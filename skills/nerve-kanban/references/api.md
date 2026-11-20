# Nerve Kanban API reference

All paths are relative to the Nerve server origin. The examples use `$NERVE_URL` for it, for example `http://localhost:3080` (3080 is the default `PORT`; use whatever host and port your Nerve instance listens on). Send `Content-Type: application/json` with every request body.

**Authentication:** when Nerve runs with `NERVE_AUTH=true`, every `/api/kanban` request needs the session cookie from `POST /api/auth/login` (body `{ "password": "..." }`). Without it you get `401 { "error": "Authentication required" }` (or `"Invalid or expired session"`). With auth off, no cookie is needed.

```bash
export NERVE_URL=http://localhost:3080
# Only when auth is on: log in once and reuse the cookie jar with -b
curl -c /tmp/nerve.cookies -X POST "$NERVE_URL/api/auth/login" \
  -H 'Content-Type: application/json' -d '{ "password": "<password>" }'
```

**Rate limit:** every Kanban route allows 60 requests per minute per client and path. Over the limit you get `429` with a plain-text body.

---

## Type definitions

### TaskStatus
```typescript
// Lowercase kebab-case, 1 to 64 chars. Must be a built-in status or a key in the board config's columns.
type TaskStatus = string;
// Built-in: 'backlog' | 'todo' | 'in-progress' | 'review' | 'done' | 'cancelled'
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
Optional fields are left out of the JSON when unset.
```typescript
interface KanbanTask {
  id: string;                // slug from the title (max 30 chars), "-2", "-3"... on clash; never changes
  title: string;             // 1 to 500 chars
  description?: string;      // max 10000 chars
  status: TaskStatus;
  priority: TaskPriority;
  createdBy: TaskActor;      // as sent by the creator, default "operator"
  createdAt: number;         // epoch ms
  updatedAt: number;         // epoch ms
  version: number;           // CAS version: starts at 1, +1 on every PATCH, reorder, workflow transition, applied update proposal
  sourceSessionKey?: string;
  assignee?: TaskActor;      // canonical form, see "Assignee rules"
  labels: string[];          // max 50, each max 100 chars
  columnOrder: number;       // position within the column, lowest first
  run?: TaskRunLink;         // server-owned, PATCH ignores it
  result?: string;           // agent result, Kanban markers stripped
  resultAt?: number;         // epoch ms
  model?: string;            // model override for execution
  thinking?: ThinkingLevel;
  dueAt?: number;            // epoch ms
  estimateMin?: number;
  actualMin?: number;
  feedback: TaskFeedback[];  // added by approve (with note), reject, abort (with note)
}
```

### TaskRunLink
```typescript
interface TaskRunLink {
  sessionKey: string;        // run correlation key: "kb-<id>-<ms>" (sessions_spawn) or "kanban-root:kb-..." (assigned)
  childSessionKey?: string;  // real worker session key, attached after launch
  sessionId?: string;        // same value as childSessionKey
  runId?: string;            // gateway run ID when returned
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'done' | 'error' | 'aborted';
  error?: string;            // e.g. "Spawn failed: ...", "Run timed out (polling limit reached)"
}
```

### TaskFeedback
```typescript
interface TaskFeedback {
  at: number;
  by: TaskActor;             // workflow endpoints always record "operator"
  note: string;
}
```

### KanbanBoardConfig
```typescript
interface KanbanBoardConfig {
  columns: Array<{
    key: TaskStatus;         // custom keys allowed
    title: string;           // 1 to 100 chars
    wipLimit?: number;       // integer >= 0, stored only, not enforced
    visible: boolean;        // whether the board shows the column
  }>;                        // 1 to 10; must include backlog, todo, in-progress, review, done
  defaults: {
    status: TaskStatus;      // default "todo"
    priority: TaskPriority;  // default "normal"
  };
  reviewRequired: boolean;       // default true, stored only
  allowDoneDragBypass: boolean;  // default false, stored only
  quickViewLimit: number;        // default 5, integer 1 to 50, stored only
  proposalPolicy: 'confirm' | 'auto';  // default "confirm"
  defaultModel?: string;         // max 100 chars, unset by default
  defaultThinking?: string;      // any string, max 20 chars, unset by default
}
```

### KanbanProposal
```typescript
interface KanbanProposal {
  id: string;               // UUID
  type: 'create' | 'update';
  payload: Record<string, unknown>;  // assignee canonicalized
  sourceSessionKey?: string;
  proposedBy: TaskActor;
  proposedAt: number;       // epoch ms
  status: ProposalStatus;
  version: number;          // 1 when created, 2 after API approve/reject; not used for concurrency
  resolvedAt?: number;
  resolvedBy?: TaskActor;   // "operator" via the API, the proposer under auto policy
  reason?: string;          // rejection reason
  resultTaskId?: string;    // created or updated task ID
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

### Assignee rules

- Accepted: `"operator"` and `"agent:<id>"`. Anything after the agent ID is dropped: `agent:designer:main` is stored as `agent:designer`.
- `agent:main` (with or without a suffix) is rejected: `400 { "error": "validation_error", "details": "Invalid Kanban assignee: agent:main" }`.
- The assignee decides how `execute` launches the task. A stored legacy `agent:main` counts as unassigned.

---

## Error responses

Handler errors are JSON:

| Error code | HTTP status | Shape | When |
|---|---|---|---|
| `validation_error` | 400 | `{ error, details }` | Invalid JSON (`details: "Invalid JSON body"`), schema failure (`details` is `<field>: <message>` pairs joined by `; `), invalid assignee, invalid proposal status filter |
| `validation_error` | 400 | `{ error, details, allowed }` | Well-formed status that the board does not allow. `details: "status: Unknown status \"<status>\""` |
| `validation_error` | 400 | `{ error, details, statuses }` | Board config: `Missing required board columns: ...` or `Cannot remove columns still in use: ...` |
| `not_found` | 404 | `{ error, details }` | `Task not found: <id>`, `Proposal not found: <id>`, `Referenced task not found: <id>`. `GET /api/kanban/tasks/:id` returns `{ error }` only |
| `version_conflict` | 409 | `{ error, serverVersion, latest }` | PATCH or reorder with a stale `version`. `latest` is the current task |
| `invalid_transition` | 409 | `{ error, from, to, message }` | Workflow action not allowed from the task's current state |
| `duplicate_execution` | 409 | `{ error, details }` | Execute on a task that is already `in-progress`. `details: "Task is already being executed"` |
| `invalid_execution_target` | 409 | `{ error, details }` | Execute: the assignee's root session is missing, or macOS and the task is unassigned |
| `already_resolved` | 409 | `{ error, proposal }` | Approve or reject on a proposal that is not `pending` |

Outside the handlers: `401` JSON from the auth middleware, `429` plain text from the rate limiter, `500 { "error": "Internal server error" }` for unexpected failures (for example a failed gateway session lookup during execute).

---

## Endpoints

### GET /api/kanban/tasks

List tasks with optional filters and pagination.

**Query parameters:**

| Param | Type | Description |
|---|---|---|
| `status` | string (repeatable, comma-separated; `status[]` also works) | Filter by status(es) |
| `priority` | string (repeatable, comma-separated; `priority[]` also works) | Filter by priority(ies) |
| `assignee` | string | Exact match on the stored assignee (e.g. `operator`, `agent:designer`) |
| `label` | string | Exact label match (only the first `label` parameter is used) |
| `q` | string | Case-insensitive substring search over title, description, labels |
| `limit` | number | Page size (default 50, clamped to 1 to 200) |
| `offset` | number | Skip N tasks (default 0) |

Filter values are not validated; an unknown status matches nothing.

**Response:** `200` with `TaskListResult`.

**Sort order:** board column order, then `columnOrder`, then `updatedAt` descending.

```bash
# List all todo tasks
curl "$NERVE_URL/api/kanban/tasks?status=todo"

# Search with pagination
curl "$NERVE_URL/api/kanban/tasks?q=deploy&limit=10&offset=0"

# Multiple status filters
curl "$NERVE_URL/api/kanban/tasks?status=todo,in-progress"
```

---

### GET /api/kanban/tasks/:id

Fetch one task.

**Response:** `200` with `KanbanTask`.

**Errors:** `404 { "error": "not_found" }` (no `details` on this route).

```bash
curl "$NERVE_URL/api/kanban/tasks/fix-login-bug"
```

---

### POST /api/kanban/tasks

Create a task. It is appended to the end of its column.

**Body:**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `title` | string (1 to 500) | **yes** | | |
| `description` | string (max 10000) | no | | |
| `status` | TaskStatus | no | config `defaults.status` | Any allowed status, no workflow check |
| `priority` | TaskPriority | no | config `defaults.priority` | |
| `createdBy` | TaskActor | no | `"operator"` | |
| `sourceSessionKey` | string (max 500) | no | | |
| `assignee` | TaskActor | no | | Canonicalized, `agent:main` rejected |
| `labels` | string[] (max 50 items, 100 chars each) | no | `[]` | |
| `model` | string (max 200) | no | | Model for execution |
| `thinking` | ThinkingLevel | no | | |
| `dueAt` | number | no | | epoch ms |
| `estimateMin` | number (0 or more) | no | | |

**Response:** `201` with `KanbanTask` (`version: 1`).

**Errors:** `400 validation_error` (bad JSON or fields, unknown status with `allowed`, invalid assignee).

```bash
curl -X POST "$NERVE_URL/api/kanban/tasks" \
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

Update a task. Requires the CAS version. Omitted fields are left alone; `null` clears a nullable field.

**Path params:** `id`: task ID (slug)

**Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | number (integer, 1 or more) | **yes** | Must match the current version |
| `title` | string (1 to 500) | no | |
| `description` | string (max 10000) \| null | no | null clears |
| `status` | TaskStatus | no | No workflow check; moves to the end of the new column |
| `priority` | TaskPriority | no | |
| `assignee` | TaskActor \| null | no | Canonicalized; null clears |
| `labels` | string[] (max 50, 100 chars each) | no | Replaces all labels |
| `model` | string (max 200) \| null | no | null clears |
| `thinking` | ThinkingLevel \| null | no | null clears |
| `dueAt` | number \| null | no | null clears |
| `estimateMin` | number (0 or more) \| null | no | null clears |
| `actualMin` | number (0 or more) \| null | no | null clears |
| `result` | string (max 50000) \| null | no | null clears |
| `resultAt` | number \| null | no | null clears |
| `feedback` | TaskFeedback[] | no | Replaces the whole list |
| `run` | TaskRunLink \| null | no | Accepted but ignored (server-owned) |

**Response:** `200` with the updated `KanbanTask` (version incremented).

**Errors:** `400 validation_error`, `404 not_found`, `409 version_conflict` (`{ error, serverVersion, latest }`).

```bash
curl -X PATCH "$NERVE_URL/api/kanban/tasks/fix-login-bug" \
  -H 'Content-Type: application/json' \
  -d '{
    "version": 1,
    "priority": "critical",
    "labels": ["bug", "auth", "urgent"]
  }'
