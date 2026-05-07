# Chat Runtime Server Replay Design

## Purpose

Nerve's chat UI needs a reliable realtime architecture for OpenClaw sessions. The browser should show operator prompts, thinking blocks, tool uses, tool results, and assistant response streams in stable order while a turn is running, after session switches, and after page refreshes.

The current failure mode to avoid is a UI that stitches together separate sources in the browser: `chat.history`, live `chat` events, live `agent` tool events, optimistic messages, recovery polling, and a separate streaming bubble. That shape makes ordering, duplication, and disappearance bugs likely because each source can replace or reinterpret the visible transcript.

The new architecture gives Nerve a server-side chat runtime. OpenClaw remains the upstream source of truth for agent execution and finalized transcript history, while Nerve owns realtime continuity and browser replay.

## Goals

- Preserve visible chat continuity across refreshes and session switches while a turn is active.
- Render thinking blocks, tool calls, tool results, and assistant text as first-class timeline items.
- Keep ordering stable during live streaming and after final history reconciliation.
- Make duplicate raw gateway events idempotent.
- Avoid deleting old timeline items during live generation.
- Let the browser render a single canonical timeline instead of merging several data sources.
- Keep the first version deployable without database infrastructure.

## Non-Goals

- Do not change OpenClaw's gateway protocol.
- Do not require OpenClaw to persist every live streaming frame.
- Do not make Nerve the permanent source of truth for completed conversations.
- Do not preserve active-turn live-only frames across a Nerve server restart in the first version.
- Do not redesign chat visual styling as part of the runtime rewrite.

## Architecture Summary

```text
OpenClaw Gateway
  -> Nerve Gateway Supervisor
  -> OpenClaw Event Adapter
  -> Timeline Reducer
  -> Server Timeline Store
  -> Replay Buffer
  -> Browser Timeline Client
  -> Chat Timeline Renderer
```

The server keeps an upstream OpenClaw connection that is independent of browser tabs. Browser tabs subscribe to Nerve's chat stream, not directly to raw OpenClaw chat events for rendering.

OpenClaw events and `chat.history` snapshots are normalized into Nerve timeline events. The server reducer applies those events to a per-session canonical timeline. Browsers receive snapshots and patches derived from the canonical timeline.

## Core Principle

The UI renders `TimelineItem[]` only.

There is no separate "history message list", "streaming response bubble", "activity log bubbles", or "recovered tail" competing for ownership of the transcript. A live assistant message is the same item that later becomes final. A running tool call is the same item that later receives its result. A thinking block is the same item whether it was reconstructed from history or seen live.

## Server Modules

### `gateway-supervisor`

Owns the long-lived upstream OpenClaw WebSocket connection.

Responsibilities:

- Connect to OpenClaw with the same auth/device identity path used by Nerve.
- Subscribe once per Nerve process, not once per browser tab.
- Receive all `chat` and `agent` events the server is authorized to see.
- Reconnect with backoff when the gateway disconnects.
- Mark active sessions dirty on reconnect so history reconciliation can run.
- Expose raw events to the event adapter.

The supervisor is process-local in the first version. In a future multi-process deployment, this role would need a distributed leader or external event bus.

### `openclaw-event-adapter`

Converts raw OpenClaw frames into Nerve runtime events.

Raw sources:

- Gateway `chat` events with states such as `started`, `delta`, `final`, `aborted`, and `error`.
- Gateway `agent` events for lifecycle, assistant stream state, and tool events.
- `chat.history` snapshots fetched via RPC.
- Local optimistic send acknowledgements from Nerve.

Adapter outputs:

```ts
type RuntimeEvent =
  | TurnStartedEvent
  | UserMessageCommittedEvent
  | ThinkingStartedEvent
  | ThinkingDeltaEvent
  | ThinkingFinalEvent
  | ToolStartedEvent
  | ToolDeltaEvent
  | ToolFinishedEvent
  | AssistantDeltaEvent
  | AssistantFinalEvent
  | TurnFinalizedEvent
  | TurnFailedEvent
  | HistorySnapshotEvent;
```

