---
name: nerve-kanban
description: Interact with the Nerve Kanban board API. CRUD tasks, manage workflow (execute, approve, reject, abort), handle proposals, configure the board. All endpoints are under /api/kanban on the Nerve server.
---

# Nerve Kanban API Skill

Use this skill to manage tasks on the Nerve Kanban board via its REST API.

## Base URL

All endpoints are relative to the Nerve server origin (e.g. `http://localhost:3000`). Prefix every path with `/api/kanban`.

## Core Concepts

- **Tasks** flow through columns: `backlog` → `todo` → `in-progress` → `review` → `done` (or `cancelled`).
- **CAS versioning**: Updates and reorders require the current `version` number. If it mismatches, you get a `409 version_conflict` with the server's latest task. Re-read and retry.
- **Workflow actions** enforce valid transitions. You can't execute a task that's already in review.
- **Proposals** let agents suggest task creation or updates. The operator (or auto-policy) approves/rejects them.
- **Actors** are either `"operator"` or `"agent:<name>"`.

## Quick Reference

| Action | Method | Path |
|---|---|---|
| List tasks | GET | `/api/kanban/tasks` |
| Create task | POST | `/api/kanban/tasks` |
| Update task | PATCH | `/api/kanban/tasks/:id` |
| Delete task | DELETE | `/api/kanban/tasks/:id` |
| Reorder/move | POST | `/api/kanban/tasks/:id/reorder` |
| Execute (spawn agent) | POST | `/api/kanban/tasks/:id/execute` |
| Approve (review→done) | POST | `/api/kanban/tasks/:id/approve` |
| Reject (review→todo) | POST | `/api/kanban/tasks/:id/reject` |
| Abort (in-progress→todo) | POST | `/api/kanban/tasks/:id/abort` |
| Complete run (webhook) | POST | `/api/kanban/tasks/:id/complete` |
| List proposals | GET | `/api/kanban/proposals` |
| Create proposal | POST | `/api/kanban/proposals` |
| Approve proposal | POST | `/api/kanban/proposals/:id/approve` |
| Reject proposal | POST | `/api/kanban/proposals/:id/reject` |
| Get config | GET | `/api/kanban/config` |
| Update config | PUT | `/api/kanban/config` |

## Common Patterns

### Creating and executing a task
1. `POST /api/kanban/tasks` with `{ "title": "...", "description": "..." }` → returns task with `id` and `version`.
2. `POST /api/kanban/tasks/:id/execute` → moves to `in-progress`, spawns an agent session.
3. The agent session runs, and on completion the task moves to `review` automatically.
4. `POST /api/kanban/tasks/:id/approve` → moves to `done`.

### Handling version conflicts
Always send `version` in PATCH and reorder requests. On `409`, read `latest` from the response and retry with the updated version.

### Proposing changes (as an agent)
Agents that can't directly modify the board should use proposals:
1. `POST /api/kanban/proposals` with `{ "type": "create", "payload": { "title": "..." }, "proposedBy": "agent:myname" }`.
2. The operator approves or rejects via `/api/kanban/proposals/:id/approve` or `/api/kanban/proposals/:id/reject`.

## Full API Reference

See [references/api.md](references/api.md) for complete endpoint documentation, type definitions, error codes, and example requests.
