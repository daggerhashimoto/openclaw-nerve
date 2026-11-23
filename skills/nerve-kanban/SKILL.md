---
name: nerve-kanban
description: Work with the Nerve Kanban board over its REST API. Create, read, update, move and delete tasks, run the workflow (execute, approve, reject, abort, complete), propose changes, and read or change the board config. All endpoints are under /api/kanban on the Nerve server.
---

# Nerve Kanban API skill

Use this skill to manage tasks on the Nerve Kanban board through its REST API.

## Base URL and access

- Paths are relative to the Nerve server origin. The default `PORT` is 3080, so a local install is usually `http://localhost:3080`, but use the host and port your Nerve instance actually listens on.
- Send JSON bodies with `Content-Type: application/json`.
- If Nerve runs with `NERVE_AUTH=true`, every request needs the session cookie from `POST /api/auth/login` (`{ "password": "..." }`). Without it you get `401`.
- Each route allows 60 requests per minute per client and path (`429` with a plain-text body when exceeded).

## Core concepts

- **Task IDs** are slugs made from the title (for example `fix-login-bug`), not UUIDs. Proposal IDs are UUIDs.
- **CAS versioning:** PATCH and reorder need the task's current `version`. On a mismatch you get `409 { "error": "version_conflict", "serverVersion", "latest" }`. Retry with `latest.version`.
- **Statuses** are column keys. Built-in: `backlog`, `todo`, `in-progress`, `review`, `done`, `cancelled`. The board config can add custom lowercase kebab-case keys. An unknown status returns `400` with an `allowed` list.
- **Priorities:** `critical`, `high`, `normal`, `low`.
- **Actors** are `"operator"` or `"agent:<name>"`. An assignee is stored as `agent:<id>` (a suffix like `:main` is dropped). `agent:main` is rejected as an assignee.
- **Runs:** `execute` starts an agent run and stores it in `task.run`. The server tracks it and moves the task on when it ends. Clients cannot set `run`.
- **Proposals** suggest a task creation or update. They wait as `pending` for approval, unless the board's `proposalPolicy` is `auto`, in which case they are applied at once.

## Columns

Default board: `backlog` (Backlog), `todo` (To Do), `in-progress` (In Progress), `review` (Review), `done` (Done), all visible, plus `cancelled` (Cancelled), hidden. The config can add up to 10 columns in total, but `backlog`, `todo`, `in-progress`, `review` and `done` must stay.

## Workflow transitions

| From | To | How |
|---|---|---|
| `todo`, `backlog` | `in-progress` | `POST /api/kanban/tasks/:id/execute` |
| `in-progress` | `review` | The run finishes (automatic), or `POST /api/kanban/tasks/:id/complete` without `error` |
| `in-progress` | `todo` | The run fails or times out, `POST /api/kanban/tasks/:id/complete` with `error`, or `POST /api/kanban/tasks/:id/abort` |
| `review` | `done` | `POST /api/kanban/tasks/:id/approve` |
| `review` | `todo` | `POST /api/kanban/tasks/:id/reject` (note required, clears run and result) |
| any | any allowed status | PATCH `status` or reorder: no workflow checks, run untouched |

A wrong-state workflow call returns `409 { "error": "invalid_transition", "from", "to", "message" }`.

## Who can do what

- The API has no per-actor permissions. Any caller that passes Nerve auth can call every endpoint. `createdBy` and `proposedBy` are whatever the caller sends, and approve, reject and abort always record `operator`.
- By convention an agent proposes changes (`POST /api/kanban/proposals`, or `[kanban:create]` and `[kanban:update]` markers in its run result) and the operator approves or rejects them.
- Execute needs a valid launch target. A task assigned to `agent:<id>` runs as a child session under `agent:<id>:main`, which must exist (otherwise `409 invalid_execution_target`). On macOS, unassigned or `operator` tasks cannot be executed; assign them to a live worker agent first.

## Quick reference

| Action | Method | Path |
|---|---|---|
| List tasks | GET | `/api/kanban/tasks` |
| Get task | GET | `/api/kanban/tasks/:id` |
| Create task | POST | `/api/kanban/tasks` |
| Update task (needs `version`) | PATCH | `/api/kanban/tasks/:id` |
| Delete task | DELETE | `/api/kanban/tasks/:id` |
| Move or reorder (needs `version`) | POST | `/api/kanban/tasks/:id/reorder` |
| Execute (start agent run) | POST | `/api/kanban/tasks/:id/execute` |
| Approve (review to done) | POST | `/api/kanban/tasks/:id/approve` |
| Reject (review to todo) | POST | `/api/kanban/tasks/:id/reject` |
| Abort (in-progress to todo) | POST | `/api/kanban/tasks/:id/abort` |
| Complete a run (needs `sessionKey`) | POST | `/api/kanban/tasks/:id/complete` |
| List proposals | GET | `/api/kanban/proposals` |
| Create proposal | POST | `/api/kanban/proposals` |
| Approve proposal | POST | `/api/kanban/proposals/:id/approve` |
| Reject proposal | POST | `/api/kanban/proposals/:id/reject` |
| Get config | GET | `/api/kanban/config` |
| Update config | PUT | `/api/kanban/config` |

## Common patterns

### Creating and executing a task
1. `POST /api/kanban/tasks` with `{ "title": "...", "description": "...", "status": "todo", "assignee": "agent:<id>" }`. The response has the task `id` and `version`. Send `status` explicitly: the board's default status is configurable, and execute accepts only `todo` or `backlog`.
2. `POST /api/kanban/tasks/:id/execute`. The task moves to `in-progress` and the agent is launched in the background.
3. When the run ends, the task moves to `review` with the agent's summary in `result` (or back to `todo` with `run.error` on failure). Poll `GET /api/kanban/tasks/:id` to follow it.
4. `POST /api/kanban/tasks/:id/approve` moves it to `done`, or `POST /api/kanban/tasks/:id/reject` with a `note` sends it back to `todo`.

### Handling version conflicts
Always send `version` with PATCH and reorder. On `409 version_conflict`, take `latest` from the response, reapply your change and retry with `latest.version`.

### Proposing changes (as an agent)
1. `POST /api/kanban/proposals` with `{ "type": "create", "payload": { "title": "..." }, "proposedBy": "agent:<name>" }`, or `{ "type": "update", "payload": { "id": "<task-id>", "status": "..." }, ... }`.
2. Check `status` in the response: `pending` waits for the operator; `approved` means auto policy applied it.

## Full API reference

See [references/api.md](references/api.md) for every endpoint, field, limit, error body and example request.
