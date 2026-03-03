# Nerve Kanban API Reference

All paths relative to server origin. Content-Type: `application/json` for all request bodies.

---

## Type Definitions

### TaskStatus
```typescript
type TaskStatus = 'backlog' | 'todo' | 'in-progress' | 'review' | 'done' | 'cancelled';
```

### TaskPriority
```typescript
type TaskPriority = 'critical' | 'high' | 'normal' | 'low';
```

### TaskActor
```typescript
type TaskActor = 'operator' | `agent:${string}`;
```

### ThinkingLevel
```typescript
type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';
```

### ProposalStatus
```typescript
type ProposalStatus = 'pending' | 'approved' | 'rejected';
```

### KanbanTask
```typescript
interface KanbanTask {
  id: string;                // URL-safe slug derived from title
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdBy: TaskActor;
  createdAt: number;         // epoch ms
  updatedAt: number;         // epoch ms
  version: number;           // CAS version, starts at 1
  sourceSessionKey?: string;
  assignee?: TaskActor;
  labels: string[];
  columnOrder: number;       // position within column
  run?: TaskRunLink;
  result?: string;           // agent output after execution
  resultAt?: number;         // epoch ms
  model?: string;            // LLM model override
  thinking?: ThinkingLevel;
  dueAt?: number;            // epoch ms
  estimateMin?: number;
  actualMin?: number;
  feedback: TaskFeedback[];
}
```

### TaskRunLink
```typescript
interface TaskRunLink {
  sessionKey: string;
  sessionId?: string;
  runId?: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'done' | 'error' | 'aborted';
  error?: string;
}
```

### TaskFeedback
```typescript
interface TaskFeedback {
  at: number;
  by: TaskActor;
  note: string;
}
```

### KanbanBoardConfig
```typescript
interface KanbanBoardConfig {
  columns: Array<{
    key: TaskStatus;
    title: string;
    wipLimit?: number;
    visible: boolean;
  }>;
  defaults: {
    status: TaskStatus;     // default for new tasks
    priority: TaskPriority; // default for new tasks
  };
  reviewRequired: boolean;
  allowDoneDragBypass: boolean;
  quickViewLimit: number;
  proposalPolicy: 'confirm' | 'auto';
  defaultModel?: string;
  defaultThinking?: ThinkingLevel;
}
```

### KanbanProposal
```typescript
interface KanbanProposal {
  id: string;               // UUID
  type: 'create' | 'update';
  payload: Record<string, unknown>;
  sourceSessionKey?: string;
  proposedBy: TaskActor;
  proposedAt: number;       // epoch ms
  status: ProposalStatus;
  version: number;
  resolvedAt?: number;
  resolvedBy?: TaskActor;
  reason?: string;          // rejection reason
  resultTaskId?: string;    // created/updated task ID on approval
}
```

### TaskListResult (pagination envelope)
```typescript
interface TaskListResult {
  items: KanbanTask[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
```

---

## Error Responses

All errors return JSON:

| Error Code | HTTP Status | Shape |
|---|---|---|
| `validation_error` | 400 | `{ error, details }` |
| `not_found` | 404 | `{ error, details }` |
| `version_conflict` | 409 | `{ error, serverVersion, latest }` |
| `invalid_transition` | 409 | `{ error, from, to, message }` |
| `already_resolved` | 409 | `{ error, proposal }` |

---

## Endpoints

### GET /api/kanban/tasks

List tasks with optional filters and pagination.

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `status` | string (repeatable, comma-separated) | Filter by status(es) |
| `priority` | string (repeatable, comma-separated) | Filter by priority(ies) |
| `assignee` | string | Filter by assignee (e.g. `operator`, `agent:kim`) |
| `label` | string | Filter by label |
| `q` | string | Full-text search (title, description, labels) |
| `limit` | number | Page size (default 50, max 200) |
| `offset` | number | Skip N tasks (default 0) |

**Response:** `TaskListResult`

**Sort order:** status column order → columnOrder → updatedAt desc.

```bash
# List all todo tasks
curl 'http://localhost:3000/api/kanban/tasks?status=todo'

# Search with pagination
curl 'http://localhost:3000/api/kanban/tasks?q=deploy&limit=10&offset=0'

# Multiple status filters
curl 'http://localhost:3000/api/kanban/tasks?status=todo,in-progress'
```

---

### POST /api/kanban/tasks

Create a new task.