```

---

### DELETE /api/kanban/tasks/:id

Permanently delete a task. Any status, no version needed. Does not stop a running agent session.

**Path params:** `id`: task ID

**Response:** `200` `{ "ok": true }`

**Errors:** `404 not_found`.

```bash
curl -X DELETE "$NERVE_URL/api/kanban/tasks/fix-login-bug"
```

---

### POST /api/kanban/tasks/:id/reorder

Move a task to a position in its own column or another column. A plain move: no workflow check, and the run is not touched (moving to `in-progress` does not start a run).

**Path params:** `id`: task ID

**Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | number (integer, 1 or more) | **yes** | CAS version |
| `targetStatus` | TaskStatus | **yes** | Destination column (any allowed status) |
| `targetIndex` | number (integer, 0 or more) | **yes** | Zero-based position; past the end is clamped to the end |

The target column is renumbered `0, 1, 2...` with the task inserted at `targetIndex`. Only the moved task's `version` goes up.

**Response:** `200` with the moved `KanbanTask`.

**Errors:** `400 validation_error`, `404 not_found`, `409 version_conflict`.

```bash
curl -X POST "$NERVE_URL/api/kanban/tasks/fix-login-bug/reorder" \
  -H 'Content-Type: application/json' \
  -d '{ "version": 2, "targetStatus": "todo", "targetIndex": 0 }'
