# Chat Runtime Server Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a server-owned replayable chat runtime so OpenClaw thinking blocks, tool uses, tool results, and assistant response streams render from one stable timeline across refreshes and session switches.

**Architecture:** Nerve keeps a process-local upstream OpenClaw gateway subscriber, normalizes raw gateway frames and `chat.history` snapshots into runtime events, reduces them into a per-session canonical timeline, and serves browser subscribers snapshots plus cursor-based patches over SSE. The browser renders `TimelineItemView[]` only; it does not merge raw `chat.history`, live `chat` events, tool activity, and a separate streaming bubble.

**Tech Stack:** TypeScript 5.9, Node 22+, Hono, `ws`, React 19, Vite, Vitest, Testing Library, existing Nerve gateway RPC utilities.

---

## Source Spec

Read the design before starting:

- `docs/superpowers/specs/2026-05-05-chat-runtime-server-replay-design.md`

The highest-risk requirements are:

- Active turn survives page refresh because the server keeps receiving events while the browser is gone.
- Stable item IDs prevent duplicate prompts, duplicate tools, duplicate final assistant bubbles, and disappearing thinking blocks.
- Browser rendering consumes a single timeline view.
- History reconciliation updates active/finalized entities in place.

## File Structure

Create the runtime under a new server module. Keep the old chat path intact until the feature flag switches over.

### Server Files

- Create `server/lib/chat-runtime/types.ts`
  - Owns runtime event types, timeline item types, patch types, cursor types, and public view types.
- Create `server/lib/chat-runtime/id.ts`
  - Owns deterministic ID helpers for turns, assistant items, thinking items, tool calls, tool groups, and fallback fingerprints.
- Create `server/lib/chat-runtime/reducer.ts`
  - Pure reducer from `RuntimeEvent` to `SessionTimeline`.
- Create `server/lib/chat-runtime/adapter.ts`
  - Validates raw OpenClaw `chat`, `agent`, and history payloads and converts them into `RuntimeEvent[]`.
- Create `server/lib/chat-runtime/store.ts`
  - Process-local timeline store with per-session timelines, subscribers, snapshots, and patch publication.
- Create `server/lib/chat-runtime/replay-buffer.ts`
  - Per-session cursor ring buffer for patch replay.
- Create `server/lib/chat-runtime/gateway-supervisor.ts`
  - Long-lived upstream OpenClaw WebSocket connection and reconnect loop.
- Create `server/lib/chat-runtime/runtime.ts`
  - Composition root for adapter, reducer, store, replay buffer, gateway supervisor, and history hydration.
- Create `server/lib/chat-runtime/singleton.ts`
  - Process-local runtime singleton, feature limits, and supervisor lifecycle exports.
- Create `server/routes/chat-runtime.ts`
  - SSE stream endpoint, send endpoint, optional diagnostic endpoint in development.

### Server Tests

- Create `server/lib/chat-runtime/id.test.ts`
- Create `server/lib/chat-runtime/reducer.test.ts`
- Create `server/lib/chat-runtime/adapter.test.ts`
- Create `server/lib/chat-runtime/replay-buffer.test.ts`
- Create `server/lib/chat-runtime/store.test.ts`
- Create `server/lib/chat-runtime/gateway-supervisor.test.ts`
- Create `server/routes/chat-runtime.test.ts`

### Frontend Files

- Create `src/features/chat-runtime/types.ts`
  - Browser-facing timeline view and SSE message types matching the server public contract.
- Create `src/features/chat-runtime/timelineClient.ts`
  - SSE client plus snapshot/patch application helpers.
- Create `src/features/chat-runtime/timelineStore.ts`
  - Small browser-side store hook for snapshots, patches, cursor, and hydration state.
- Create `src/features/chat-runtime/runtimeFlag.ts`
  - Browser feature flag helper for staged rollout.
- Create `src/features/chat-runtime/sendRuntimeMessage.ts`
  - Browser send helper for the runtime endpoint.
- Create `src/features/chat-runtime/ChatRuntimePanel.tsx`
  - Runtime chat panel wrapper combining timeline rendering and the existing input bar.
- Create `src/features/chat-runtime/ChatTimeline.tsx`
  - Renders timeline items by kind.
- Create `src/features/chat-runtime/TimelineToolBlock.tsx`
  - Tool group and tool call renderer.
- Create `src/features/chat-runtime/TimelineThinkingBlock.tsx`
  - Thinking renderer.
- Create `src/features/chat-runtime/TimelineAssistantBlock.tsx`
  - Assistant message renderer, including streaming state.
- Create `src/features/chat-runtime/index.ts`

### Frontend Tests

- Create `src/features/chat-runtime/timelineClient.test.ts`
- Create `src/features/chat-runtime/ChatTimeline.test.tsx`

### Existing Files To Modify

- Modify `server/app.ts`
  - Mount `chatRuntimeRoutes`.
  - Exclude `/api/chat-runtime/stream` from compression.
- Modify `server/index.ts`
  - Start and stop the chat runtime supervisor.
- Modify `server/lib/config.ts`
  - Add feature flag and runtime limits.
- Modify `src/App.tsx`
  - Route chat rendering through the new timeline path when the feature flag is enabled.
- Modify `src/features/chat/ChatPanel.tsx`
  - Accept an optional runtime timeline child or add a sibling runtime panel wrapper. Keep the old path functional during rollout.
- Modify `docs/API.md`
  - Document the new runtime endpoints after implementation.
- Modify `docs/ARCHITECTURE.md`
  - Add the chat runtime to the architecture overview after implementation.

---

## Task 1: Runtime Types And Deterministic IDs

**Files:**
- Create: `server/lib/chat-runtime/types.ts`
- Create: `server/lib/chat-runtime/id.ts`
- Test: `server/lib/chat-runtime/id.test.ts`

### Steps

- [ ] **Step 1: Write ID tests first**

Create `server/lib/chat-runtime/id.test.ts` with deterministic ID coverage.

```ts
import { describe, expect, it } from 'vitest';
import {
  assistantItemId,
  fingerprintText,
  thinkingItemId,
  toolCallItemId,
  toolGroupItemId,
  turnId,
  userItemId,
} from './id.js';

describe('chat runtime ids', () => {
  it('creates stable IDs from session and run identifiers', () => {
    expect(turnId('agent:main:main', 'run-1')).toBe('turn:agent:main:main:run-1');
    expect(assistantItemId('agent:main:main', 'run-1')).toBe('assistant:agent:main:main:run-1:answer');
    expect(toolCallItemId('agent:main:main', 'run-1', 'tool-7')).toBe('tool:agent:main:main:run-1:tool-7');
    expect(toolGroupItemId('agent:main:main', 'run-1', 2)).toBe('tool-group:agent:main:main:run-1:2');
    expect(thinkingItemId('agent:main:main', 'run-1', 0)).toBe('thinking:agent:main:main:run-1:0');
  });

  it('uses gateway message id for user items when present', () => {
    expect(userItemId({ sessionKey: 'agent:main:main', messageId: 'msg-1' })).toBe('user:agent:main:main:msg-1');
  });

  it('uses idempotency key for optimistic user items', () => {
    expect(userItemId({ sessionKey: 'agent:main:main', idempotencyKey: 'ik-1' })).toBe('user:agent:main:main:ik-1');
  });

  it('fingerprints normalized text deterministically', () => {
    expect(fingerprintText(' hello\\n\\nworld ')).toBe(fingerprintText('hello world'));
    expect(fingerprintText('hello world')).not.toBe(fingerprintText('hello there'));
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- --run server/lib/chat-runtime/id.test.ts
```

Expected: fail because `server/lib/chat-runtime/id.ts` does not exist.

- [ ] **Step 3: Add runtime types**

Create `server/lib/chat-runtime/types.ts` with the canonical server contract.

```ts
export type TimelineHydrationState = 'cold' | 'hydrating' | 'ready' | 'stale';
export type TimelineTurnStatus = 'running' | 'finalized' | 'failed' | 'aborted';
export type TimelineItemStatus = 'provisional' | 'running' | 'complete' | 'failed' | 'aborted';
export type TimelineItemSource = 'history' | 'live' | 'optimistic' | 'system';

export interface TimelineOrderKey {
  turn: number;
  block: number;
  sub: number;
}

export interface TimelineItemBase {
  id: string;
  sessionKey: string;
  turnId?: string;
  runId?: string;
  kind: 'user_message' | 'thinking' | 'tool_group' | 'tool_call' | 'assistant_message' | 'system_event';
  orderKey: TimelineOrderKey;
  createdAt: number;
  updatedAt: number;
  status: TimelineItemStatus;
  source: TimelineItemSource;
}

export interface UserTimelineItem extends TimelineItemBase {
  kind: 'user_message';
  text: string;
  idempotencyKey?: string;
  messageId?: string;
  pending?: boolean;
}

export interface ThinkingTimelineItem extends TimelineItemBase {
  kind: 'thinking';
  text: string;
  durationMs?: number;
}

export interface ToolGroupTimelineItem extends TimelineItemBase {
  kind: 'tool_group';
  childItemIds: string[];
  closed: boolean;
}

export interface ToolCallTimelineItem extends TimelineItemBase {
  kind: 'tool_call';
  toolCallId: string;
  name: string;
  args: unknown;
  result?: unknown;
  error?: string;
}

export interface AssistantTimelineItem extends TimelineItemBase {
  kind: 'assistant_message';
  text: string;
  isStreaming: boolean;
  finalText?: string;
  stopReason?: string;
}

export interface SystemTimelineItem extends TimelineItemBase {
  kind: 'system_event';
  text: string;
  severity: 'info' | 'warning' | 'error';
}

export type TimelineItem =
  | UserTimelineItem
  | ThinkingTimelineItem
  | ToolGroupTimelineItem
  | ToolCallTimelineItem
  | AssistantTimelineItem
  | SystemTimelineItem;

export interface TimelineTurn {
  id: string;
  sessionKey: string;
  runId: string;
  status: TimelineTurnStatus;
  startedAt: number;
  finalizedAt?: number;
  inputItemIds: string[];
  outputItemIds: string[];
  orderBase: TimelineOrderKey;
}

export interface SessionTimeline {
  sessionKey: string;
  version: number;
  cursor: string;
  hydrationState: TimelineHydrationState;
  turns: TimelineTurn[];
  items: Record<string, TimelineItem>;
  updatedAt: number;
}

export type RuntimeEvent =
  | { type: 'turn_started'; sessionKey: string; runId: string; at: number; seq?: number }
  | { type: 'user_message_committed'; sessionKey: string; runId?: string; messageId?: string; idempotencyKey?: string; text: string; at: number }
  | { type: 'thinking_started'; sessionKey: string; runId: string; blockIndex: number; at: number }
  | { type: 'thinking_delta'; sessionKey: string; runId: string; blockIndex: number; text: string; at: number }
  | { type: 'thinking_final'; sessionKey: string; runId: string; blockIndex: number; text: string; durationMs?: number; at: number }
  | { type: 'tool_started'; sessionKey: string; runId: string; toolCallId: string; name: string; args: unknown; at: number }
  | { type: 'tool_finished'; sessionKey: string; runId: string; toolCallId: string; result?: unknown; error?: string; at: number }
  | { type: 'assistant_delta'; sessionKey: string; runId: string; text: string; at: number; seq?: number }
  | { type: 'assistant_final'; sessionKey: string; runId: string; text: string; stopReason?: string; at: number }
  | { type: 'turn_finalized'; sessionKey: string; runId: string; at: number }
  | { type: 'turn_failed'; sessionKey: string; runId: string; error: string; at: number }
  | { type: 'history_snapshot'; sessionKey: string; messages: HistoryMessage[]; at: number };

export interface HistoryContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image' | string;
  text?: string;
  thinking?: string;
  id?: string;
  toolCallId?: string;
  name?: string;
  input?: unknown;
  arguments?: unknown;
  content?: unknown;
}

export interface HistoryMessage {
  role: 'user' | 'assistant' | 'tool' | 'toolResult' | 'system';
  content: string | HistoryContentBlock[];
  timestamp?: string | number;
  createdAt?: string | number;
  ts?: string | number;
  id?: string;
  messageId?: string;
  runId?: string;
}

export type TimelinePatchOp =
  | { op: 'upsert_turn'; turn: TimelineTurn }
  | { op: 'upsert_item'; item: TimelineItem }
  | { op: 'remove_item'; id: string; reason: 'compaction' | 'user_reset' }
  | { op: 'set_hydration_state'; state: TimelineHydrationState };

export interface TimelinePatch {
  sessionKey: string;
  cursor: string;
  ops: TimelinePatchOp[];
  createdAt: number;
}

export interface TimelineSnapshot {
  type: 'snapshot';
  sessionKey: string;
  cursor: string;
  timeline: SessionTimeline;
  reason: 'initial' | 'cursor_expired' | 'hydration' | 'manual';
}
```

