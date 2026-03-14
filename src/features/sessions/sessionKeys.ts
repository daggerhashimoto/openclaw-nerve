import type { Session } from '@/types';
import { getSessionKey } from '@/types';

const ROOT_AGENT_RE = /^agent:([^:]+):main$/;
const SUBAGENT_RE = /^((?:agent:[^:]+)):subagent:.+$/;
const CRON_RE = /^((?:agent:[^:]+)):cron:[^:]+$/;
const CRON_RUN_RE = /^(.+:cron:[^:]+):run:.+$/;

export type SessionType = 'main' | 'subagent' | 'cron' | 'cron-run';

function slugifyPart(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const slug = trimmed
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug || 'agent';
}

export function getSessionType(sessionKey: string): SessionType {
  if (CRON_RUN_RE.test(sessionKey)) return 'cron-run';
  if (CRON_RE.test(sessionKey)) return 'cron';
  if (SUBAGENT_RE.test(sessionKey)) return 'subagent';
  return 'main';
}

export function isTopLevelAgentSessionKey(sessionKey: string): boolean {
  return ROOT_AGENT_RE.test(sessionKey);
}

export function isSubagentSessionKey(sessionKey: string): boolean {
  return SUBAGENT_RE.test(sessionKey);
}

export function isCronSessionKey(sessionKey: string): boolean {
  return CRON_RE.test(sessionKey);
}

export function isCronRunSessionKey(sessionKey: string): boolean {
  return CRON_RUN_RE.test(sessionKey);
}

export function getRootAgentId(sessionKey: string): string | null {
  const rootMatch = sessionKey.match(ROOT_AGENT_RE);
  if (rootMatch) return rootMatch[1];

  const subagentMatch = sessionKey.match(SUBAGENT_RE);
  if (subagentMatch) return subagentMatch[1].split(':')[1] ?? null;

  const cronMatch = sessionKey.match(CRON_RE);
  if (cronMatch) return cronMatch[1].split(':')[1] ?? null;

  const cronRunMatch = sessionKey.match(/^((?:agent:[^:]+)):cron:[^:]+:run:.+$/);
  if (cronRunMatch) return cronRunMatch[1].split(':')[1] ?? null;

  return null;
}

export function getRootAgentSessionKey(sessionKey: string): string | null {
  const rootId = getRootAgentId(sessionKey);
  return rootId ? `agent:${rootId}:main` : null;
}

export function inferParentSessionKey(sessionKey: string): string | null {
  const cronRunMatch = sessionKey.match(CRON_RUN_RE);
  if (cronRunMatch) return cronRunMatch[1];

  const subagentMatch = sessionKey.match(SUBAGENT_RE);
  if (subagentMatch) return `${subagentMatch[1]}:main`;

  const cronMatch = sessionKey.match(CRON_RE);
  if (cronMatch) return `${cronMatch[1]}:main`;

  return null;
}

export function resolveParentSessionKey(session: Session, knownKeys?: Set<string>): string | null {
  const sessionKey = getSessionKey(session);
  if (!sessionKey) return null;

  if (session.parentId) {
    if (!knownKeys || knownKeys.has(session.parentId)) return session.parentId;
  }

  const inferred = inferParentSessionKey(sessionKey);
  if (!inferred) return null;
  if (!knownKeys || knownKeys.has(inferred)) return inferred;
  return null;
}

export function isSessionDescendantOf(sessionKey: string, ancestorKey: string): boolean {
  let current = inferParentSessionKey(sessionKey);
  while (current) {
    if (current === ancestorKey) return true;
    current = inferParentSessionKey(current);
  }
  return false;
}

export function isRootChildSession(sessionKey: string, rootSessionKey: string): boolean {
  return getRootAgentSessionKey(sessionKey) === rootSessionKey && sessionKey !== rootSessionKey;
}

export function getTopLevelAgentSessions(sessions: Session[]): Session[] {
  return sessions
    .filter((session) => isTopLevelAgentSessionKey(getSessionKey(session)))
    .sort((a, b) => {
      const keyA = getSessionKey(a);
      const keyB = getSessionKey(b);
      if (keyA === 'agent:main:main') return -1;
      if (keyB === 'agent:main:main') return 1;

      const labelA = (a.displayName || a.label || keyA).toLowerCase();
      const labelB = (b.displayName || b.label || keyB).toLowerCase();
      return labelA.localeCompare(labelB);
    });
}

export function getSessionDisplayLabel(session: Session, agentName = 'Agent'): string {
  const sessionKey = getSessionKey(session);

  if (session.label?.trim()) return session.label.trim();
  if (session.displayName?.trim()) return session.displayName.trim();

  if (isTopLevelAgentSessionKey(sessionKey)) {
    const rootId = getRootAgentId(sessionKey);
    if (rootId === 'main') return `${agentName} (main)`;
    if (rootId) return `Agent ${rootId}`;
  }

  if (isCronSessionKey(sessionKey)) {
    return `Cron ${sessionKey.split(':')[3]?.slice(0, 8) || ''}`.trim();
  }

  if (isCronRunSessionKey(sessionKey)) {
    return `Run ${sessionKey.split(':').pop()?.slice(0, 8) || ''}`.trim();
  }

  if (isSubagentSessionKey(sessionKey)) {
    return `Subagent ${sessionKey.split(':').pop()?.slice(0, 8) || ''}`.trim();
  }

  return sessionKey.split(':').pop() || sessionKey;
}

export function pickDefaultSessionKey(sessions: Session[], preferredKey?: string): string {
  if (preferredKey && sessions.some((session) => getSessionKey(session) === preferredKey)) {
    return preferredKey;
  }

  const topLevelAgents = getTopLevelAgentSessions(sessions);
  if (topLevelAgents.length > 0) {
    return getSessionKey(topLevelAgents[0]);
  }

  if (sessions.length > 0) {
    return getSessionKey(sessions[0]);
  }

  return '';
}

export function buildAgentRootSessionKey(
  name: string,
  existingKeys: Iterable<string>,
): string {
  const baseId = slugifyPart(name);
  const existing = new Set(existingKeys);

  let candidate = `agent:${baseId}:main`;
  if (!existing.has(candidate)) return candidate;

  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `agent:${baseId}-${suffix}:main`;
    suffix += 1;
  }

  return candidate;
}
