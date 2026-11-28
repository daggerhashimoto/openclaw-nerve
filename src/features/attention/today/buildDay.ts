/**
 * The Today digest's normalizer: tasks, crons, their runs and sessions turned into what finished
 * today and which chats were active today. Pure: the day is the viewer's local day around
 * `input.now`, and every time comes from the input.
 *
 * Done today holds a row per task that reached done, per pull request a done task says merged,
 * per cron run (ok runs of a job that ran many times fold into one row), and per spawned session
 * (a subagent) whose run ended. Top-level and channel chats are ongoing, never "done"; they and
 * the subagents are listed under Chats today instead.
 */

import type { KanbanTask, TaskActor } from '@/features/kanban/types';
import type { CronJob } from '@/features/workspace/hooks/useCrons';
import { isFailedCronStatus, isOkCronStatus } from '@/features/workspace/cronStatus';
import {
  getSessionAgentId,
  inferParentSessionKey,
  isCronRunSessionKey,
  isCronSessionKey,
  isSubagentSessionKey,
  isTopLevelAgentSessionKey,
} from '@/features/sessions/sessionKeys';
import { isGranularLive } from '@/lib/paneState';
import { getSessionKey, type GranularAgentState, type Session } from '@/types';
import { formatClock } from '../briefCopy';
import type { SourceStatus } from '../types';

/** `/api/crons/:id/runs` answers at most this many runs per job. */
export const CRON_RUNS_LIMIT = 10;
/** A job with more ok runs than this today shows them as one row. */
export const CRON_FOLD_AFTER = 3;
/** Done lists longer than this are grouped by hour. */
export const GROUP_BY_HOUR_AFTER = 8;

const ENDED_STATUSES = new Set(['done', 'failed', 'interrupted', 'killed', 'timeout']);
const FAILED_END_STATUSES = new Set(['failed', 'interrupted', 'killed', 'timeout']);
const MODEL_RUN_RE = /:explicit:model-run-/;
const PR_LINK_RE = /https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g;
const PR_REF_RE = /(?:^|[^\w&/])#(\d{1,6})\b/g;
const MERGED_RE = /\bmerged\b/i;

export type DaySource = 'tasks' | 'crons' | 'cronRuns' | 'sessions';
export type DayKind = 'task' | 'pr' | 'cron' | 'session';

/** One cron run as `/api/crons/:id/runs` reports it, normalized. */
export interface CronRunEntry {
  at: number;
  status: string;
  error?: string;
  summary?: string;
  durationMs?: number;
  sessionKey?: string;
}

/** Where a Nudge or Ask on a row goes, with a line of context for the agent. */
export interface ReplyTarget {
  sessionKey: string;
  /** The row's own session has ended; this asks its parent about it. */
  ask: boolean;
  context?: string;
}

export interface DayRow {
  key: string;
  at: number;
  kind: DayKind;
  title: string;
  /** Result text, the newest note, a cron run's summary or error. */
  detail?: string;
  /** A pull request's URL, only when the text carried one. */
  href?: string;
  /** The session whose thread the row's "What happened" reads. */
  sessionKey?: string;
  agentId?: string;
  taskId?: string;
  cronId?: string;
  failed: boolean;
  /** A session's run status word (done, failed, killed...). */
  status?: string;
  /** Folded cron runs: how many, and whether the run list was cut short. */
  runs?: { ok: number; partial: boolean };
  target?: ReplyTarget;
}

export interface ChatRow {
  key: string;
  title: string;
  agentId?: string;
  channel?: string;
  lastActivity: number;
  topLevel: boolean;
  running: boolean;
  failed: boolean;
  /** A spawned session whose run ended: replies go to its parent. */
  ended: boolean;
  /** What the Now brief holds against this session (Review, Run failed...). */
  needs?: string;
  target: ReplyTarget;
  children: ChatRow[];
}