**Body:**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `title` | string (1-500) | **yes** | | |
| `description` | string (max 10000) | no | | |
| `status` | TaskStatus | no | config default | |
| `priority` | TaskPriority | no | config default | |
| `createdBy` | TaskActor | no | `"operator"` | |
| `sourceSessionKey` | string (max 500) | no | | |
| `assignee` | TaskActor | no | | |
| `labels` | string[] (max 50 items, 100 chars each) | no | `[]` | |
| `model` | string (max 200) | no | | LLM model for execution |
| `thinking` | ThinkingLevel | no | | |
| `dueAt` | number | no | | epoch ms |
| `estimateMin` | number (≥0) | no | | |

**Response:** `201` with `KanbanTask`. ID is a URL-safe slug derived from title.

```bash
curl -X POST http://localhost:3000/api/kanban/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Fix login bug",
    "description": "Users report 500 on /auth/login with special chars",
    "priority": "high",
    "labels": ["bug", "auth"]
  }'
```

---

### PATCH /api/kanban/tasks/:id

Update a task. Requires CAS version.

**Path params:** `id` - task ID (slug)

**Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | number | **yes** | Must match current version |
| `title` | string (1-500) | no | |
| `description` | string \| null | no | null clears |
| `status` | TaskStatus | no | |
| `priority` | TaskPriority | no | |
| `assignee` | TaskActor \| null | no | null clears |
| `labels` | string[] | no | |
| `model` | string \| null | no | null clears |
| `thinking` | ThinkingLevel \| null | no | null clears |
| `dueAt` | number \| null | no | null clears |
| `estimateMin` | number \| null | no | null clears |
| `actualMin` | number \| null | no | null clears |
| `result` | string \| null | no | null clears |
| `resultAt` | number \| null | no | null clears |
| `run` | TaskRunLink \| null | no | null clears |
| `feedback` | TaskFeedback[] | no | |

**Response:** `200` with updated `KanbanTask` (version incremented).

**Errors:** `409 version_conflict` if version mismatches (response includes `serverVersion` and `latest` task).

```bash
curl -X PATCH http://localhost:3000/api/kanban/tasks/fix-login-bug \
  -H 'Content-Type: application/json' \
  -d '{
    "version": 1,
    "priority": "critical",
    "labels": ["bug", "auth", "urgent"]
  }'
```

---

### DELETE /api/kanban/tasks/:id

Permanently delete a task.

**Path params:** `id` - task ID

**Response:** `200` `{ "ok": true }`

**Errors:** `404` if not found.

```bash
curl -X DELETE http://localhost:3000/api/kanban/tasks/fix-login-bug
```

---

### POST /api/kanban/tasks/:id/reorder

Move a task to a different column and/or position.

**Path params:** `id` - task ID

**Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | number | **yes** | CAS version |
| `targetStatus` | TaskStatus | **yes** | Destination column |
| `targetIndex` | number (≥0) | **yes** | Position in column (0-based) |

**Response:** `200` with updated `KanbanTask`.

**Errors:** `409 version_conflict` on stale version.

```bash
curl -X POST http://localhost:3000/api/kanban/tasks/fix-login-bug/reorder \
  -H 'Content-Type: application/json' \
  -d '{ "version": 2, "targetStatus": "in-progress", "targetIndex": 0 }'
```

---

### POST /api/kanban/tasks/:id/execute

Start execution. Moves task from `todo`/`backlog` → `in-progress` and spawns an agent session.

**Path params:** `id` - task ID

**Body (optional):**

| Field | Type | Notes |
|---|---|---|
| `model` | string (max 200) | Override model for this run |
| `thinking` | ThinkingLevel | Override thinking level |

**Response:** `200` with updated `KanbanTask` (status=`in-progress`, `run.status`=`running`).

**Errors:** `409 invalid_transition` if task is not in `todo` or `backlog`.

**Side effects:** Spawns a gateway subagent session with label `kb-<id>`. Background poller watches for completion and auto-transitions to `review`.

```bash
curl -X POST http://localhost:3000/api/kanban/tasks/fix-login-bug/execute \
  -H 'Content-Type: application/json' \
  -d '{ "model": "claude-sonnet-4-20250514" }'
```

---

### POST /api/kanban/tasks/:id/approve

Approve a task in review. Moves `review` → `done`.

**Path params:** `id` - task ID

**Body (optional):**

| Field | Type | Notes |
|---|---|---|
| `note` | string (max 5000) | Approval note (added to feedback) |

