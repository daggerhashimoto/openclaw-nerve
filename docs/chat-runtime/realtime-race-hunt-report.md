# Realtime chat-runtime async-interleaving race hunt

> Provenance: recovered from a killed workflow run (`wf_da7a7b6a-e56`, 2026-06-02: 81 agents,
> 1.38M tokens, aborted before critic/synthesis). The 6 races verified before the kill were
> reconstructed from its journal cache at zero re-spend; the remaining 10 unresolved candidates
> were then verified, criticized, and synthesized in a continuation run (`wf_9f59557e-b70`:
> 32 agents, 1.68M tokens). Each confirmed race survived >=2 of 3 perspective-diverse skeptics
> (reachability, single-thread-reality, user-visible-impact).

> Tally: 11 confirmed (6 recovered + 5 newly verified); 5 tail candidates refuted; 8 unverified open leads.

---

## Realtime chat-runtime race hunt: final synthesis

### Executive summary

The new event-sourced chat-runtime (`server/lib/chat-runtime/`) and the modified client reconnect path (`src/hooks/useWebSocket.ts`, `server/app.ts`) contain eleven confirmed async-interleaving races, four of them high-severity data-corruption or lost-message defects that surface on routine events (deploy/restart, reconnect, mid-stream completion, reordered tool results). The most dangerous are silent: a server-restart cursor collision that merges two timeline generations on resume, a `publish()` re-entrancy bug that permanently freezes a chat, an active-history poll that finalizes a still-streaming turn and drops the answer tail, and post-finalize tool/turn status regressions that leave two clients disagreeing on terminal state.

**Lean: NO-GO** for merging to the integration branch as-is. Ranks 1-4 (restart cursor collision, publish re-entrancy, premature finalize, post-finalize tool regression) are data/UI-corruption blockers, and the one-line client `onmessage` generation guard closes both rank 9 and rank 10. These five fixes are small and localized. The remaining medium/low races (ranks 5-8, 11) should land with regression tests as fast-follows but are not individually merge-blocking.

### Ranked findings

| Rank | Severity | Title | Key files | Fix (one-liner) |
|---|---|---|---|---|
| 1 | high | Process-restart cursor collision merges two timeline generations on resume | replay-buffer.ts:48-74, store.ts:63, types.ts:145-158 | Epoch-tag cursors; mismatch -> `snapshot_required` before string match |
| 2 | high | publish() stale subscriber-Set ref orphans subscribers on re-entrant subscribe | store.ts:206-220 | Identity-check the captured Set before deleting the map key |
| 3 | high | Active-history poll prematurely finalizes a still-streaming turn, dropping deltas | runtime.ts:215-221, adapter.ts:68-93, reducer.ts:185-225 | Gate turn_finalized on a live-terminal signal, not history content |
| 4 | high | Post-finalize tool_finished regresses a terminal group, re-emits siblings | reducer.ts:170-176, 553-571 | Skip mutation when tool already terminal; `if (group.closed) continue` |
| 5 | high | fail-then-succeed send orphans the committed prompt, strands a ghost failed bubble | reducer.ts:249-275, 336-358, runtime.ts:183-224 | Keep optimistic-prompt failure non-terminal/rebindable, or reconcile by idempotencyKey |
| 6 | high | Late send rejection regresses a delivered committed user message to failed | reducer.ts:249-266, 110-123 | Skip user_message_failed when item already committed (messageId/history+complete) |
| 7 | medium | Fingerprint recorded before bind success strands a ghost duplicate prompt on clock skew | runtime.ts:105-111, 482-491 | Record fingerprint only after a successful bind; bind by idempotencyKey |
| 8 | medium | Late thinking_final/assistant_final injects a new item into a finalized turn | reducer.ts:131-163, 185-225, 760-767 | `if (isTerminalTurnStatus(turn.status) && !existing) break;` in both branches |
| 9 | high | Superseded socket's in-flight events fanned out to live session (no onmessage gen guard) | useWebSocket.ts:192, 256-257, 148 | Gen guard at top of ws.onmessage (also fixes #10) |
| 10 | high | Stale connect.challenge clobbers connectReqIdRef, hangs connect, kills healthy socket | useWebSocket.ts:192, 196-198, 222, 183 | Same gen guard at top of ws.onmessage |
| 11 | low | Output-boundary closes a still-running tool child as 'failed' | reducer.ts:505-532 | Use neutral 'aborted'/'boundaried' status, not 'failed' |

### Per-race detail