- [ ] **Step 4: Add deterministic ID helpers**

Create `server/lib/chat-runtime/id.ts`.

```ts
import { createHash } from 'node:crypto';

function cleanPart(value: string): string {
  return value.replace(/\\s+/g, ' ').trim();
}

export function turnId(sessionKey: string, runId: string): string {
  return `turn:${sessionKey}:${runId}`;
}

export function assistantItemId(sessionKey: string, runId: string): string {
  return `assistant:${sessionKey}:${runId}:answer`;
}

export function toolCallItemId(sessionKey: string, runId: string, toolCallId: string): string {
  return `tool:${sessionKey}:${runId}:${toolCallId}`;
}

export function toolGroupItemId(sessionKey: string, runId: string, groupIndex: number): string {
  return `tool-group:${sessionKey}:${runId}:${groupIndex}`;
}

export function thinkingItemId(sessionKey: string, runId: string, blockIndex: number): string {
  return `thinking:${sessionKey}:${runId}:${blockIndex}`;
}

export function fingerprintText(input: string): string {
  const normalized = cleanPart(input);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export function userItemId(params: {
  sessionKey: string;
  messageId?: string;
  idempotencyKey?: string;
  text?: string;
  timestamp?: number;
}): string {
  if (params.messageId) return `user:${params.sessionKey}:${params.messageId}`;
  if (params.idempotencyKey) return `user:${params.sessionKey}:${params.idempotencyKey}`;
  const textHash = fingerprintText(params.text || '');
  const timestamp = Number.isFinite(params.timestamp) ? params.timestamp : 0;
  return `user:${params.sessionKey}:fallback:${timestamp}:${textHash}`;
}
```

- [ ] **Step 5: Verify ID tests pass**

Run:

```bash
npm test -- --run server/lib/chat-runtime/id.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add server/lib/chat-runtime/types.ts server/lib/chat-runtime/id.ts server/lib/chat-runtime/id.test.ts
git commit -m "feat(chat-runtime): add timeline types and stable ids"
```

---

## Task 2: Pure Timeline Reducer

**Files:**
- Create: `server/lib/chat-runtime/reducer.ts`
- Test: `server/lib/chat-runtime/reducer.test.ts`

### Steps

- [ ] **Step 1: Write reducer tests for live turn stability**

Create `server/lib/chat-runtime/reducer.test.ts` with the first batch of behavior.

```ts
import { describe, expect, it } from 'vitest';
import { createEmptyTimeline, reduceRuntimeEvent } from './reducer.js';

describe('chat runtime reducer', () => {
  it('updates the same assistant item for streaming and final text', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_started', sessionKey: 'agent:main:main', runId: 'run-1', at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_delta', sessionKey: 'agent:main:main', runId: 'run-1', text: 'hel', at: 1001 });
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_delta', sessionKey: 'agent:main:main', runId: 'run-1', text: 'hello', at: 1002 });
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_final', sessionKey: 'agent:main:main', runId: 'run-1', text: 'hello world', at: 1003 });

    const assistantItems = Object.values(timeline.items).filter((item) => item.kind === 'assistant_message');
    expect(assistantItems).toHaveLength(1);
    expect(assistantItems[0]).toMatchObject({
      id: 'assistant:agent:main:main:run-1:answer',
      text: 'hello world',
      status: 'complete',
      source: 'history',
    });
  });

  it('applies duplicate final events idempotently', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    const finalEvent = { type: 'assistant_final' as const, sessionKey: 'agent:main:main', runId: 'run-1', text: 'final answer', at: 1000 };
    timeline = reduceRuntimeEvent(timeline, finalEvent);
    timeline = reduceRuntimeEvent(timeline, finalEvent);

    const assistantItems = Object.values(timeline.items).filter((item) => item.kind === 'assistant_message');
    expect(assistantItems).toHaveLength(1);
    expect(assistantItems[0].text).toBe('final answer');
  });

  it('keeps old finalized assistant items while a new turn runs', () => {
    let timeline = createEmptyTimeline('agent:main:main');
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_final', sessionKey: 'agent:main:main', runId: 'run-old', text: 'old answer', at: 1000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_finalized', sessionKey: 'agent:main:main', runId: 'run-old', at: 1001 });
    timeline = reduceRuntimeEvent(timeline, { type: 'turn_started', sessionKey: 'agent:main:main', runId: 'run-new', at: 2000 });
    timeline = reduceRuntimeEvent(timeline, { type: 'assistant_delta', sessionKey: 'agent:main:main', runId: 'run-new', text: 'new partial', at: 2001 });

    const texts = Object.values(timeline.items)
      .filter((item) => item.kind === 'assistant_message')
      .map((item) => item.text);
    expect(texts).toEqual(['old answer', 'new partial']);
  });
});
```

- [ ] **Step 2: Run the failing reducer tests**

Run:

```bash
npm test -- --run server/lib/chat-runtime/reducer.test.ts
```

Expected: fail because `reducer.ts` does not exist.

- [ ] **Step 3: Implement minimal reducer**

Create `server/lib/chat-runtime/reducer.ts`.

```ts
import {
  assistantItemId,
  thinkingItemId,
  toolCallItemId,
  toolGroupItemId,
  turnId,
  userItemId,
} from './id.js';
import type {
  AssistantTimelineItem,
  RuntimeEvent,
  SessionTimeline,
  TimelineItem,
  TimelineOrderKey,
  TimelinePatchOp,
  TimelineTurn,
  ToolCallTimelineItem,
  ToolGroupTimelineItem,
} from './types.js';

const ZERO_CURSOR = '0';

export function createEmptyTimeline(sessionKey: string): SessionTimeline {
  return {
    sessionKey,
    version: 0,
    cursor: ZERO_CURSOR,
    hydrationState: 'cold',
    turns: [],
    items: {},
    updatedAt: Date.now(),
  };
}

function nextVersion(timeline: SessionTimeline, at: number): SessionTimeline {
  return { ...timeline, version: timeline.version + 1, cursor: String(timeline.version + 1), updatedAt: at };
}

function compareOrder(a: TimelineOrderKey, b: TimelineOrderKey): number {
  return a.turn - b.turn || a.block - b.block || a.sub - b.sub;
}

function getTurnIndex(timeline: SessionTimeline, runId: string): number {
  const existing = timeline.turns.findIndex((turn) => turn.runId === runId);
  return existing >= 0 ? existing : timeline.turns.length;
}

function defaultOrder(timeline: SessionTimeline, runId: string, blockOffset = 0, sub = 0): TimelineOrderKey {
  return { turn: getTurnIndex(timeline, runId), block: blockOffset, sub };
}

function upsertTurn(timeline: SessionTimeline, sessionKey: string, runId: string, at: number): { timeline: SessionTimeline; turn: TimelineTurn } {
  const id = turnId(sessionKey, runId);
  const existing = timeline.turns.find((turn) => turn.id === id);
  if (existing) return { timeline, turn: existing };

  const turn: TimelineTurn = {
    id,
    sessionKey,
    runId,
    status: 'running',
    startedAt: at,
    inputItemIds: [],
    outputItemIds: [],
    orderBase: { turn: timeline.turns.length, block: 0, sub: 0 },
  };
  return { timeline: { ...timeline, turns: [...timeline.turns, turn] }, turn };
}

function replaceTurn(timeline: SessionTimeline, nextTurn: TimelineTurn): SessionTimeline {
  return {
    ...timeline,
    turns: timeline.turns
      .map((turn) => (turn.id === nextTurn.id ? nextTurn : turn))
      .sort((a, b) => compareOrder(a.orderBase, b.orderBase)),
  };
}

function upsertItem(timeline: SessionTimeline, item: TimelineItem): SessionTimeline {
  return {
    ...timeline,
    items: {
      ...timeline.items,
      [item.id]: item,
    },
  };
}

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function activeToolGroup(timeline: SessionTimeline, sessionKey: string, runId: string): ToolGroupTimelineItem {
  const groupIndex = Object.values(timeline.items)
    .filter((item) => item.kind === 'tool_group' && item.sessionKey === sessionKey && item.runId === runId)
    .length;
  const existing = Object.values(timeline.items)
    .find((item): item is ToolGroupTimelineItem =>
      item.kind === 'tool_group' && item.sessionKey === sessionKey && item.runId === runId && !item.closed,
    );
  if (existing) return existing;

  return {
    id: toolGroupItemId(sessionKey, runId, groupIndex),
    kind: 'tool_group',
    sessionKey,
    runId,
    turnId: turnId(sessionKey, runId),
    childItemIds: [],
    closed: false,
    orderKey: defaultOrder(timeline, runId, 20 + groupIndex, 0),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'running',
    source: 'live',
  };
}

export function reduceRuntimeEvent(timeline: SessionTimeline, event: RuntimeEvent): SessionTimeline {
  if (event.sessionKey !== timeline.sessionKey) return timeline;

  if (event.type === 'turn_started') {
    const result = upsertTurn(timeline, event.sessionKey, event.runId, event.at);
    return nextVersion(result.timeline, event.at);
  }

  if (event.type === 'user_message_committed') {
    const runId = event.runId || `optimistic:${event.idempotencyKey || event.messageId || 'unknown'}`;
    let result = upsertTurn(timeline, event.sessionKey, runId, event.at);
    const id = userItemId({
      sessionKey: event.sessionKey,
      messageId: event.messageId,
      idempotencyKey: event.idempotencyKey,
      text: event.text,
      timestamp: event.at,
    });
    const item: TimelineItem = {
      id,
      kind: 'user_message',
      sessionKey: event.sessionKey,
      runId,
      turnId: result.turn.id,
      text: event.text,
      messageId: event.messageId,
      idempotencyKey: event.idempotencyKey,
      orderKey: defaultOrder(result.timeline, runId, 0, 0),
      createdAt: event.at,
      updatedAt: event.at,
      status: event.messageId ? 'complete' : 'provisional',
      source: event.messageId ? 'history' : 'optimistic',
      pending: !event.messageId,
    };
    result.timeline = upsertItem(result.timeline, item);
    result.turn = { ...result.turn, inputItemIds: appendUnique(result.turn.inputItemIds, id) };
    result.timeline = replaceTurn(result.timeline, result.turn);
    return nextVersion(result.timeline, event.at);
  }

  if (event.type === 'assistant_delta' || event.type === 'assistant_final') {
    let result = upsertTurn(timeline, event.sessionKey, event.runId, event.at);
    const id = assistantItemId(event.sessionKey, event.runId);
    const prev = result.timeline.items[id] as AssistantTimelineItem | undefined;
    const item: AssistantTimelineItem = {
      id,
      kind: 'assistant_message',
      sessionKey: event.sessionKey,
      runId: event.runId,
      turnId: result.turn.id,
      text: event.text,
      finalText: event.type === 'assistant_final' ? event.text : prev?.finalText,
      stopReason: event.type === 'assistant_final' ? event.stopReason : prev?.stopReason,
      isStreaming: event.type === 'assistant_delta',
      orderKey: prev?.orderKey || defaultOrder(result.timeline, event.runId, 100, 0),
      createdAt: prev?.createdAt || event.at,
      updatedAt: event.at,
      status: event.type === 'assistant_final' ? 'complete' : 'running',
      source: event.type === 'assistant_final' ? 'history' : 'live',
    };
    result.timeline = upsertItem(result.timeline, item);
    result.turn = {
      ...result.turn,
      outputItemIds: appendUnique(result.turn.outputItemIds, id),
      status: event.type === 'assistant_final' ? 'finalized' : result.turn.status,
      finalizedAt: event.type === 'assistant_final' ? event.at : result.turn.finalizedAt,
    };
    result.timeline = replaceTurn(result.timeline, result.turn);
    return nextVersion(result.timeline, event.at);
  }

  if (event.type === 'thinking_delta' || event.type === 'thinking_final' || event.type === 'thinking_started') {
    let result = upsertTurn(timeline, event.sessionKey, event.runId, event.at);
    const id = thinkingItemId(event.sessionKey, event.runId, event.blockIndex);
    const prev = result.timeline.items[id];
    const text = event.type === 'thinking_started' ? (prev?.kind === 'thinking' ? prev.text : '') : event.text;
    const item: TimelineItem = {
      id,
      kind: 'thinking',
      sessionKey: event.sessionKey,
      runId: event.runId,
      turnId: result.turn.id,
      text,
      durationMs: event.type === 'thinking_final' ? event.durationMs : undefined,
      orderKey: prev?.orderKey || defaultOrder(result.timeline, event.runId, 10 + event.blockIndex, 0),
      createdAt: prev?.createdAt || event.at,
      updatedAt: event.at,
      status: event.type === 'thinking_final' ? 'complete' : 'running',
      source: event.type === 'thinking_final' ? 'history' : 'live',
    };
    result.timeline = upsertItem(result.timeline, item);
    result.turn = { ...result.turn, outputItemIds: appendUnique(result.turn.outputItemIds, id) };
    result.timeline = replaceTurn(result.timeline, result.turn);
    return nextVersion(result.timeline, event.at);
  }

  if (event.type === 'tool_started' || event.type === 'tool_finished') {
    let result = upsertTurn(timeline, event.sessionKey, event.runId, event.at);
    let group = activeToolGroup(result.timeline, event.sessionKey, event.runId);
    const id = toolCallItemId(event.sessionKey, event.runId, event.toolCallId);
    const prev = result.timeline.items[id] as ToolCallTimelineItem | undefined;
    const item: ToolCallTimelineItem = {
      id,
      kind: 'tool_call',
      sessionKey: event.sessionKey,
      runId: event.runId,
      turnId: result.turn.id,
      toolCallId: event.toolCallId,
      name: event.type === 'tool_started' ? event.name : prev?.name || 'unknown',
      args: event.type === 'tool_started' ? event.args : prev?.args || {},
      result: event.type === 'tool_finished' ? event.result : prev?.result,
      error: event.type === 'tool_finished' ? event.error : prev?.error,
      orderKey: prev?.orderKey || defaultOrder(result.timeline, event.runId, 21 + group.childItemIds.length, 0),
      createdAt: prev?.createdAt || event.at,
      updatedAt: event.at,
      status: event.type === 'tool_finished' ? (event.error ? 'failed' : 'complete') : 'running',
      source: event.type === 'tool_finished' ? 'history' : 'live',
    };
    group = { ...group, childItemIds: appendUnique(group.childItemIds, id), updatedAt: event.at };
    result.timeline = upsertItem(result.timeline, group);
    result.timeline = upsertItem(result.timeline, item);
    result.turn = {
      ...result.turn,
      outputItemIds: appendUnique(appendUnique(result.turn.outputItemIds, group.id), id),
    };
    result.timeline = replaceTurn(result.timeline, result.turn);
    return nextVersion(result.timeline, event.at);
  }

  if (event.type === 'turn_finalized' || event.type === 'turn_failed') {
    const result = upsertTurn(timeline, event.sessionKey, event.runId, event.at);
    const nextTurn: TimelineTurn = {
      ...result.turn,
      status: event.type === 'turn_finalized' ? 'finalized' : 'failed',
      finalizedAt: event.at,
    };
    return nextVersion(replaceTurn(result.timeline, nextTurn), event.at);
  }

  if (event.type === 'history_snapshot') {
    return nextVersion({ ...timeline, hydrationState: 'ready' }, event.at);
  }

  return timeline;
}

export function timelineItemsInOrder(timeline: SessionTimeline): TimelineItem[] {
  return Object.values(timeline.items).sort((a, b) => compareOrder(a.orderKey, b.orderKey));
}

export function buildPatchFromTimeline(timeline: SessionTimeline): TimelinePatchOp[] {
  return [
    ...timeline.turns.map((turn): TimelinePatchOp => ({ op: 'upsert_turn', turn })),
    ...timelineItemsInOrder(timeline).map((item): TimelinePatchOp => ({ op: 'upsert_item', item })),
    { op: 'set_hydration_state', state: timeline.hydrationState },
  ];
}
```