The adapter validates all gateway payloads at the boundary. Invalid payloads are logged and skipped, not passed into the reducer as ambiguous objects.

### `timeline-reducer`

Applies runtime events to a session timeline. This is pure logic and should have broad unit coverage.

Reducer invariants:

- Applying the same event twice has the same result as applying it once.
- Applying history after live events reconciles entities; it does not replace the whole active timeline.
- Applying live events after history updates active entities without duplicating final ones.
- Finalized history content wins over provisional live content.
- Live active-tail content wins over stale history that does not yet include the active turn.
- Existing finalized timeline items are never removed because an active turn received an event.
- A turn can be partial, running, finalized, failed, or aborted.
- Every timeline item has a stable ID and stable React key.

### `timeline-store`

Keeps canonical per-session timelines in memory.

Responsibilities:

- Store `SessionTimeline` by `sessionKey`.
- Store active turn state by `sessionKey + runId`.
- Track the latest server cursor per session.
- Track dirty sessions that need history reconciliation.
- Enforce TTL and max-size limits.
- Produce snapshots for new browser subscribers.
- Produce patches for incremental browser subscribers.

First-version storage:

- In-memory maps.
- Ring buffer per session.
- No database.
- No restart replay guarantee for live-only active turn frames.

Suggested retention defaults:

- Session TTL: 60 minutes after last subscriber or event.
- Event patch buffer: 2,000 patches per session.
- Timeline item cap: 1,000 items per session before older finalized prefix is compacted behind a history reload boundary.
- Global retained sessions cap: 100.

### `replay-buffer`

Stores recent timeline patches by cursor.

Responsibilities:

- Let a browser reconnect with `cursor`.
- Replay missed patches when the cursor is still retained.
- Return a fresh snapshot when the cursor is absent or expired.
- Guarantee monotonically increasing server cursors per session.

The browser must not care whether it received patches or a snapshot. Both describe the same timeline model.

## Data Model

### Session Timeline

```ts
interface SessionTimeline {
  sessionKey: string;
  version: number;
  cursor: string;
  hydrationState: 'cold' | 'hydrating' | 'ready' | 'stale';
  turns: TimelineTurn[];
  updatedAt: number;
}
```

### Turn

```ts
interface TimelineTurn {
  id: string;
  sessionKey: string;
  runId: string;
  status: 'running' | 'finalized' | 'failed' | 'aborted';
  startedAt: number;
  finalizedAt?: number;
  inputItemIds: string[];
  outputItemIds: string[];
  orderBase: TimelineOrderKey;
}
```

### Timeline Item

```ts
type TimelineItem =
  | UserTimelineItem
  | ThinkingTimelineItem
  | ToolGroupTimelineItem
  | ToolCallTimelineItem
  | AssistantTimelineItem
  | SystemTimelineItem;
```

Common fields:

```ts
interface TimelineItemBase {
  id: string;
  sessionKey: string;
  turnId?: string;
  runId?: string;
  kind: string;
  orderKey: TimelineOrderKey;
  createdAt: number;
  updatedAt: number;
  status: 'provisional' | 'running' | 'complete' | 'failed' | 'aborted';
  source: 'history' | 'live' | 'optimistic' | 'system';
}
```

Important item variants:

```ts
interface ThinkingTimelineItem extends TimelineItemBase {
  kind: 'thinking';
  text: string;
  durationMs?: number;
}

interface ToolCallTimelineItem extends TimelineItemBase {
  kind: 'tool_call';
  toolCallId: string;
  name: string;
  args: unknown;
  result?: unknown;
  error?: string;
}

interface ToolGroupTimelineItem extends TimelineItemBase {
  kind: 'tool_group';
  childItemIds: string[];
}

interface AssistantTimelineItem extends TimelineItemBase {
  kind: 'assistant_message';
  text: string;
  isStreaming: boolean;
  finalText?: string;
  stopReason?: string;
}
```