**Response:** `200` with updated `KanbanTask`.

**Errors:** `409 invalid_transition` if not in `review`.

```bash
curl -X POST http://localhost:3000/api/kanban/tasks/fix-login-bug/approve \
  -H 'Content-Type: application/json' \
  -d '{ "note": "Looks good, merging." }'
```

---

### POST /api/kanban/tasks/:id/reject

Reject a task in review. Moves `review` → `todo`. Clears the run and result so it can be re-executed.

**Path params:** `id` - task ID

**Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `note` | string (1-5000) | **yes** | Rejection reason (added to feedback) |

**Response:** `200` with updated `KanbanTask`.

**Errors:** `409 invalid_transition` if not in `review`.

```bash
curl -X POST http://localhost:3000/api/kanban/tasks/fix-login-bug/reject \
  -H 'Content-Type: application/json' \
  -d '{ "note": "Missed edge case with unicode chars. Retry." }'
```

---

### POST /api/kanban/tasks/:id/abort

Abort a running task. Moves `in-progress` → `todo`, marks run as `aborted`.

**Path params:** `id` - task ID

**Body (optional):**

| Field | Type | Notes |
|---|---|---|
| `note` | string (max 5000) | Abort reason (added to feedback) |

**Response:** `200` with updated `KanbanTask`.

**Errors:** `409 invalid_transition` if not in `in-progress` with an active run.

```bash
curl -X POST http://localhost:3000/api/kanban/tasks/fix-login-bug/abort \
  -H 'Content-Type: application/json' \
  -d '{ "note": "Taking too long, will rethink approach." }'
```

---

### POST /api/kanban/tasks/:id/complete

Webhook to mark a run as complete. Called automatically by the background poller, but can also be called externally.

**Path params:** `id` - task ID

**Body (optional):**

| Field | Type | Notes |
|---|---|---|
| `result` | string (max 50000) | Agent output. Kanban markers are auto-extracted as proposals. |
| `error` | string (max 5000) | If set, marks run as error and moves task to `todo`. |

**Behavior:**
- With `error`: run status → `error`, task → `todo`.
- Without `error`: run status → `done`, task → `review`, `result` stored on task.

**Response:** `200` with updated `KanbanTask`.

```bash
# Success
curl -X POST http://localhost:3000/api/kanban/tasks/fix-login-bug/complete \
  -H 'Content-Type: application/json' \
  -d '{ "result": "Fixed the bug. Escaped special chars in auth handler." }'

# Error
curl -X POST http://localhost:3000/api/kanban/tasks/fix-login-bug/complete \
  -H 'Content-Type: application/json' \
  -d '{ "error": "Agent timed out" }'
```

---

### GET /api/kanban/config

Get board configuration.

**Response:** `KanbanBoardConfig`

```bash
curl http://localhost:3000/api/kanban/config
```

---

### PUT /api/kanban/config

Update board configuration. Partial updates supported (unset fields keep current values).

**Body:** Any subset of `KanbanBoardConfig` fields:

| Field | Type | Notes |
|---|---|---|
| `columns` | Column[] (1-10) | Full replacement if provided |
| `defaults` | `{ status, priority }` | Merged with existing |
| `reviewRequired` | boolean | |
| `allowDoneDragBypass` | boolean | |
| `quickViewLimit` | number (1-50) | |
| `proposalPolicy` | `'confirm'` \| `'auto'` | `auto` = proposals auto-approve |
| `defaultModel` | string (max 100) | Default model for task execution |
| `defaultThinking` | ThinkingLevel | Default thinking level |

**Column shape:**
```typescript
{ key: TaskStatus, title: string, wipLimit?: number, visible: boolean }
```

**Response:** `200` with full updated `KanbanBoardConfig`.

```bash
curl -X PUT http://localhost:3000/api/kanban/config \
  -H 'Content-Type: application/json' \
  -d '{
    "proposalPolicy": "auto",
    "defaultModel": "claude-sonnet-4-20250514",
    "defaults": { "priority": "high" }
  }'
```

---

### GET /api/kanban/proposals

List proposals, optionally filtered by status.

**Query Parameters:**

| Param | Type | Notes |
|---|---|---|
| `status` | ProposalStatus | `pending`, `approved`, or `rejected` |

**Response:** `{ proposals: KanbanProposal[] }` (sorted most recent first).

```bash
# All pending proposals
curl 'http://localhost:3000/api/kanban/proposals?status=pending'
```

---

### POST /api/kanban/proposals