```

---

### POST /api/kanban/tasks/:id/execute

Start an agent run. Moves the task from `todo` or `backlog` to `in-progress` and launches the worker in the background; the response comes back before the launch finishes.

**Path params:** `id`: task ID

**Body (optional, may be empty):**

| Field | Type | Notes |
|---|---|---|
| `model` | string (max 200) | Model for this run, saved on the task |
| `thinking` | ThinkingLevel | Thinking level for this run, saved on the task |

**Launch settings:** model is request, then task `model`, then config `defaultModel` (no model is sent if all are unset). Thinking is request, then task `thinking`, then config `defaultThinking`; empty or `off` launches as `low`. The prompt contains the task title and description.

**How the worker is launched:**
- Assigned to `agent:<id>`: Nerve checks that `agent:<id>:main` exists, creates a child session `agent:<id>:subagent:<uuid>` under it (`sessions.create`), sends the prompt (`sessions.send`), polls until the child is done, and posts a completion report back into `agent:<id>:main`. Works on every platform.
- Unassigned or `operator`: launched with the gateway `sessions_spawn` tool and tracked through the `subagents` and `sessions_history` tools. On macOS this is rejected with `409 invalid_execution_target`; assign the task to a live worker agent first.

**Response:** `200` with the updated `KanbanTask` (`status: "in-progress"`, `run.status: "running"`, `result` and `resultAt` cleared). `run.childSessionKey` and `run.runId` are attached later.

**Completion:** the server checks 3 seconds after launch, then every 5 seconds, up to 720 checks (about 60 minutes). Success moves the task to `review` with the agent's last message as `result` (markers become proposals and are stripped). Failure, launch failure (`run.error: "Spawn failed: ..."`) or timeout (`"Run timed out (polling limit reached)"`) moves it back to `todo` with `run.status: "error"`.

**Errors:**
- `400 validation_error`: invalid JSON or fields.
- `404 not_found`.
- `409 duplicate_execution`: task is already `in-progress`, with or without an active run (`details: "Task is already being executed"`).
- `409 invalid_execution_target`: `Parent agent session not found: agent:<id>:main`, or on macOS `Kanban automation on macOS requires assigning the task to a live worker agent root (not @main).`
- `409 invalid_transition`: task not in `todo` or `backlog` (`message: Cannot execute task in "<status>" status; must be "todo" or "backlog"`).
- `500`: the gateway session lookup for an assigned task failed.

```bash
curl -X POST "$NERVE_URL/api/kanban/tasks/fix-login-bug/execute" \
  -H 'Content-Type: application/json' \
  -d '{ "thinking": "medium" }'