## Identity Rules

Stable IDs are the main defense against duplication.

Preferred IDs:

- Turn: `turn:${sessionKey}:${runId}`
- Tool call: `tool:${sessionKey}:${runId}:${toolCallId}`
- Assistant stream: `assistant:${sessionKey}:${runId}:answer`
- User message: use gateway message ID when present; otherwise `user:${sessionKey}:${turnCorrelationId}`
- Thinking block: use gateway content block ID when present; otherwise `thinking:${sessionKey}:${runId}:${blockIndex}`
- Tool group: `tool-group:${sessionKey}:${runId}:${groupIndex}`

Fallback IDs must be deterministic within the same server process. They should not include `Date.now()` unless there is no other correlation data. If a fallback ID is later matched to a stronger persisted identity, the store must preserve the public item ID and update metadata, so React keys do not churn.

## Ordering Rules

Every item receives an `orderKey`.

```ts
interface TimelineOrderKey {
  turn: number;
  block: number;
  sub: number;
}
```

Ordering sources, strongest first:

1. Persisted history content block order.
2. Gateway run sequence for live events.
3. Adapter-assigned provisional order inside the active turn.

Live order can be provisional. History can refine order. Refinement must update the `orderKey` of existing items, not delete and recreate items.

Tool grouping uses ordering boundaries:

- Consecutive tool calls are grouped until an assistant text, thinking, user, system boundary, or turn finalization closes the group.
- A running group can accept new tool calls.
- A closed group is not reopened by late duplicate events.
- If history proves a different grouping, reconcile child IDs into the persisted order while preserving item IDs where possible.

## Browser Contract

The browser subscribes to Nerve, not OpenClaw, for chat runtime state.

Endpoint:

```text
GET /api/chat-runtime/stream?sessionKey=<sessionKey>&cursor=<cursor>
```

Transport can be SSE for the first version. WebSocket is acceptable later if bidirectional runtime controls are needed.

Server messages:

```ts
type ServerChatRuntimeMessage =
  | RuntimeConnectedMessage
  | TimelineSnapshotMessage
  | TimelinePatchMessage
  | RuntimeErrorMessage
  | RuntimeHeartbeatMessage;
```

Snapshot:

```ts
interface TimelineSnapshotMessage {
  type: 'snapshot';
  sessionKey: string;
  cursor: string;
  timeline: SessionTimelineView;
}
```

Patch:

```ts
interface TimelinePatchMessage {
  type: 'patch';
  sessionKey: string;
  cursor: string;
  ops: TimelinePatchOp[];
}
```

Patch operations:

```ts
type TimelinePatchOp =
  | { op: 'upsert_turn'; turn: TimelineTurnView }
  | { op: 'upsert_item'; item: TimelineItemView }
  | { op: 'remove_item'; id: string; reason: 'compaction' | 'user_reset' }
  | { op: 'set_hydration_state'; state: SessionTimeline['hydrationState'] };
```

Removal is intentionally rare. Normal live reconciliation should upsert, not remove.

## Browser Runtime

The browser runtime is deliberately small.

Responsibilities:

- Subscribe with last known cursor.
- Apply snapshots by replacing local view for that session.
- Apply patches by ID.
- Sort by `orderKey`.
- Render `TimelineItemView[]`.
- Keep collapse state keyed by item ID.
- Keep scroll state independent of patch application.

The browser does not:

- Call `chat.history` for display.
- Merge raw OpenClaw live events into transcript state.
- Deduplicate assistant/tool/thinking bubbles by text.
- Maintain a separate streaming assistant bubble outside the timeline.

## Hydration Flow

### Page Load or Session Switch

1. Browser subscribes to `/api/chat-runtime/stream`.
2. Server immediately emits `connected`.
3. If the session timeline is missing or stale, server marks it `hydrating`.
4. Server fetches `chat.history`.
5. Server applies `history_snapshot`.
6. Server emits a `snapshot`.
7. Live gateway events that arrived during hydration are applied after the snapshot source event and emitted as patches or included in the snapshot if already reduced.

