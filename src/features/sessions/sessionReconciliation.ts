import type { Session } from '@/types';
import { getSessionKey } from '@/types';
import {
  getExplicitParentCandidates,
  getRootAgentSessionKey,
  isCronRunSessionKey,
  isCronSessionKey,
  isTopLevelAgentSessionKey,
} from './sessionKeys';

const LIVE_SUPPLEMENTAL_STATES = new Set([
  'busy',
  'delta',
  'pending',
  'processing',
  'queued',
  'running',
  'started',
  'streaming',
  'thinking',
  'tool_use',
  'working',
]);

const TERMINAL_SUPPLEMENTAL_STATES = new Set([
  'aborted',
  'archived',
  'cancelled',
  'canceled',
  'completed',
  'deleted',
  'done',
  'ended',
  'error',
  'failed',
  'final',
  'finished',
  'idle',
  'stopped',
  'timeout',
]);

function normalizedState(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isLiveSupplementalSession(session: Session): boolean {
  if (session.busy || session.processing) return true;

  const states = [
    normalizedState(session.state),
    normalizedState(session.agentState),
    normalizedState(session.status),
  ].filter(Boolean);

  if (states.some((state) => LIVE_SUPPLEMENTAL_STATES.has(state))) return true;
  if (states.some((state) => TERMINAL_SUPPLEMENTAL_STATES.has(state))) return false;
  return false;
}

function hasConfirmedParent(session: Session, confirmedKeys: Set<string>): boolean {
  return getExplicitParentCandidates(session).some((parentKey) => confirmedKeys.has(parentKey));
}

function isSessionEligibleWithoutSpawnedConfirmation(session: Session): boolean {
  const key = getSessionKey(session);
  if (!key) return false;
  if (isTopLevelAgentSessionKey(key)) return true;
  if (isCronSessionKey(key) || isCronRunSessionKey(key)) return true;
  return isLiveSupplementalSession(session);
}

export interface MergeAuthoritativeSessionsOptions {
  /**
   * True when spawnedBy calls succeeded and can be treated as the current child
   * source of truth. When every spawnedBy call fails, callers should leave this
   * false so an RPC outage does not wipe the sidebar down to roots.
   */
  spawnedByAuthoritative?: boolean;
  authoritativeSpawnedByRoots?: Set<string>;
}

export function mergeAuthoritativeSessions(
  baseSessions: Session[],
  spawnedSessionLists: Session[][],
  options: MergeAuthoritativeSessionsOptions = {},
): Session[] {
  const spawnedKeys = new Set<string>();
  for (const spawnedSessions of spawnedSessionLists) {
    for (const session of spawnedSessions) {
      const key = getSessionKey(session);
      if (key) spawnedKeys.add(key);
    }
  }

  const spawnedByAuthoritative = options.spawnedByAuthoritative ?? spawnedSessionLists.length > 0;
  const authoritativeSpawnedByRoots = options.authoritativeSpawnedByRoots;
  const baseSessionsToKeep = spawnedByAuthoritative
    ? baseSessions.filter((session) => {
        const key = getSessionKey(session);
        if (!key) return false;
        if (isSessionEligibleWithoutSpawnedConfirmation(session)) return true;
        if (spawnedKeys.has(key)) return true;
        if (hasConfirmedParent(session, spawnedKeys)) return true;

        const rootKey = getRootAgentSessionKey(key);
        if (rootKey && authoritativeSpawnedByRoots && !authoritativeSpawnedByRoots.has(rootKey)) return true;
        return Boolean(rootKey && spawnedKeys.has(rootKey));
      })
    : baseSessions;

  const merged = [...baseSessionsToKeep];
  const seen = new Set(baseSessionsToKeep.map(getSessionKey).filter(Boolean));

  for (const spawnedSessions of spawnedSessionLists) {
    for (const session of spawnedSessions) {
      const key = getSessionKey(session);
      if (!key || seen.has(key)) continue;
      if (!isLiveSupplementalSession(session)) continue;
      seen.add(key);
      merged.push(session);
    }
  }

  return merged;
}