#### 1. Process-restart cursor collision merges two timeline generations (high, 3/3 skeptics)
**Mechanism.** The module singleton `ReplayBuffer` is recreated empty on deploy and `nextCursor` resets to 1, so generation G2 re-issues cursor `"3"`. A client resuming with its stale G1 cursor `"3"` gets a pure string match in `replayAfter` (replay-buffer.ts:67), is handed G2 patches `4+` as `kind:'patches'` with no snapshot, and the G2 rebuild patches `1..3` are skipped. The `cursor === '0'` branch (replay-buffer.ts:58-64) leaks the same invariant for cold resumes. There is no epoch/generation token anywhere in the cursor/patch/snapshot model (`version === latestCursor` in lockstep, so the embedded `snapshot.cursor` at store.ts:63 cannot detect staleness either).
**Fix.** Generate a per-process epoch once at `ReplayBuffer` construction; prefix it into the cursor (`${epoch}:${seq}`) or add an `epoch` field to `TimelinePatch`/`TimelineSnapshot` (types.ts:145-158) embedded in `snapshot()`. In `replayAfter` (replay-buffer.ts:48) compare epoch first and return `{ kind: 'snapshot_required' }` on mismatch, before both the `findIndex` match and the cursor `'0'` branch. This subsumes the critic's separate "cursor '0' acceptance ignores generation" open lead.
**Consensus.** 3/3 (impact + single-thread + reachability), recovered.

#### 2. publish() stale subscriber-Set reference orphans subscribers (high, 2/3 skeptics)
**Mechanism.** `publish` captures the Set into a local (store.ts:207) and iterates a copy. A subscriber that synchronously unsubscribes and resubscribes during delivery (a reconnect/resume handler reacting to the patch) deletes the now-empty `S1` from the map and creates `S2` for the new subscriber. Control returns to `publish`; the test at store.ts:220 inspects the captured `S1` (size 0) and deletes the map key, removing the freshly-mapped `S2`. Every later `publish` then reads `undefined` and returns early. The chat is frozen mid-stream until a full reload.
**Fix.** Make cleanup identity-checked and idempotent at store.ts:220:
```
const liveSet = this.subscribers.get(sessionKey);
if (liveSet === sessionSubscribers && liveSet.size === 0) {
  this.subscribers.delete(sessionKey);
}
```
This mirrors the fresh re-read already in the unsubscribe closure at store.ts:87, and is correct regardless of how reachable the re-entrancy is.
**Consensus.** 2/3, tail.

#### 3. Active-history poll prematurely finalizes a still-streaming turn (high, 3/3 skeptics)
**Mechanism.** The agent process flushes a complete assistant message to persisted history before the gateway emits its terminal frame. The 1500ms poll runs while `hasRunningTurn` is true, binds the running turn, and `adaptActiveHistorySnapshot` emits `assistant_final` + `turn_finalized` for the live run; the `turn_finalized` survives the filter because history now contains an `assistant_final` (runtime.ts:215-221). The reducer overwrites the live item text with the possibly-shorter history text and finalizes the turn; the next real live `assistant_delta` then hits `shouldIgnoreEventForTerminalTurn` (reducer.ts:760-766) and is dropped. The tail of the answer is permanently lost until reload.
**Fix.** Gate run-finalization on a live-terminal signal: in the runtime.ts:215-221 filter, suppress `turn_finalized` for a run whose live turn is still `running` unless the gateway has delivered a terminal frame for that run. Optionally add an `assistant_final` staleness guard in the reducer so a history final does not clobber a longer live streaming item (mirror reducer.ts:194-195).
**Consensus.** 3/3 (single-thread + impact + reachability), recovered.

#### 4. Post-finalize tool_finished regresses a terminal group and re-emits siblings (high, 3/3 skeptics)
**Mechanism.** `turn_finalized` force-terminalizes a still-running tool to `complete` and publishes it. A reordered real `tool_finished tool-2 error` then arrives; because the turn is terminal but `existingTool` exists, reducer.ts:170-176 re-runs `buildToolItem` (flips tool-2 to `failed`) and `closeToolGroupsForTurn`, which iterates every group with no closed/terminal guard (reducer.ts:553), regressing its group `complete -> failed` and re-publishing unrelated all-complete sibling groups with a bumped `updatedAt` and `source` rewritten to `history`. A client resumed at the finalize cursor sees `complete`; one resuming after the late event sees `failed`. The symmetric `turn_failed` + late `ok` case flips `failed -> complete`.
**Fix.** In the post-terminal branch (reducer.ts:170-176) skip mutation when `existingTool` is already terminal (`isTerminalItemStatus`); if late payloads must be recorded, preserve the committed status rather than recomputing. Add `if (group.closed) continue` to `closeToolGroupsForTurn` (reducer.ts:553), mirroring the guard in `closeOpenToolGroupsForOutputBoundary` (reducer.ts:519), and only re-emit a group whose value actually changed.
**Consensus.** 3/3, tail.