```

---

### POST /api/kanban/tasks/:id/approve

Approve a task in review: `review` to `done`.

**Path params:** `id`: task ID

**Body (optional):**

| Field | Type | Notes |
|---|---|---|
| `note` | string (max 5000) | Added to feedback as `operator` |

**Response:** `200` with the updated `KanbanTask`.

**Errors:** `400 validation_error`, `404 not_found`, `409 invalid_transition` if not in `review` (`Cannot approve task in "<status>" status; must be "review"`).

```bash
curl -X POST "$NERVE_URL/api/kanban/tasks/fix-login-bug/approve" \
  -H 'Content-Type: application/json' \
  -d '{ "note": "Looks good, merging." }'
```

---

### POST /api/kanban/tasks/:id/reject

Reject a task in review: `review` to `todo`. Clears `run`, `result` and `resultAt` so it can be executed again.

**Path params:** `id`: task ID

**Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `note` | string (1 to 5000) | **yes** | Added to feedback as `operator` |

**Response:** `200` with the updated `KanbanTask`.

**Errors:** `400 validation_error` (missing body or note), `404 not_found`, `409 invalid_transition` if not in `review` (`Cannot reject task in "<status>" status; must be "review"`).

```bash
curl -X POST "$NERVE_URL/api/kanban/tasks/fix-login-bug/reject" \
  -H 'Content-Type: application/json' \
  -d '{ "note": "Missed edge case with unicode chars. Retry." }'
