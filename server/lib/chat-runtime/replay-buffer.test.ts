import { describe, expect, it, vi } from 'vitest';
import { ReplayBuffer } from './replay-buffer.js';
import type { TimelinePatch, TimelinePatchOp, TimelineTurn } from './types.js';

function hydrationOp(state: Extract<TimelinePatchOp, { op: 'set_hydration_state' }>['state'] = 'ready'): TimelinePatchOp {
  return { op: 'set_hydration_state', state };
}

function expectPatchReplay(result: ReturnType<ReplayBuffer['replayAfter']>) {
  expect(result.kind).toBe('patches');
  if (result.kind !== 'patches') throw new Error('expected patch replay');
  return result.patches;
}

function turnOp(runId: string): Extract<TimelinePatchOp, { op: 'upsert_turn' }> {
  const turn: TimelineTurn = {
    id: `turn:agent:main:main:${runId}`,
    sessionKey: 'agent:main:main',
    runId,
    status: 'running',
    startedAt: 1000,
    inputItemIds: [],
    outputItemIds: [],
    orderBase: { turn: 0, block: 0, sub: 0 },
  };
  return { op: 'upsert_turn', turn };
}

function turnRunIds(patch: TimelinePatch): string[] {
  return patch.ops
    .filter((op): op is Extract<TimelinePatchOp, { op: 'upsert_turn' }> => op.op === 'upsert_turn')
    .map((op) => op.turn.runId);
}

