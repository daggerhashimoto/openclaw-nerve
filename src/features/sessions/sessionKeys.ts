import type { Session } from '@/types';
import { getSessionKey } from '@/types';

const ROOT_AGENT_RE = /^agent:([^:]+):main$/;
const SUBAGENT_RE = /^((?:agent:[^:]+)):subagent:.+$/;
const CRON_RE = /^((?:agent:[^:]+)):cron:[^:]+$/;
const CRON_RUN_RE = /^(.+:cron:[^:]+):run:.+$/;
const DIRECT_RE = /^((?:agent:[^:]+))(?::[^:]+)*:direct:.+$/;
const CHANNEL_RE = /^((?:agent:[^:]+))(?::[^:]+)*:channel:.+$/;

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

  const directMatch = sessionKey.match(DIRECT_RE);
  if (directMatch) return directMatch[1].split(':')[1] ?? null;

  const channelMatch = sessionKey.match(CHANNEL_RE);
  if (channelMatch) return channelMatch[1].split(':')[1] ?? null;

  return null;
}

/**
 * The agent any agent-scoped key belongs to (`agent:<id>:...`), including session kinds
 * getRootAgentId does not know. Removing an agent uses it to find everything that was its.
 */
export function getSessionAgentId(sessionKey: string): string | null {
  return sessionKey.match(/^agent:([^:]+):/)?.[1] ?? null;
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

  const directMatch = sessionKey.match(DIRECT_RE);
  if (directMatch) return `${directMatch[1]}:main`;

  const channelMatch = sessionKey.match(CHANNEL_RE);
  if (channelMatch) return `${channelMatch[1]}:main`;

  return null;
}

export function getExplicitParentCandidates(session: Session | undefined): string[] {
  const candidates: string[] = [];

  const parentSessionKey = typeof session?.parentSessionKey === 'string'
    ? session.parentSessionKey.trim()
    : '';
  if (parentSessionKey) candidates.push(parentSessionKey);

  const parentId = typeof session?.parentId === 'string'
    ? session.parentId.trim()
    : '';
  if (parentId && parentId !== parentSessionKey) candidates.push(parentId);

  return candidates;
}

export function resolveParentSessionKey(session: Session, knownKeys?: Set<string>): string | null {
  const sessionKey = getSessionKey(session);
  if (!sessionKey) return null;

  for (const explicitParent of getExplicitParentCandidates(session)) {
    if (!knownKeys || knownKeys.has(explicitParent)) return explicitParent;
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

export function extractIdentityName(content: string): string | null {
  const normalized = content.replace(/\*\*/g, '');
  const match = normalized.match(/^\s*(?:[-*]\s*)?Name\s*:\s*(.+?)\s*$/im);
  return match?.[1]?.trim() || null;
}

export function getSessionDisplayLabel(session: Session, agentName = 'Agent'): string {
  const sessionKey = getSessionKey(session);
  const rootId = getRootAgentId(sessionKey);
  const identityName = session.identityName?.trim();
  const explicitLabel = session.label?.trim();

  if (sessionKey === 'agent:main:main') {
    const normalized = explicitLabel?.toLowerCase();
    if (explicitLabel && normalized !== 'main' && normalized !== 'heartbeat') return explicitLabel;
    return `${agentName} (main)`;
  }

  if (isTopLevelAgentSessionKey(sessionKey)) {
    if (explicitLabel) return explicitLabel;
    if (identityName && rootId) return `${identityName} (${rootId})`;
    if (rootId) return rootId;
  }

  if (explicitLabel) return explicitLabel;
  if (session.displayName?.trim()) return session.displayName.trim();

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

/** Any gateway key scoped to an agent (`agent:<id>:...`) belongs to that agent's family. */
const AGENT_SCOPED_RE = /^agent:([^:]+):.+$/;

function getKeyAgentId(sessionKey: string): string | null {
  return getRootAgentId(sessionKey) ?? sessionKey.match(AGENT_SCOPED_RE)?.[1] ?? null;
}

/**
 * The agent family a session belongs to. An agent-scoped key names it outright. A nonstandard key
 * follows its explicit parent (`parentSessionKey`, then `parentId`) the way the sidebar tree places
 * the row: the first candidate that names an agent or is a loaded session, up to a session whose
 * key names its agent. A parent cycle names no family.
 */
function resolveAgentFamilyId(sessionKey: string, sessions: Session[]): string | null {
  const byKey = new Map(sessions.map((candidate) => [getSessionKey(candidate), candidate]));
  const visited = new Set<string>();
  let key: string | undefined = sessionKey;

  while (key && !visited.has(key)) {
    const agentId = getKeyAgentId(key);
    if (agentId) return agentId;
    visited.add(key);
    const session = byKey.get(key);
    key = session
      ? getExplicitParentCandidates(session).find((parent) => getKeyAgentId(parent) !== null || byKey.has(parent))
      : undefined;
  }

  return null;
}

export interface ChatRoomNames {
  /** The agent family the open session belongs to, if any; its hue colours the room. */
  agentId: string | null;
  /** Who speaks for the agent: the name on its replies and the header nameplate. */
  agentName: string;
  /** The session's own name, set only when it names someone or something other than the agent. */
  sessionName?: string;
}

/**
 * The names an open chat room shows: who the agent's replies belong to, and what the session is
 * called when that is not the agent.
 *
 * A root agent session (`agent:<id>:main`) and a subagent session are named after the agent that
 * runs them, so their own label is the speaker and there is no separate session name. Every other
 * session under an agent (a direct or channel conversation from Telegram, Discord and the like, a
 * group, topic or thread, a cron job or one of its runs) is a conversation that agent holds: its
 * label names the peer, the room or the job, never the agent. Its replies belong to the agent
 * family, named as the family's root row names it, and its label becomes the session name. A
 * session whose key names no agent belongs to the family its explicit parent chain leads to.
 */
export function getChatRoomNames(sessionKey: string, sessions: Session[], mainAgentName = 'Agent'): ChatRoomNames {
  const session = sessions.find((candidate) => getSessionKey(candidate) === sessionKey);
  const ownLabel = session ? getSessionDisplayLabel(session, mainAgentName) : undefined;
  const agentId = resolveAgentFamilyId(sessionKey, sessions);

  if (!agentId || isTopLevelAgentSessionKey(sessionKey) || isSubagentSessionKey(sessionKey)) {
    return { agentId, agentName: ownLabel ?? mainAgentName };
  }

  const rootKey = `agent:${agentId}:main`;
  const root = sessions.find((candidate) => getSessionKey(candidate) === rootKey) ?? { sessionKey: rootKey };
  const names: ChatRoomNames = { agentId, agentName: getSessionDisplayLabel(root, mainAgentName) };
  if (ownLabel) names.sessionName = ownLabel;
  return names;
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

export function getAgentRegistrationName(name: string, sessionKey: string): string {
  const agentId = getRootAgentId(sessionKey);
  const baseId = slugifyPart(name);

  if (!agentId || agentId === baseId) return name;

  const suffix = agentId.startsWith(`${baseId}-`) ? agentId.slice(baseId.length + 1) : '';
  if (/^\d+$/.test(suffix)) return `${name} ${suffix}`;

  return agentId;
}
