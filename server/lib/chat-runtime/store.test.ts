import { describe, expect, it } from 'vitest';
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