The browser never sends a user prompt before the selected session has a ready timeline. If the user submits while hydration is running, the input can be queued client-side and sent after `hydrationState === 'ready'`.

### Refresh Mid-Turn

1. Server has continued receiving OpenClaw events while the browser was gone.
2. Browser reconnects without a current cursor, or with an expired cursor.
3. Server emits a snapshot containing the active turn and all known running/completed items.
4. Browser renders the active timeline immediately.
5. Later OpenClaw `chat.final` or `chat.history` reconciliation finalizes provisional items in place.

### Server Restart Mid-Turn

First-version behavior:

1. Server loses live-only active turn frames.
2. On startup or first subscription, server fetches `chat.history`.
3. Finalized persisted items are restored.
4. If OpenClaw still reports active state but missed live frames are not recoverable, the UI shows a recovering/running state until final history catches up.

This limitation is acceptable for the first version and should be visible in tests and documentation.

## Sending Messages

Message sending should go through Nerve so the server timeline can create an optimistic turn before OpenClaw events arrive.

Endpoint:

```text
POST /api/chat-runtime/sessions/:sessionKey/messages
```

Request:

```ts
interface SendRuntimeMessageRequest {
  text: string;
  attachments?: OutgoingAttachment[];
  idempotencyKey: string;
}
```

Response:

```ts
interface SendRuntimeMessageResponse {
  ok: true;
  sessionKey: string;
  runId?: string;
  turnId: string;
  cursor: string;
}
```

Server behavior:

1. Create or upsert optimistic user item by `idempotencyKey`.
2. Forward to OpenClaw `chat.send`.
3. If OpenClaw returns `runId`, bind the optimistic turn to that run.
4. Emit patches for the optimistic item and running turn.
5. Reconcile when OpenClaw emits `chat.started` and `chat.final`.

If send fails, the optimistic item becomes `failed`; it is not silently removed.

## History Reconciliation

History snapshots are authoritative for finalized transcript content, but not for live continuity.

Rules:

- History can create missing finalized turns/items.
- History can update text, block order, images, tool args, tool results, and thinking text.
- History can mark a turn finalized when it contains the final assistant response.
- History cannot wipe a running turn solely because the snapshot does not include it yet.
- History cannot remove older finalized items unless the session was reset or compaction explicitly says the prefix is gone.
- Duplicate final assistant text should update the active assistant item, not append a new one.

## Error Handling

Gateway disconnect:

- Keep current timelines in memory.
- Mark active turns as `running` with `connectionState: reconnecting`.
- Reconnect upstream.
- Fetch history for sessions that had active turns.
- Reconcile after reconnect.

Invalid gateway payload:

- Log with event type, session key, run ID if available, and validation error.
- Do not apply to timeline.
- Do not break the stream.

Cursor expired:

- Send full snapshot.
- Include a reason field for diagnostics.

Store limit exceeded:

- Compact old finalized prefix.
- Never compact active turns.
- Prefer requiring a fresh history snapshot over preserving an oversized patch log.

## Testing Strategy

### Unit Tests

Reducer tests should cover:

- Duplicate `assistant_delta`.
- Duplicate `assistant_final`.
- `tool_finished` before `tool_started`.
- `history_snapshot` before live events.
- Live events before `history_snapshot`.
- Refresh mid-turn snapshot.
- Session switch with buffered live events.
- Thinking block appears only in final/history.
- Thinking block appears live before final.
- Consecutive tool calls grouped.
- Assistant text boundary closes a tool group.
- Final assistant response updates streaming item in place.
- User optimistic item reconciles with persisted user item.
- Late stale history does not erase active turn.
- Server cursor replay with patch gap.

### Integration Tests

Server tests should cover:

