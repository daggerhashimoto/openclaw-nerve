import type { ChatSendStatus } from './sendMessage';

export type RecoveryReason = 'frame-gap' | 'chat-gap' | 'reconnect' | 'unrenderable-final' | 'subagent-complete';

export interface RunState {
  runId: string;
  sessionKey: string;
  startedAt: number;
  lastChatSeq: number | null;
  lastFrameSeq: number | null;
  /** Raw (uncleaned) delta text — preserved for debugging */
  bufferRaw: string;
  /** Cleaned delta text (TTS/chart markers stripped) — used for display */
  bufferText: string;
  finalized: boolean;
  status?: ChatSendStatus;
  stopReason?: string;
}

const FALLBACK_RUN_PREFIX = 'run-local';

export function createFallbackRunId(sessionKey: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${FALLBACK_RUN_PREFIX}:${sessionKey}:${Date.now()}:${rand}`;
}

export function hasSeqGap(lastSeq: number | null, nextSeq?: number): boolean {
  if (typeof nextSeq !== 'number') return false;
  if (lastSeq === null) return false;
  return nextSeq > lastSeq + 1;
}

export function updateHighestSeq(lastSeq: number | null, nextSeq?: number): number | null {
  if (typeof nextSeq !== 'number') return lastSeq;
  if (lastSeq === null) return nextSeq;
  return nextSeq > lastSeq ? nextSeq : lastSeq;
}

export function getOrCreateRunState(
  runs: Map<string, RunState>,
  runId: string,
  sessionKey: string,
): RunState {
  const existing = runs.get(runId);
  if (existing) return existing;

  const run: RunState = {
    runId,
    sessionKey,
    startedAt: Date.now(),
    lastChatSeq: null,
    lastFrameSeq: null,
    bufferRaw: '',
    bufferText: '',
    finalized: false,
  };
  runs.set(runId, run);
  return run;
}

/**
 * Resolve the run ID for an incoming event.
 * Returns null when no runId is provided AND no active run exists,
 * preventing phantom run entries from accumulating.
 */
export function resolveRunId(
  runId: string | undefined,
  activeRunId: string | null,
): string | null {
  if (runId) return runId;
  if (activeRunId) return activeRunId;
  return null;
}

const STALE_RUN_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETAINED_FINALIZED_RUNS = 24;

export function pruneRunRegistry(runs: Map<string, RunState>, activeRunId: string | null): void {
  const now = Date.now();

  // Prune orphan runs: non-finalized runs older than STALE_RUN_MS that aren't the active run.
  // These are runs that started but never received a final/abort/error event.
  for (const [id, run] of runs) {
    if (id === activeRunId) continue;
    if (!run.finalized && now - run.startedAt > STALE_RUN_MS) {
      runs.delete(id);
    }
  }

  // Prune excess finalized runs (keep at most MAX_RETAINED_FINALIZED_RUNS).
  const finalized = [...runs.values()]
    .filter(run => run.finalized && run.runId !== activeRunId)
    .sort((a, b) => b.startedAt - a.startedAt);

  for (const run of finalized.slice(MAX_RETAINED_FINALIZED_RUNS)) {
    runs.delete(run.runId);
  }
}
