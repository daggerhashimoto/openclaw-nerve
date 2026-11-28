/**
 * Names for sessions in words, never their keys. A kanban run is named after its task, a cron
 * session after its job, any other session by its own label, and failing all of that by the
 * agent it belongs to ("Kim on telegram"). Shared by the Now board and the Today digest.
 */

import type { KanbanTask } from '@/features/kanban/types';
import type { CronJob } from '@/features/workspace/hooks/useCrons';
import {
  getSessionAgentId,
  isCronRunSessionKey,
  isCronSessionKey,
  isPlaceholderIdentityName,
  isTopLevelAgentSessionKey,
} from '@/features/sessions/sessionKeys';
import { getSessionKey, type Session } from '@/types';

export interface NameSources {
  tasks?: readonly KanbanTask[];
  crons?: readonly CronJob[];
  sessions?: readonly Session[];
  /** Agent ids to display names. */
  agentNames?: ReadonlyMap<string, string>;
}

/** A kanban run label: `kb-<task id>-<ms>` or `kb-<title slug>-<task id>-v<n>-<ms>`, maybe with a sequence. */
const KANBAN_LABEL_RE = /^kb-(.+?)-\d{10,}(?:-[a-z0-9]{1,4})?$/;

/** The channel a chat runs on: the row's channel, its last one, or its participants' plugin. */
export function channelOf(session: Session): string | undefined {
  if (session.channel) return session.channel;
  if (session.lastChannel) return session.lastChannel;
  const origin = (session as { origin?: { provider?: unknown } }).origin;
  if (typeof origin?.provider === 'string' && origin.provider) return origin.provider;
  for (const participant of session.participants ?? []) {
    const pluginId = participant?.identity?.pluginId;
    if (pluginId) return pluginId;
  }
  for (const participant of session.participants ?? []) {
    const id = participant?.identity?.id;
    if (participant?.identity?.type === 'observation' && id && /^[a-z]+$/.test(id)) return id;
  }
  return undefined;
}

/** The text of a kanban run label between `kb-` and its timestamp, or null when it is not one. */
function kanbanLabelBody(value: string | undefined): string | null {
  if (!value) return null;
  const tail = value.includes(':') ? value.slice(value.lastIndexOf(':') + 1) : value;
  return tail.match(KANBAN_LABEL_RE)?.[1] ?? null;
}

/** The task a kanban run label names: the task id is the body, or ends it before `-v<n>`. */
function taskForLabel(body: string, tasks: readonly KanbanTask[]): KanbanTask | undefined {
  const withoutVersion = body.replace(/-v\d+$/, '');
  const exact = tasks.find((task) => task.id === withoutVersion || task.id === body);
  if (exact) return exact;
  // The longest id that ends the body wins, so `fix-2` is not read as `2`.
  let best: KanbanTask | undefined;
  for (const task of tasks) {
    if (withoutVersion.endsWith(`-${task.id}`) && (!best || task.id.length > best.id.length)) best = task;
  }
  return best;
}

export function isKanbanRunLabel(value: string | undefined): boolean {
  return kanbanLabelBody(value) !== null;
}

/** The agent's name: the given map, else its main session's identity, else its id. */
function agentNameOf(agentId: string | null | undefined, sources: NameSources): string | undefined {
  if (!agentId) return undefined;
  const root = sources.sessions?.find((candidate) => getSessionKey(candidate) === `agent:${agentId}:main`);
  for (const name of [sources.agentNames?.get(agentId), root?.identityName?.trim()]) {
    if (name && !isPlaceholderIdentityName(name)) return name;
  }
  return agentId;
}

function usableLabel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || isPlaceholderIdentityName(trimmed) || isKanbanRunLabel(trimmed)) return undefined;
  // A label that is itself a session key is not a name.
  if (/^(agent|kanban-root):/.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * The session in words. Never returns the key: the last resort is the agent's name, then
 * "Session".
 */
export function sessionDisplayName(key: string, sources: NameSources): string {
  const tasks = sources.tasks ?? [];
  const session = sources.sessions?.find((candidate) => getSessionKey(candidate) === key);
  const agentId = getSessionAgentId(key);
  const agentName = agentNameOf(agentId, sources);

  if (isTopLevelAgentSessionKey(key)) return agentName ?? 'Session';

  // A kanban run: the task whose run is this session, or the task its label names.
  const byRun = tasks.find((task) => task.run && (task.run.sessionKey === key || task.run.childSessionKey === key));
  if (byRun) return byRun.title;
  for (const value of [session?.label, session?.displayName, key]) {
    const body = kanbanLabelBody(value);
    if (!body) continue;
    const task = taskForLabel(body, tasks);
    if (task) return task.title;
  }

  // A cron job's session or one of its runs: the job's name.
  if (isCronSessionKey(key) || isCronRunSessionKey(key)) {
    const jobId = key.split(':')[3];
    const job = sources.crons?.find((candidate) => candidate.id === jobId || candidate.sessionKey === key);
    const jobName = job?.name?.trim() || job?.label?.trim();
    if (jobName) return jobName;
  }

  const label = usableLabel(session?.label) ?? usableLabel(session?.displayName);
  if (label) return label;

  const channel = session ? channelOf(session) : undefined;
  if (agentName && channel) return `${agentName} on ${channel}`;
  return agentName ?? 'Session';
}