export interface DayStats {
  sessions: number;
  /** Tasks done and subagents that finished cleanly. */
  done: number;
  merged: number;
  cronOk: number;
  cronFailed: number;
  /** A job's run list was cut at the limit inside today, so the cron counts are at least these. */
  cronPartial: boolean;
}

export interface DayInput {
  now: number;
  tasks: KanbanTask[];
  crons: CronJob[];
  /** Runs per job id, for the jobs that ran today. */
  cronRuns: Record<string, CronRunEntry[]>;
  sessions: Session[];
  agentStatus: Record<string, GranularAgentState>;
  busyState: Record<string, boolean>;
  /** Session keys the Now brief holds against the operator, with the kind word. */
  needsReply: ReadonlyMap<string, string>;
  /** Agent ids to display names. */
  agentNames: ReadonlyMap<string, string>;
  sources: Record<DaySource, SourceStatus>;
}

export interface Day {
  dayStart: number;
  /** `YYYY-MM-DD` of the viewer's local day. */
  dayKey: string;
  stats: DayStats;
  /** Newest first. */
  done: DayRow[];
  chats: ChatRow[];
}

export function startOfLocalDay(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function localDayKey(now: number): string {
  const date = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function agentIdOf(actor?: TaskActor | string): string | undefined {
  return actor?.startsWith('agent:') ? actor.slice('agent:'.length) : undefined;
}

function isoToMs(value?: string | number): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// ── Pull requests ────────────────────────────────────────────────────

export interface PrMention {
  number: number;
  /** `owner/repo`, when a full link named it. */
  repo?: string;
  href?: string;
}

/** Every pull request a text names: full GitHub pull links, and `#123` references. */
export function prMentions(text: string): PrMention[] {
  const found = new Map<number, PrMention>();
  for (const match of text.matchAll(PR_LINK_RE)) {
    const number = Number(match[2]);
    found.set(number, { number, repo: match[1], href: `https://github.com/${match[1]}/pull/${number}` });
  }
  const withoutLinks = text.replace(PR_LINK_RE, ' ');
  for (const match of withoutLinks.matchAll(PR_REF_RE)) {
    const number = Number(match[1]);
    if (!found.has(number)) found.set(number, { number });
  }
  return [...found.values()];
}

/**
 * The pull requests a done task says were merged, each at the time of the text that says so.
 * A note counts when it says "merged" and names the PR (`Merged #456 as 8a0b787`,
 * `Merge watch: #458 merged as ...`); a full pull link in the task's own result counts too,
 * since the task was closed on it. Mentions without the word ("PR #456 awaiting approval") do not.
 */
export function mergedPrs(task: KanbanTask, doneAt: number): Array<PrMention & { at: number }> {
  const out = new Map<number, PrMention & { at: number }>();
  const add = (mention: PrMention, at: number) => {
    const existing = out.get(mention.number);
    if (!existing) out.set(mention.number, { ...mention, at });
    else if (!existing.href && mention.href) out.set(mention.number, { ...existing, repo: mention.repo, href: mention.href });
  };
  const result = task.result ?? '';
  const resultAt = task.resultAt ?? doneAt;
  for (const mention of prMentions(result)) {
    if (mention.href || MERGED_RE.test(result)) add(mention, resultAt);
  }
  for (const note of task.feedback ?? []) {
    if (!note?.note || !MERGED_RE.test(note.note)) continue;
    for (const mention of prMentions(note.note)) add(mention, note.at);
  }
  // A bare #123 takes its link from any full link to the same number elsewhere on the task.
  const texts = [result, ...(task.feedback ?? []).map((note) => note?.note ?? '')].join('\n');
  for (const mention of prMentions(texts)) {
    const known = out.get(mention.number);
    if (known && !known.href && mention.href) out.set(mention.number, { ...known, repo: mention.repo, href: mention.href });
  }
  return [...out.values()];
}

// ── Sessions ─────────────────────────────────────────────────────────

export function sessionActivity(session: Session): number | undefined {
  const times = [session.updatedAt, session.lastActivityAt, isoToMs(session.lastActivity), session.endedAt]
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  return times.length > 0 ? Math.max(...times) : undefined;
}

/** The session that spawned this one: spawnedBy, the explicit parent, or the parent its key implies. */
export function parentKeyOf(session: Session): string | undefined {
  const key = getSessionKey(session);
  for (const candidate of [session.spawnedBy, session.parentSessionKey, session.parentId]) {
    const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
    if (trimmed && trimmed !== key) return trimmed;
  }
  return inferParentSessionKey(key) ?? undefined;
}

/** A session some other session started: subagent keys, or rows that name who spawned them. */
export function isSpawnedSession(session: Session): boolean {
  const key = getSessionKey(session);
  if (!key || isTopLevelAgentSessionKey(key) || isCronSessionKey(key) || isCronRunSessionKey(key)) return false;
  return isSubagentSessionKey(key)
    || Boolean(session.spawnedBy?.trim())
    || Boolean(session.parentSessionKey?.trim())
    || session.createdVia === 'spawn';
}

function isRunning(session: Session, input: DayInput): boolean {
  const key = getSessionKey(session);
  const granular = input.agentStatus[key];
  return Boolean(session.hasActiveRun)
    || Boolean(input.busyState[key])
    || (granular ? isGranularLive(granular) : false)
    || session.status === 'running'
    || session.status === 'queued';
}

/**
 * When a spawned session's run ended, and how: the row's terminal `status` (done, failed,
 * interrupted, killed, timeout) with `endedAt`, or a failure or finish this page saw live.
 * Null while it runs, or when nothing says it ended.
 */
export function sessionEnd(session: Session, input: DayInput): { at: number; status: string; failed: boolean } | null {
  if (!isSpawnedSession(session) || isRunning(session, input)) return null;
  const status = session.status?.toLowerCase();
  if (status && ENDED_STATUSES.has(status)) {
    const at = session.endedAt ?? session.updatedAt ?? sessionActivity(session);
    return at === undefined ? null : { at, status, failed: FAILED_END_STATUSES.has(status) };
  }
  const granular = input.agentStatus[getSessionKey(session)];
  if (granular?.status === 'ERROR') return { at: granular.since, status: 'failed', failed: true };
  if (granular?.status === 'DONE') return { at: granular.since, status: 'done', failed: false };
  return null;
}

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

function agentName(agentId: string | undefined, input: DayInput): string | undefined {
  return agentId ? input.agentNames.get(agentId) ?? agentId : undefined;
}

function sessionTitle(session: Session, input: DayInput): string {
  const key = getSessionKey(session);
  const agentId = getSessionAgentId(key) ?? undefined;
  if (isTopLevelAgentSessionKey(key)) return agentName(agentId, input) ?? session.label ?? key;
  const label = session.label?.trim() || session.displayName?.trim();
  if (label) return label;
  const name = agentName(agentId, input);
  const channel = channelOf(session);
  if (name && channel) return `${name} on ${channel}`;
  return name ?? key;
}

/** Counted as a chat: anything people or agents talk in. Crons and summary runs are not. */
function isChatSession(key: string): boolean {
  return Boolean(key) && !isCronSessionKey(key) && !isCronRunSessionKey(key) && !MODEL_RUN_RE.test(key);
}

// ── Builder ──────────────────────────────────────────────────────────

/**
 * The agent a done task belongs to: its assignee, the agent of its run or source session, the
 * agent who wrote its newest note, or the agent that created it. Cards an agent works through
 * notes alone (no assignee, no run) still get an owner to nudge.
 */
export function taskAgent(task: KanbanTask, runKey?: string): string | undefined {
  const fromKey = (key?: string) => (key ? getSessionAgentId(key) ?? undefined : undefined);
  const noteAuthor = [...(task.feedback ?? [])]
    .filter((note) => note?.by?.startsWith('agent:'))
    .sort((a, b) => b.at - a.at)[0]?.by;
  return agentIdOf(task.assignee)
    ?? fromKey(runKey)
    ?? fromKey(task.sourceSessionKey)
    ?? agentIdOf(noteAuthor)
    ?? agentIdOf(task.createdBy);
}

function newestNote(task: KanbanTask): string | undefined {
  const notes = (task.feedback ?? []).filter((note) => note?.note?.trim());
  if (notes.length === 0) return undefined;
  return notes.reduce((a, b) => (b.at >= a.at ? b : a)).note.trim();
}

export function buildDay(input: DayInput): Day {
  const { now } = input;
  const dayStart = startOfLocalDay(now);
  const today = (at: number | undefined): at is number => typeof at === 'number' && at >= dayStart && at <= now + 60_000;
  const sourceOn = (source: DaySource) => input.sources[source].state !== 'off';

  const sessionsByKey = new Map<string, Session>();
  for (const session of input.sessions) {
    const key = getSessionKey(session);
    if (key) sessionsByKey.set(key, session);
  }
  const ends = new Map<string, { at: number; status: string; failed: boolean }>();
  for (const [key, session] of sessionsByKey) {
    const end = sessionEnd(session, input);
    if (end) ends.set(key, end);
  }

  /** A reply to a session; one that has ended goes to its parent with a line about it. */
  const targetFor = (key: string, context: string | undefined): ReplyTarget => {
    const session = sessionsByKey.get(key);
    const end = ends.get(key);
    const parent = session ? parentKeyOf(session) : undefined;
    if (end && parent) {
      const title = session ? sessionTitle(session, input) : key;
      const ended = `the subagent "${title}" (${key}), which ${end.failed ? `ended ${end.status}` : 'finished'} at ${formatClock(end.at)}`;
      return { sessionKey: parent, ask: true, context: context ? `${context} It ran in ${ended}.` : `About ${ended}.` };
    }
    return { sessionKey: key, ask: false, context };
  };

  const done: DayRow[] = [];
  const linkedSessions = new Set<string>();

  // Tasks and the pull requests they merged.
  if (sourceOn('tasks')) {
    const prRows = new Map<number, DayRow>();
    for (const task of input.tasks) {
      if (task.status !== 'done' || !today(task.updatedAt)) continue;
      const at = task.updatedAt;
      const run = task.run;
      const runKey = run ? run.childSessionKey ?? run.sessionKey : undefined;
      if (run?.sessionKey) linkedSessions.add(run.sessionKey);
      if (run?.childSessionKey) linkedSessions.add(run.childSessionKey);
      const agentId = taskAgent(task, runKey);
      const replyKey = run?.sessionKey ?? task.sourceSessionKey ?? (agentId ? `agent:${agentId}:main` : undefined);
      const context = `About the task "${task.title}", done at ${formatClock(at)}.`;
      const target = replyKey ? targetFor(replyKey, context) : undefined;
      done.push({
        key: `task:${task.id}`,
        at,
        kind: 'task',
        title: task.title,
        detail: task.result?.trim() || newestNote(task),
        sessionKey: runKey,
        agentId,
        taskId: task.id,
        failed: false,
        target,
      });
      for (const pr of mergedPrs(task, at)) {
        if (!today(pr.at)) continue;
        const existing = prRows.get(pr.number);
        if (existing && (existing.at >= pr.at || (existing.href && !pr.href))) continue;
        prRows.set(pr.number, {
          key: `pr:${pr.number}`,
          at: pr.at,
          kind: 'pr',
          title: `PR #${pr.number} merged`,
          detail: task.title,
          href: pr.href ?? existing?.href,
          sessionKey: runKey,
          agentId,
          taskId: task.id,
          failed: false,
          target: replyKey ? targetFor(replyKey, `About PR #${pr.number} for the task "${task.title}".`) : undefined,
        });
      }
    }
    done.push(...prRows.values());
  }

  // Cron runs: failures each, ok runs each unless the job ran often.
  let cronOk = 0;
  let cronFailed = 0;
  let cronPartial = false;
  if (sourceOn('crons')) {
    const cronSessionOf = (jobId: string) => {
      for (const key of sessionsByKey.keys()) {
        if (isCronSessionKey(key) && key.endsWith(`:cron:${jobId}`)) return key;
      }
      return undefined;
    };
    for (const job of input.crons) {
      const entries = input.cronRuns[job.id];
      if (!entries) continue;
      const todays = entries.filter((entry) => today(entry.at));
      const oldest = entries.length > 0 ? Math.min(...entries.map((entry) => entry.at)) : undefined;
      const partial = entries.length >= CRON_RUNS_LIMIT && oldest !== undefined && oldest >= dayStart;
      if (partial) cronPartial = true;
      const ok = todays.filter((entry) => isOkCronStatus(entry.status)).sort((a, b) => b.at - a.at);
      const failed = todays.filter((entry) => isFailedCronStatus(entry.status));
      cronOk += ok.length;
      cronFailed += failed.length;
      const title = job.name || job.label || job.id;
      const sessionKey = cronSessionOf(job.id);
      const base = { kind: 'cron' as const, title, cronId: job.id, agentId: sessionKey ? getSessionAgentId(sessionKey) ?? undefined : undefined };
      for (const entry of failed) {
        done.push({ ...base, key: `cron:${job.id}:${entry.at}`, at: entry.at, detail: entry.error || entry.summary, failed: true, sessionKey: entry.sessionKey ?? sessionKey });
      }
      if (ok.length > CRON_FOLD_AFTER || (partial && ok.length > 0)) {
        done.push({
          ...base,
          key: `cron:${job.id}:ok`,
          at: ok[0].at,
          detail: ok.find((entry) => entry.summary)?.summary,
          failed: false,
          runs: { ok: ok.length, partial },
          sessionKey: ok[0].sessionKey ?? sessionKey,
        });
      } else {
        for (const entry of ok) {
          done.push({ ...base, key: `cron:${job.id}:${entry.at}`, at: entry.at, detail: entry.summary, failed: false, sessionKey: entry.sessionKey ?? sessionKey });
        }
      }
    }
  }

  // Spawned sessions that ended today, unless a done task already stands for them.
  if (sourceOn('sessions')) {
    for (const [key, end] of ends) {
      if (!today(end.at) || linkedSessions.has(key)) continue;
      const session = sessionsByKey.get(key)!;
      const parent = parentKeyOf(session);
      done.push({
        key: `session:${key}`,
        at: end.at,
        kind: 'session',
        title: sessionTitle(session, input),
        detail: end.failed ? session.lastRunError?.trim() || undefined : undefined,
        sessionKey: key,
        agentId: getSessionAgentId(key) ?? undefined,
        failed: end.failed,
        status: end.status,
        target: parent ? targetFor(key, undefined) : undefined,
      });
    }
  }

  done.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));

  // Chats active today, subagents under their parent.
  const chatRows = new Map<string, ChatRow>();
  const parents = new Map<string, string | undefined>();
  if (sourceOn('sessions')) {
    for (const [key, session] of sessionsByKey) {
      if (!isChatSession(key)) continue;
      const activity = sessionActivity(session);
      if (!today(activity)) continue;
      const end = ends.get(key);
      const granular = input.agentStatus[key];
      chatRows.set(key, {
        key,
        title: sessionTitle(session, input),
        agentId: getSessionAgentId(key) ?? undefined,
        channel: channelOf(session),
        lastActivity: activity,
        topLevel: isTopLevelAgentSessionKey(key),
        running: isRunning(session, input),
        failed: granular?.status === 'ERROR' || Boolean(end?.failed),
        ended: Boolean(end),
        needs: input.needsReply.get(key),
        target: targetFor(key, undefined),
        children: [],
      });
      parents.set(key, isTopLevelAgentSessionKey(key) ? undefined : parentKeyOf(session));
    }
  }
  const roots: ChatRow[] = [];
  for (const row of chatRows.values()) {
    const parent = parents.get(row.key);
    const parentRow = parent ? chatRows.get(parent) : undefined;
    if (parentRow && parentRow !== row) parentRow.children.push(row);
    else roots.push(row);
  }
  const byActivity = (a: ChatRow, b: ChatRow) => b.lastActivity - a.lastActivity || a.key.localeCompare(b.key);
  const sortTree = (rows: ChatRow[]) => {
    rows.sort(byActivity);
    for (const row of rows) sortTree(row.children);
  };
  sortTree(roots);
  // Top-level agent chats first, then any chat whose parent was not active today.
  const chats = [...roots.filter((row) => row.topLevel), ...roots.filter((row) => !row.topLevel)];

  return {
    dayStart,
    dayKey: localDayKey(now),
    stats: {
      sessions: chatRows.size,
      done: done.filter((row) => row.kind === 'task' || (row.kind === 'session' && !row.failed)).length,
      merged: done.filter((row) => row.kind === 'pr').length,
      cronOk,
      cronFailed,
      cronPartial,
    },
    done,
    chats,
  };
}

