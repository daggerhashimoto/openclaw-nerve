import { describe, expect, it, vi } from 'vitest';
import { ChatRuntime } from './runtime.js';
import { ChatTimelineStore } from './store.js';
import type { RuntimeEvent, TimelinePatch, TimelinePatchOp } from './types.js';

function turnStarted(sessionKey: string, runId: string, at: number): RuntimeEvent {
  return { type: 'turn_started', sessionKey, runId, at };
}

function assistantDelta(sessionKey: string, runId: string, text: string, at: number): RuntimeEvent {
  return { type: 'assistant_delta', sessionKey, runId, text, at };
}

function assistantFinal(sessionKey: string, runId: string, text: string, at: number): RuntimeEvent {
  return { type: 'assistant_final', sessionKey, runId, text, at };
}

function expectPatchReplay(result: ReturnType<ChatTimelineStore['replayAfter']>) {
  expect(result.kind).toBe('patches');
  if (result.kind !== 'patches') throw new Error('expected patch replay');
  return result.patches;
}

function turnRunIds(patch: TimelinePatch): string[] {
  return patch.ops
    .filter((op): op is Extract<TimelinePatchOp, { op: 'upsert_turn' }> => op.op === 'upsert_turn')
    .map((op) => op.turn.runId);
}

function firstTurnOp(patch: TimelinePatch): Extract<TimelinePatchOp, { op: 'upsert_turn' }> {
  const op = patch.ops.find((candidate): candidate is Extract<TimelinePatchOp, { op: 'upsert_turn' }> =>
    candidate.op === 'upsert_turn',
  );
  if (!op) throw new Error('expected turn op');
  return op;
}

function assistantItemsFromSnapshot(snapshot: ReturnType<ChatRuntime['snapshot']>) {
  return Object.values(snapshot.timeline.items).filter((item) => item.kind === 'assistant_message');
}

function thinkingItemsFromSnapshot(snapshot: ReturnType<ChatRuntime['snapshot']>) {
  return Object.values(snapshot.timeline.items).filter((item) => item.kind === 'thinking');
}

function assistantTextsInTurnOrder(snapshot: ReturnType<ChatRuntime['snapshot']>): string[] {
  return snapshot.timeline.turns.flatMap((turn) =>
    turn.outputItemIds.flatMap((itemId) => {
      const item = snapshot.timeline.items[itemId];
      return item?.kind === 'assistant_message' ? [item.text] : [];
    }),
  );
}

function userItemsFromSnapshot(snapshot: ReturnType<ChatRuntime['snapshot']>) {
  return Object.values(snapshot.timeline.items).filter((item) => item.kind === 'user_message');
}

