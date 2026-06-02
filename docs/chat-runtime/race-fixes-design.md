# Chat-runtime async-race fixes: design

Date: 2026-06-02
Base: `origin/next` @ `4dc0ad6` (branch `fix/chat-runtime-races`)
Source report: `docs/chat-runtime/realtime-race-hunt-report.md` (verified against an earlier snapshot)
Status: approved design, re-verified against origin/next, pending implementation plan

## Context

The event-sourced chat-runtime (`server/lib/chat-runtime/`), the `useWebSocket` reconnection
hardening, and the SPA-404 / cache-headers guards are all already merged into `next`
(PRs #330, #331). The race-hunt report was originally produced against a stale local snapshot
that sat ~1,000 lines behind next; this design has since been re-verified against the current
`origin/next` (`4dc0ad6`).

This branch is therefore **fixes-only**. Every change edits a file that already exists on next,
so there is no subsystem to preserve, no chat-runtime PR, and no branch stacking. One feature
branch off `origin/next` carries the fixes, optionally split into two PRs (blockers, then
fast-follows).

## Reachability

The chat-runtime subsystem has no production caller yet (nothing outside its own tests imports
it), so its races are latent until it is wired into a route. The client races (#9/#10) live in
`useWebSocket.ts`, the actual gateway transport, and are reachable today.

- **Live now:** #9, #10 (client transport).
- **Latent until the runtime is wired:** #1-8, #11 (real defects, cannot corrupt until a caller
  exists; must be correct before wiring).

The "fix before wiring" goal still holds; the latent tier just means there is no production fire,
and every server fix is low risk (self-contained module, large existing unit-test suite).

## Re-verification against origin/next (4dc0ad6)

All eleven races plus the SPA-404 regression are still present on next. Line numbers below are
next's current lines. None of next's newer commits (`fail send ghosts`,
`stabilize active history replay`, `reject untimestamped active history matches`) closed any
race; they added adjacent machinery (see "New machinery on next" below).

| # | Sev | Race | Status on next | Key lines (next) |
|---|---|---|---|---|
| 1 | high | Process-restart cursor collision merges timeline generations | present | replay-buffer.ts:30,53,58,67 |
| 2 | high | publish() stale subscriber-Set ref orphans subscribers | present | store.ts:213-231 (cleanup at 231) |
| 3 | high | Active-history poll prematurely finalizes a streaming turn | present | runtime.ts:122-130, 249-255 |
| 4 | high | Post-finalize tool_finished regresses a terminal group | present | reducer.ts:222-228, 604-612 (cf 571) |
| 5 | high | fail-then-succeed send orphans the committed prompt | present | reducer.ts:301-328, 388-400 |
| 6 | high | Late send rejection regresses a committed user message to failed | present | reducer.ts:301-318 |
| 7 | med | Fingerprint recorded before bind success strands a ghost prompt | present | runtime.ts:129-130, 585 |
| 8 | med | Late thinking_final/assistant_final injects into a finalized turn | present | reducer.ts:237-277, 811-818 |
| 9 | high | Superseded socket's events fan out to the live session | present | useWebSocket.ts:192 (cf 178,270) |
| 10 | high | Stale connect.challenge clobbers connectReqIdRef, hangs connect | present | useWebSocket.ts:192,198,222 |
| 11 | low | Output-boundary closes a running tool child as 'failed' | present | reducer.ts:557-578 |
| - | - | SPA-404 guard 404s extensionless app routes with a dot | present | app.ts (looksLikeStaticFile) |

## New machinery on next (affects #5/#6/#7)

Next introduced an explicit run-binding path that the stale snapshot lacked:

- a `user_message_run_bound` event,
- `ChatRuntime.bindRunIdToOptimisticUserMessage` (runtime.ts:191),
- a runId-aware `isPlausibleActiveHistoryUserMessage(message, startedAt, runId)`.

This does not fix #5/#6/#7, but it is likely the natural reconcile hook: binding a runId to an
optimistic prompt is the moment to adopt or un-fail it. The optimistic-message fixes should
integrate with this path rather than only patching the heuristic
`rebindSinglePendingOptimisticPromptTurn`. The exact integration is pinned in the implementation
plan. (This is the one place the design moved because of re-verification.)

## Plan (phased, blockers first)

### Phase 1a: live client fix (one PR, ship first)

- **#9 + #10** Add `if (gen !== connectionGenRef.current) return;` at the top of `ws.onmessage`
  (`useWebSocket.ts:192`). One guard closes both: it stops a superseded socket's buffered `event`
  frames from fanning out to the live session (#9) and stops a stale `connect.challenge` from
  clobbering `connectReqIdRef` and hanging the healthy connection (#10). Mirrors the existing
  generation guards at lines 178 (connect-timeout) and 270 (onclose).
  - Test: a mock-socket delivers an `event` frame and a `connect.challenge` to a superseded
    (gen-N) socket after a gen-(N+1) `doConnect`; assert `onEvent` is not called and
    `connectReqIdRef` is not mutated.

### Phase 1b: server blockers (one PR, before the runtime is wired)

- **#1 Cursor collision** (`replay-buffer.ts`, `store.ts:63`, `types.ts`). Generate a per-process
  epoch token at `ReplayBuffer` construction (`crypto.randomUUID()`). Encode it in the cursor as
  `${epoch}:${seq}` (decision D1). In `replayAfter`, compare the resumed cursor's epoch to the
  current epoch before any sequence match (replay-buffer.ts:67) and the `cursor === '0'` branch
  (lines 53, 58); return `{ kind: 'snapshot_required' }` on mismatch. Decode the sequence for the
  `firstRetainedCursor === '1'` check.
  - Test: rebuild the buffer (new epoch), issue a colliding sequence, resume with a stale-epoch
    cursor; assert `snapshot_required`, not a patch slice.

- **#2 publish() re-entrancy** (`store.ts:231`). The end-of-`publish` cleanup inspects the captured
  Set, which can be a stale `S1` after a subscriber synchronously unsubscribes and resubscribes
  (creating `S2`) during delivery. Re-read the live Set and only delete the map key if it is the
  same Set and empty. Mirrors the fresh re-read in the unsubscribe closure at `store.ts:91`.
  - Test: subscriber unsubscribes then resubscribes inside its own callback; assert a later
    `publish` still reaches the new subscriber.

- **#3 Premature finalize** (`runtime.ts:249-255`, `reducer.ts`). Gate run-finalization on a
  live-terminal signal: suppress `turn_finalized` for a run whose live turn is still `running`
  unless the gateway has delivered a terminal frame for that run. Add an `assistant_final`
  staleness guard so a shorter history final does not clobber a longer live streaming item.
  - Test: deliver a complete history snapshot before the gateway terminal frame; assert the turn
    stays running and later live deltas are not dropped.

- **#4 Post-finalize tool regression** (`reducer.ts:222-228`, `604-612`). Skip mutation when the
  existing tool is already terminal; add `if (group.closed) continue` to `closeToolGroupsForTurn`
  (line 612), mirroring `closeOpenToolGroupsForOutputBoundary` (line 571); only re-emit a group
  whose value actually changed.
  - Test: finalize a turn, then deliver a reordered `tool_finished`; assert no terminal sibling
    group is re-published and the targeted group keeps its committed status.

### Phase 2: fast-follows (one PR)

- **#5 + #6 user_message_failed weakness** (`reducer.ts:301-328`, `388-400`). Unified fix in
  `user_message_failed`:
  1. Skip the fail when the matched item is already committed (carries a `messageId`, or
     `source === 'history' && status === 'complete'`). Fixes #6.
  2. Keep a prompt-only optimistic failure adoptable so a later real `turn_started` (or
     `user_message_run_bound`) rebinds it instead of orphaning it. Fixes #5.
  - Constraint: `rebindSinglePendingOptimisticPromptTurn` rejects inputs with `pending === false`
    (reducer.ts:400) and terminal turns (reducer.ts:396), so "keep it rebindable" cannot just set
    `pending:false` and a terminal turn. Integrate with next's `user_message_run_bound` path
    (binding a runId is the reconcile point). Exact marker pinned in the plan.
  - Tests: (a) committed echo then late `chat.send` rejection -> item stays complete. (b) optimistic
    send fails, real `turn_started`/bind arrives -> prompt adopted, not orphaned.

- **#7 Fingerprint before bind** (`runtime.ts:129-130`, `585`). Record
  `historyFingerprintBySession` only after a non-empty `adaptActiveHistorySnapshot` result, so a
  failed bind is retried by the next poll instead of short-circuited. Prefer binding by
  idempotencyKey / the explicit `user_message_run_bound` path over the timestamp gate.

- **#8 Late final injects into a finalized turn** (`reducer.ts:237-277`, `811-818`).
  `shouldIgnoreEventForTerminalTurn` shields only delta/started events. Add
  `if (isTerminalTurnStatus(turn.status) && !existing) break;` in the thinking_final and
  assistant_final branches, while still allowing finals that update an existing item on a
  still-running turn.

- **#11 Output-boundary closes a running tool child as 'failed'** (`reducer.ts:557-578`).
  Terminalize output-boundary children to a neutral `aborted`/`boundaried` status rather than
  `failed`, with a matching branch in `closedToolGroupStatus`; map the neutral state to `complete`
  at finalization when no error was ever observed.

- **SPA-404 availability regression** (`app.ts`). `path !== '/' && path.includes('.')` 404s any
  client route containing a dot. Gate on a known-asset-extension allowlist instead of any dot.

- **Open-lead triage.** Reachability-check the five remaining unverified leads against next; fix
  only survivors. Priority: Date.now() vs seq ordering (adjacent to #3), then `structuredClone`
  throwing on non-cloneable tool args/result, `optimisticRunId` same-ms fallback collision, per-tab
  `instanceId` duplication via Duplicate Tab, active-history-sync RPC failure loop with no backoff.

## Resolved decisions

- **D1 Epoch encoding (#1): epoch-prefixed cursor `${epoch}:${seq}`.** No protocol consumer exists
  yet, so the cursor stays an opaque token the future client echoes back; `replayAfter(sessionKey,
  cursor)` keeps its signature and the epoch rides inside the token. Trade-off: cursor parsing
  (`cursor === '0'`, `firstRetainedCursor === '1'`) must decode the sequence.

- **D2 #5/#6: one reducer-local fix in `user_message_failed`,** keyed by idempotencyKey and
  integrated with `user_message_run_bound`, rather than new bespoke reconcile events.

- **D3 Tests + PRs:** failing-first reproduction test per race (TDD red then green). Three stackable
  PRs (client guard / server blockers / fast-follows) targeting `next`. Phase 1a ships independently
  (only live fix).

## Risks and notes

- Server fixes are validated by unit tests at the module boundary (the subsystem is unwired); same
  surface the existing suite covers.
- #5/#6/#7 are the least mechanical: the plan must pin how the fix integrates with next's
  `user_message_run_bound` machinery before coding.
- #1 changes the internal cursor format; confirm no existing test asserts the bare `String(seq)`
  cursor in a way that should now assert the epoch-prefixed form.