Create a proposal for task creation or update.

**Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | `'create'` \| `'update'` | **yes** | |
| `payload` | object | **yes** | See below |
| `sourceSessionKey` | string (max 500) | no | |
| `proposedBy` | TaskActor | no | default `"operator"` |

**Payload for `type: 'create'`:**

| Field | Type | Required |
|---|---|---|
| `title` | string (1-500) | **yes** |
| `description` | string (max 10000) | no |
| `status` | TaskStatus | no |
| `priority` | TaskPriority | no |
| `assignee` | TaskActor | no |
| `labels` | string[] | no |
| `model` | string | no |
| `thinking` | ThinkingLevel | no |
| `dueAt` | number | no |
| `estimateMin` | number | no |

**Payload for `type: 'update'`:**

| Field | Type | Required |
|---|---|---|
| `id` | string | **yes** |
| `title` | string (1-500) | no |
| `description` | string (max 10000) | no |
| `status` | TaskStatus | no |
| `priority` | TaskPriority | no |
| `assignee` | TaskActor | no |
| `labels` | string[] | no |
| `result` | string (max 50000) | no |

**Behavior:** If board `proposalPolicy` is `'auto'`, the proposal is immediately applied and returned as `approved`. Otherwise it stays `pending`.

**Response:** `201` with `KanbanProposal`.

```bash
# Agent proposes a new task
curl -X POST http://localhost:3000/api/kanban/proposals \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "create",
    "payload": { "title": "Add rate limiting to uploads", "priority": "high" },
    "proposedBy": "agent:kim"
  }'

# Agent proposes updating an existing task
curl -X POST http://localhost:3000/api/kanban/proposals \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "update",
    "payload": { "id": "fix-login-bug", "status": "done", "result": "Fixed and deployed." },
    "proposedBy": "agent:kim"
  }'
```

---

### POST /api/kanban/proposals/:id/approve

Approve a pending proposal. Executes the proposed action (creates/updates the task).

**Path params:** `id` - proposal UUID

**Response:** `200` with `{ proposal: KanbanProposal, task: KanbanTask }`.

**Errors:**
- `404` if proposal not found.
- `409 already_resolved` if proposal was already approved/rejected.

```bash
curl -X POST http://localhost:3000/api/kanban/proposals/abc-uuid/approve
```

---

### POST /api/kanban/proposals/:id/reject

Reject a pending proposal.

**Path params:** `id` - proposal UUID

**Body (optional):**

| Field | Type | Notes |
|---|---|---|
| `reason` | string (max 5000) | Rejection reason |

**Response:** `200` with `{ proposal: KanbanProposal }`.

**Errors:**
- `404` if proposal not found.
- `409 already_resolved` if already resolved.

```bash
curl -X POST http://localhost:3000/api/kanban/proposals/abc-uuid/reject \
  -H 'Content-Type: application/json' \
  -d '{ "reason": "Not needed right now." }'
```

---

## Task Lifecycle / State Machine

```text
backlog ──┐
          ├──→ in-progress ──→ review ──→ done
todo ─────┘       │              │
                  │ (abort)      │ (reject)
                  └──→ todo ←────┘
```

**Valid transitions via workflow endpoints:**

| From | To | Endpoint | Notes |
|---|---|---|---|
| `todo`, `backlog` | `in-progress` | `/execute` | Spawns agent |
| `in-progress` | `review` | (automatic) | On run completion |
| `in-progress` | `todo` | `/abort` | Cancels run |
| `review` | `done` | `/approve` | |
| `review` | `todo` | `/reject` | Clears run + result |

Direct status changes via PATCH are also possible but bypass workflow guardrails.

## Fetch Examples (JavaScript)

```javascript
// List todo tasks
const res = await fetch('http://localhost:3000/api/kanban/tasks?status=todo');
const { items, total, hasMore } = await res.json();

// Create a task
const task = await fetch('http://localhost:3000/api/kanban/tasks', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Implement caching layer',
    description: 'Add Redis caching for API responses',
    priority: 'high',
    labels: ['backend', 'performance'],
  }),
}).then(r => r.json());

// Update with CAS
const updated = await fetch(`http://localhost:3000/api/kanban/tasks/${task.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    version: task.version,
    assignee: 'agent:kim',
  }),
}).then(r => r.json());

// Execute
await fetch(`http://localhost:3000/api/kanban/tasks/${task.id}/execute`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'claude-sonnet-4-20250514' }),
});
```