function firstUserItemOp(patch: TimelinePatch): Extract<TimelinePatchOp, { op: 'upsert_item' }> {
  const op = patch.ops.find((candidate): candidate is Extract<TimelinePatchOp, { op: 'upsert_item' }> =>
    candidate.op === 'upsert_item' && candidate.item.kind === 'user_message',
  );
  if (!op) throw new Error('expected user item op');
  return op;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function liveAssistantFinalEvent(sessionKey: string, runId: string, text: string) {
  return {
    type: 'event' as const,
    event: 'chat',
    payload: {
      state: 'final',
      sessionKey,
      runId,
      messages: [{ role: 'assistant', content: text }],
    },
  };
}

describe('ChatTimelineStore', () => {
  it('publishes cursors 1 and 2 for two events', () => {
    const store = new ChatTimelineStore({ maxPatchesPerSession: 10 });
    const publishedCursors: string[] = [];
    store.subscribe('agent:main:main', (patch) => publishedCursors.push(patch.cursor));

    const first = store.applyEvent(turnStarted('agent:main:main', 'run-1', 1000));
    const second = store.applyEvent(assistantDelta('agent:main:main', 'run-1', 'hello', 1001));

    expect([first.cursor, second.cursor]).toEqual(['1', '2']);
    expect(publishedCursors).toEqual(['1', '2']);
  });

  it('uses the runtime event timestamp for returned and published patch metadata', () => {
    const store = new ChatTimelineStore({ maxPatchesPerSession: 10 });
    const publishedPatches: TimelinePatch[] = [];
    store.subscribe('agent:main:main', (patch) => publishedPatches.push(patch));

    const patch = store.applyEvent(turnStarted('agent:main:main', 'run-1', 424242));

    expect(patch.createdAt).toBe(424242);
    expect(publishedPatches.map((publishedPatch) => publishedPatch.createdAt)).toEqual([424242]);
  });

  it('creates an empty cloned timeline for a new session', () => {
    const store = new ChatTimelineStore({ maxPatchesPerSession: 10 });
    const timeline = store.getTimeline('agent:new:main');

    expect(timeline).toMatchObject({
      sessionKey: 'agent:new:main',
      version: 0,
      cursor: '0',
      hydrationState: 'cold',
      turns: [],
      items: {},
      updatedAt: 0,
    });

    timeline.turns.push({
      id: 'turn:agent:new:main:mutated',
      sessionKey: 'agent:new:main',
      runId: 'mutated',
      status: 'running',
      startedAt: 1000,
      inputItemIds: [],
      outputItemIds: [],
      orderBase: { turn: 0, block: 0, sub: 0 },
    });
    timeline.hydrationState = 'ready';

    expect(store.getTimeline('agent:new:main').turns).toEqual([]);
    expect(store.snapshot('agent:new:main', 'initial').timeline).toMatchObject({
      hydrationState: 'cold',
      turns: [],
      items: {},
    });
  });

  it('does not let getTimeline or snapshot callers mutate canonical timelines', () => {
    const store = new ChatTimelineStore({ maxPatchesPerSession: 10 });
    store.applyEvent(turnStarted('agent:main:main', 'run-1', 1000));

    const timeline = store.getTimeline('agent:main:main');
    timeline.turns[0].runId = 'mutated-getTimeline';

    const snapshot = store.snapshot('agent:main:main', 'manual');
    snapshot.timeline.turns[0].runId = 'mutated-snapshot';

    expect(store.getTimeline('agent:main:main').turns.map((turn) => turn.runId)).toEqual(['run-1']);
    expect(store.snapshot('agent:main:main', 'manual').timeline.turns.map((turn) => turn.runId)).toEqual(['run-1']);
  });

  it('returns, publishes, and replays isolated patch clones', () => {
    const store = new ChatTimelineStore({ maxPatchesPerSession: 10 });
    const secondSubscriberPatches: Array<{ cursor: string; runIds: string[] }> = [];

    store.subscribe('agent:main:main', (patch) => {
      patch.cursor = 'mutated-subscriber';
      firstTurnOp(patch).turn.runId = 'mutated-subscriber';
    });
    store.subscribe('agent:main:main', (patch) => {
      secondSubscriberPatches.push({ cursor: patch.cursor, runIds: turnRunIds(patch) });
    });

    const returnedPatch = store.applyEvent(turnStarted('agent:main:main', 'run-1', 1000));
    returnedPatch.cursor = 'mutated-return';
    firstTurnOp(returnedPatch).turn.runId = 'mutated-return';

    const replayedPatches = expectPatchReplay(store.replayAfter('agent:main:main', '0'));

    expect(secondSubscriberPatches).toEqual([{ cursor: '1', runIds: ['run-1'] }]);
    expect(replayedPatches.map((patch) => ({ cursor: patch.cursor, runIds: turnRunIds(patch) }))).toEqual([
      { cursor: '1', runIds: ['run-1'] },
    ]);
  });

  it('isolates subscriber failures and removes throwing subscribers', () => {
    const store = new ChatTimelineStore({ maxPatchesPerSession: 10 });
    const normalSubscriberCursors: string[] = [];
    let throwingSubscriberCalls = 0;

    store.subscribe('agent:main:main', () => {
      throwingSubscriberCalls += 1;
      throw new Error('subscriber failed');
    });
    store.subscribe('agent:main:main', (patch) => normalSubscriberCursors.push(patch.cursor));

    expect(() => store.applyEvent(turnStarted('agent:main:main', 'run-1', 1000))).not.toThrow();
    expect(() => store.applyEvent(assistantDelta('agent:main:main', 'run-1', 'hello', 1001))).not.toThrow();

    expect(throwingSubscriberCalls).toBe(1);
    expect(normalSubscriberCursors).toEqual(['1', '2']);
  });

  it('replays retained patches after cursor', () => {
    const store = new ChatTimelineStore({ maxPatchesPerSession: 3 });
    const first = store.applyEvent(turnStarted('agent:main:main', 'run-1', 1000));
    const second = store.applyEvent(assistantDelta('agent:main:main', 'run-1', 'hello', 1001));
    const third = store.applyEvent(assistantFinal('agent:main:main', 'run-1', 'hello world', 1002));

    expect(expectPatchReplay(store.replayAfter('agent:main:main', first.cursor))).toEqual([second, third]);
  });

  it('emits only changed turns and items for append patches after hydration', () => {
    const sessionKey = 'agent:delta-patch:main';
    const store = new ChatTimelineStore({ maxPatchesPerSession: 10 });
    store.replaceEvents(sessionKey, [
      { type: 'history_snapshot', sessionKey, messages: [], at: 1000 },
      assistantFinal(sessionKey, 'history-1', 'old answer 1', 1001),
      { type: 'turn_finalized', sessionKey, runId: 'history-1', at: 1001 },
      assistantFinal(sessionKey, 'history-2', 'old answer 2', 1002),
      { type: 'turn_finalized', sessionKey, runId: 'history-2', at: 1002 },
    ]);

    const startPatch = store.applyEvent(turnStarted(sessionKey, 'run-live', 2000));
    expect(turnRunIds(startPatch)).toEqual(['run-live']);
    expect(startPatch.ops.filter((op) => op.op === 'upsert_item')).toEqual([]);

    const deltaPatch = store.applyEvent(assistantDelta(sessionKey, 'run-live', 'live answer', 2001));
    const upsertedItems = deltaPatch.ops
      .filter((op): op is Extract<TimelinePatchOp, { op: 'upsert_item' }> => op.op === 'upsert_item')
      .map((op) => op.item);

    expect(turnRunIds(deltaPatch)).toEqual(['run-live']);
    expect(upsertedItems).toHaveLength(1);
    expect(upsertedItems[0]).toMatchObject({
      kind: 'assistant_message',
      runId: 'run-live',
      text: 'live answer',
    });
    expect(deltaPatch.ops).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'upsert_item', item: expect.objectContaining({ text: 'old answer 1' }) }),
      expect.objectContaining({ op: 'upsert_item', item: expect.objectContaining({ text: 'old answer 2' }) }),
    ]));
  });

  it('does not publish same-session patches after unsubscribe is called twice or notify other sessions', () => {
    const store = new ChatTimelineStore({ maxPatchesPerSession: 10 });
    const sessionAPatches: TimelinePatch[] = [];
    const sessionBPatches: TimelinePatch[] = [];

    const unsubscribeA = store.subscribe('agent:a:main', (patch) => sessionAPatches.push(patch));
    store.subscribe('agent:b:main', (patch) => sessionBPatches.push(patch));

    store.applyEvent(turnStarted('agent:a:main', 'run-a', 1000));
    unsubscribeA();
    unsubscribeA();
    store.applyEvent(assistantDelta('agent:a:main', 'run-a', 'hidden from subscriber', 1001));
    store.applyEvent(turnStarted('agent:b:main', 'run-b', 1002));

    expect(sessionAPatches.map((patch) => patch.cursor)).toEqual(['1']);
    expect(sessionBPatches.map((patch) => patch.sessionKey)).toEqual(['agent:b:main']);
    expect(sessionBPatches.map((patch) => patch.cursor)).toEqual(['1']);
  });

  it('advances snapshot cursor after applyEvent and keeps timelines session-specific', () => {
    const store = new ChatTimelineStore({ maxPatchesPerSession: 10 });

    expect(store.snapshot('agent:a:main', 'initial')).toMatchObject({
      cursor: '0',
      timeline: { sessionKey: 'agent:a:main', turns: [] },
    });

    store.applyEvent(turnStarted('agent:a:main', 'run-a', 1000));
    store.applyEvent(turnStarted('agent:b:main', 'run-b', 1001));
    store.applyEvent(assistantDelta('agent:a:main', 'run-a', 'hello a', 1002));

    const sessionASnapshot = store.snapshot('agent:a:main', 'manual');
    const sessionBSnapshot = store.snapshot('agent:b:main', 'manual');

    expect(sessionASnapshot.cursor).toBe('2');
    expect(sessionBSnapshot.cursor).toBe('1');
    expect(store.getTimeline('agent:a:main').turns.map((turn) => turn.runId)).toEqual(['run-a']);
    expect(store.getTimeline('agent:b:main').turns.map((turn) => turn.runId)).toEqual(['run-b']);
  });

  it('returns snapshot_required when replay cursor has expired', () => {
    const store = new ChatTimelineStore({ maxPatchesPerSession: 1 });
    const first = store.applyEvent(turnStarted('agent:main:main', 'run-1', 1000));
    store.applyEvent(assistantDelta('agent:main:main', 'run-1', 'hello', 1001));

    expect(store.replayAfter('agent:main:main', first.cursor)).toEqual({ kind: 'snapshot_required' });
  });

  it('marks timeline ready after replaceEvents even without a history_snapshot event', () => {
    const store = new ChatTimelineStore({ maxPatchesPerSession: 16 });
    const sessionKey = 'agent:main:main';

    store.replaceEvents(sessionKey, [
      { type: 'turn_started', sessionKey, runId: 'run-1', at: 1000 },
      { type: 'turn_finalized', sessionKey, runId: 'run-1', at: 1001 },
    ]);

    const snapshot = store.snapshot(sessionKey, 'manual');
    expect(snapshot.timeline.hydrationState).toBe('ready');
  });

  it('logs and removes a subscriber that throws', () => {
    const store = new ChatTimelineStore({ maxPatchesPerSession: 16 });
    const sessionKey = 'agent:main:main';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const thrower = vi.fn(() => { throw new Error('subscriber boom'); });

    store.subscribe(sessionKey, thrower);
    store.applyEvents([
      { type: 'turn_started', sessionKey, runId: 'run-1', at: 1000 },
    ]);

    expect(thrower).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    const message = String(errorSpy.mock.calls[0]?.[0] ?? '');
    expect(message.toLowerCase()).toMatch(/subscriber|chat-runtime/);

    errorSpy.mockRestore();
  });
});