```

---

### POST /api/kanban/tasks/:id/abort

Abort a running task: `in-progress` to `todo`, run marked `aborted`. Nerve stops tracking the run but sends nothing to the gateway, so the agent session itself is not stopped.

**Path params:** `id`: task ID

**Body (optional):**

| Field | Type | Notes |
|---|---|---|
| `note` | string (max 5000) | Added to feedback as `operator` |

**Response:** `200` with the updated `KanbanTask`.

**Errors:** `400 validation_error`, `404 not_found`, `409 invalid_transition` if not `in-progress` with a running run (`Cannot abort task: must be "in-progress" with an active run`).

```bash
curl -X POST "$NERVE_URL/api/kanban/tasks/fix-login-bug/abort" \
  -H 'Content-Type: application/json' \
  -d '{ "note": "Taking too long, will rethink approach." }'
```

---

### POST /api/kanban/tasks/:id/complete

Complete the task's active run yourself. Nerve's own pollers update the store directly and do not call this endpoint. No separate webhook secret: same authentication as every other route.

**Path params:** `id`: task ID

**Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `sessionKey` | string (1 to 500) | **yes** | Must match the run's `sessionKey`, `childSessionKey`, `sessionId` or `runId` |
| `result` | string (max 50000) | no | Agent output. Kanban markers become proposals and are stripped |
| `error` | string (max 5000) | no | Marks the run failed |

**Behavior:**
- With `error`: run `status` becomes `error`, task goes to `todo`, `result` is cleared, markers are not parsed.
- Without `error`: run `status` becomes `done`, task goes to `review`, a non-empty `result` is stored with `resultAt`. Marker proposals get `proposedBy: "agent:<sessionKey>"`.

**Response:** `200` with the updated `KanbanTask`.

**Errors:** `400 validation_error` (including a missing `sessionKey`), `404 not_found`, `409 invalid_transition` with `message` `No active run to complete on task "<id>"` or `Run key mismatch for task "<id>": active run is "<key>", got "<sessionKey>"` (nothing is changed).

```bash
# Success
curl -X POST "$NERVE_URL/api/kanban/tasks/fix-login-bug/complete" \
  -H 'Content-Type: application/json' \
  -d '{ "sessionKey": "kb-fix-login-bug-1708100000000", "result": "Fixed the bug. Escaped special chars in auth handler." }'

# Error
curl -X POST "$NERVE_URL/api/kanban/tasks/fix-login-bug/complete" \
  -H 'Content-Type: application/json' \
  -d '{ "sessionKey": "kb-fix-login-bug-1708100000000", "error": "Agent timed out" }'