- [ ] **Step 4: Verify reducer tests pass**

Run:

```bash
npm test -- --run server/lib/chat-runtime/reducer.test.ts
```

Expected: pass.

- [ ] **Step 5: Add reducer tests for tools and thinking**

Append tests that lock down the remaining active-turn entities.

```ts
it('keeps one tool call item when result arrives after start', () => {
  let timeline = createEmptyTimeline('agent:main:main');
  timeline = reduceRuntimeEvent(timeline, { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', name: 'exec', args: { cmd: 'pwd' }, at: 1000 });
  timeline = reduceRuntimeEvent(timeline, { type: 'tool_finished', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', result: 'ok', at: 1001 });

  const toolItems = Object.values(timeline.items).filter((item) => item.kind === 'tool_call');
  const groups = Object.values(timeline.items).filter((item) => item.kind === 'tool_group');
  expect(toolItems).toHaveLength(1);
  expect(toolItems[0]).toMatchObject({ id: 'tool:agent:main:main:run-1:tool-1', status: 'complete' });
  expect(groups).toHaveLength(1);
});

it('creates a tool item even when result arrives before start', () => {
  let timeline = createEmptyTimeline('agent:main:main');
  timeline = reduceRuntimeEvent(timeline, { type: 'tool_finished', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', result: 'late result', at: 1001 });

  const toolItems = Object.values(timeline.items).filter((item) => item.kind === 'tool_call');
  expect(toolItems).toHaveLength(1);
  expect(toolItems[0]).toMatchObject({ name: 'unknown', result: 'late result', status: 'complete' });
});

it('updates thinking in place from live delta to final text', () => {
  let timeline = createEmptyTimeline('agent:main:main');
  timeline = reduceRuntimeEvent(timeline, { type: 'thinking_delta', sessionKey: 'agent:main:main', runId: 'run-1', blockIndex: 0, text: 'reason', at: 1000 });
  timeline = reduceRuntimeEvent(timeline, { type: 'thinking_final', sessionKey: 'agent:main:main', runId: 'run-1', blockIndex: 0, text: 'reasoned fully', durationMs: 2500, at: 1001 });

  const thinkingItems = Object.values(timeline.items).filter((item) => item.kind === 'thinking');
  expect(thinkingItems).toHaveLength(1);
  expect(thinkingItems[0]).toMatchObject({ text: 'reasoned fully', status: 'complete', durationMs: 2500 });
});
```

- [ ] **Step 6: Run reducer tests again**

Run:

```bash
npm test -- --run server/lib/chat-runtime/reducer.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add server/lib/chat-runtime/reducer.ts server/lib/chat-runtime/reducer.test.ts
git commit -m "feat(chat-runtime): reduce live events into stable timeline"
```

---

## Task 3: OpenClaw Event Adapter

**Files:**
- Create: `server/lib/chat-runtime/adapter.ts`
- Test: `server/lib/chat-runtime/adapter.test.ts`

### Steps

- [ ] **Step 1: Write adapter tests**

Create `server/lib/chat-runtime/adapter.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { adaptGatewayEvent, adaptHistorySnapshot } from './adapter.js';

describe('OpenClaw chat runtime adapter', () => {
  it('adapts chat started and delta events', () => {
    expect(adaptGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: { state: 'started', sessionKey: 'agent:main:main', runId: 'run-1' },
      seq: 3,
    })).toEqual([
      { type: 'turn_started', sessionKey: 'agent:main:main', runId: 'run-1', at: expect.any(Number), seq: 3 },
    ]);

    expect(adaptGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: {
        state: 'delta',
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      },
      seq: 4,
    })).toEqual([
      { type: 'assistant_delta', sessionKey: 'agent:main:main', runId: 'run-1', text: 'hello', at: expect.any(Number), seq: 4 },
    ]);
  });

  it('adapts agent tool events', () => {
    expect(adaptGatewayEvent({
      type: 'event',
      event: 'agent',
      payload: {
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        stream: 'tool',
        data: { phase: 'start', toolCallId: 'tool-1', name: 'exec', args: { cmd: 'pwd' } },
      },
    })).toEqual([
      { type: 'tool_started', sessionKey: 'agent:main:main', runId: 'run-1', toolCallId: 'tool-1', name: 'exec', args: { cmd: 'pwd' }, at: expect.any(Number) },
    ]);
  });

  it('adapts assistant history content blocks into ordered runtime events', () => {
    const events = adaptHistorySnapshot('agent:main:main', [
      {
        role: 'assistant',
        runId: 'run-1',
        timestamp: 1000,
        content: [
          { type: 'thinking', thinking: 'thought' },
          { type: 'tool_use', id: 'tool-1', name: 'exec', input: { cmd: 'pwd' } },
          { type: 'text', text: 'answer' },
        ],
      },
    ]);

    expect(events.map((event) => event.type)).toEqual([
      'history_snapshot',
      'thinking_final',
      'tool_started',
      'assistant_final',
      'turn_finalized',
    ]);
  });

  it('skips invalid gateway payloads', () => {
    expect(adaptGatewayEvent({ type: 'event', event: 'chat', payload: { state: 'delta' } })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the failing adapter tests**

Run:

```bash
npm test -- --run server/lib/chat-runtime/adapter.test.ts
```

Expected: fail because `adapter.ts` does not exist.

- [ ] **Step 3: Implement adapter**

Create `server/lib/chat-runtime/adapter.ts`.

```ts
import type { GatewayEvent } from '../../types.js';
import type { HistoryContentBlock, HistoryMessage, RuntimeEvent } from './types.js';