export interface HourGroup<T> {
  /** `14:00`, or null when the list is short enough to show ungrouped. */
  label: string | null;
  rows: T[];
}

/** Consecutive rows in the same local hour, once the list is longer than `after`. */
export function groupByHour<T extends { at: number }>(rows: T[], after = GROUP_BY_HOUR_AFTER): HourGroup<T>[] {
  if (rows.length <= after) return [{ label: null, rows }];
  const groups: HourGroup<T>[] = [];
  for (const row of rows) {
    const label = `${String(new Date(row.at).getHours()).padStart(2, '0')}:00`;
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}

export function flattenChats(rows: ChatRow[]): ChatRow[] {
  return rows.flatMap((row) => [row, ...flattenChats(row.children)]);
}

/**
 * The day's compact facts for the paragraph: counts, a short line per done row and per chat,
 * and the sources that were not read. Chat lines carry no times, so the facts only change when
 * something new happens.
 */
export function dayFacts(day: Day, missing: string[]): {
  day: string;
  counts: { sessions: number; done: number; merged: number; cronOk: number; cronFailed: number };
  done: string[];
  chats: string[];
  missing: string[];
} {
  const clip = (text: string) => (text.length > 200 ? `${text.slice(0, 197).trimEnd()}...` : text);
  const doneLines = day.done.map((row) => {
    const clock = formatClock(row.at);
    switch (row.kind) {
      case 'task':
        return clip(`${clock} Task done: ${flatten(row.title)}`);
      case 'pr':
        return clip(`${clock} ${row.title} (${flatten(row.detail ?? '')})`);
      case 'session':
        return clip(`${clock} Subagent ${flatten(row.title)} ${row.failed ? `ended ${row.status}` : 'finished'}`);
      case 'cron':
        if (row.runs) return clip(`Cron ${flatten(row.title)} ran ${row.runs.ok}${row.runs.partial ? '+' : ''} times ok`);
        return clip(`${clock} Cron ${flatten(row.title)} ${row.failed ? 'failed' : 'ran ok'}`);
    }
  });
  const chatLines = flattenChats(day.chats).map((row) => clip([
    flatten(row.title),
    row.channel,
    row.running ? 'running' : undefined,
    row.ended ? 'finished' : undefined,
    row.needs ? `needs the operator (${row.needs})` : undefined,
  ].filter(Boolean).join(', ')));
  return {
    day: day.dayKey,
    counts: {
      sessions: day.stats.sessions,
      done: day.stats.done,
      merged: day.stats.merged,
      cronOk: day.stats.cronOk,
      cronFailed: day.stats.cronFailed,
    },
    done: doneLines.slice(0, 40),
    chats: chatLines.slice(0, 30),
    missing,
  };
}
