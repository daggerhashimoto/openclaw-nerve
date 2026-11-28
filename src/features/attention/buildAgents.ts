/**
 * The Agents strip: one line per top-level agent saying what it is doing, in words. Pure.
 *
 * An agent's activity is, in order: a task run it holds (named by the task), another of its
 * sessions that is running (named by sessionDisplayName, or "replying on Telegram" for a
 * channel chat), or its main session running. A task run that went quiet (the brief's gone-quiet
 * logic) marks the line quiet. Working and quiet agents come first, idle ones after, each group
 * in the session list's order (main first).
 */

import { getSessionAgentId, getTopLevelAgentSessions, isPlaceholderIdentityName } from '@/features/sessions/sessionKeys';
import { isGranularLive, isSessionRunning } from '@/lib/paneState';
import { getSessionKey, type GranularAgentState, type Session } from '@/types';
import { channelOf } from './sessionNames';
import type { AttentionBrief, AttentionItem, OpenTarget } from './types';

export interface AgentLine {
  /** The agent's id; a line for work no agent in the list holds has none. */
  agentId?: string;
  /** What the line opens: the agent's main chat, or for unplaced work, the work itself. */
  open: OpenTarget | null;
  name: string;
  state: 'working' | 'quiet' | 'idle';
  /** What it is doing, in words; absent when idle. */
  activity?: string;
  /** When that started (a run's start, or the session's live state). */
  since?: number;
  /** Further things it is doing at once. */
  more: number;
  /** The task run Stop acts on: the quiet one, else the run the agent is on. */
  stopItem?: AttentionItem;
  /** When the quiet run last showed activity. */
  quietSince?: number;
}

export interface AgentsInput {
  brief: Pick<AttentionBrief, 'progress' | 'blocked' | 'seen'>;
  sessions: Session[];
  agentStatus: Record<string, GranularAgentState>;
  busyState: Record<string, boolean>;
  agentNames: ReadonlyMap<string, string>;
  now: number;
}

/**
 * A session is working as the rest of the app counts it (the top bar's fleet words): its live
 * state when the gateway sent one, else the busy flag or the list's own run fields
 * (`status: "running"`, `hasActiveRun`). A failed session never counts.
 */
export function isSessionWorking(
  session: Session,
  busyState: Record<string, boolean>,
  agentStatus: Record<string, GranularAgentState>,
): boolean {
  const key = getSessionKey(session);
  const granular = agentStatus[key];
  if (granular?.status === 'ERROR') return false;
  if (granular && isGranularLive(granular)) return true;
  return isSessionRunning(session, Boolean(busyState[key])) || Boolean(session.hasActiveRun);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The agent an item belongs to: its owner, its session's agent, or the agent of the session that spawned it. */
function agentOf(item: AttentionItem, byKey: Map<string, Session>): string | undefined {
  if (item.ownerId) return item.ownerId;
  const key = item.detail.sessionKey;
  if (!key) return undefined;
  const direct = getSessionAgentId(key);
  if (direct) return direct;
  const session = byKey.get(key);
  for (const parent of [session?.spawnedBy, session?.parentSessionKey, session?.parentId]) {
    const agent = parent ? getSessionAgentId(parent) : null;
    if (agent) return agent;
  }
  return undefined;
}

interface Activity {
  rank: number;
  words: string;
  since?: number;
  item?: AttentionItem;
}

/** A live run outranks a quiet one; then task runs, other sessions, the main session; newest first. */
function byLead(a: Activity, b: Activity): number {
  return Number(a.item?.kind === 'gone-quiet') - Number(b.item?.kind === 'gone-quiet')
    || a.rank - b.rank
    || (b.since ?? 0) - (a.since ?? 0);
}

function lineFor(activities: Activity[], who: Pick<AgentLine, 'agentId' | 'name' | 'open'>): AgentLine {
  const quiet = activities.find((activity) => activity.item?.kind === 'gone-quiet');
  const lead = activities[0];
  const state: AgentLine['state'] = !lead ? 'idle' : lead.item?.kind === 'gone-quiet' ? 'quiet' : 'working';
  const taskRun = activities.find((activity) => activity.item?.kind === 'task-running')?.item;
  return {
    ...who,
    state,
    activity: lead?.words,
    since: lead?.since,
    more: Math.max(0, activities.length - 1),
    stopItem: quiet?.item ?? taskRun,
    quietSince: quiet?.item ? quiet.item.detail.quietSince ?? quiet.item.updatedAt : undefined,
  };
}

export function buildAgents(input: AgentsInput): AgentLine[] {
  const { brief, sessions, agentStatus, busyState, agentNames } = input;
  const byKey = new Map(sessions.map((session) => [getSessionKey(session), session] as const));
  const running = [
    ...brief.progress,
    ...brief.blocked.filter((item) => item.kind === 'gone-quiet'),
    ...brief.seen.blocked.filter((item) => item.kind === 'gone-quiet'),
  ];

  const lines: AgentLine[] = [];
  const placed = new Set<string>();
  for (const root of getTopLevelAgentSessions(sessions)) {
    const sessionKey = getSessionKey(root);
    const agentId = getSessionAgentId(sessionKey);
    if (!agentId) continue;
    const known = agentNames.get(agentId) ?? root.identityName?.trim();
    const name = known && !isPlaceholderIdentityName(known) ? known : agentId;

    const activities: Activity[] = [];
    for (const item of running) {
      if (agentOf(item, byKey) !== agentId) continue;
      placed.add(item.key);
      if (item.kind === 'task-running' || item.kind === 'gone-quiet') {
        activities.push({ rank: 0, words: item.title, since: item.updatedAt, item });
      } else {
        const session = item.detail.sessionKey ? byKey.get(item.detail.sessionKey) : undefined;
        const channel = session ? channelOf(session) : undefined;
        activities.push({
          rank: 1,
          words: channel && !session?.spawnedBy && !session?.parentSessionKey ? `replying on ${capitalize(channel)}` : item.title,
          since: item.updatedAt,
        });
      }
    }
    const granular = agentStatus[sessionKey];
    if (isSessionWorking(root, busyState, agentStatus)) {
      const channel = channelOf(root);
      activities.push({
        rank: 2,
        words: channel ? `replying on ${capitalize(channel)}` : 'in main chat',
        since: granular && isGranularLive(granular) ? granular.since : root.startedAt ?? granular?.since,
      });
    }

    activities.sort(byLead);
    lines.push(lineFor(activities, { agentId, name, open: { type: 'session', key: sessionKey } }));
  }

  // Work that no listed agent holds (a run on the board's own fallback session, or an agent with
  // no main session here) still gets a line, so running work never drops off the board.
  const unplaced = running.filter((item) => !placed.has(item.key));
  const byAgent = new Map<string, AttentionItem[]>();
  for (const item of unplaced) {
    const agent = agentOf(item, byKey) ?? '';
    byAgent.set(agent, [...(byAgent.get(agent) ?? []), item]);
  }
  for (const [agent, items] of byAgent) {
    const known = agent ? agentNames.get(agent) : undefined;
    const name = agent ? (known && !isPlaceholderIdentityName(known) ? known : agent) : 'Unassigned';
    const activities = items.map((item) => ({ rank: 0, words: item.title, since: item.updatedAt, item }));
    activities.sort(byLead);
    lines.push(lineFor(activities, { agentId: agent || undefined, name, open: activities[0].item.open }));
  }

  const order = (line: AgentLine) => (line.state === 'idle' ? 1 : 0);
  return lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => order(a.line) - order(b.line) || a.index - b.index)
    .map(({ line }) => line);
}