describe('ReplayBuffer', () => {
  it('rejects invalid retention limits', () => {
    for (const maxPatchesPerSession of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new ReplayBuffer({ maxPatchesPerSession })).toThrow(RangeError);
      expect(() => new ReplayBuffer({ maxPatchesPerSession })).toThrow('positive safe integer');
    }
  });

  it('uses Date.now as the default patch createdAt timestamp', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-05T10:30:00.000Z'));
      const buffer = new ReplayBuffer({ maxPatchesPerSession: 3 });

      expect(buffer.append('agent:main:main', [hydrationOp('ready')]).createdAt).toBe(Date.now());
    } finally {
      vi.useRealTimers();
    }
  });

  it('replays retained patches after cursor', () => {
    const buffer = new ReplayBuffer({ maxPatchesPerSession: 3 });
    const first = buffer.append('agent:main:main', [hydrationOp('cold')], 1000);
    const second = buffer.append('agent:main:main', [hydrationOp('hydrating')], 1001);
    const third = buffer.append('agent:main:main', [hydrationOp('ready')], 1002);

    expect([first.cursor, second.cursor, third.cursor]).toEqual(['1', '2', '3']);
    expect(expectPatchReplay(buffer.replayAfter('agent:main:main', first.cursor))).toEqual([second, third]);
  });

  it('replays from cursor 0 while the first patch is still retained', () => {
    const buffer = new ReplayBuffer({ maxPatchesPerSession: 3 });
    const first = buffer.append('agent:main:main', [hydrationOp('cold')], 1000);
    const second = buffer.append('agent:main:main', [hydrationOp('ready')], 1001);

    expect(expectPatchReplay(buffer.replayAfter('agent:main:main', '0'))).toEqual([first, second]);
  });

  it('requires a snapshot from cursor 0 once the first patch has expired', () => {
    const buffer = new ReplayBuffer({ maxPatchesPerSession: 1 });
    buffer.append('agent:main:main', [hydrationOp('cold')], 1000);
    buffer.append('agent:main:main', [hydrationOp('ready')], 1001);

    expect(buffer.replayAfter('agent:main:main', '0')).toEqual({ kind: 'snapshot_required' });
  });

  it('returns no patches when replaying after the latest cursor', () => {
    const buffer = new ReplayBuffer({ maxPatchesPerSession: 3 });
    buffer.append('agent:main:main', [hydrationOp('cold')], 1000);
    const latest = buffer.append('agent:main:main', [hydrationOp('ready')], 1001);

    expect(expectPatchReplay(buffer.replayAfter('agent:main:main', latest.cursor))).toEqual([]);
  });

  it('requires a snapshot for absent, unknown, or expired cursors', () => {
    const buffer = new ReplayBuffer({ maxPatchesPerSession: 2 });
    buffer.append('agent:main:main', [hydrationOp('cold')], 1000);
    buffer.append('agent:main:main', [hydrationOp('hydrating')], 1001);
    buffer.append('agent:main:main', [hydrationOp('ready')], 1002);

    expect(buffer.replayAfter('agent:main:main')).toEqual({ kind: 'snapshot_required' });
    expect(buffer.replayAfter('agent:main:main', null)).toEqual({ kind: 'snapshot_required' });
    expect(buffer.replayAfter('agent:main:main', 'missing')).toEqual({ kind: 'snapshot_required' });
    expect(buffer.replayAfter('agent:main:main', '1')).toEqual({ kind: 'snapshot_required' });
  });

  it('does not let append return values or input ops mutate stored patches', () => {
    const buffer = new ReplayBuffer({ maxPatchesPerSession: 3 });
    buffer.append('agent:main:main', [hydrationOp('cold')], 1000);
    const op = turnOp('run-2');
    const appended = buffer.append('agent:main:main', [op], 1001);

    op.turn.runId = 'mutated-input';
    const returnedTurnOp = appended.ops.find((candidate): candidate is Extract<TimelinePatchOp, { op: 'upsert_turn' }> =>
      candidate.op === 'upsert_turn',
    );
    if (!returnedTurnOp) throw new Error('expected turn op');
    returnedTurnOp.turn.runId = 'mutated-return';

    const replayed = expectPatchReplay(buffer.replayAfter('agent:main:main', '1'));
    expect(replayed.map(turnRunIds)).toEqual([['run-2']]);
  });

  it('does not let replay consumers mutate stored patches', () => {
    const buffer = new ReplayBuffer({ maxPatchesPerSession: 3 });
    buffer.append('agent:main:main', [hydrationOp('cold')], 1000);
    buffer.append('agent:main:main', [turnOp('run-2')], 1001);

    const firstReplay = expectPatchReplay(buffer.replayAfter('agent:main:main', '1'));
    const replayedTurnOp = firstReplay[0].ops.find((op): op is Extract<TimelinePatchOp, { op: 'upsert_turn' }> =>
      op.op === 'upsert_turn',
    );
    if (!replayedTurnOp) throw new Error('expected turn op');
    replayedTurnOp.turn.runId = 'mutated-replay';

    const secondReplay = expectPatchReplay(buffer.replayAfter('agent:main:main', '1'));
    expect(secondReplay.map(turnRunIds)).toEqual([['run-2']]);
  });

  it('uses independent cursor counters per session and does not replay another session patches', () => {
    const buffer = new ReplayBuffer({ maxPatchesPerSession: 5 });
    const sessionAFirst = buffer.append('agent:a:main', [hydrationOp('cold')], 1000);
    const sessionBFirst = buffer.append('agent:b:main', [hydrationOp('hydrating')], 1001);
    const sessionASecond = buffer.append('agent:a:main', [hydrationOp('ready')], 1002);

    expect([sessionAFirst.cursor, sessionBFirst.cursor, sessionASecond.cursor]).toEqual(['1', '1', '2']);
    expect(expectPatchReplay(buffer.replayAfter('agent:a:main', sessionAFirst.cursor))).toEqual([sessionASecond]);
    expect(expectPatchReplay(buffer.replayAfter('agent:b:main', sessionBFirst.cursor))).toEqual([]);
  });

  it('returns latest cursor for seen sessions and 0 for unseen sessions', () => {
    const buffer = new ReplayBuffer({ maxPatchesPerSession: 2 });

    expect(buffer.latestCursor('agent:missing:main')).toBe('0');

    buffer.append('agent:main:main', [hydrationOp('cold')], 1000);
    expect(buffer.latestCursor('agent:main:main')).toBe('1');

    buffer.append('agent:main:main', [hydrationOp('ready')], 1001);
    expect(buffer.latestCursor('agent:main:main')).toBe('2');
    expect(buffer.latestCursor('agent:missing:main')).toBe('0');
  });
});