```

---

### GET /api/kanban/proposals

List proposals, optionally filtered by status.

**Query parameters:**

| Param | Type | Notes |
|---|---|---|
| `status` | ProposalStatus | `pending`, `approved`, or `rejected` |

**Response:** `200` `{ proposals: KanbanProposal[] }`, most recent first.

**Errors:** `400 { "error": "validation_error", "details": "Invalid status filter" }`.

```bash
# All pending proposals
curl "$NERVE_URL/api/kanban/proposals?status=pending"
```

---

### POST /api/kanban/proposals

Create a proposal for a task creation or update.

**Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | `'create'` \| `'update'` | **yes** | |
| `payload` | object | **yes** | See below; unknown keys are dropped |
| `sourceSessionKey` | string (max 500) | no | |
| `proposedBy` | TaskActor | no | default `"operator"` |

**Payload for `type: 'create'`:**

| Field | Type | Required |
|---|---|---|
| `title` | string (1 to 500) | **yes** |
| `description` | string (max 10000) | no |
| `status` | TaskStatus | no |
| `priority` | TaskPriority | no |
| `assignee` | TaskActor | no |
| `labels` | string[] (max 50, 100 chars each) | no |
| `model` | string (max 200) | no |
| `thinking` | ThinkingLevel | no |
| `dueAt` | number | no |
| `estimateMin` | number (0 or more) | no |

The created task gets `createdBy` set to the proposal's `proposedBy`.

**Payload for `type: 'update'`:**

| Field | Type | Required |
|---|---|---|
| `id` | string (existing task) | **yes** |
| `title` | string (1 to 500) | no |
| `description` | string (max 10000) | no |
| `status` | TaskStatus | no |
| `priority` | TaskPriority | no |
| `assignee` | TaskActor | no |
| `labels` | string[] (max 50, 100 chars each) | no |
| `result` | string (max 50000) | no |

Applying an update skips the version check and workflow checks and increments the task's `version`.

**Behavior:** with `proposalPolicy: "confirm"` (default) the proposal stays `pending`. With `"auto"` it is applied at once and returned as `approved` with `resultTaskId` set and `resolvedBy` equal to `proposedBy`.

**Response:** `201` with `KanbanProposal`.

**Errors:** `400 validation_error` (bad JSON, payload, status with `allowed`, assignee), `404 { "error": "not_found", "details": "Referenced task not found: <id>" }` for an update of a missing task.

```bash
# Agent proposes a new task
curl -X POST "$NERVE_URL/api/kanban/proposals" \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "create",
    "payload": { "title": "Add rate limiting to uploads", "priority": "high" },
    "proposedBy": "agent:designer"
  }'

# Agent proposes updating an existing task
curl -X POST "$NERVE_URL/api/kanban/proposals" \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "update",
    "payload": { "id": "fix-login-bug", "status": "done", "result": "Fixed and deployed." },
    "proposedBy": "agent:designer"
  }'
```

---

### POST /api/kanban/proposals/:id/approve

Approve a pending proposal and apply it (create or update the task). No body.

**Path params:** `id`: proposal UUID

**Response:** `200` with `{ proposal: KanbanProposal, task: KanbanTask }`.

**Errors:**
- `400 validation_error` if the proposed status is no longer allowed.
- `404 not_found` if the proposal (`Proposal not found: <id>`) or, for an update, the task (`Task not found: <id>`) does not exist.
- `409 already_resolved` (`{ error, proposal }`) if it was already approved or rejected.

```bash
curl -X POST "$NERVE_URL/api/kanban/proposals/<proposal-id>/approve"
```

---

### POST /api/kanban/proposals/:id/reject

Reject a pending proposal.

**Path params:** `id`: proposal UUID

**Body (optional):**

| Field | Type | Notes |
|---|---|---|
| `reason` | string (max 5000) | Rejection reason |

**Response:** `200` with `{ proposal: KanbanProposal }`.

**Errors:** `400 validation_error`, `404 not_found` (`Proposal not found: <id>`), `409 already_resolved`.

```bash
curl -X POST "$NERVE_URL/api/kanban/proposals/<proposal-id>/reject" \
  -H 'Content-Type: application/json' \
  -d '{ "reason": "Not needed right now." }'