- SSE subscription receives initial snapshot.
- SSE reconnect with retained cursor receives only patches.
- SSE reconnect with expired cursor receives snapshot.
- `POST /messages` creates optimistic timeline patches.
- Gateway reconnect triggers history reconciliation.
- Per-session retention does not leak patches across sessions.

### Browser Tests

Component tests should cover:

- `TimelineItem[]` rendering order.
- Collapse state survives item updates.
- Streaming assistant text updates the same DOM item.
- Tool result updates the same DOM item.
- Snapshot replacement does not duplicate items with same IDs.

### Browser Smoke

Manual/Playwright smoke should verify:

- Send a message and observe live assistant streaming.
- Refresh during generation.
- Switch to another session and back during generation.
- Tool call bubbles remain visible and ordered.
- Thinking blocks remain visible once known.
- Final assistant bubble appears once.
- Repeated refresh after finalization does not duplicate the last reply.

## Rollout Plan

### Phase 1: Server Runtime Foundation

- Add runtime types.
- Add adapter validation.
- Add pure timeline reducer.
- Add in-memory timeline store and replay buffer.
- Add unit tests with synthetic OpenClaw event fixtures.

No UI migration yet.

### Phase 2: Runtime API

- Add `/api/chat-runtime/stream`.
- Add runtime send endpoint.
- Add gateway supervisor lifecycle.
- Add history hydration and reconciliation.
- Add server integration tests.

Existing chat UI can remain on the old path.

### Phase 3: Browser Timeline Client

- Add browser runtime client.
- Add timeline reducer/view store on the browser for snapshots and patches.
- Add typed rendering model.
- Keep behind a feature flag.

### Phase 4: Chat Renderer Migration

- Render `TimelineItem[]` in the chat panel.
- Remove separate streaming response rendering for the flagged path.
- Remove browser `chat.history` display merging for the flagged path.
- Keep existing visual components where possible, but drive them from timeline item types.

### Phase 5: Validation and Cutover

- Run focused unit/integration tests.
- Run full build and lint.
- Run browser smoke against `http://localhost:3080`.
- Enable runtime path by default only after refresh/session-switch/live-turn smoke passes.

## Acceptance Criteria

- Refresh mid-turn preserves all known assistant, thinking, and tool timeline items.
- Session switching mid-turn does not duplicate the prompt, tool items, or final response.
- Tool bubbles do not jump above/below the streaming assistant item during a turn.
- Consecutive tool calls remain grouped during streaming and after refresh.
- Final assistant response appears exactly once.
- Thinking blocks do not disappear after finalization if they are present in live events or history.
- Clearing browser cache/cookies does not remove finalized OpenClaw history from the rendered timeline.
- Browser reconnect with a retained cursor receives patches instead of a full reload.
- Browser reconnect with an expired cursor receives a correct snapshot.
- Nerve restart restores finalized history and degrades explicitly for live-only missed frames.

## Implementation Notes

- Keep the reducer independent of React and Hono.
- Keep OpenClaw payload parsing in the adapter, not in UI components.
- Use generated stable entity IDs at the server store layer, not during React rendering.
- Prefer SSE for timeline delivery first; it fits one-way server replay and is easier to test.
- Keep raw gateway frame logging behind a debug flag to avoid leaking large payloads by default.
- Make all limits configurable but ship conservative defaults.
- Add a development diagnostic endpoint to inspect one session timeline while building, but do not expose it without auth in production.

## Open Questions

- Does OpenClaw expose stable message IDs or content block IDs in `chat.history` for every provider path? If not, the adapter needs deterministic fingerprinting rules for persisted blocks.
- Can OpenClaw stream thinking text live for the relevant agent provider, or are thinking blocks only available in final history? The runtime supports both, but UX expectations should match actual upstream behavior.
- Should the first version subscribe to all sessions globally, or lazily hydrate only sessions with browser subscribers plus active sessions observed from gateway events?
- Should timeline snapshots include rendered HTML, or should the browser render markdown from plain text? Recommendation: send plain structured content and render in the browser.