describe('ChatRuntime', () => {
  it('hydrates history through adapter and store using default chat.history params', async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async (method, params) => {
        calls.push({ method, params });
        return {
          messages: [
            {
              role: 'assistant',
              runId: 'run-history',
              timestamp: 1000,
              content: 'persisted answer',
            },
          ],
        };
      },
    });

    await runtime.hydrateSession('agent:main:main');

    expect(calls).toEqual([
      { method: 'chat.history', params: { sessionKey: 'agent:main:main', limit: 500 } },
    ]);
    const snapshot = runtime.snapshot('agent:main:main', 'hydration');
    expect(snapshot.timeline.hydrationState).toBe('ready');
    expect(assistantItemsFromSnapshot(snapshot)).toMatchObject([
      {
        kind: 'assistant_message',
        text: 'persisted answer',
        finalText: 'persisted answer',
        status: 'complete',
      },
    ]);
  });

  it('hydrates persisted user prompts as inactive history instead of active optimistic turns', async () => {
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({
        messages: [
          {
            role: 'user',
            messageId: 'prompt-1',
            timestamp: 1000,
            content: 'hello',
          },
          {
            role: 'assistant',
            messageId: 'answer-1',
            timestamp: 1001,
            content: 'answer',
          },
        ],
      }),
    });

    await runtime.hydrateSession('agent:main:main');

    const snapshot = runtime.snapshot('agent:main:main', 'hydration');
    expect(snapshot.timeline.turns.map((turn) => ({ runId: turn.runId, status: turn.status }))).toEqual([
      { runId: 'history:user:prompt-1', status: 'finalized' },
      { runId: 'history:message:answer-1', status: 'finalized' },
    ]);
    expect(userItemsFromSnapshot(snapshot)).toMatchObject([
      {
        kind: 'user_message',
        text: 'hello',
        status: 'complete',
        source: 'history',
        pending: false,
      },
    ]);
    expect(snapshot.timeline.turns.filter((turn) => turn.status === 'running')).toEqual([]);
  });

  it('uses custom history limits when hydrating', async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async (method, params) => {
        calls.push({ method, params });
        return { messages: [] };
      },
    });

    await runtime.hydrateSession('agent:limited:main', 42);

    expect(calls).toEqual([
      { method: 'chat.history', params: { sessionKey: 'agent:limited:main', limit: 42 } },
    ]);
  });

  it('applies current OpenClaw live item tool events before the final assistant message', () => {
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({ messages: [] }),
    });

    runtime.applyGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: { state: 'started', sessionKey: 'agent:main:main', runId: 'run-live' },
    });
    runtime.applyGatewayEvent({
      type: 'event',
      event: 'agent',
      payload: {
        sessionKey: 'agent:main:main',
        runId: 'run-live',
        stream: 'item',
        data: {
          phase: 'start',
          kind: 'tool',
          name: 'exec',
          meta: 'pwd (in ~/.openclaw/workspace)',
          toolCallId: 'call-1',
        },
      },
    });
    runtime.applyGatewayEvent({
      type: 'event',
      event: 'agent',
      payload: {
        sessionKey: 'agent:main:main',
        runId: 'run-live',
        stream: 'command_output',
        data: {
          phase: 'end',
          toolCallId: 'call-1',
          output: '/Users/cd0x23/.openclaw/workspace',
          status: 'completed',
        },
      },
    });
    runtime.applyGatewayEvent(liveAssistantFinalEvent('agent:main:main', 'run-live', 'done'));

    const snapshot = runtime.snapshot('agent:main:main', 'manual');
    const topLevelOutput = snapshot.timeline.turns[0].outputItemIds.map((itemId) => snapshot.timeline.items[itemId]);

    expect(topLevelOutput.map((item) => item?.kind)).toEqual(['tool_group', 'assistant_message']);
    expect(Object.values(snapshot.timeline.items).find((item) => item.kind === 'tool_call')).toMatchObject({
      kind: 'tool_call',
      name: 'exec',
      result: '/Users/cd0x23/.openclaw/workspace',
      status: 'complete',
    });
    expect(assistantItemsFromSnapshot(snapshot)).toMatchObject([
      { text: 'done', status: 'complete' },
    ]);
  });

  it('applies current OpenClaw live thinking stream before the final assistant message', () => {
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({ messages: [] }),
    });

    runtime.applyGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: { state: 'started', sessionKey: 'agent:main:main', runId: 'run-live' },
    });
    runtime.applyGatewayEvent({
      type: 'event',
      event: 'agent',
      payload: {
        sessionKey: 'agent:main:main',
        runId: 'run-live',
        stream: 'thinking',
        data: {
          text: 'I should inspect the project first.',
          delta: ' first.',
        },
      },
    });
    runtime.applyGatewayEvent(liveAssistantFinalEvent('agent:main:main', 'run-live', 'done'));

    const snapshot = runtime.snapshot('agent:main:main', 'manual');
    const topLevelOutput = snapshot.timeline.turns[0].outputItemIds.map((itemId) => snapshot.timeline.items[itemId]);

    expect(topLevelOutput.map((item) => item?.kind)).toEqual(['thinking', 'assistant_message']);
    expect(topLevelOutput[0]).toMatchObject({
      kind: 'thinking',
      text: 'I should inspect the project first.',
      status: 'complete',
    });
    expect(assistantItemsFromSnapshot(snapshot)).toMatchObject([
      { text: 'done', status: 'complete' },
    ]);
  });

  it('applies live thinking stream events that only include the run id', () => {
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({ messages: [] }),
    });

    runtime.applyGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: { state: 'started', sessionKey: 'agent:main:main', runId: 'run-live' },
    });
    runtime.applyGatewayEvent({
      type: 'event',
      event: 'agent',
      payload: {
        runId: 'run-live',
        stream: 'thinking',
        data: {
          text: 'I can stream once the run is known.',
          delta: ' known.',
        },
      },
    });

    const snapshot = runtime.snapshot('agent:main:main', 'manual');
    const thinkingItems = Object.values(snapshot.timeline.items).filter((item) => item.kind === 'thinking');

    expect(thinkingItems).toHaveLength(1);
    expect(thinkingItems[0]).toMatchObject({
      kind: 'thinking',
      text: 'I can stream once the run is known.',
      status: 'running',
    });
  });

  it('buffers run-scoped live thinking until the session-bearing chat event arrives', () => {
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({ messages: [] }),
    });

    runtime.applyGatewayEvent({
      type: 'event',
      event: 'agent',
      payload: {
        runId: 'run-live',
        stream: 'thinking',
        data: {
          text: 'Reasoning arrived before chat started.',
          delta: ' started.',
        },
      },
    });
    expect(runtime.snapshot('agent:main:main', 'manual').timeline.turns).toEqual([]);

    runtime.applyGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: { state: 'started', sessionKey: 'agent:main:main', runId: 'run-live' },
    });

    const snapshot = runtime.snapshot('agent:main:main', 'manual');
    const thinkingItems = Object.values(snapshot.timeline.items).filter((item) => item.kind === 'thinking');

    expect(thinkingItems).toHaveLength(1);
    expect(thinkingItems[0]).toMatchObject({
      kind: 'thinking',
      text: 'Reasoning arrived before chat started.',
      status: 'running',
    });
  });

  it('replaces idle live timelines with canonical history during hydration', async () => {
    const publishedPatches: TimelinePatch[] = [];
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'run command' }],
            timestamp: 1000,
            __openclaw: { id: 'user-history' },
          },
          {
            role: 'assistant',
            content: [
              { type: 'toolCall', id: 'tool-history', name: 'exec', arguments: { command: 'pwd' } },
            ],
            timestamp: 1001,
            __openclaw: { id: 'assistant-tool-history' },
          },
          {
            role: 'toolResult',
            toolCallId: 'tool-history',
            content: [{ type: 'text', text: '/workspace' }],
            timestamp: 1002,
          },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'done' }],
            timestamp: 1003,
            __openclaw: { id: 'assistant-final-history' },
          },
        ],
      }),
    });
    runtime.subscribe('agent:main:main', (patch) => publishedPatches.push(patch));

    runtime.applyGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: { state: 'started', sessionKey: 'agent:main:main', runId: 'run-live' },
    });
    runtime.applyGatewayEvent({
      type: 'event',
      event: 'agent',
      payload: {
        sessionKey: 'agent:main:main',
        runId: 'run-live',
        stream: 'item',
        data: { phase: 'start', kind: 'tool', name: 'exec', meta: 'pwd', toolCallId: 'tool-live' },
      },
    });
    runtime.applyGatewayEvent(liveAssistantFinalEvent('agent:main:main', 'run-live', 'done'));

    await runtime.hydrateSession('agent:main:main');

    const snapshot = runtime.snapshot('agent:main:main', 'manual');
    const items = Object.values(snapshot.timeline.items);
    const replacementPatch = publishedPatches.find((patch) =>
      patch.ops.some((op) => op.op === 'set_hydration_state' && op.state === 'ready'),
    );
    expect(items.filter((item) => item.runId === 'run-live')).toHaveLength(0);
    expect(items.filter((item) => item.kind === 'user_message')).toHaveLength(1);
    expect(items.filter((item) => item.kind === 'tool_call')).toHaveLength(1);
    expect(assistantItemsFromSnapshot(snapshot)).toHaveLength(1);
    expect(assistantItemsFromSnapshot(snapshot)[0]).toMatchObject({ text: 'done' });
    expect(replacementPatch?.ops).toContainEqual({
      op: 'remove_turn',
      id: 'turn:agent:main:main:run-live',
      reason: 'compaction',
    });
  });

  it('ignores unrelated canonical history during hydration without losing an active live timeline', async () => {
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'older history answer' }],
            timestamp: 1000,
            __openclaw: { id: 'older-history' },
          },
        ],
      }),
    });

    runtime.applyGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: { state: 'started', sessionKey: 'agent:main:main', runId: 'run-live' },
    });
    runtime.applyGatewayEvent({
      type: 'event',
      event: 'agent',
      payload: {
        sessionKey: 'agent:main:main',
        runId: 'run-live',
        stream: 'item',
        data: { phase: 'start', kind: 'tool', name: 'exec', meta: 'sleep 10', toolCallId: 'tool-live' },
      },
    });

    await runtime.hydrateSession('agent:main:main');

    const snapshot = runtime.snapshot('agent:main:main', 'manual');
    expect(Object.values(snapshot.timeline.items).filter((item) => item.runId === 'run-live')).toHaveLength(2);
    expect(Object.values(snapshot.timeline.items).filter((item) => item.kind === 'tool_call')).toHaveLength(1);
    expect(assistantItemsFromSnapshot(snapshot)).toHaveLength(0);
  });

  it('merges persisted thinking from history into a running live turn without duplicating the prompt', async () => {
    const sessionKey = 'agent:active-thinking:main';
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({
        messages: [
          {
            role: 'user',
            messageId: 'history-user-1',
            timestamp: 1000,
            content: 'explain the plan',
          },
          {
            role: 'assistant',
            messageId: 'history-assistant-1',
            timestamp: 1001,
            content: [
              { type: 'thinking', thinking: 'I should compare the runtime and history paths.' },
              { type: 'text', text: 'Here is the plan.' },
            ],
          },
        ],
      }),
    });

    runtime.applyOptimisticUserMessage({
      sessionKey,
      runId: 'run-live',
      text: 'explain the plan',
      idempotencyKey: 'idem-active-prompt',
      at: 999,
    });

    await runtime.hydrateSession(sessionKey);

    const snapshot = runtime.snapshot(sessionKey, 'manual');
    expect(userItemsFromSnapshot(snapshot)).toHaveLength(1);
    expect(userItemsFromSnapshot(snapshot)[0]).toMatchObject({
      kind: 'user_message',
      text: 'explain the plan',
      idempotencyKey: 'idem-active-prompt',
      messageId: 'history-user-1',
      pending: false,
      source: 'history',
    });
    expect(thinkingItemsFromSnapshot(snapshot)).toMatchObject([
      {
        kind: 'thinking',
        runId: 'run-live',
        text: 'I should compare the runtime and history paths.',
        status: 'complete',
      },
    ]);
    expect(assistantItemsFromSnapshot(snapshot)).toMatchObject([
      {
        kind: 'assistant_message',
        runId: 'run-live',
        text: 'Here is the plan.',
        status: 'complete',
      },
    ]);
    expect(snapshot.timeline.turns.map((turn) => turn.runId)).toEqual(['run-live']);
  });

  it('does not append unrelated older history below the running turn during active hydration', async () => {
    const sessionKey = 'agent:active-unrelated-history:main';
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({
        messages: [
          {
            role: 'user',
            messageId: 'older-user-1',
            timestamp: 1000,
            content: 'older question',
          },
          {
            role: 'assistant',
            messageId: 'older-assistant-1',
            timestamp: 1001,
            content: 'older answer',
          },
        ],
      }),
    });

    runtime.applyOptimisticUserMessage({
      sessionKey,
      runId: 'run-live',
      text: 'current question',
      idempotencyKey: 'idem-current-question',
      at: 10_000,
    });

    await runtime.hydrateSession(sessionKey);

    const snapshot = runtime.snapshot(sessionKey, 'manual');
    expect(snapshot.timeline.turns.map((turn) => turn.runId)).toEqual(['run-live']);
    expect(userItemsFromSnapshot(snapshot)).toMatchObject([
      { text: 'current question', source: 'optimistic' },
    ]);
    expect(assistantItemsFromSnapshot(snapshot)).toHaveLength(0);
  });

  it('does not bind stale same-text history to the active turn during mid-run refresh', async () => {
    const sessionKey = 'agent:active-stale-same-text:main';
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({
        messages: [
          {
            role: 'user',
            messageId: 'older-user-1',
            timestamp: 1000,
            content: 'repeatable prompt',
          },
          {
            role: 'assistant',
            messageId: 'older-assistant-1',
            timestamp: 1001,
            content: [
              { type: 'thinking', thinking: 'Old reasoning should stay old.' },
              { type: 'text', text: 'Old answer should not attach to the active run.' },
            ],
          },
        ],
      }),
    });

    runtime.applyOptimisticUserMessage({
      sessionKey,
      runId: 'run-live',
      text: 'repeatable prompt',
      idempotencyKey: 'idem-repeatable-prompt',
      at: 120_000,
    });

    await runtime.hydrateSession(sessionKey);

    const snapshot = runtime.snapshot(sessionKey, 'manual');
    expect(snapshot.timeline.turns).toMatchObject([
      { runId: 'run-live', status: 'running' },
    ]);
    expect(thinkingItemsFromSnapshot(snapshot)).toHaveLength(0);
    expect(assistantItemsFromSnapshot(snapshot)).toHaveLength(0);
    expect(userItemsFromSnapshot(snapshot)).toMatchObject([
      { text: 'repeatable prompt', idempotencyKey: 'idem-repeatable-prompt' },
    ]);
  });

  it('does not bind untimestamped same-text history to the active turn during mid-run refresh', async () => {
    const sessionKey = 'agent:active-untimestamped-same-text:main';
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({
        messages: [
          {
            role: 'user',
            messageId: 'older-user-1',
            content: 'repeatable prompt',
          },
          {
            role: 'assistant',
            messageId: 'older-assistant-1',
            content: [
              { type: 'thinking', thinking: 'Old reasoning should stay old.' },
              { type: 'text', text: 'Old answer should not attach to the active run.' },
            ],
          },
        ],
      }),
    });

    runtime.applyOptimisticUserMessage({
      sessionKey,
      runId: 'run-live',
      text: 'repeatable prompt',
      idempotencyKey: 'idem-repeatable-prompt',
      at: 120_000,
    });

    await runtime.hydrateSession(sessionKey);

    const snapshot = runtime.snapshot(sessionKey, 'manual');
    expect(snapshot.timeline.turns).toMatchObject([
      { runId: 'run-live', status: 'running' },
    ]);
    expect(thinkingItemsFromSnapshot(snapshot)).toHaveLength(0);
    expect(assistantItemsFromSnapshot(snapshot)).toHaveLength(0);
    expect(userItemsFromSnapshot(snapshot)).toMatchObject([
      { text: 'repeatable prompt', idempotencyKey: 'idem-repeatable-prompt' },
    ]);
  });

  it('does not finalize a running turn when history has only the matching user prompt', async () => {
    const sessionKey = 'agent:active-user-only:main';
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({
        messages: [
          {
            role: 'user',
            messageId: 'history-user-1',
            timestamp: 1000,
            content: 'keep streaming',
          },
        ],
      }),
    });

    runtime.applyOptimisticUserMessage({
      sessionKey,
      runId: 'run-live',
      text: 'keep streaming',
      idempotencyKey: 'idem-user-only',
      at: 999,
    });

    await runtime.hydrateSession(sessionKey);

    expect(runtime.snapshot(sessionKey, 'manual').timeline.turns).toMatchObject([
      { runId: 'run-live', status: 'running' },
    ]);
  });

  it('polls canonical history during an active live turn so history-only thinking appears without refresh', async () => {
    vi.useFakeTimers();
    try {
      const sessionKey = 'agent:active-thinking-poll:main';
      let messages: Array<{
        role: 'user' | 'assistant';
        messageId: string;
        timestamp: number;
        content: string | Array<{ type: string; thinking?: string; text?: string }>;
      }> = [];
      const calls: Array<{ method: string; params: unknown }> = [];
      const runtime = new ChatRuntime({
        maxPatchesPerSession: 10,
        rpc: async (method, params) => {
          calls.push({ method, params });
          return { messages };
        },
      });

      runtime.applyOptimisticUserMessage({
        sessionKey,
        runId: 'run-live',
        text: 'show live thinking',
        idempotencyKey: 'idem-live-thinking',
        at: 1000,
      });

      messages = [
        {
          role: 'user',
          messageId: 'history-user-1',
          timestamp: 1000,
          content: 'show live thinking',
        },
        {
          role: 'assistant',
          messageId: 'history-assistant-1',
          timestamp: 1001,
          content: [
            { type: 'thinking', thinking: 'Reasoning became available through history.' },
            { type: 'text', text: 'Visible answer.' },
          ],
        },
      ];

      await vi.advanceTimersByTimeAsync(5000);

      expect(calls).toContainEqual({
        method: 'chat.history',
        params: { sessionKey, limit: 500 },
      });
      expect(thinkingItemsFromSnapshot(runtime.snapshot(sessionKey, 'manual'))).toMatchObject([
        {
          kind: 'thinking',
          runId: 'run-live',
          text: 'Reasoning became available through history.',
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shares concurrent hydration work until the RPC resolves', async () => {
    const sessionKey = 'agent:concurrent:main';
    const historyRpc = deferred<unknown>();
    const calls: Array<{ method: string; params: unknown }> = [];
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: (method, params) => {
        calls.push({ method, params });
        return historyRpc.promise;
      },
    });

    const firstHydration = runtime.hydrateSession(sessionKey);
    const secondHydration = runtime.hydrateSession(sessionKey);
    const settled: string[] = [];
    firstHydration.then(() => settled.push('first'), () => settled.push('first rejected'));
    secondHydration.then(() => settled.push('second'), () => settled.push('second rejected'));

    await Promise.resolve();

    expect(calls).toEqual([
      { method: 'chat.history', params: { sessionKey, limit: 500 } },
    ]);
    expect(settled).toEqual([]);

    historyRpc.resolve({ messages: [] });

    await expect(Promise.all([firstHydration, secondHydration])).resolves.toEqual([undefined, undefined]);
    expect(settled).toEqual(['first', 'second']);
  });

  it('shares hydration work when RPC synchronously reenters hydrateSession', async () => {
    const sessionKey = 'agent:reentrant:main';
    const calls: Array<{ method: string; params: unknown }> = [];
    let reentered = false;
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: (method, params) => {
        calls.push({ method, params });
        if (!reentered) {
          reentered = true;
          void runtime.hydrateSession(sessionKey);
        }

        return Promise.resolve({ messages: [] });
      },
    });

    await runtime.hydrateSession(sessionKey);

    expect(calls).toEqual([
      { method: 'chat.history', params: { sessionKey, limit: 500 } },
    ]);
  });

  it('queues same-stack gateway events emitted from history RPC until after history applies', async () => {
    const sessionKey = 'agent:same-stack-live:main';
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: () => {
        const patches = runtime.applyGatewayEvent(
          liveAssistantFinalEvent(sessionKey, 'run-live', 'live answer'),
        );

        expect(patches).toEqual([]);

        return Promise.resolve({
          messages: [
            {
              role: 'assistant',
              runId: 'run-history',
              timestamp: 1000,
              content: 'history answer',
            },
          ],
        });
      },
    });

    await runtime.hydrateSession(sessionKey);

    expect(assistantTextsInTurnOrder(runtime.snapshot(sessionKey, 'hydration'))).toEqual([
      'history answer',
      'live answer',
    ]);
  });

  it('shares concurrent hydration rejection and clears failure state for retry', async () => {
    const sessionKey = 'agent:retry:main';
    const firstRpc = deferred<unknown>();
    const calls: Array<{ method: string; params: unknown }> = [];
    let attempt = 0;
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: (method, params) => {
        calls.push({ method, params });
        attempt += 1;

        if (attempt === 1) return firstRpc.promise;

        return Promise.resolve({
          messages: [
            {
              role: 'assistant',
              runId: 'run-retry',
              timestamp: 2000,
              content: 'retried answer',
            },
          ],
        });
      },
    });

    const firstHydration = runtime.hydrateSession(sessionKey);
    const secondHydration = runtime.hydrateSession(sessionKey);
    const firstOutcome = firstHydration.then(
      () => 'resolved',
      (error: unknown) => error instanceof Error ? error.message : String(error),
    );
    const secondOutcome = secondHydration.then(
      () => 'resolved',
      (error: unknown) => error instanceof Error ? error.message : String(error),
    );

    expect(calls).toHaveLength(1);
    firstRpc.reject(new Error('history unavailable'));

    await expect(firstOutcome).resolves.toBe('history unavailable');
    await expect(secondOutcome).resolves.toBe('history unavailable');

    await runtime.hydrateSession(sessionKey);

    expect(calls).toEqual([
      { method: 'chat.history', params: { sessionKey, limit: 500 } },
      { method: 'chat.history', params: { sessionKey, limit: 500 } },
    ]);
    const snapshot = runtime.snapshot(sessionKey, 'hydration');
    expect(snapshot.timeline.hydrationState).toBe('ready');
    expect(assistantItemsFromSnapshot(snapshot).map((item) => item.text)).toEqual(['retried answer']);
  });

  it('treats malformed history results as empty ready snapshots', async () => {
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({ messages: 'not an array' }),
    });

    await expect(runtime.hydrateSession('agent:malformed:main')).resolves.toBeUndefined();

    const snapshot = runtime.snapshot('agent:malformed:main', 'hydration');
    expect(snapshot.timeline.hydrationState).toBe('ready');
    expect(Object.values(snapshot.timeline.items)).toEqual([]);
  });

  it('filters invalid history array entries before adapting RPC history', async () => {
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({
        messages: [
          null,
          'bad',
          { role: 'assistant' },
          { role: 'assistant', content: 'ok', runId: 'run-1' },
        ],
      }),
    });

    await expect(runtime.hydrateSession('agent:filtered:main')).resolves.toBeUndefined();

    const snapshot = runtime.snapshot('agent:filtered:main', 'hydration');
    expect(snapshot.timeline.hydrationState).toBe('ready');
    expect(assistantItemsFromSnapshot(snapshot)).toMatchObject([
      {
        kind: 'assistant_message',
        text: 'ok',
        finalText: 'ok',
        status: 'complete',
        runId: 'run-1',
      },
    ]);
  });

  it('queues same-session live gateway events during hydration and flushes them after history', async () => {
    const sessionKey = 'agent:queued:main';
    const historyRpc = deferred<unknown>();
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: () => historyRpc.promise,
    });

    const hydration = runtime.hydrateSession(sessionKey);
    const patches = runtime.applyGatewayEvent(liveAssistantFinalEvent(sessionKey, 'run-live', 'live answer'));

    expect(patches).toEqual([]);
    expect(assistantTextsInTurnOrder(runtime.snapshot(sessionKey, 'manual'))).toEqual([]);

    historyRpc.resolve({
      messages: [
        {
          role: 'assistant',
          runId: 'run-history',
          timestamp: 1000,
          content: 'history answer',
        },
      ],
    });
    await hydration;

    expect(assistantTextsInTurnOrder(runtime.snapshot(sessionKey, 'hydration'))).toEqual([
      'history answer',
      'live answer',
    ]);
  });

  it('flushes run-scoped agent events when their chat start is replayed after hydration', async () => {
    const sessionKey = 'agent:queued-sessionless-agent:main';
    const historyRpc = deferred<unknown>();
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: () => historyRpc.promise,
    });

    const hydration = runtime.hydrateSession(sessionKey);

    expect(runtime.applyGatewayEvent({
      type: 'event',
      event: 'agent',
      payload: {
        runId: 'run-live',
        stream: 'thinking',
        data: {
          text: 'Reasoning arrived before chat start during hydration.',
          delta: ' hydration.',
        },
      },
    })).toEqual([]);
    expect(runtime.applyGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: { state: 'started', sessionKey, runId: 'run-live' },
    })).toEqual([]);

    historyRpc.resolve({ messages: [] });
    await hydration;

    expect(thinkingItemsFromSnapshot(runtime.snapshot(sessionKey, 'hydration'))).toMatchObject([
      {
        kind: 'thinking',
        runId: 'run-live',
        text: 'Reasoning arrived before chat start during hydration.',
        status: 'running',
      },
    ]);
  });

  it('keeps hydration promise visible to subscriber microtasks during history publication', async () => {
    const sessionKey = 'agent:subscriber-rehydrate:main';
    const calls: Array<{ method: string; params: unknown }> = [];
    let rehydrateQueued = false;
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async (method, params) => {
        calls.push({ method, params });
        return {
          messages: [
            {
              role: 'assistant',
              runId: 'run-history',
              timestamp: 1000,
              content: 'history answer',
            },
          ],
        };
      },
    });

    runtime.subscribe(sessionKey, (patch) => {
      const marksReady = patch.ops.some((op) => op.op === 'set_hydration_state' && op.state === 'ready');
      if (!marksReady || rehydrateQueued) return;

      rehydrateQueued = true;
      queueMicrotask(() => {
        void runtime.hydrateSession(sessionKey);
      });
    });

    await runtime.hydrateSession(sessionKey);
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual([
      { method: 'chat.history', params: { sessionKey, limit: 500 } },
    ]);
  });

  it('publishes ready hydration patches only after all history messages are visible in snapshots', async () => {
    const sessionKey = 'agent:atomic-history:main';
    const readyPatchSnapshots: string[][] = [];
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({
        messages: [
          {
            role: 'assistant',
            runId: 'run-history-1',
            timestamp: 1000,
            content: 'first history answer',
          },
          {
            role: 'assistant',
            runId: 'run-history-2',
            timestamp: 2000,
            content: 'second history answer',
          },
        ],
      }),
    });

    runtime.subscribe(sessionKey, (patch) => {
      const marksReady = patch.ops.some((op) => op.op === 'set_hydration_state' && op.state === 'ready');
      if (!marksReady) return;

      readyPatchSnapshots.push(assistantTextsInTurnOrder(runtime.snapshot(sessionKey, 'manual')));
    });

    await runtime.hydrateSession(sessionKey);

    expect(readyPatchSnapshots).toEqual([
      ['first history answer', 'second history answer'],
    ]);
  });

  it('flushes live gateway events queued from subscriber microtasks during hydration publication', async () => {
    const sessionKey = 'agent:microtask-queued-live:main';
    let liveEventQueued = false;
    let queuedPatches: TimelinePatch[] | undefined;
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({
        messages: [
          {
            role: 'assistant',
            runId: 'run-history',
            timestamp: 1000,
            content: 'history answer',
          },
        ],
      }),
    });

    runtime.subscribe(sessionKey, (patch) => {
      const marksReady = patch.ops.some((op) => op.op === 'set_hydration_state' && op.state === 'ready');
      if (!marksReady || liveEventQueued) return;

      liveEventQueued = true;
      queueMicrotask(() => {
        queuedPatches = runtime.applyGatewayEvent(
          liveAssistantFinalEvent(sessionKey, 'run-live', 'live answer from microtask'),
        );
      });
    });

    await runtime.hydrateSession(sessionKey);
    await Promise.resolve();
    await Promise.resolve();

    expect(queuedPatches).toEqual([]);
    expect(assistantTextsInTurnOrder(runtime.snapshot(sessionKey, 'hydration'))).toEqual([
      'history answer',
      'live answer from microtask',
    ]);
  });

  it('applies live gateway events for other sessions while hydration is pending', async () => {
    const hydratingSessionKey = 'agent:hydrating:main';
    const liveSessionKey = 'agent:other-live:main';
    const historyRpc = deferred<unknown>();
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: () => historyRpc.promise,
    });

    const hydration = runtime.hydrateSession(hydratingSessionKey);
    const patches = runtime.applyGatewayEvent(liveAssistantFinalEvent(liveSessionKey, 'run-live', 'other live answer'));

    expect(patches).toHaveLength(2);
    expect(assistantTextsInTurnOrder(runtime.snapshot(liveSessionKey, 'manual'))).toEqual(['other live answer']);

    historyRpc.resolve({ messages: [] });
    await hydration;
  });

  it('drops queued same-session gateway events after hydration failure and allows later retry', async () => {
    const sessionKey = 'agent:failed-queue:main';
    const firstRpc = deferred<unknown>();
    let attempt = 0;
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: () => {
        attempt += 1;
        if (attempt === 1) return firstRpc.promise;

        return Promise.resolve({
          messages: [
            {
              role: 'assistant',
              runId: 'run-history',
              timestamp: 2000,
              content: 'history after retry',
            },
          ],
        });
      },
    });

    const hydration = runtime.hydrateSession(sessionKey);
    const patches = runtime.applyGatewayEvent(liveAssistantFinalEvent(sessionKey, 'run-live', 'dropped live answer'));

    expect(patches).toEqual([]);

    firstRpc.reject(new Error('history unavailable'));
    await expect(hydration).rejects.toThrow('history unavailable');
    expect(assistantTextsInTurnOrder(runtime.snapshot(sessionKey, 'manual'))).toEqual([]);

    await runtime.hydrateSession(sessionKey);

    expect(assistantTextsInTurnOrder(runtime.snapshot(sessionKey, 'hydration'))).toEqual([
      'history after retry',
    ]);
  });

  it('applies adapted gateway chat started, delta, and final events into the timeline', () => {
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({ messages: [] }),
    });

    runtime.applyGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: { state: 'started', sessionKey: 'agent:live:main', runId: 'run-live' },
    });
    runtime.applyGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: {
        state: 'delta',
        sessionKey: 'agent:live:main',
        runId: 'run-live',
        message: { role: 'assistant', content: [{ type: 'text', text: 'partial' }] },
      },
    });
    runtime.applyGatewayEvent({
      type: 'event',
      event: 'chat',
      payload: {
        state: 'final',
        sessionKey: 'agent:live:main',
        runId: 'run-live',
        messages: [{ role: 'assistant', content: 'final answer' }],
      },
    });

    const snapshot = runtime.snapshot('agent:live:main', 'manual');
    expect(snapshot.timeline.turns).toMatchObject([
      { runId: 'run-live', status: 'finalized' },
    ]);
    expect(assistantItemsFromSnapshot(snapshot)).toMatchObject([
      {
        kind: 'assistant_message',
        text: 'final answer',
        finalText: 'final answer',
        isStreaming: false,
      },
    ]);
  });

  it('applies optimistic user messages with provided and default timestamps', () => {
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({ messages: [] }),
    });

    const providedAtPatch = runtime.applyOptimisticUserMessage({
      sessionKey: 'agent:optimistic:main',
      runId: 'run-optimistic',
      text: 'hello from user',
      idempotencyKey: 'idem-1',
      at: 1234,
    });

    expect(providedAtPatch.createdAt).toBe(1234);
    expect(firstUserItemOp(providedAtPatch).item).toMatchObject({
      kind: 'user_message',
      text: 'hello from user',
      idempotencyKey: 'idem-1',
      status: 'provisional',
      source: 'optimistic',
      pending: true,
      createdAt: 1234,
      updatedAt: 1234,
    });

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(5678);
    try {
      const defaultAtPatch = runtime.applyOptimisticUserMessage({
        sessionKey: 'agent:clock:main',
        text: 'uses Date.now',
        idempotencyKey: 'idem-now',
      });

      expect(defaultAtPatch.createdAt).toBe(5678);
      expect(userItemsFromSnapshot(runtime.snapshot('agent:clock:main', 'manual'))).toMatchObject([
        {
          kind: 'user_message',
          text: 'uses Date.now',
          idempotencyKey: 'idem-now',
          createdAt: 5678,
          updatedAt: 5678,
        },
      ]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('binds optimistic user messages to real run IDs without replaying media payloads', () => {
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({ messages: [] }),
    });

    runtime.applyOptimisticUserMessage({
      sessionKey: 'agent:optimistic-media:main',
      text: 'look',
      idempotencyKey: 'idem-media-bind',
      images: [{
        mimeType: 'image/png',
        content: 'base64-image',
        preview: 'data:image/png;base64,base64-image',
        name: 'image.png',
      }],
      uploadAttachments: [{
        id: 'att-1',
        origin: 'upload',
        mode: 'inline',
        name: 'image.png',
        mimeType: 'image/png',
        sizeBytes: 100,
        inline: {
          encoding: 'base64',
          base64: 'base64-image',
          base64Bytes: 100,
          compressed: false,
        },
        policy: { forwardToSubagents: false },
      }],
      at: 1000,
    });

    const bindPatch = runtime.bindRunIdToOptimisticUserMessage({
      sessionKey: 'agent:optimistic-media:main',
      idempotencyKey: 'idem-media-bind',
      runId: 'run-real',
      at: 1001,
    });

    expect(bindPatch.ops).toEqual([
      {
        op: 'bind_user_message_run',
        idempotencyKey: 'idem-media-bind',
        runId: 'run-real',
        at: 1001,
      },
    ]);
    expect(JSON.stringify(bindPatch)).not.toContain('base64-image');
    expect(runtime.snapshot('agent:optimistic-media:main', 'manual').timeline.turns).toMatchObject([
      { runId: 'run-real' },
    ]);
  });

  it('does not scan unrelated media payloads while detecting run binding patches', () => {
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({ messages: [] }),
    });

    runtime.applyOptimisticUserMessage({
      sessionKey: 'agent:optimistic-media:main',
      text: 'older media prompt',
      idempotencyKey: 'idem-unrelated-media',
      images: [{
        mimeType: 'image/png',
        content: 'unrelated-large-media-payload',
        preview: 'data:image/png;base64,unrelated-large-media-payload',
        name: 'older.png',
      }],
      uploadAttachments: [{
        id: 'att-unrelated',
        origin: 'upload',
        mode: 'inline',
        name: 'older.png',
        mimeType: 'image/png',
        sizeBytes: 100,
        inline: {
          encoding: 'base64',
          base64: 'unrelated-large-media-payload',
          base64Bytes: 100,
          compressed: false,
        },
        policy: { forwardToSubagents: false },
      }],
      at: 1000,
    });
    runtime.applyOptimisticUserMessage({
      sessionKey: 'agent:optimistic-media:main',
      text: 'new prompt',
      idempotencyKey: 'idem-bind-target',
      at: 1001,
    });

    const stringifySpy = vi.spyOn(JSON, 'stringify');
    runtime.bindRunIdToOptimisticUserMessage({
      sessionKey: 'agent:optimistic-media:main',
      idempotencyKey: 'idem-bind-target',
      runId: 'run-real',
      at: 1002,
    });

    const stringifyCalls = [...stringifySpy.mock.calls];
    stringifySpy.mockRestore();

    expect(stringifyCalls.some(([value]) =>
      typeof value === 'object' &&
      value !== null &&
      JSON.stringify(value).includes('unrelated-large-media-payload'),
    )).toBe(false);
  });

  it('marks failed optimistic user messages terminal in the server timeline', () => {
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({ messages: [] }),
    });

    runtime.applyOptimisticUserMessage({
      sessionKey: 'agent:failed-send:main',
      text: 'will not reach gateway',
      idempotencyKey: 'idem-failed-send',
      at: 1000,
    });

    const failedPatch = runtime.failOptimisticUserMessage({
      sessionKey: 'agent:failed-send:main',
      idempotencyKey: 'idem-failed-send',
      error: 'chat.send failed: gateway unavailable',
      at: 1001,
    });
    const snapshot = runtime.snapshot('agent:failed-send:main', 'manual');

    expect(failedPatch.ops).toEqual(expect.arrayContaining([
      expect.objectContaining({
        op: 'upsert_turn',
        turn: expect.objectContaining({ status: 'failed' }),
      }),
      expect.objectContaining({
        op: 'upsert_item',
        item: expect.objectContaining({
          kind: 'user_message',
          idempotencyKey: 'idem-failed-send',
          pending: false,
          status: 'failed',
        }),
      }),
    ]));
    expect(snapshot.timeline.turns).toMatchObject([
      { runId: 'optimistic:idempotency:idem-failed-send', status: 'failed' },
    ]);
    expect(userItemsFromSnapshot(snapshot)).toMatchObject([
      {
        idempotencyKey: 'idem-failed-send',
        pending: false,
        status: 'failed',
      },
    ]);
  });

  it('delegates subscribe, replayAfter, and snapshot behavior to the store', () => {
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 10,
      rpc: async () => ({ messages: [] }),
    });
    const receivedPatches: TimelinePatch[] = [];

    runtime.subscribe('agent:delegated:main', (patch) => receivedPatches.push(patch));
    const patch = runtime.applyOptimisticUserMessage({
      sessionKey: 'agent:delegated:main',
      text: 'delegated user message',
      idempotencyKey: 'idem-delegated',
      at: 9000,
    });

    expect(receivedPatches).toEqual([patch]);
    const replay = runtime.replayAfter('agent:delegated:main', '0');
    expect(replay.kind).toBe('patches');
    if (replay.kind !== 'patches') throw new Error('expected patch replay');
    expect(replay.patches).toEqual([patch]);
    expect(runtime.snapshot('agent:delegated:main', 'manual')).toMatchObject({
      cursor: patch.cursor,
      timeline: {
        sessionKey: 'agent:delegated:main',
        items: expect.any(Object),
      },
    });
  });

  it('dedupes a second applyOptimisticUserMessage with the same idempotencyKey when rebinding to a runId', () => {
    // The chat-runtime route calls applyOptimisticUserMessage twice with the same idempotencyKey:
    // once before chat.send (no runId) to seed the optimistic bubble, and once after chat.send
    // returns to rebind the message to the real runId. The reducer dedupes by idempotencyKey —
    // the second call updates the existing item in place rather than creating a duplicate.
    const runtime = new ChatRuntime({
      maxPatchesPerSession: 16,
      rpc: async () => ({ messages: [] }),
    });
    const sessionKey = 'agent:main:main';

    runtime.applyOptimisticUserMessage({
      sessionKey,
      text: 'hello',
      idempotencyKey: 'idem-1',
      at: 1000,
    });
    runtime.applyOptimisticUserMessage({
      sessionKey,
      text: 'hello',
      idempotencyKey: 'idem-1',
      runId: 'run-1',
      at: 1001,
    });

    const snapshot = runtime.snapshot(sessionKey, 'live');
    const userMessages = Object.values(snapshot.timeline.items).filter((item) => item.kind === 'user_message');
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toMatchObject({
      kind: 'user_message',
      text: 'hello',
      idempotencyKey: 'idem-1',
      runId: 'run-1',
    });
  });
});