#### 5. fail-then-succeed optimistic send orphans the committed prompt (high, 2/2 skeptics)
**Mechanism.** `chat.send` rejects on the client (timeout) even though the gateway accepted and enqueued it. `failOptimisticUserMessage` marks the optimistic turn `status='failed'` (terminal) without detaching the input item (reducer.ts:249-275). On the real `turn_started`, `rebindSinglePendingOptimisticPromptTurn` skips the failed turn (terminal-status reject at reducer.ts:344) and creates a brand-new empty turn. `activeHistoryBindings` only considers running turns, so the persisted prompt is never surfaced or merged. The committed prompt is lost on the live turn (an answer with no visible prompt) and the failed bubble is orphaned forever.
**Fix.** Keep an optimistic-prompt failure non-terminal: in user_message_failed (reducer.ts:249-275) mark only the item failed for prompt-only optimistic turns and leave the turn rebindable so `rebindSinglePendingOptimisticPromptTurn` (reducer.ts:336) can adopt it; or relax `activeHistoryBindings` (runtime.ts:224) to also consider recently-failed optimistic prompt turns whose normalized text matches a persisted message; or add an explicit reconcile/un-fail event keyed by idempotencyKey.
**Consensus.** 2/2 (single-thread + reachability), recovered.

#### 6. Late send rejection regresses a delivered committed user message to failed (high, 2/3 skeptics)
**Mechanism.** After an optimistic user item is reconciled by a committed echo (messageId set, status complete at reducer.ts:110-123), the original `chat.send` RPC rejects late (reconnect rejectPending / 30s timeout). `failOptimisticUserMessage` runs; user_message_failed looks up by idempotencyKey (reducer.ts:250) and clobbers the committed item to `failed`, or the fallback `Object.values` scan (reducer.ts:254-258) marks the first matching user_message failed even when it is a committed/history item. The user sees a delivered message presented as failed. (Distinct from rank 5: this regresses an already-reconciled message rather than orphaning an unreconciled one; they share the same `user_message_failed` weakness.)
**Fix.** Guard the user_message_failed path (reducer.ts:249-266): skip marking the item failed when it is already committed (`item.source === 'history' && item.status === 'complete'`, or it carries a messageId), mirroring the existing `isStaleOptimisticUserRetry` guard.
**Consensus.** 2/3 (single-thread + impact), recovered.

#### 7. Fingerprint recorded before bind success strands a ghost duplicate prompt (medium, 3/3 skeptics)
**Mechanism.** The history fingerprint is written at runtime.ts:111 before binding is attempted. If the persisted prompt timestamp is more than 30s older than the optimistic `at` (clock skew or a backfilled createdAt), `isPlausibleActiveHistoryUserMessage` fails the timestamp gate (runtime.ts:491), bindings stay empty, and the item is not reconciled. The next identical poll short-circuits on the matching fingerprint (runtime.ts:105-108) and never retries the bind. The prompt stays pending for the whole run and reappears duplicated after reload.
**Fix.** Record `historyFingerprintBySession` only after a non-empty `adaptActiveHistorySnapshot` result (move/guard the set at runtime.ts:111). Make `isPlausibleActiveHistoryUserMessage` bind by idempotencyKey, or accept a unique text match regardless of clock skew when there is a single running prompt-only claimant. The critic's "fingerprint omits idempotencyKey/runId binding metadata" lead is a widening of this same gap.
**Consensus.** 3/3, tail.

#### 8. Late thinking_final / assistant_final injects a new item into a finalized turn (medium, 3/3 skeptics)
**Mechanism.** A trailing thinking-end (or assistant_final with a new segment) for run-1 arrives on the wire after the coupled chat `final` already finalized the turn. `shouldIgnoreEventForTerminalTurn` (reducer.ts:760-767) only allow-lists started/delta events, so finals fall through; with `existing===undefined` the reducer creates a brand-new complete item and appends it to the finalized turn's `outputItemIds` (reducer.ts:160-161), emitting an upsert to all subscribers. A finished turn grows an extra block after completion.
**Fix.** Extend the terminal shield to new-item creation: in the thinking_final and assistant_final branches add `if (isTerminalTurnStatus(turn.status) && !existing) break;`, mirroring the tool path at reducer.ts:170-176, while still allowing finals that update an existing item on a still-running turn (needed for active-history replay).
**Consensus.** 3/3, recovered.

#### 9. Superseded socket's in-flight events fanned out to the live session (high, 3/3 skeptics)
**Mechanism.** On reconnect, `doConnect` bumps `connectionGenRef` and closes socket A (useWebSocket.ts:148) but never detaches `A.onmessage`. Buffered `event` frames still delivered to `A.onmessage` reach useWebSocket.ts:256-257 and call the shared `onEvent.current` with no gen check, so `GatewayContext` fans a previous-generation connection's deltas out to every live subscriber on top of the new connection's state.
**Fix.** Add `if (gen !== connectionGenRef.current) return;` at the top of `ws.onmessage` (useWebSocket.ts:192), mirroring the existing guards at lines 178 (connect-timeout) and 270 (onclose); or detach the handler (`wsRef.current.onmessage = null;`) before `close()` at line 148. The top-of-handler guard covers all branches uniformly and also fixes rank 10.
**Consensus.** 3/3, tail.

