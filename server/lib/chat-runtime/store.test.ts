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
    let runtime!: ChatRuntime;
    runtime = new ChatRuntime({
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
    let runtime!: ChatRuntime;
    runtime = new ChatRuntime({
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
});
