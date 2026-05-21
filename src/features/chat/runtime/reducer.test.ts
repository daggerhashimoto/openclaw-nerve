import { describe, expect, it } from 'vitest';
import {
  applyTimelinePatch,
  applyTimelineSnapshot,
  createEmptyRuntimeTimelineState,
  orderedTimelineItems,
} from './reducer';
import type {
  TimelinePatch,
  TimelineSnapshot,
  TimelineTurn,
  UserTimelineItem,
} from './types';

describe('chat runtime client reducer', () => {
  it('applies patches idempotently and ignores stale cursors', () => {
    const state = createEmptyRuntimeTimelineState('session-1');
    const turn = makeTurn('session-1', 'run-1', 0);
    const firstUser = makeUserItem('session-1', turn, 'user-1', 'first', 1);
    const replacementUser = makeUserItem('session-1', turn, 'user-1', 'stale replacement', 2);

    const afterFirst = applyTimelinePatch(state, {
      sessionKey: 'session-1',
      cursor: '2',
      createdAt: 2,
      ops: [
        { op: 'upsert_turn', turn },
        { op: 'upsert_item', item: firstUser },
      ],
    });

    const afterStale = applyTimelinePatch(afterFirst, {
      sessionKey: 'session-1',
      cursor: '2',
      createdAt: 3,
      ops: [{ op: 'upsert_item', item: replacementUser }],
    });

    expect(afterStale).toBe(afterFirst);
    expect(afterStale.timeline.items['user-1']).toMatchObject({ text: 'first' });
  });

  it('removes stale turns and their items from replacement patches', () => {
    const state = createEmptyRuntimeTimelineState('session-1');
    const turn = makeTurn('session-1', 'run-1', 0);
    const user = makeUserItem('session-1', turn, 'user-1', 'stale user', 1);

    const withTurn = applyTimelinePatch(state, {
      sessionKey: 'session-1',
      cursor: '1',
      createdAt: 1,
      ops: [
        { op: 'upsert_turn', turn },
        { op: 'upsert_item', item: user },
      ],
    });
    const afterRemoval = applyTimelinePatch(withTurn, {
      sessionKey: 'session-1',
      cursor: '2',
      createdAt: 2,
      ops: [{ op: 'remove_turn', id: turn.id, reason: 'compaction' }],
    });

    expect(afterRemoval.timeline.turns).toEqual([]);
    expect(afterRemoval.timeline.items).toEqual({});
  });

  it('applies lightweight run binding patches without replacing user media', () => {
    const state = createEmptyRuntimeTimelineState('session-1');
    const turn = makeTurn('session-1', 'optimistic:idempotency:idem-1', 0);
    const user = {
      ...makeUserItem('session-1', turn, 'user-1', 'hello', 1),
      idempotencyKey: 'idem-1',
      images: [{
        mimeType: 'image/png',
        content: 'base64-image',
        preview: 'data:image/png;base64,base64-image',
        name: 'image.png',
      }],
    };

    const afterOptimistic = applyTimelinePatch(state, {
      sessionKey: 'session-1',
      cursor: '1',
      createdAt: 1,
      ops: [
        { op: 'upsert_turn', turn },
        { op: 'upsert_item', item: user },
      ],
    });
    const afterBind = applyTimelinePatch(afterOptimistic, {
      sessionKey: 'session-1',
      cursor: '2',
      createdAt: 2,
      ops: [{
        op: 'bind_user_message_run',
        idempotencyKey: 'idem-1',
        runId: 'run-real',
        at: 2,
      }],
    });

    expect(afterBind.timeline.turns[0]).toMatchObject({ runId: 'run-real' });
    expect(afterBind.timeline.items['user-1']).toMatchObject({
      runId: 'run-real',
      images: user.images,
    });
  });

  it('replaces the timeline from snapshots and preserves server ordering', () => {
    const state = createEmptyRuntimeTimelineState('session-1');
    const turnA = makeTurn('session-1', 'run-a', 1);
    const turnB = makeTurn('session-1', 'run-b', 0);
    const stalePatch = makePatch('session-1', '5', []);
    const snapshot: TimelineSnapshot = {
      type: 'snapshot',
      sessionKey: 'session-1',
      cursor: '10',
      reason: 'manual',
      timeline: {
        sessionKey: 'session-1',
        version: 10,
        cursor: '10',
        hydrationState: 'ready',
        turns: [turnA, turnB],
        items: {
          'user-a': makeUserItem('session-1', turnA, 'user-a', 'later', 101),
          'user-b': makeUserItem('session-1', turnB, 'user-b', 'earlier', 100),
        },
        updatedAt: 101,
      },
    };

    const afterStale = applyTimelinePatch(state, stalePatch);
    const afterSnapshot = applyTimelineSnapshot(afterStale, snapshot);

    expect(afterSnapshot.cursor).toBe('10');
    expect(afterSnapshot.timeline.hydrationState).toBe('ready');
    expect(orderedTimelineItems(afterSnapshot.timeline).map((item) => item.id)).toEqual(['user-b', 'user-a']);
  });

  it('ignores stale snapshots after newer live patches', () => {
    const state = createEmptyRuntimeTimelineState('session-1');
    const turn = makeTurn('session-1', 'run-1', 0);
    const freshUser = makeUserItem('session-1', turn, 'user-1', 'fresh live patch', 10);
    const staleUser = makeUserItem('session-1', turn, 'user-1', 'stale snapshot', 5);

    const afterPatch = applyTimelinePatch(state, {
      sessionKey: 'session-1',
      cursor: '10',
      createdAt: 10,
      ops: [
        { op: 'upsert_turn', turn },
        { op: 'upsert_item', item: freshUser },
      ],
    });

    const afterSnapshot = applyTimelineSnapshot(afterPatch, {
      type: 'snapshot',
      sessionKey: 'session-1',
      cursor: '5',
      reason: 'hydration',
      timeline: {
        sessionKey: 'session-1',
        version: 5,
        cursor: '5',
        hydrationState: 'ready',
        turns: [turn],
        items: { 'user-1': staleUser },
        updatedAt: 5,
      },
    });

    expect(afterSnapshot).toBe(afterPatch);
    expect(afterSnapshot.cursor).toBe('10');
    expect(afterSnapshot.timeline.items['user-1']).toMatchObject({ text: 'fresh live patch' });
  });

  it('preserves unchanged timeline item references and ordered indexes across patches', () => {
    const state = createEmptyRuntimeTimelineState('session-1');
    const turnA = makeTurn('session-1', 'run-a', 0);
    const turnB = makeTurn('session-1', 'run-b', 1);
    const initial = applyTimelinePatch(state, {
      sessionKey: 'session-1',
      cursor: '1',
      createdAt: 1,
      ops: [
        { op: 'upsert_turn', turn: turnA },
        { op: 'upsert_turn', turn: turnB },
        { op: 'upsert_item', item: makeUserItem('session-1', turnA, 'user-a', 'first', 1) },
        { op: 'upsert_item', item: makeUserItem('session-1', turnB, 'user-b', 'second', 2) },
      ],
    });
    const unchanged = initial.timeline.items['user-a'];
    const changedBefore = initial.timeline.items['user-b'];

    const afterPatch = applyTimelinePatch(initial, {
      sessionKey: 'session-1',
      cursor: '2',
      createdAt: 2,
      ops: [
        { op: 'upsert_item', item: makeUserItem('session-1', turnB, 'user-b', 'second updated', 3) },
      ],
    });

    expect(afterPatch.timeline.items['user-a']).toBe(unchanged);
    expect(afterPatch.timeline.items['user-b']).not.toBe(changedBefore);
    expect(afterPatch.timeline.items['user-b']).toMatchObject({ text: 'second updated' });
    expect(orderedTimelineItems(afterPatch.timeline).map((item) => item.id)).toEqual(['user-a', 'user-b']);
    expect(afterPatch.timeline.itemsByTurnId?.[turnA.id].map((item) => item.id)).toEqual(['user-a']);
    expect(afterPatch.timeline.itemsByTurnId?.[turnB.id].map((item) => item.id)).toEqual(['user-b']);
  });
});

function makePatch(sessionKey: string, cursor: string, ops: TimelinePatch['ops']): TimelinePatch {
  return { sessionKey, cursor, ops, createdAt: Number(cursor) || 0 };
}

function makeTurn(sessionKey: string, runId: string, turnIndex: number): TimelineTurn {
  return {
    id: `turn:${runId}`,
    sessionKey,
    runId,
    status: 'running',
    startedAt: 1_775_000_000_000 + turnIndex,
    inputItemIds: [],
    outputItemIds: [],
    orderBase: { turn: turnIndex, block: 0, sub: 0 },
  };
}

function makeUserItem(
  sessionKey: string,
  turn: TimelineTurn,
  id: string,
  text: string,
  at: number,
): UserTimelineItem {
  return {
    id,
    sessionKey,
    turnId: turn.id,
    runId: turn.runId,
    kind: 'user_message',
    text,
    orderKey: { turn: turn.orderBase.turn, block: 0, sub: 0 },
    createdAt: 1_775_000_000_000 + at,
    updatedAt: 1_775_000_000_000 + at,
    status: 'complete',
    source: 'history',
    pending: false,
  };
}
