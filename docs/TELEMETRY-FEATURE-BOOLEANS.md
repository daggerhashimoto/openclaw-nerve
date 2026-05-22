# Telemetry Feature Booleans

This document defines what currently flips each Phase 1 `features_used_24h.*` boolean to `true` in Nerve.

It is intentionally implementation-specific. If an action is not listed here, it does not currently count, even if it feels related to the same product area.

## How these booleans work

- Each boolean answers: "did at least one tracked action in this area happen in the last 24 hours?"
- They are booleans, not counters. Repeating the same action 20 times still produces `true`, not `20`.
- The current implementation stores the latest seen timestamp per feature area, then heartbeats derive `true` or `false` from whether that timestamp falls inside the trailing 24 hour window.
- These booleans are part of Phase 1 heartbeat snapshots used by the telemetry platform dashboard.

## Summary table

| Feature boolean | Currently flips to `true` when | Main source paths |
| --- | --- | --- |
| `features_used_24h.chat` | a `chat.send` succeeds, or a tool call completes | `server/lib/ws-proxy.ts`, `server/lib/telemetry/store.ts` |
| `features_used_24h.sessions` | a session is opened from the UI, a subagent session is created, a session label is changed, a session is deleted, or a first successful message lands in a previously unseen root session | `src/contexts/SessionContext.tsx`, `server/routes/telemetry.ts`, `server/routes/sessions.ts`, `server/lib/ws-proxy.ts` |
| `features_used_24h.branches` | a new top-level root is created and opened, or the UI switches between top-level roots | `src/contexts/SessionContext.tsx`, `src/App.tsx`, `server/routes/telemetry.ts` |
| `features_used_24h.kanban` | tracked Kanban create or mutation endpoints succeed | `server/routes/kanban.ts` |
| `features_used_24h.settings` | tracked settings write endpoints succeed | `server/routes/api-keys.ts`, `server/routes/transcribe.ts`, `server/routes/voice-phrases.ts` |

## `features_used_24h.chat`

`chat` flips to `true` when current code sees either of these:

1. A `chat.send` request succeeds through the gateway proxy.
2. A tool call completes, whether it finished successfully or ended in failure after starting.

### Current sources

- `server/lib/ws-proxy.ts`
  - successful `chat.send` responses call `telemetry.recordMessageSubmitted(...)`
  - completed tool executions call `telemetry.recordToolCompleted(...)`
- `server/lib/telemetry/store.ts`
  - both `recordMessageSubmitted(...)` and `recordToolCompleted(...)` set `featureLastUsedAt.chat`

### Does not currently count

- typing into the composer
- opening chat UI panels
- failed `chat.send` requests
- a tool starting but never reaching completion bookkeeping
- reading existing messages

## `features_used_24h.sessions`

`sessions` flips to `true` when current code sees any of these:

1. The UI switches to a different non-empty session and emits `session_opened`.
2. A subagent session is created successfully through `POST /api/sessions/spawn-subagent`.
3. A session label change succeeds through `sessions.patch` with a `label` field.
4. A session deletion succeeds through `sessions.delete`.
5. The first successful `chat.send` lands in a previously unseen root session, which implicitly records `session_created`.

### Current sources

- `src/contexts/SessionContext.tsx`
  - `setCurrentSession(...)` emits `session_opened` when switching to a different non-empty session
- `server/routes/telemetry.ts`
  - `session_opened` maps to `telemetry.markFeatureUsed('sessions')`
- `server/routes/sessions.ts`
  - successful subagent spawn calls `telemetry.recordSessionCreated({ explicit: true, ... })`
- `server/lib/ws-proxy.ts`
  - successful `sessions.patch` label changes and `sessions.delete` calls mark `sessions`
  - the first successful message into a previously unseen root session records `session_created`

### Does not currently count

- refreshing the session list
- viewing session metadata without switching or mutating anything
- failed rename or delete attempts

A top-level root creation does not have its own separate top-level-root `session_created` hook. It only affects `sessions` when opening that new root also emits `session_opened`.

## `features_used_24h.branches`

`branches` flips to `true` when current code sees either of these top-level workspace actions:

1. A new top-level root agent is created and opened, emitted as `branch_created`.
2. The UI switches between different top-level roots, emitted as `branch_switched`.

### Current sources

- `src/contexts/SessionContext.tsx`
  - successful top-level root creation emits `branch_created`
- `src/App.tsx`
  - switching between different top-level roots emits `branch_switched`
- `server/routes/telemetry.ts`
  - `branch_created` marks `branches`
  - `branch_switched` marks `branches` and also forwards a Phase 2 detailed event when telemetry mode is `detailed`

### Important semantics

- This is about Nerve's top-level root or branch-style workspace model, not Git branch operations.
- Creating and opening the first top-level root from an empty workspace counts as a branch switch in current code.
- Switching between a root and one of its own subagents does not count as `branches`.
- Switching sessions within the same top-level root does not count as `branches`.

## `features_used_24h.kanban`

`kanban` flips to `true` when one of these Kanban actions succeeds:

1. `POST /api/kanban/tasks` creates a task.
2. `POST /api/kanban/proposals/:id/approve` approves a proposal.
   - if the proposal is a create proposal, it also records `kanban_task_created`
   - otherwise it still marks `kanban`
3. `POST /api/kanban/tasks/:id/reorder` reorders a task.
4. `POST /api/kanban/tasks/:id/execute` starts execution.
5. `POST /api/kanban/tasks/:id/approve` approves a task.
6. `POST /api/kanban/tasks/:id/reject` rejects a task.
7. `POST /api/kanban/tasks/:id/abort` aborts a task.

### Current sources

- `server/routes/kanban.ts`
  - `recordKanbanTaskCreatedTelemetry()` marks `kanban` and records the detailed `kanban_task_created` event
  - `markKanbanFeatureUsed()` marks `kanban` for the tracked mutation flows above

### Does not currently count

- reading Kanban tasks, proposals, or config
- `PATCH /api/kanban/tasks/:id`
- `DELETE /api/kanban/tasks/:id`
- `POST /api/kanban/proposals`
- `POST /api/kanban/proposals/:id/reject`
- `PUT /api/kanban/config`

## `features_used_24h.settings`

`settings` flips to `true` when one of these tracked settings-write paths succeeds:

1. `PUT /api/keys`
   - saves or clears `OPENAI_API_KEY`
   - saves or clears `REPLICATE_API_TOKEN`
   - saves or clears `MIMO_API_KEY`
2. `PUT /api/transcribe/config`
   - changes STT provider
   - changes Whisper model
   - changes transcription language
3. `PUT /api/language`
   - changes `NERVE_LANGUAGE`
   - changes `EDGE_VOICE_GENDER`
4. `PUT /api/voice-phrases/:lang`
   - writes custom stop, cancel, or wake phrases for a language

### Current sources

- `server/routes/api-keys.ts`
- `server/routes/transcribe.ts`
- `server/routes/voice-phrases.ts`

Each of those routes calls `telemetry.markFeatureUsed('settings')` after a successful write path.

### Does not currently count

- `GET` requests for settings state
- using TTS without changing config
- using STT without changing config
- `PUT /api/tts/config` writes to `tts-config.json`
- frontend-only UI preferences unless a server write path explicitly marks `settings`

## Maintenance note

If telemetry instrumentation changes, update this file in the same PR. The goal is for this document to stay as the exact current-code answer to: "what made this feature boolean turn on?"
