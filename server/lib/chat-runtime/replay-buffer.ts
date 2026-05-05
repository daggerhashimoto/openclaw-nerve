import type { TimelinePatch, TimelinePatchOp } from './types.js';

export type ReplayResult =
  | { kind: 'snapshot_required' }
  | { kind: 'patches'; patches: TimelinePatch[] };

interface ReplayBufferOptions {
  maxPatchesPerSession: number;
}

interface SessionReplayLog {
  nextCursor: number;
  patches: TimelinePatch[];
}

export class ReplayBuffer {
  private readonly maxPatchesPerSession: number;
  private readonly sessions = new Map<string, SessionReplayLog>();

  constructor(options: ReplayBufferOptions) {
    if (!Number.isSafeInteger(options.maxPatchesPerSession) || options.maxPatchesPerSession <= 0) {
      throw new RangeError('ReplayBuffer maxPatchesPerSession must be a positive safe integer');
    }

    this.maxPatchesPerSession = options.maxPatchesPerSession;
  }

  append(sessionKey: string, ops: TimelinePatchOp[], createdAt = Date.now()): TimelinePatch {
    const log = this.getOrCreateLog(sessionKey);
    const cursor = String(log.nextCursor);
    log.nextCursor += 1;

    const patch: TimelinePatch = {
      sessionKey,
      cursor,
      ops: cloneTimelinePatchOps(ops),
      createdAt,
    };

    log.patches.push(patch);
    if (log.patches.length > this.maxPatchesPerSession) {
      log.patches.splice(0, log.patches.length - this.maxPatchesPerSession);
    }

    return cloneTimelinePatch(patch);
  }

  replayAfter(sessionKey: string, cursor?: string | null): ReplayResult {
    if (!cursor) return { kind: 'snapshot_required' };

    const log = this.sessions.get(sessionKey);
    if (!log) {
      return cursor === '0'
        ? { kind: 'patches', patches: [] }
        : { kind: 'snapshot_required' };
    }

    if (cursor === '0') {
      const firstRetainedCursor = log.patches[0]?.cursor;
      if (!firstRetainedCursor || firstRetainedCursor === '1') {
        return { kind: 'patches', patches: cloneTimelinePatches(log.patches) };
      }

      return { kind: 'snapshot_required' };
    }

    const cursorIndex = log.patches.findIndex((patch) => patch.cursor === cursor);
    if (cursorIndex === -1) return { kind: 'snapshot_required' };

    return {
      kind: 'patches',
      patches: cloneTimelinePatches(log.patches.slice(cursorIndex + 1)),
    };
  }

  latestCursor(sessionKey: string): string {
    const log = this.sessions.get(sessionKey);
    if (!log) return '0';
    return String(log.nextCursor - 1);
  }

  private getOrCreateLog(sessionKey: string): SessionReplayLog {
    const existing = this.sessions.get(sessionKey);
    if (existing) return existing;

    const log: SessionReplayLog = {
      nextCursor: 1,
      patches: [],
    };
    this.sessions.set(sessionKey, log);
    return log;
  }
}

function cloneTimelinePatch(patch: TimelinePatch): TimelinePatch {
  return structuredClone(patch);
}

function cloneTimelinePatches(patches: TimelinePatch[]): TimelinePatch[] {
  return structuredClone(patches);
}

function cloneTimelinePatchOps(ops: TimelinePatchOp[]): TimelinePatchOp[] {
  return structuredClone(ops);
}