```

---

### GET /api/kanban/config

Get the board configuration.

**Response:** `200` with `KanbanBoardConfig`. Defaults: columns `backlog`, `todo` ("To Do"), `in-progress`, `review`, `done` visible and `cancelled` hidden; `defaults` `{ status: "todo", priority: "normal" }`; `reviewRequired: true`; `allowDoneDragBypass: false`; `quickViewLimit: 5`; `proposalPolicy: "confirm"`. `defaultModel` and `defaultThinking` are absent until set.

```bash
curl "$NERVE_URL/api/kanban/config"
```

---

### PUT /api/kanban/config

Update the board configuration. Send only the fields to change.

**Body:** any subset of `KanbanBoardConfig` fields:

| Field | Type | Notes |
|---|---|---|
| `columns` | Column[] (1 to 10) | Replaces the whole list. Must include `backlog`, `todo`, `in-progress`, `review`, `done`. A column still used by a task or by any proposal's `status` cannot be removed |
| `defaults` | `{ status, priority }` | Both keys required when sent |
| `reviewRequired` | boolean | Stored only; nothing acts on it |
| `allowDoneDragBypass` | boolean | Stored only; nothing acts on it |
| `quickViewLimit` | integer (1 to 50) | Stored only; the quick view shows a fixed 5 rows |
| `proposalPolicy` | `'confirm'` \| `'auto'` | `auto` applies proposals immediately |
| `defaultModel` | string (max 100) | Fallback model for execute |
| `defaultThinking` | string (max 20) | Fallback thinking for execute; empty or `off` launches as `low` |

**Column shape:**
```typescript
{ key: TaskStatus, title: string /* 1 to 100 */, wipLimit?: number /* integer >= 0, not enforced */, visible: boolean }
```

**Response:** `200` with the full updated `KanbanBoardConfig`.

**Errors:** `400 validation_error`: schema failure; `{ error, details, statuses }` for `Missing required board columns: ...` or `Cannot remove columns still in use: ...`; `{ error, details, allowed }` for an unknown `defaults.status`.

```bash
curl -X PUT "$NERVE_URL/api/kanban/config" \
  -H 'Content-Type: application/json' \
  -d '{
    "proposalPolicy": "auto",
    "defaults": { "status": "todo", "priority": "high" }
  }'
```

---

## Task lifecycle

**Transitions:**

| From | To | Trigger | Notes |
|---|---|---|---|
| `todo`, `backlog` | `in-progress` | `/execute` | Launches the agent |
| `in-progress` | `review` | Run finishes (automatic, or `/complete` without `error`) | `result` stored |
| `in-progress` | `todo` | Run fails, times out or cannot launch | `run.status: "error"` |
| `in-progress` | `todo` | `/abort` | `run.status: "aborted"`; the gateway session is not stopped |
| `review` | `done` | `/approve` | |
| `review` | `todo` | `/reject` | Clears run and result |
| any | any allowed status | PATCH `status`, `/reorder`, applied update proposal | No workflow checks; the run is not touched |

No workflow endpoint moves a task to `cancelled`; use PATCH or reorder.

## Kanban markers

An agent run's result text can propose board changes with markers:

```text
[kanban:create]{"title":"Write migration guide","priority":"normal"}[/kanban:create]
[kanban:update]{"id":"fix-login-bug","labels":["bug","auth"]}[/kanban:update]
```

They are parsed when the run completes (automatically or via `/complete` without `error`): at most 5 per result, each payload at most 2048 bytes and a JSON object with a non-empty `title` (create) or `id` (update). Each becomes a proposal (subject to `proposalPolicy`) and is stripped from the stored `result`. Marker payloads skip the HTTP payload schemas; only `status` and `assignee` are checked, and an invalid marker is skipped.

## Fetch examples (JavaScript)

```javascript
const NERVE_URL = 'http://localhost:3080'; // your Nerve origin
// When NERVE_AUTH=true, run in a context that sends the session cookie (credentials: 'include').

// List todo tasks
const res = await fetch(`${NERVE_URL}/api/kanban/tasks?status=todo`);
const { items, total, hasMore } = await res.json();

// Create a task
const task = await fetch(`${NERVE_URL}/api/kanban/tasks`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Implement caching layer',
    description: 'Add Redis caching for API responses',
    priority: 'high',
    labels: ['backend', 'performance'],
  }),
}).then(r => r.json());

// Update with CAS, retrying once on a version conflict
let patch = await fetch(`${NERVE_URL}/api/kanban/tasks/${task.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ version: task.version, assignee: 'agent:designer' }),
});
if (patch.status === 409) {
  const { latest } = await patch.json();
  patch = await fetch(`${NERVE_URL}/api/kanban/tasks/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: latest.version, assignee: 'agent:designer' }),
  });
}

// Execute
await fetch(`${NERVE_URL}/api/kanban/tasks/${task.id}/execute`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ thinking: 'medium' }),
});
```