function now(): number {
  return Date.now();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function extractText(message: unknown): string {
  if (typeof message === 'string') return message;
  const record = asRecord(message);
  if (!record) return '';
  if (typeof record.text === 'string') return record.text;
  if (typeof record.content === 'string') return record.content;
  if (Array.isArray(record.content)) {
    return record.content
      .map((block) => {
        const blockRecord = asRecord(block);
        return typeof blockRecord?.text === 'string' ? blockRecord.text : '';
      })
      .filter(Boolean)
      .join('\\n');
  }
  return '';
}

function runIdFromPayload(payload: Record<string, unknown>): string | undefined {
  return asString(payload.runId) || asString(payload.id);
}

export function adaptGatewayEvent(event: GatewayEvent): RuntimeEvent[] {
  const payload = asRecord(event.payload);
  if (!payload) return [];

  if (event.event === 'chat') {
    const sessionKey = asString(payload.sessionKey);
    const runId = runIdFromPayload(payload);
    const state = asString(payload.state);
    if (!sessionKey || !runId || !state) return [];
    const at = now();

    if (state === 'started') return [{ type: 'turn_started', sessionKey, runId, at, seq: event.seq }];
    if (state === 'delta') {
      const text = extractText(payload.message);
      return text ? [{ type: 'assistant_delta', sessionKey, runId, text, at, seq: event.seq }] : [];
    }
    if (state === 'final') {
      const text = extractText(payload.message) || extractText(Array.isArray(payload.messages) ? payload.messages.at(-1) : undefined);
      const stopReason = asString(payload.stopReason);
      return [
        ...(text ? [{ type: 'assistant_final' as const, sessionKey, runId, text, stopReason, at }] : []),
        { type: 'turn_finalized', sessionKey, runId, at },
      ];
    }
    if (state === 'aborted') return [{ type: 'turn_failed', sessionKey, runId, error: 'aborted', at }];
    if (state === 'error') return [{ type: 'turn_failed', sessionKey, runId, error: asString(payload.errorMessage) || asString(payload.error) || 'error', at }];
    return [];
  }

  if (event.event === 'agent') {
    const sessionKey = asString(payload.sessionKey);
    const runId = runIdFromPayload(payload);
    const stream = asString(payload.stream);
    const data = asRecord(payload.data);
    if (!sessionKey || !runId || stream !== 'tool' || !data) return [];
    const phase = asString(data.phase);
    const toolCallId = asString(data.toolCallId);
    if (!phase || !toolCallId) return [];
    const at = now();

    if (phase === 'start') {
      const name = asString(data.name);
      if (!name) return [];
      return [{ type: 'tool_started', sessionKey, runId, toolCallId, name, args: data.args ?? {}, at }];
    }
    if (phase === 'result') {
      return [{ type: 'tool_finished', sessionKey, runId, toolCallId, result: data.result, error: asString(data.error), at }];
    }
  }

  return [];
}

function messageTime(message: HistoryMessage, fallback: number): number {
  const raw = message.timestamp || message.createdAt || message.ts;
  const parsed = typeof raw === 'number' ? raw : raw ? Date.parse(String(raw)) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function blockInput(block: HistoryContentBlock): unknown {
  return block.input ?? block.arguments ?? {};
}

export function adaptHistorySnapshot(sessionKey: string, messages: HistoryMessage[]): RuntimeEvent[] {
  const at = now();
  const events: RuntimeEvent[] = [{ type: 'history_snapshot', sessionKey, messages, at }];

  for (const message of messages) {
    const runId = message.runId || `history:${messageTime(message, at)}`;
    const eventTime = messageTime(message, at);
    if (message.role === 'user') {
      events.push({
        type: 'user_message_committed',
        sessionKey,
        runId,
        messageId: message.messageId || message.id,
        text: extractText(message),
        at: eventTime,
      });
      continue;
    }

    if (message.role !== 'assistant') continue;

    if (Array.isArray(message.content)) {
      let thinkingIndex = 0;
      for (const block of message.content) {
        if (block.type === 'thinking') {
          events.push({
            type: 'thinking_final',
            sessionKey,
            runId,
            blockIndex: thinkingIndex++,
            text: block.thinking || block.text || '',
            at: eventTime,
          });
        }
        if (block.type === 'tool_use' || block.type === 'toolCall') {
          const toolCallId = block.toolCallId || block.id;
          if (toolCallId && block.name) {
            events.push({ type: 'tool_started', sessionKey, runId, toolCallId, name: block.name, args: blockInput(block), at: eventTime });
          }
        }
      }
    }

    const text = extractText(message);
    if (text) events.push({ type: 'assistant_final', sessionKey, runId, text, at: eventTime });
    events.push({ type: 'turn_finalized', sessionKey, runId, at: eventTime });
  }

  return events;
}
```

- [ ] **Step 4: Verify adapter tests pass**

Run:

```bash
npm test -- --run server/lib/chat-runtime/adapter.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add server/lib/chat-runtime/adapter.ts server/lib/chat-runtime/adapter.test.ts
git commit -m "feat(chat-runtime): adapt OpenClaw events"
```

---

## Task 4: Replay Buffer And Timeline Store

**Files:**
- Create: `server/lib/chat-runtime/replay-buffer.ts`
- Create: `server/lib/chat-runtime/store.ts`
- Test: `server/lib/chat-runtime/replay-buffer.test.ts`
- Test: `server/lib/chat-runtime/store.test.ts`

### Steps

- [ ] **Step 1: Write replay buffer tests**

Create `server/lib/chat-runtime/replay-buffer.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { ReplayBuffer } from './replay-buffer.js';

describe('ReplayBuffer', () => {
  it('replays patches after a retained cursor', () => {
    const buffer = new ReplayBuffer({ maxPatchesPerSession: 3 });
    const first = buffer.append('agent:main:main', [{ op: 'set_hydration_state', state: 'hydrating' }], 1000);
    const second = buffer.append('agent:main:main', [{ op: 'set_hydration_state', state: 'ready' }], 1001);

    expect(buffer.replayAfter('agent:main:main', first.cursor)).toEqual({ kind: 'patches', patches: [second] });
  });

  it('requires snapshot when cursor is expired', () => {
    const buffer = new ReplayBuffer({ maxPatchesPerSession: 1 });
    buffer.append('agent:main:main', [{ op: 'set_hydration_state', state: 'hydrating' }], 1000);
    buffer.append('agent:main:main', [{ op: 'set_hydration_state', state: 'ready' }], 1001);

    expect(buffer.replayAfter('agent:main:main', '1')).toEqual({ kind: 'snapshot_required' });
  });
});
```

- [ ] **Step 2: Implement replay buffer**

Create `server/lib/chat-runtime/replay-buffer.ts`.

```ts
import type { TimelinePatch, TimelinePatchOp } from './types.js';

export interface ReplayBufferOptions {
  maxPatchesPerSession: number;
}

export type ReplayResult =
  | { kind: 'patches'; patches: TimelinePatch[] }
  | { kind: 'snapshot_required' };

export class ReplayBuffer {
  private readonly maxPatchesPerSession: number;
  private readonly bySession = new Map<string, TimelinePatch[]>();
  private counters = new Map<string, number>();

  constructor(options: ReplayBufferOptions) {
    this.maxPatchesPerSession = options.maxPatchesPerSession;
  }

  append(sessionKey: string, ops: TimelinePatchOp[], createdAt = Date.now()): TimelinePatch {
    const next = (this.counters.get(sessionKey) || 0) + 1;
    this.counters.set(sessionKey, next);
    const patch: TimelinePatch = {
      sessionKey,
      cursor: String(next),
      ops,
      createdAt,
    };
    const patches = [...(this.bySession.get(sessionKey) || []), patch].slice(-this.maxPatchesPerSession);
    this.bySession.set(sessionKey, patches);
    return patch;
  }

  replayAfter(sessionKey: string, cursor?: string | null): ReplayResult {
    if (!cursor) return { kind: 'snapshot_required' };
    const patches = this.bySession.get(sessionKey) || [];
    const index = patches.findIndex((patch) => patch.cursor === cursor);
    if (index < 0) return { kind: 'snapshot_required' };
    return { kind: 'patches', patches: patches.slice(index + 1) };
  }

  latestCursor(sessionKey: string): string {
    return String(this.counters.get(sessionKey) || 0);
  }
}
```

- [ ] **Step 3: Write store tests**

Create `server/lib/chat-runtime/store.test.ts`.

```ts
import { describe, expect, it, vi } from 'vitest';
import { ChatTimelineStore } from './store.js';

describe('ChatTimelineStore', () => {
  it('publishes patches when runtime events update a timeline', () => {
    const store = new ChatTimelineStore({ maxPatchesPerSession: 50 });
    const seen: string[] = [];
    const unsubscribe = store.subscribe('agent:main:main', (patch) => seen.push(patch.cursor));

    store.applyEvent({ type: 'turn_started', sessionKey: 'agent:main:main', runId: 'run-1', at: 1000 });
    store.applyEvent({ type: 'assistant_delta', sessionKey: 'agent:main:main', runId: 'run-1', text: 'hello', at: 1001 });

    unsubscribe();
    expect(seen).toEqual(['1', '2']);
    expect(store.snapshot('agent:main:main', 'manual').timeline.turns).toHaveLength(1);
  });

  it('replays retained patches to reconnecting subscribers', () => {
    const store = new ChatTimelineStore({ maxPatchesPerSession: 50 });
    const first = store.applyEvent({ type: 'turn_started', sessionKey: 'agent:main:main', runId: 'run-1', at: 1000 });
    store.applyEvent({ type: 'assistant_delta', sessionKey: 'agent:main:main', runId: 'run-1', text: 'hello', at: 1001 });

    const replay = store.replayAfter('agent:main:main', first.cursor);
    expect(replay.kind).toBe('patches');
    if (replay.kind === 'patches') expect(replay.patches).toHaveLength(1);
  });

  it('removes subscribers cleanly', () => {
    const store = new ChatTimelineStore({ maxPatchesPerSession: 50 });
    const listener = vi.fn();
    const unsubscribe = store.subscribe('agent:main:main', listener);
    unsubscribe();
    store.applyEvent({ type: 'turn_started', sessionKey: 'agent:main:main', runId: 'run-1', at: 1000 });
    expect(listener).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Implement store**

Create `server/lib/chat-runtime/store.ts`.

```ts
import { createEmptyTimeline, reduceRuntimeEvent, buildPatchFromTimeline } from './reducer.js';
import { ReplayBuffer, type ReplayResult } from './replay-buffer.js';
import type { RuntimeEvent, SessionTimeline, TimelinePatch, TimelineSnapshot } from './types.js';

export interface ChatTimelineStoreOptions {
  maxPatchesPerSession: number;
}

type Subscriber = (patch: TimelinePatch) => void;

export class ChatTimelineStore {
  private readonly replayBuffer: ReplayBuffer;
  private readonly timelines = new Map<string, SessionTimeline>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  constructor(options: ChatTimelineStoreOptions) {
    this.replayBuffer = new ReplayBuffer({ maxPatchesPerSession: options.maxPatchesPerSession });
  }

  getTimeline(sessionKey: string): SessionTimeline {
    const existing = this.timelines.get(sessionKey);
    if (existing) return existing;
    const timeline = createEmptyTimeline(sessionKey);
    this.timelines.set(sessionKey, timeline);
    return timeline;
  }

  applyEvent(event: RuntimeEvent): TimelinePatch {
    const previous = this.getTimeline(event.sessionKey);
    const next = reduceRuntimeEvent(previous, event);
    this.timelines.set(event.sessionKey, next);
    const patch = this.replayBuffer.append(event.sessionKey, buildPatchFromTimeline(next), event.at);
    this.publish(patch);
    return patch;
  }

  snapshot(sessionKey: string, reason: TimelineSnapshot['reason']): TimelineSnapshot {
    const timeline = this.getTimeline(sessionKey);
    return {
      type: 'snapshot',
      sessionKey,
      cursor: this.replayBuffer.latestCursor(sessionKey),
      timeline,
      reason,
    };
  }

  replayAfter(sessionKey: string, cursor?: string | null): ReplayResult {
    return this.replayBuffer.replayAfter(sessionKey, cursor);
  }

  subscribe(sessionKey: string, subscriber: Subscriber): () => void {
    const set = this.subscribers.get(sessionKey) || new Set<Subscriber>();
    set.add(subscriber);
    this.subscribers.set(sessionKey, set);
    return () => {
      set.delete(subscriber);
      if (set.size === 0) this.subscribers.delete(sessionKey);
    };
  }

  private publish(patch: TimelinePatch): void {
    for (const subscriber of this.subscribers.get(patch.sessionKey) || []) {
      subscriber(patch);
    }
  }
}
```

- [ ] **Step 5: Verify store tests pass**

Run:

```bash
npm test -- --run server/lib/chat-runtime/replay-buffer.test.ts server/lib/chat-runtime/store.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add server/lib/chat-runtime/replay-buffer.ts server/lib/chat-runtime/store.ts server/lib/chat-runtime/replay-buffer.test.ts server/lib/chat-runtime/store.test.ts
git commit -m "feat(chat-runtime): add timeline store replay buffer"
```

---

## Task 5: Runtime Composition And History Hydration

**Files:**
- Create: `server/lib/chat-runtime/runtime.ts`
- Test: extend `server/lib/chat-runtime/store.test.ts`

### Steps

- [ ] **Step 1: Add hydration tests**

Append this test to `server/lib/chat-runtime/store.test.ts`.

```ts
import { ChatRuntime } from './runtime.js';

it('hydrates history through the adapter and store', async () => {
  const runtime = new ChatRuntime({
    rpc: async (method, params) => {
      expect(method).toBe('chat.history');
      expect(params).toEqual({ sessionKey: 'agent:main:main', limit: 500 });
      return {
        messages: [
          { role: 'assistant', runId: 'run-1', timestamp: 1000, content: [{ type: 'text', text: 'persisted answer' }] },
        ],
      };
    },
    maxPatchesPerSession: 50,
  });

  await runtime.hydrateSession('agent:main:main');
  const snapshot = runtime.snapshot('agent:main:main', 'manual');
  expect(Object.values(snapshot.timeline.items).some((item) => item.kind === 'assistant_message' && item.text === 'persisted answer')).toBe(true);
});
```

- [ ] **Step 2: Implement runtime composition**

Create `server/lib/chat-runtime/runtime.ts`.

```ts
import { adaptGatewayEvent, adaptHistorySnapshot } from './adapter.js';
import { ChatTimelineStore } from './store.js';
import type { GatewayEvent } from '../../types.js';
import type { HistoryMessage, TimelinePatch, TimelineSnapshot } from './types.js';

type RpcFn = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export interface ChatRuntimeOptions {
  rpc: RpcFn;
  maxPatchesPerSession: number;
}

export class ChatRuntime {
  private readonly rpc: RpcFn;
  private readonly store: ChatTimelineStore;
  private readonly hydrating = new Set<string>();

  constructor(options: ChatRuntimeOptions) {
    this.rpc = options.rpc;
    this.store = new ChatTimelineStore({ maxPatchesPerSession: options.maxPatchesPerSession });
  }

  applyGatewayEvent(event: GatewayEvent): void {
    for (const runtimeEvent of adaptGatewayEvent(event)) {
      this.store.applyEvent(runtimeEvent);
    }
  }

  async hydrateSession(sessionKey: string, limit = 500): Promise<void> {
    if (this.hydrating.has(sessionKey)) return;
    this.hydrating.add(sessionKey);
    try {
      this.store.applyEvent({ type: 'history_snapshot', sessionKey, messages: [], at: Date.now() });
      const result = await this.rpc('chat.history', { sessionKey, limit }) as { messages?: HistoryMessage[] };
      const events = adaptHistorySnapshot(sessionKey, result.messages || []);
      for (const event of events) this.store.applyEvent(event);
    } finally {
      this.hydrating.delete(sessionKey);
    }
  }

  snapshot(sessionKey: string, reason: TimelineSnapshot['reason']): TimelineSnapshot {
    return this.store.snapshot(sessionKey, reason);
  }

  replayAfter(sessionKey: string, cursor?: string | null) {
    return this.store.replayAfter(sessionKey, cursor);
  }

  subscribe(sessionKey: string, subscriber: (patch: TimelinePatch) => void): () => void {
    return this.store.subscribe(sessionKey, subscriber);
  }

  applyOptimisticUserMessage(params: {
    sessionKey: string;
    runId?: string;
    text: string;
    idempotencyKey: string;
    at?: number;
  }): TimelinePatch {
    return this.store.applyEvent({
      type: 'user_message_committed',
      sessionKey: params.sessionKey,
      runId: params.runId,
      text: params.text,
      idempotencyKey: params.idempotencyKey,
      at: params.at || Date.now(),
    });
  }
}
```

- [ ] **Step 3: Verify runtime tests pass**

Run:

```bash
npm test -- --run server/lib/chat-runtime/store.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add server/lib/chat-runtime/runtime.ts server/lib/chat-runtime/store.test.ts
git commit -m "feat(chat-runtime): hydrate timelines from history"
```

---

## Task 6: Runtime API Routes

**Files:**
- Create: `server/routes/chat-runtime.ts`
- Create: `server/routes/chat-runtime.test.ts`
- Modify: `server/app.ts`

### Steps

- [ ] **Step 1: Write route tests**

Create `server/routes/chat-runtime.test.ts`.

```ts
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const runtimeMock = vi.hoisted(() => ({
  hydrateSession: vi.fn(async () => {}),
  snapshot: vi.fn(() => ({
    type: 'snapshot',
    sessionKey: 'agent:main:main',
    cursor: '0',
    reason: 'initial',
    timeline: { sessionKey: 'agent:main:main', version: 0, cursor: '0', hydrationState: 'ready', turns: [], items: {}, updatedAt: 1000 },
  })),
  replayAfter: vi.fn(() => ({ kind: 'snapshot_required' })),
  subscribe: vi.fn(() => () => {}),
  applyOptimisticUserMessage: vi.fn(() => ({ sessionKey: 'agent:main:main', cursor: '1', ops: [], createdAt: 1000 })),
}));

vi.mock('../lib/chat-runtime/singleton.js', () => ({
  getChatRuntime: () => runtimeMock,
}));

vi.mock('../lib/gateway-rpc.js', () => ({
  gatewayRpcCall: vi.fn(async () => ({ runId: 'run-1', status: 'started' })),
}));

import chatRuntimeRoutes from './chat-runtime.js';

function buildApp() {
  const app = new Hono();
  app.route('/', chatRuntimeRoutes);
  return app;
}

describe('chat runtime routes', () => {
  it('rejects stream requests without sessionKey', async () => {
    const res = await buildApp().request('/api/chat-runtime/stream');
    expect(res.status).toBe(400);
  });

  it('sends messages through runtime endpoint', async () => {
    const res = await buildApp().request('/api/chat-runtime/sessions/agent%3Amain%3Amain/messages', {
      method: 'POST',
      body: JSON.stringify({ text: 'hello', idempotencyKey: 'ik-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sessionKey: 'agent:main:main', runId: 'run-1', cursor: '1' });
  });
});
```

- [ ] **Step 2: Add singleton module**

Create `server/lib/chat-runtime/singleton.ts`.

```ts
import { gatewayRpcCall } from '../gateway-rpc.js';
import { ChatRuntime } from './runtime.js';

let runtime: ChatRuntime | null = null;

export function getChatRuntime(): ChatRuntime {
  if (!runtime) {
    runtime = new ChatRuntime({
      rpc: gatewayRpcCall,
      maxPatchesPerSession: Number(process.env.NERVE_CHAT_RUNTIME_PATCH_LIMIT || 2000),
    });
  }
  return runtime;
}

export function resetChatRuntimeForTests(): void {
  runtime = null;
}
```

- [ ] **Step 3: Implement route**

Create `server/routes/chat-runtime.ts`.

```ts
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { getChatRuntime } from '../lib/chat-runtime/singleton.js';
import { gatewayRpcCall } from '../lib/gateway-rpc.js';

const app = new Hono();

const sendSchema = z.object({
  text: z.string().min(1),
  idempotencyKey: z.string().min(1),
});

function writeJsonSse(stream: Parameters<Parameters<typeof streamSSE>[1]>[0], event: string, data: unknown) {
  return stream.writeSSE({ event, data: JSON.stringify(data) });
}

app.get('/api/chat-runtime/stream', async (c) => {
  const sessionKey = c.req.query('sessionKey');
  const cursor = c.req.query('cursor') || null;
  if (!sessionKey) return c.json({ error: 'sessionKey is required' }, 400);

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');
  c.header('X-Accel-Buffering', 'no');

  const runtime = getChatRuntime();
  await runtime.hydrateSession(sessionKey);

  return streamSSE(c, async (stream) => {
    let connected = true;
    let resolveDisconnect: (() => void) | undefined;

    await writeJsonSse(stream, 'connected', { type: 'connected', sessionKey, ts: Date.now() });

    const replay = runtime.replayAfter(sessionKey, cursor);
    if (replay.kind === 'patches') {
      for (const patch of replay.patches) await writeJsonSse(stream, 'patch', { type: 'patch', ...patch });
    } else {
      await writeJsonSse(stream, 'snapshot', runtime.snapshot(sessionKey, cursor ? 'cursor_expired' : 'initial'));
    }

    const unsubscribe = runtime.subscribe(sessionKey, (patch) => {
      if (!connected) return;
      void writeJsonSse(stream, 'patch', { type: 'patch', ...patch }).catch(() => disconnect());
    });

    const pingTimer = setInterval(() => {
      if (!connected) return;
      void writeJsonSse(stream, 'ping', { type: 'ping', ts: Date.now() }).catch(() => disconnect());
    }, 30_000);

    function disconnect() {
      if (!connected) return;
      connected = false;
      clearInterval(pingTimer);
      unsubscribe();
      resolveDisconnect?.();
    }

    stream.onAbort(disconnect);
    await new Promise<void>((resolve) => {
      resolveDisconnect = resolve;
      if (!connected) resolve();
    });
  });
});

app.post('/api/chat-runtime/sessions/:sessionKey/messages', async (c) => {
  const sessionKey = decodeURIComponent(c.req.param('sessionKey'));
  const parsed = sendSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid message request', details: parsed.error.flatten() }, 422);

  const runtime = getChatRuntime();
  const optimisticPatch = runtime.applyOptimisticUserMessage({
    sessionKey,
    text: parsed.data.text,
    idempotencyKey: parsed.data.idempotencyKey,
  });
  const ack = await gatewayRpcCall('chat.send', {
    sessionKey,
    message: parsed.data.text,
    deliver: false,
    idempotencyKey: parsed.data.idempotencyKey,
  }) as { runId?: string };

  return c.json({ ok: true, sessionKey, runId: ack.runId, cursor: optimisticPatch.cursor });
});

export default app;
```

- [ ] **Step 4: Mount route and disable compression for stream**

Modify `server/app.ts`:

```ts
import chatRuntimeRoutes from './routes/chat-runtime.js';
```

Update the compression guard:

```ts
if (
  c.req.path === '/api/events' ||
  c.req.path === '/api/chat-runtime/stream' ||
  c.req.path === '/api/files/raw'
) return next();
```

Add `chatRuntimeRoutes` to the `routes` array.

- [ ] **Step 5: Verify route tests pass**

Run:

```bash
npm test -- --run server/routes/chat-runtime.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add server/routes/chat-runtime.ts server/routes/chat-runtime.test.ts server/lib/chat-runtime/singleton.ts server/app.ts
git commit -m "feat(chat-runtime): expose timeline stream api"
```

---

## Task 7: Gateway Supervisor Lifecycle

**Files:**
- Create: `server/lib/chat-runtime/gateway-supervisor.ts`
- Modify: `server/lib/chat-runtime/singleton.ts`
- Modify: `server/index.ts`
- Test: `server/lib/chat-runtime/gateway-supervisor.test.ts`

### Steps

- [ ] **Step 1: Write supervisor unit test with injected socket**

Create `server/lib/chat-runtime/gateway-supervisor.test.ts`.

```ts
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ChatGatewaySupervisor } from './gateway-supervisor.js';

class FakeSocket extends EventEmitter {
  sent: string[] = [];
  readyState = 1;
  send(data: string) { this.sent.push(data); }
  close() { this.emit('close'); }
}

describe('ChatGatewaySupervisor', () => {
  it('forwards gateway events into runtime', () => {
    const socket = new FakeSocket();
    const runtime = { applyGatewayEvent: vi.fn() };
    const supervisor = new ChatGatewaySupervisor({
      runtime,
      createSocket: () => socket,
      reconnectDelayMs: 10,
    });

    supervisor.start();
    socket.emit('message', JSON.stringify({ type: 'event', event: 'chat', payload: { state: 'started', sessionKey: 'agent:main:main', runId: 'run-1' } }));

    expect(runtime.applyGatewayEvent).toHaveBeenCalledWith({
      type: 'event',
      event: 'chat',
      payload: { state: 'started', sessionKey: 'agent:main:main', runId: 'run-1' },
    });
    supervisor.stop();
  });
});
```

- [ ] **Step 2: Implement supervisor with dependency injection**

Create `server/lib/chat-runtime/gateway-supervisor.ts`.

```ts
import { WebSocket } from 'ws';
import { config } from '../config.js';
import type { GatewayEvent } from '../../types.js';
import type { ChatRuntime } from './runtime.js';

interface MinimalSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: 'open' | 'message' | 'close' | 'error', handler: (...args: unknown[]) => void): void;
}

export interface ChatGatewaySupervisorOptions {
  runtime: Pick<ChatRuntime, 'applyGatewayEvent'>;
  createSocket?: () => MinimalSocket;
  reconnectDelayMs?: number;
}

function gatewayWsUrl(): string {
  const base = config.gatewayUrl.startsWith('ws')
    ? config.gatewayUrl
    : config.gatewayUrl.replace(/^http/, 'ws');
  return base.endsWith('/ws') ? base : `${base.replace(/\\/$/, '')}/ws`;
}

export class ChatGatewaySupervisor {
  private readonly runtime: Pick<ChatRuntime, 'applyGatewayEvent'>;
  private readonly createSocket: () => MinimalSocket;
  private readonly reconnectDelayMs: number;
  private socket: MinimalSocket | null = null;
  private stopped = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ChatGatewaySupervisorOptions) {
    this.runtime = options.runtime;
    this.createSocket = options.createSocket || (() => new WebSocket(gatewayWsUrl(), { headers: { Origin: `http://127.0.0.1:${config.port}` } }));
    this.reconnectDelayMs = options.reconnectDelayMs || 3000;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  private open(): void {
    if (this.stopped) return;
    const socket = this.createSocket();
    this.socket = socket;

    socket.on('message', (data: unknown) => {
      try {
        const parsed = JSON.parse(String(data));
        if (parsed?.type === 'event') this.runtime.applyGatewayEvent(parsed as GatewayEvent);
      } catch {
        // Ignore malformed gateway frames.
      }
    });

    socket.on('close', () => this.scheduleReconnect());
    socket.on('error', () => this.scheduleReconnect());
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, this.reconnectDelayMs);
  }
}
```

- [ ] **Step 3: Wire singleton start and stop**

Modify `server/lib/chat-runtime/singleton.ts` to export supervisor lifecycle.

```ts
import { ChatGatewaySupervisor } from './gateway-supervisor.js';

let supervisor: ChatGatewaySupervisor | null = null;

export function startChatRuntimeSupervisor(): void {
  const runtime = getChatRuntime();
  if (!supervisor) supervisor = new ChatGatewaySupervisor({ runtime });
  supervisor.start();
}

export function stopChatRuntimeSupervisor(): void {
  supervisor?.stop();
  supervisor = null;
}
```

- [ ] **Step 4: Start and stop in server entry**

Modify `server/index.ts`:

```ts
import { startChatRuntimeSupervisor, stopChatRuntimeSupervisor } from './lib/chat-runtime/singleton.js';
```

After `startFileWatcher();` add:

```ts
startChatRuntimeSupervisor();
```

Inside `shutdown()` after `stopFileWatcher();` add:

```ts
stopChatRuntimeSupervisor();
```

- [ ] **Step 5: Verify supervisor tests pass**

Run:

```bash
npm test -- --run server/lib/chat-runtime/gateway-supervisor.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add server/lib/chat-runtime/gateway-supervisor.ts server/lib/chat-runtime/gateway-supervisor.test.ts server/lib/chat-runtime/singleton.ts server/index.ts
git commit -m "feat(chat-runtime): supervise gateway event stream"
```

---

## Task 8: Browser Timeline Client

**Files:**
- Create: `src/features/chat-runtime/types.ts`
- Create: `src/features/chat-runtime/timelineClient.ts`
- Create: `src/features/chat-runtime/timelineClient.test.ts`
- Create: `src/features/chat-runtime/index.ts`

### Steps

- [ ] **Step 1: Write client reducer tests**

Create `src/features/chat-runtime/timelineClient.test.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { applyTimelinePatch, emptyRuntimeState } from './timelineClient';

describe('timeline client patch application', () => {
  it('upserts items by id and does not duplicate final assistant updates', () => {
    let state = emptyRuntimeState('agent:main:main');
    state = applyTimelinePatch(state, {
      type: 'patch',
      sessionKey: 'agent:main:main',
      cursor: '1',
      ops: [
        {
          op: 'upsert_item',
          item: {
            id: 'assistant:agent:main:main:run-1:answer',
            kind: 'assistant_message',
            sessionKey: 'agent:main:main',
            runId: 'run-1',
            text: 'partial',
            isStreaming: true,
            orderKey: { turn: 0, block: 100, sub: 0 },
            createdAt: 1,
            updatedAt: 1,
            status: 'running',
            source: 'live',
          },
        },
      ],
    });
    state = applyTimelinePatch(state, {
      type: 'patch',
      sessionKey: 'agent:main:main',
      cursor: '2',
      ops: [
        {
          op: 'upsert_item',
          item: {
            id: 'assistant:agent:main:main:run-1:answer',
            kind: 'assistant_message',
            sessionKey: 'agent:main:main',
            runId: 'run-1',
            text: 'final',
            isStreaming: false,
            orderKey: { turn: 0, block: 100, sub: 0 },
            createdAt: 1,
            updatedAt: 2,
            status: 'complete',
            source: 'history',
          },
        },
      ],
    });

    expect(state.items).toHaveLength(1);
    expect(state.items[0].text).toBe('final');
  });
});
```

- [ ] **Step 2: Add browser runtime types**

Create `src/features/chat-runtime/types.ts`. Keep it aligned with the public server shape, but do not import from server files.

```ts
export interface TimelineOrderKey {
  turn: number;
  block: number;
  sub: number;
}

export type TimelineItemView =
  | {
      id: string;
      kind: 'user_message';
      sessionKey: string;
      text: string;
      orderKey: TimelineOrderKey;
      createdAt: number;
      updatedAt: number;
      status: 'provisional' | 'running' | 'complete' | 'failed' | 'aborted';
      source: 'history' | 'live' | 'optimistic' | 'system';
    }
  | {
      id: string;
      kind: 'assistant_message';
      sessionKey: string;
      text: string;
      isStreaming: boolean;
      orderKey: TimelineOrderKey;
      createdAt: number;
      updatedAt: number;
      status: 'provisional' | 'running' | 'complete' | 'failed' | 'aborted';
      source: 'history' | 'live' | 'optimistic' | 'system';
    }
  | {
      id: string;
      kind: 'thinking';
      sessionKey: string;
      text: string;
      durationMs?: number;
      orderKey: TimelineOrderKey;
      createdAt: number;
      updatedAt: number;
      status: 'provisional' | 'running' | 'complete' | 'failed' | 'aborted';
      source: 'history' | 'live' | 'optimistic' | 'system';
    }
  | {
      id: string;
      kind: 'tool_group';
      sessionKey: string;
      childItemIds: string[];
      closed: boolean;
      orderKey: TimelineOrderKey;
      createdAt: number;
      updatedAt: number;
      status: 'provisional' | 'running' | 'complete' | 'failed' | 'aborted';
      source: 'history' | 'live' | 'optimistic' | 'system';
    }
  | {
      id: string;
      kind: 'tool_call';
      sessionKey: string;
      toolCallId: string;
      name: string;
      args: unknown;
      result?: unknown;
      error?: string;
      orderKey: TimelineOrderKey;
      createdAt: number;
      updatedAt: number;
      status: 'provisional' | 'running' | 'complete' | 'failed' | 'aborted';
      source: 'history' | 'live' | 'optimistic' | 'system';
    };

export interface TimelineTurnView {
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

export interface TimelineStateView {
  sessionKey: string;
  cursor: string | null;
  hydrationState: 'cold' | 'hydrating' | 'ready' | 'stale';
  turns: TimelineTurnView[];
  items: TimelineItemView[];
}

export type TimelinePatchOp =
  | { op: 'upsert_turn'; turn: TimelineTurnView }
  | { op: 'upsert_item'; item: TimelineItemView }
  | { op: 'remove_item'; id: string; reason: 'compaction' | 'user_reset' }
  | { op: 'set_hydration_state'; state: TimelineStateView['hydrationState'] };

export interface TimelinePatchMessage {
  type: 'patch';
  sessionKey: string;
  cursor: string;
  ops: TimelinePatchOp[];
}

export interface TimelineSnapshotMessage {
  type: 'snapshot';
  sessionKey: string;
  cursor: string;
  timeline: {
    sessionKey: string;
    hydrationState: TimelineStateView['hydrationState'];
    turns: TimelineTurnView[];
    items: Record<string, TimelineItemView>;
  };
}
```

- [ ] **Step 3: Add patch application helper**

Create `src/features/chat-runtime/timelineClient.ts`.

```ts
import type { TimelineItemView, TimelinePatchMessage, TimelineSnapshotMessage, TimelineStateView, TimelineTurnView } from './types';

function compareOrder(a: TimelineItemView, b: TimelineItemView): number {
  return a.orderKey.turn - b.orderKey.turn || a.orderKey.block - b.orderKey.block || a.orderKey.sub - b.orderKey.sub;
}

export function emptyRuntimeState(sessionKey: string): TimelineStateView {
  return {
    sessionKey,
    cursor: null,
    hydrationState: 'cold',
    turns: [],
    items: [],
  };
}

export function applyTimelineSnapshot(_state: TimelineStateView, snapshot: TimelineSnapshotMessage): TimelineStateView {
  return {
    sessionKey: snapshot.sessionKey,
    cursor: snapshot.cursor,
    hydrationState: snapshot.timeline.hydrationState,
    turns: snapshot.timeline.turns,
    items: Object.values(snapshot.timeline.items).sort(compareOrder),
  };
}

function upsertTurn(turns: TimelineTurnView[], turn: TimelineTurnView): TimelineTurnView[] {
  const next = turns.filter((existing) => existing.id !== turn.id);
  next.push(turn);
  return next.sort((a, b) => a.orderBase.turn - b.orderBase.turn || a.orderBase.block - b.orderBase.block || a.orderBase.sub - b.orderBase.sub);
}

function upsertItem(items: TimelineItemView[], item: TimelineItemView): TimelineItemView[] {
  const next = items.filter((existing) => existing.id !== item.id);
  next.push(item);
  return next.sort(compareOrder);
}

export function applyTimelinePatch(state: TimelineStateView, patch: TimelinePatchMessage): TimelineStateView {
  if (patch.sessionKey !== state.sessionKey) return state;
  let turns = state.turns;
  let items = state.items;
  let hydrationState = state.hydrationState;

  for (const op of patch.ops) {
    if (op.op === 'upsert_turn') turns = upsertTurn(turns, op.turn);
    if (op.op === 'upsert_item') items = upsertItem(items, op.item);
    if (op.op === 'remove_item') items = items.filter((item) => item.id !== op.id);
    if (op.op === 'set_hydration_state') hydrationState = op.state;
  }

  return { ...state, cursor: patch.cursor, turns, items, hydrationState };
}

export function createRuntimeEventSource(sessionKey: string, cursor: string | null): EventSource {
  const params = new URLSearchParams({ sessionKey });
  if (cursor) params.set('cursor', cursor);
  return new EventSource(`/api/chat-runtime/stream?${params.toString()}`);
}
```

- [ ] **Step 4: Add barrel export**

Create `src/features/chat-runtime/index.ts`.

```ts
export * from './types';
export * from './timelineClient';
```

- [ ] **Step 5: Verify client tests pass**

Run:

```bash
npm test -- --run src/features/chat-runtime/timelineClient.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/chat-runtime/types.ts src/features/chat-runtime/timelineClient.ts src/features/chat-runtime/timelineClient.test.ts src/features/chat-runtime/index.ts
git commit -m "feat(chat-runtime): add browser timeline client"
```

---

## Task 9: Browser Runtime Hook And Renderer

**Files:**
- Create: `src/features/chat-runtime/timelineStore.ts`
- Create: `src/features/chat-runtime/ChatTimeline.tsx`
- Create: `src/features/chat-runtime/TimelineAssistantBlock.tsx`
- Create: `src/features/chat-runtime/TimelineThinkingBlock.tsx`
- Create: `src/features/chat-runtime/TimelineToolBlock.tsx`
- Test: `src/features/chat-runtime/ChatTimeline.test.tsx`

### Steps

- [ ] **Step 1: Write renderer test**

Create `src/features/chat-runtime/ChatTimeline.test.tsx`.

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatTimeline } from './ChatTimeline';
import type { TimelineStateView } from './types';

describe('ChatTimeline', () => {
  it('renders thinking, tool, and assistant items in order without duplicates', () => {
    const state: TimelineStateView = {
      sessionKey: 'agent:main:main',
      cursor: '3',
      hydrationState: 'ready',
      turns: [],
      items: [
        {
          id: 'thinking:agent:main:main:run-1:0',
          kind: 'thinking',
          sessionKey: 'agent:main:main',
          text: 'I should inspect files',
          orderKey: { turn: 0, block: 10, sub: 0 },
          createdAt: 1,
          updatedAt: 1,
          status: 'complete',
          source: 'history',
        },
        {
          id: 'tool:agent:main:main:run-1:tool-1',
          kind: 'tool_call',
          sessionKey: 'agent:main:main',
          toolCallId: 'tool-1',
          name: 'exec',
          args: { cmd: 'pwd' },
          result: '/tmp/project',
          orderKey: { turn: 0, block: 20, sub: 0 },
          createdAt: 2,
          updatedAt: 3,
          status: 'complete',
          source: 'history',
        },
        {
          id: 'assistant:agent:main:main:run-1:answer',
          kind: 'assistant_message',
          sessionKey: 'agent:main:main',
          text: 'Done',
          isStreaming: false,
          orderKey: { turn: 0, block: 100, sub: 0 },
          createdAt: 4,
          updatedAt: 4,
          status: 'complete',
          source: 'history',
        },
      ],
    };

    render(<ChatTimeline state={state} agentName="Agent" />);
    expect(screen.getByText('Thinking')).toBeInTheDocument();
    expect(screen.getByText('exec')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Add runtime hook**

Create `src/features/chat-runtime/timelineStore.ts`.

```ts
import { useEffect, useRef, useState } from 'react';
import {
  applyTimelinePatch,
  applyTimelineSnapshot,
  createRuntimeEventSource,
  emptyRuntimeState,
} from './timelineClient';
import type { TimelinePatchMessage, TimelineSnapshotMessage, TimelineStateView } from './types';

export function useChatRuntimeTimeline(sessionKey: string | null): TimelineStateView {
  const [state, setState] = useState<TimelineStateView>(() => emptyRuntimeState(sessionKey || ''));
  const cursorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionKey) return;
    setState(emptyRuntimeState(sessionKey));
    cursorRef.current = null;

    const eventSource = createRuntimeEventSource(sessionKey, cursorRef.current);

    eventSource.addEventListener('snapshot', (event) => {
      const snapshot = JSON.parse((event as MessageEvent).data) as TimelineSnapshotMessage;
      cursorRef.current = snapshot.cursor;
      setState((previous) => applyTimelineSnapshot(previous, snapshot));
    });

    eventSource.addEventListener('patch', (event) => {
      const patch = JSON.parse((event as MessageEvent).data) as TimelinePatchMessage;
      cursorRef.current = patch.cursor;
      setState((previous) => applyTimelinePatch(previous, patch));
    });

    eventSource.onerror = () => {
      setState((previous) => ({ ...previous, hydrationState: 'stale' }));
    };

    return () => eventSource.close();
  }, [sessionKey]);

  return state;
}
```

- [ ] **Step 3: Add simple renderers**

Create `src/features/chat-runtime/TimelineAssistantBlock.tsx`.

```tsx
import { MarkdownRenderer } from '@/features/markdown/MarkdownRenderer';
import type { TimelineItemView } from './types';

export function TimelineAssistantBlock({ item, agentName }: { item: Extract<TimelineItemView, { kind: 'assistant_message' }>; agentName: string }) {
  return (
    <div className="msg msg-assistant relative max-w-full break-words bg-message-assistant" data-testid={item.id}>
      <div className="flex items-center gap-2 px-4 py-2">
        <span className="cockpit-badge" data-tone="success">{agentName}</span>
        {item.isStreaming && <span className="text-[0.667rem] text-muted-foreground">Streaming</span>}
      </div>
      <div className="ml-4 border-l-2 border-green/60 px-4 pb-3 pl-6">
        <div className="msg-body text-foreground text-[0.867rem]">
          <MarkdownRenderer content={item.text} />
        </div>
      </div>
    </div>
  );
}
```

Create `src/features/chat-runtime/TimelineThinkingBlock.tsx`.

```tsx
import { MarkdownRenderer } from '@/features/markdown/MarkdownRenderer';
import type { TimelineItemView } from './types';

export function TimelineThinkingBlock({ item }: { item: Extract<TimelineItemView, { kind: 'thinking' }> }) {
  return (
    <div className="group msg msg-assistant relative mx-4 my-0.5 max-w-full break-words" data-testid={item.id}>
      <div className="rounded-2xl border border-primary/10 bg-primary/[0.03] px-3 py-2">
        <div className="flex items-center gap-2 text-[0.733rem] font-medium text-primary/78">
          <span>Thinking</span>
          {item.durationMs ? <span className="text-primary/52">{(item.durationMs / 1000).toFixed(1)}s</span> : null}
        </div>
        <div className="pt-1 text-[0.8rem] text-foreground/70">
          <MarkdownRenderer content={item.text} />
        </div>
      </div>
    </div>
  );
}
```

Create `src/features/chat-runtime/TimelineToolBlock.tsx`.

```tsx
import type { TimelineItemView } from './types';

export function TimelineToolBlock({ item }: { item: Extract<TimelineItemView, { kind: 'tool_call' }> }) {
  return (
    <div className="msg msg-tool relative mx-4 my-1.5 max-w-full break-words" data-testid={item.id}>
      <div className="rounded-2xl border border-border/50 bg-card/62 px-3.5 py-3">
        <div className="flex items-center gap-2">
          <span className="cockpit-badge shrink-0">Tool</span>
          <span className="text-[0.8rem] text-foreground/78">{item.name}</span>
          <span className="ml-auto text-[0.667rem] text-muted-foreground">{item.status}</span>
        </div>
        <pre className="mt-2 max-h-[220px] overflow-y-auto whitespace-pre-wrap text-[0.733rem] text-muted-foreground">
          {JSON.stringify({ args: item.args, result: item.result, error: item.error }, null, 2)}
        </pre>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add timeline renderer**

Create `src/features/chat-runtime/ChatTimeline.tsx`.

```tsx
import type { TimelineStateView } from './types';
import { TimelineAssistantBlock } from './TimelineAssistantBlock';
import { TimelineThinkingBlock } from './TimelineThinkingBlock';
import { TimelineToolBlock } from './TimelineToolBlock';
import { MarkdownRenderer } from '@/features/markdown/MarkdownRenderer';

export function ChatTimeline({ state, agentName = 'Agent' }: { state: TimelineStateView; agentName?: string }) {
  return (
    <div role="log" aria-label="Chat messages" className="flex-1 overflow-y-auto overflow-x-hidden py-3 flex flex-col gap-1">
      {state.hydrationState !== 'ready' && (
        <div className="px-4 py-2 text-[0.733rem] text-muted-foreground">{state.hydrationState}</div>
      )}
      {state.items.map((item) => {
        if (item.kind === 'assistant_message') return <TimelineAssistantBlock key={item.id} item={item} agentName={agentName} />;
        if (item.kind === 'thinking') return <TimelineThinkingBlock key={item.id} item={item} />;
        if (item.kind === 'tool_call') return <TimelineToolBlock key={item.id} item={item} />;
        if (item.kind === 'user_message') {
          return (
            <div key={item.id} className="msg msg-user ml-auto w-fit max-w-full bg-message-user px-4 py-2" data-testid={item.id}>
              <MarkdownRenderer content={item.text} />
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
```

- [ ] **Step 5: Verify renderer tests pass**

Run:

```bash
npm test -- --run src/features/chat-runtime/ChatTimeline.test.tsx
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/chat-runtime/timelineStore.ts src/features/chat-runtime/ChatTimeline.tsx src/features/chat-runtime/TimelineAssistantBlock.tsx src/features/chat-runtime/TimelineThinkingBlock.tsx src/features/chat-runtime/TimelineToolBlock.tsx src/features/chat-runtime/ChatTimeline.test.tsx
git commit -m "feat(chat-runtime): render server timeline"
```

---

## Task 10: Feature Flagged App Integration

**Files:**
- Modify: `server/lib/config.ts`
- Modify: `src/App.tsx`
- Modify: `src/features/chat-runtime/index.ts`
- Test: existing app/chat tests if they cover App

### Steps

- [ ] **Step 1: Add config flag**

Modify `server/lib/config.ts` to expose an environment flag named `NERVE_CHAT_RUNTIME`.

Add a boolean field to the exported config object:

```ts
chatRuntimeEnabled: process.env.NERVE_CHAT_RUNTIME === '1',
```

If `config.ts` has a typed config interface, add:

```ts
chatRuntimeEnabled: boolean;
```

- [ ] **Step 2: Add frontend flag helper**

Create `src/features/chat-runtime/runtimeFlag.ts`.

```ts
export function isChatRuntimeEnabled(): boolean {
  try {
    return localStorage.getItem('nerve:chat-runtime') === '1';
  } catch {
    return false;
  }
}
```

Export it from `src/features/chat-runtime/index.ts`.

```ts
export * from './runtimeFlag';
```

- [ ] **Step 3: Integrate into App behind local flag**

Modify `src/App.tsx` imports:

```ts
import { ChatTimeline, isChatRuntimeEnabled, useChatRuntimeTimeline } from '@/features/chat-runtime';
```

Inside `App`, derive runtime state:

```tsx
const chatRuntimeEnabled = isChatRuntimeEnabled();
const runtimeTimeline = useChatRuntimeTimeline(chatRuntimeEnabled ? currentSession : null);
```

Where `ChatPanel` is rendered, keep the old path when the flag is off. When the flag is on, render a panel shell for the runtime timeline. The first integration should avoid deleting the old chat path.

Use this explicit switch:

```tsx
{chatRuntimeEnabled ? (
  <div className="h-full flex flex-col border-r border-border min-w-0 relative">
    <ChatTimeline state={runtimeTimeline} agentName={agentName} />
  </div>
) : (
  <ChatPanel
    ref={chatPanelRef}
    messages={messages}
    onSend={handleSend}
    onAbort={handleAbort}
    isGenerating={isGenerating}
    stream={stream}
    processingStage={processingStage}
    lastEventTimestamp={lastEventTimestamp}
    currentToolDescription={currentToolDescription}
    activityLog={activityLog}
    agentName={agentName}
    loadMore={loadMore}
    hasMore={hasMore}
    onReset={handleReset}
  />
)}
```

Before editing this branch, copy the existing `ChatPanel` JSX call unchanged into the `false` branch. The old branch must keep every current prop so the legacy path remains available for rollback.

- [ ] **Step 4: Verify build catches integration errors**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add server/lib/config.ts src/App.tsx src/features/chat-runtime/runtimeFlag.ts src/features/chat-runtime/index.ts
git commit -m "feat(chat-runtime): gate timeline renderer"
```

---

## Task 11: Runtime Send Path In Browser

**Files:**
- Create: `src/features/chat-runtime/sendRuntimeMessage.ts`
- Modify: runtime integration from Task 10
- Test: `src/features/chat-runtime/timelineClient.test.ts`

### Steps

- [ ] **Step 1: Add send helper**

Create `src/features/chat-runtime/sendRuntimeMessage.ts`.

```ts
export interface SendRuntimeMessageResult {
  ok: true;
  sessionKey: string;
  runId?: string;
  cursor: string;
}

export async function sendRuntimeMessage(sessionKey: string, text: string): Promise<SendRuntimeMessageResult> {
  const idempotencyKey = crypto.randomUUID ? crypto.randomUUID() : `ik-${Date.now()}`;
  const res = await fetch(`/api/chat-runtime/sessions/${encodeURIComponent(sessionKey)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, idempotencyKey }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Runtime send failed: ${res.status} ${body}`);
  }
  return await res.json() as SendRuntimeMessageResult;
}
```

- [ ] **Step 2: Export send helper**

Modify `src/features/chat-runtime/index.ts`:

```ts
export * from './sendRuntimeMessage';
```

- [ ] **Step 3: Wire runtime branch to existing input flow**

If the runtime branch from Task 10 does not include `InputBar`, create a small `ChatRuntimePanel` component that renders `ChatTimeline` plus `InputBar`.

Create `src/features/chat-runtime/ChatRuntimePanel.tsx`.

```tsx
import { useCallback } from 'react';
import { InputBar } from '@/features/chat/InputBar';
import { ChatTimeline } from './ChatTimeline';
import { sendRuntimeMessage } from './sendRuntimeMessage';
import type { TimelineStateView } from './types';

export function ChatRuntimePanel({
  state,
  sessionKey,
  agentName,
}: {
  state: TimelineStateView;
  sessionKey: string;
  agentName: string;
}) {
  const handleSend = useCallback(async (text: string) => {
    await sendRuntimeMessage(sessionKey, text);
  }, [sessionKey]);

  const isGenerating = state.turns.some((turn) => turn.status === 'running');

  return (
    <div className="h-full flex flex-col border-r border-border min-w-0 relative">
      <ChatTimeline state={state} agentName={agentName} />
      <InputBar onSend={handleSend} isGenerating={isGenerating} agentName={agentName} />
    </div>
  );
}
```

Export it and use it in `src/App.tsx` for the flagged branch.

- [ ] **Step 4: Verify runtime branch builds**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat-runtime/sendRuntimeMessage.ts src/features/chat-runtime/ChatRuntimePanel.tsx src/features/chat-runtime/index.ts src/App.tsx
git commit -m "feat(chat-runtime): send messages through runtime api"
```

---

## Task 12: Documentation And Diagnostics

**Files:**
- Modify: `docs/API.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `server/routes/chat-runtime.ts`

### Steps

- [ ] **Step 1: Add development diagnostic endpoint**

In `server/routes/chat-runtime.ts`, add a development-only route:

```ts
if (process.env.NODE_ENV === 'development') {
  app.get('/api/chat-runtime/sessions/:sessionKey/debug', async (c) => {
    const sessionKey = decodeURIComponent(c.req.param('sessionKey'));
    const runtime = getChatRuntime();
    return c.json(runtime.snapshot(sessionKey, 'manual'));
  });
}
```

- [ ] **Step 2: Document API**

Add to `docs/API.md`:

```md
## Chat Runtime

### `GET /api/chat-runtime/stream?sessionKey=<key>&cursor=<cursor>`

Server-Sent Events stream for the server-owned chat timeline. The server emits:

- `connected`
- `snapshot`
- `patch`
- `ping`

When `cursor` is retained, the stream replays missed patches. When `cursor` is absent or expired, the stream sends a full snapshot.

### `POST /api/chat-runtime/sessions/:sessionKey/messages`

Sends a user message through the runtime path. The request body is:

```json
{
  "text": "Hello",
  "idempotencyKey": "client-generated-key"
}
```

The response is:

```json
{
  "ok": true,
  "sessionKey": "agent:main:main",
  "runId": "run-id-from-openclaw",
  "cursor": "runtime-cursor"
}
```
```

- [ ] **Step 3: Document architecture**

Add a short section to `docs/ARCHITECTURE.md`:

```md
### Chat Runtime

The chat runtime is a server-owned replay layer between OpenClaw Gateway and the browser. It keeps a long-lived gateway subscription, normalizes `chat` and `agent` events into runtime events, reduces them into a per-session timeline, and serves browser subscribers snapshots plus cursor-based patches. The browser renders `TimelineItem[]` and does not merge raw gateway events with `chat.history`.
```

- [ ] **Step 4: Run docs and build checks**

Run:

```bash
git diff --check
npm run build
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add docs/API.md docs/ARCHITECTURE.md server/routes/chat-runtime.ts
git commit -m "docs(chat-runtime): document server replay api"
```

---

## Task 13: Full Verification And Browser Smoke

**Files:**
- No source files required unless verification finds a bug.

### Steps

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- --run \
  server/lib/chat-runtime/id.test.ts \
  server/lib/chat-runtime/reducer.test.ts \
  server/lib/chat-runtime/adapter.test.ts \
  server/lib/chat-runtime/replay-buffer.test.ts \
  server/lib/chat-runtime/store.test.ts \
  server/lib/chat-runtime/gateway-supervisor.test.ts \
  server/routes/chat-runtime.test.ts \
  src/features/chat-runtime/timelineClient.test.ts \
  src/features/chat-runtime/ChatTimeline.test.tsx
```

Expected: pass.

- [ ] **Step 2: Run general checks**

Run:

```bash
npm run lint
git diff --check
npm run build
```

Expected: pass.

- [ ] **Step 3: Deploy to existing service**

Use the existing `localhost:3080` service. Do not start a separate service.

Run:

```bash
launchctl kickstart -k gui/501/com.nerve.server
sleep 2
curl -fsS http://127.0.0.1:3080/health
```

Expected: health returns JSON with `"status":"ok"`.

- [ ] **Step 4: Enable runtime branch for browser smoke**

In the browser console on `http://localhost:3080`, run:

```js
localStorage.setItem('nerve:chat-runtime', '1');
location.reload();
```

- [ ] **Step 5: Smoke refresh mid-turn**

Manual flow:

1. Send a prompt that causes a tool call and a non-empty final reply.
2. Refresh while generation is still running.
3. Confirm the active turn reappears from the server snapshot.
4. Confirm tool call item IDs do not duplicate after the final response.
5. Confirm the final assistant response appears once.

Record the prompt text and observed result in the PR description.

- [ ] **Step 6: Smoke session switch mid-turn**

Manual flow:

1. Send a prompt.
2. Switch to another agent session while the turn is running.
3. Switch back.
4. Confirm the last user prompt appears once.
5. Confirm active tools and assistant stream continue from the server timeline.
6. Confirm the final response appears once.

- [ ] **Step 7: Smoke cache clear behavior**

Manual flow:

1. Let a turn finish.
2. Clear browser site data.
3. Reload `http://localhost:3080`.
4. Enable `localStorage.setItem('nerve:chat-runtime', '1')` again.
5. Confirm finalized OpenClaw history renders through runtime hydration.

- [ ] **Step 8: Commit verification fixes**

If smoke reveals bugs, fix the minimal runtime path only, rerun Steps 1-7, then commit with a focused message.

```bash
git add <changed-files>
git commit -m "fix(chat-runtime): stabilize replay smoke flow"
```

---

## Task 14: Cutover Cleanup After Runtime Is Stable

**Files:**
- Modify: `src/contexts/ChatContext.tsx`
- Modify: `src/hooks/useChatMessages.ts`
- Modify: `src/hooks/useChatStreaming.ts`
- Modify: `src/hooks/useChatRecovery.ts`
- Modify: `src/features/chat/ChatPanel.tsx`

### Steps

- [ ] **Step 1: Keep old path until smoke is stable**

Do not remove old chat state code until Task 13 passes in the browser against `localhost:3080`.

- [ ] **Step 2: Make runtime the default**

Change the frontend flag helper:

```ts
export function isChatRuntimeEnabled(): boolean {
  try {
    const override = localStorage.getItem('nerve:chat-runtime');
    if (override === '0') return false;
    if (override === '1') return true;
  } catch {
    return true;
  }
  return true;
}
```

- [ ] **Step 3: Remove only unused old streaming display branches**

After runtime default is stable, remove code paths that render a separate streaming assistant bubble for the runtime branch. Keep old `ChatContext` files until a separate cleanup PR removes the legacy renderer.

- [ ] **Step 4: Verify old fallback still works**

In browser console:

```js
localStorage.setItem('nerve:chat-runtime', '0');
location.reload();
```

Send one prompt and confirm old chat path still sends and receives a response.

- [ ] **Step 5: Verify runtime default works**

In browser console:

```js
localStorage.removeItem('nerve:chat-runtime');
location.reload();
```

Send one prompt and confirm runtime path is active.

- [ ] **Step 6: Commit cutover**

```bash
git add src/features/chat-runtime/runtimeFlag.ts src/App.tsx src/features/chat/ChatPanel.tsx src/contexts/ChatContext.tsx src/hooks/useChatMessages.ts src/hooks/useChatStreaming.ts src/hooks/useChatRecovery.ts
git commit -m "feat(chat-runtime): default chat to server timeline"
```

---

## Final Verification Checklist

- [ ] `npm test -- --run server/lib/chat-runtime/id.test.ts server/lib/chat-runtime/reducer.test.ts server/lib/chat-runtime/adapter.test.ts server/lib/chat-runtime/replay-buffer.test.ts server/lib/chat-runtime/store.test.ts server/lib/chat-runtime/gateway-supervisor.test.ts server/routes/chat-runtime.test.ts src/features/chat-runtime/timelineClient.test.ts src/features/chat-runtime/ChatTimeline.test.tsx`
- [ ] `npm run lint`
- [ ] `git diff --check`
- [ ] `npm run build`
- [ ] `curl -fsS http://127.0.0.1:3080/health`
- [ ] Browser smoke: refresh mid-turn
- [ ] Browser smoke: session switch mid-turn
- [ ] Browser smoke: cache clear after finalized history
- [ ] Browser smoke: final assistant reply appears once
- [ ] Browser smoke: thinking blocks remain visible once known
- [ ] Browser smoke: tool calls remain ordered and grouped

## Known First-Version Limitation

If the Nerve server process restarts mid-turn, live-only frames that OpenClaw does not persist cannot be replayed. The runtime must recover finalized transcript content from `chat.history` and show an explicit recovering state for any active turn whose missed live frames are unrecoverable.