#### 10. Stale connect.challenge clobbers connectReqIdRef, hangs connect, kills healthy socket (high, 2/3 skeptics)
**Mechanism.** A delayed `connect.challenge` for superseded socket A arrives after gen-2 socket B already set the shared `connectReqIdRef` (useWebSocket.ts:198). A.onmessage has no gen guard (line 192), so it overwrites `connectReqIdRef` to a fresh id. B's auth-success `res` then fails the `response.id === connectReqIdRef.current` check (line 222), so `settleConnectSuccess` never runs, B's connect promise hangs, and ~10s later the gen-2 timeout (line 183) closes the healthy authenticated socket. User sees a full 10s stall and a spurious timeout on a live connection. Requires a runtime that delivers frames to a closing socket.
**Fix.** Same single guard as rank 9 at useWebSocket.ts:192. Defense-in-depth for spec-compliant browsers; required for mocks/non-compliant runtimes.
**Consensus.** 2/3, tail.

#### 11. Output-boundary closes a still-running tool child as 'failed' (low, 3/3 skeptics)
**Mechanism.** An `assistant_delta` or new `thinking_started` arrives before a still-running tool's result (reordered). `closeOpenToolGroupsForOutputBoundary` (reducer.ts:517-532) terminalizes the running child to `failed` and `closedToolGroupStatus` returns `failed` (reducer.ts:511). If the real `tool_finished:ok` was reordered behind the boundary, the group is published as failed (a transient red flash, or permanent if the result is dropped past finalization).
**Fix.** Terminalize output-boundary children to a neutral `aborted`/`boundaried` status rather than `failed`, with a matching branch in `closedToolGroupStatus`; or leave running children `running` and only mark the group closed for ordering. At finalization, map the neutral state to `complete` when no error was ever observed.
**Consensus.** 3/3, recovered.

### Open leads (unverified)

These come from the completeness critic and were not run through the adversarial verifiers. Worth a triage pass but not blocking on their own.

- **Adapter Date.now() vs seq-based ordering** (adapter.ts, reducer.ts:670-671, 774). Every live event is stamped with an independent `Date.now()`; `shouldIgnoreAssistantDelta` drops a delta when `event.at < existing.updatedAt` if `seq` is absent, and `compareItems` uses `createdAt` as a tiebreak. Same-millisecond or out-of-order wall-clock stamps can reorder or silently drop events. Plausible and adjacent to rank 3; verify whether `seq` is reliably present on the live path.
- **structuredClone throws on non-cloneable tool args/result** (store.ts:224-229, replay-buffer.ts:95-105, types.ts:49-50, supervisor.ts:18-20). `args`/`result` are `unknown` copied verbatim; a function/BigInt/circular value throws inside `applySessionEvents`, the patch is never published, and the supervisor swallows it. `sameTimelineValue` uses `JSON.stringify` (store.ts:233), so the diff and clone paths can disagree on the same payload. Robustness gap; depends on whether the gateway can emit such values.
- **optimisticRunId fallback collides for same-ms identical-text sends with no idempotencyKey** (reducer.ts:782). `optimistic:fallback:${event.at}:${fingerprintText(text)}` collapses two same-ms identical sends into one turn. Narrow but a real duplicate-message variant.
- **SPA 404 guard 404s extensionless app routes containing a dot** (app.ts:113, cache-headers.ts). `path !== '/' && path.includes('.')` returns `notFound()` for any client route with a dot (session keys like `agent:main:v1.5`, version segments, encoded ids). Availability regression introduced alongside the stale-bundle fix; `/ws` is unaffected. Confirmed in source -- fix by gating on a known-asset-extension allowlist rather than any dot.
- **Per-tab instanceId duplicated by browser Duplicate Tab** (useWebSocket.ts:30-43, 208). `getOrCreateInstanceId` persists in `sessionStorage`, which Duplicate Tab copies, so two live tabs present the same `instanceId`; if the gateway treats it as a presence singleton, one tab can evict or cross-deliver the other's stream. Depends on gateway semantics.
- **Active-history-sync RPC failure loops with no backpressure** (runtime.ts:362-368). `runActiveHistorySync` only `console.warn`s on rejection then unconditionally reschedules every 1500ms; a persistently failing `chat.history` re-fires forever and the turn never reconciles. Add a circuit-breaker / backoff.