/**
 * The Today digest's normalizer: tasks, crons, their runs and sessions turned into the chats of
 * the day and what got done. Pure: the day is the viewer's local day around `input.now`, and
 * every time comes from the input.
 *
 * Chats today holds every session active today, subagents nested under their parent (an ended
 * subagent carries how it ended). Nothing in Chats is repeated in Done.
 *
 * Done today holds, in this order:
 * - failing: cron jobs whose latest run failed, by the same rule as Now (`cronLatestState`),
 *   pinned while they stay failing, each with the item Now's actions run on;
 * - done: tasks that reached done today, newest first, each with the pull requests it merged
 *   today; then crons that failed today but no longer fail, one line per job ("failed 09:00,
 *   recovered 12:03");
 * - cronsOk: successful cron runs, folded into one quiet line with a row per job.
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
import { channelOf, sessionDisplayName } from '../sessionNames';
import type { AttentionItem, SourceStatus } from '../types';
import type { ThreadSummary } from '../useAttentionSummaries';

export { channelOf };

/** `/api/crons/:id/runs` answers at most this many runs per job. */
export const CRON_RUNS_LIMIT = 10;

const ENDED_STATUSES = new Set(['done', 'failed', 'interrupted', 'killed', 'timeout']);
const FAILED_END_STATUSES = new Set(['failed', 'interrupted', 'killed', 'timeout']);
const MODEL_RUN_RE = /:explicit:model-run-/;
const PR_LINK_RE = /https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g;
const PR_REF_RE = /(?:^|[^\w&/])#(\d{1,6})\b/g;
const MERGED_RE = /\bmerged\b/i;

export type DaySource = 'tasks' | 'crons' | 'cronRuns' | 'sessions';
export type DayKind = 'task' | 'cron';

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

export interface MergedPr {
  number: number;
  href?: string;
  at: number;
}

/** What a cron row knows about its job today. */
export interface CronDay {
  /** The latest run failed and the job is enabled: the same rule as Now's Failing. */
  failing: boolean;
  enabled: boolean;
  /** Today's failed runs, oldest first. */
  failedAt: number[];
  /** The first good run after today's last failure, when the job is no longer failing. */
  recoveredAt?: number;
  /** Today's good runs, and whether the run list was cut short inside today. */
  okRuns: number;
  partial: boolean;
  /** The newest run read, for the open row's output and duration. */
  latest?: CronRunEntry;
  nextRun?: number;
  /** The newest failure's error. */
  error?: string;
}

export interface DayRow {
  key: string;
  at: number;
  kind: DayKind;
  title: string;
  /** A task's result or newest note. */
  detail?: string;
  /** Pull requests a done task merged today. */
  prs?: MergedPr[];
  /** The session whose thread the row's "What happened" reads. */
  sessionKey?: string;
  agentId?: string;
  taskId?: string;
  cronId?: string;
  /** A failing cron: the pane is red. */
  failed: boolean;
  cron?: CronDay;
  /** The item Now's actions run on (Run now, Pause), for failing crons. */
  item?: AttentionItem;
  target?: ReplyTarget;
}

export interface ChatRow {
  key: string;
  title: string;
  agentId?: string;
  channel?: string;
  lastActivity: number;
  topLevel: boolean;
  /** Started by another session (a subagent): its "user" is the parent agent, not the operator. */
  spawned: boolean;
  running: boolean;
  /** Failing now, as Now counts it: the gateway reports the session in error. */
  failing: boolean;
  /** Failing now, or ended failed. */
  failed: boolean;
  /** A spawned session whose run ended: replies go to its parent. */
  ended: boolean;
  /** How and when an ended run ended. */
  end?: { at: number; status: string; error?: string };
  /** What the Now brief holds against this session (Review, Run failed...). */
  needs?: string;
  target: ReplyTarget;
  children: ChatRow[];
}

export interface DayStats {
  /** Chats active today, subagents included. */
  sessions: number;
  /** Tasks that reached done today. */
  done: number;
  merged: number;
  cronOk: number;
  /** Cron jobs failing now. A failure a later run recovered is not counted. */
  cronFailed: number;
  /** Failing crons and failing chats: what the facts strip calls failing. */
  failing: number;
  /** A job's run list was cut at the limit inside today, so the ok count is at least this. */
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
  /** Failing crons, newest failure first. */
  failing: DayRow[];
  /** Tasks newest first, then recovered and paused cron failures newest first. */
  done: DayRow[];
  /** Successful cron runs, a row per job, newest first. */
  cronsOk: DayRow[];
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
 * When a done task was finished. `updatedAt` is not used: reordering a column re-stamps every
 * card in it, so an old card would look finished today. Cards from before `completedAt` existed
 * fall back to their result time, then their newest note.
 */
export function doneTimeOf(task: KanbanTask): number | undefined {
  if (task.completedAt !== undefined) return task.completedAt;
  if (task.resultAt !== undefined) return task.resultAt;
  const notes = (task.feedback ?? []).map((note) => note?.at).filter((at): at is number => typeof at === 'number');
  return notes.length ? Math.max(...notes) : undefined;
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

// ── Crons ────────────────────────────────────────────────────────────

export interface CronLatest {
  /** The latest run failed. */
  failed: boolean;
  ok: boolean;
  /** When that latest run ran. */
  at?: number;
  /** The run history's newest run is newer than the job's own last run. */
  fromHistory: boolean;
  newest?: CronRunEntry;
  error?: string;
}

/**
 * A job's latest state, the rule Now's Failing uses: skipped runs do not count, and the run
 * history overrides the job's own last status only when its newest run is later. A failure
 * followed by a good run is not failing.
 */
export function cronLatestState(job: CronJob, runs: CronRunEntry[] | undefined): CronLatest {
  const lastRun = isoToMs(job.lastRun);
  const sorted = [...(runs ?? [])]
    .filter((entry) => entry.status.toLowerCase() !== 'skipped')
    .sort((a, b) => b.at - a.at);
  const newest = sorted[0];
  const fromHistory = newest !== undefined && (lastRun === undefined || newest.at > lastRun);
  return {
    failed: fromHistory ? isFailedCronStatus(newest.status) : isFailedCronStatus(job.lastStatus),
    ok: fromHistory ? isOkCronStatus(newest.status) : isOkCronStatus(job.lastStatus),
    at: fromHistory ? newest.at : lastRun,
    fromHistory,
    newest,
    error: (fromHistory ? newest.error : undefined) ?? job.lastError,
  };
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

function agentName(agentId: string | undefined, input: DayInput): string | undefined {
  return agentId ? input.agentNames.get(agentId) ?? agentId : undefined;
}

function sessionTitle(session: Session, input: DayInput): string {
  const key = getSessionKey(session);
  const agentId = getSessionAgentId(key) ?? undefined;
  if (isTopLevelAgentSessionKey(key)) return agentName(agentId, input) ?? session.label ?? 'Agent';
  return sessionDisplayName(key, input);
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

  // Tasks, each with the pull requests it merged today. A PR several cards mention goes to the
  // card whose note merged it last.
  const tasks: DayRow[] = [];
  let merged = 0;
  if (sourceOn('tasks')) {
    const prOwner = new Map<number, { taskId: string; pr: MergedPr }>();
    const doneTasks: Array<{ task: KanbanTask; at: number }> = [];
    for (const task of input.tasks) {
      if (task.status !== 'done') continue;
      const at = doneTimeOf(task);
      if (at === undefined || !today(at)) continue;
      doneTasks.push({ task, at });
      for (const pr of mergedPrs(task, at)) {
        if (!today(pr.at)) continue;
        const existing = prOwner.get(pr.number);
        if (existing && (existing.pr.at >= pr.at || (existing.pr.href && !pr.href))) continue;
        prOwner.set(pr.number, { taskId: task.id, pr: { number: pr.number, href: pr.href ?? existing?.pr.href, at: pr.at } });
      }
    }
    merged = prOwner.size;
    for (const { task, at } of doneTasks) {
      const run = task.run;
      const runKey = run ? run.childSessionKey ?? run.sessionKey : undefined;
      const agentId = taskAgent(task, runKey);
      const replyKey = run?.sessionKey ?? task.sourceSessionKey ?? (agentId ? `agent:${agentId}:main` : undefined);
      const prs = [...prOwner.values()].filter((entry) => entry.taskId === task.id).map((entry) => entry.pr).sort((a, b) => a.number - b.number);
      tasks.push({
        key: `task:${task.id}`,
        at,
        kind: 'task',
        title: task.title,
        detail: task.result?.trim() || newestNote(task),
        ...(prs.length > 0 ? { prs } : {}),
        sessionKey: runKey,
        agentId,
        taskId: task.id,
        failed: false,
        target: replyKey ? targetFor(replyKey, `About the task "${task.title}", done at ${formatClock(at)}.`) : undefined,
      });
    }
  }
  tasks.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));

  // Crons: failing ones pinned, today's other failures as one line per job, good runs folded.
  const failing: DayRow[] = [];
  const cronLines: DayRow[] = [];
  const cronsOk: DayRow[] = [];
  let cronOk = 0;
  let cronPartial = false;
  if (sourceOn('crons')) {
    const cronSessionOf = (jobId: string) => {
      for (const key of sessionsByKey.keys()) {
        if (isCronSessionKey(key) && key.endsWith(`:cron:${jobId}`)) return key;
      }
      return undefined;
    };
    for (const job of input.crons) {
      const entries = input.cronRuns[job.id] ?? [];
      const latest = cronLatestState(job, entries);
      const todays = entries.filter((entry) => today(entry.at)).sort((a, b) => a.at - b.at);
      const oldest = entries.length > 0 ? Math.min(...entries.map((entry) => entry.at)) : undefined;
      const partial = entries.length >= CRON_RUNS_LIMIT && oldest !== undefined && oldest >= dayStart;
      const ok = todays.filter((entry) => isOkCronStatus(entry.status));
      const failures = todays.filter((entry) => isFailedCronStatus(entry.status) && entry.status.toLowerCase() !== 'skipped');
      const isFailing = job.enabled && latest.failed;
      if (!isFailing && failures.length === 0 && ok.length === 0) continue;

      const sessionKey = cronSessionOf(job.id);
      const lastFailure = failures.at(-1);
      const recoveredAt = !latest.failed && lastFailure
        ? ok.find((entry) => entry.at > lastFailure.at)?.at
        : undefined;
      const cron: CronDay = {
        failing: isFailing,
        enabled: job.enabled,
        failedAt: failures.map((entry) => entry.at),
        ...(recoveredAt !== undefined ? { recoveredAt } : {}),
        okRuns: ok.length,
        partial: partial && ok.length > 0,
        latest: latest.newest,
        nextRun: isoToMs(job.nextRun),
        error: lastFailure?.error ?? (isFailing ? latest.error : undefined),
      };
      const title = job.name || job.label || job.id;
      const base = {
        kind: 'cron' as const,
        title,
        cronId: job.id,
        agentId: sessionKey ? getSessionAgentId(sessionKey) ?? undefined : undefined,
        sessionKey: latest.newest?.sessionKey ?? sessionKey,
        cron,
      };

      if (isFailing) {
        const failedAt = latest.at ?? now;
        failing.push({
          ...base,
          key: `cron:${job.id}:failing`,
          at: failedAt,
          failed: true,
          item: {
            // Now's key for the same failure, so both views act on one item.
            key: `crons:${job.id}:cron-failed:${job.lastRun ?? new Date(failedAt).toISOString()}`,
            source: 'crons',
            sourceId: job.id,
            kind: 'cron-failed',
            section: 'blocked',
            title,
            updatedAt: failedAt,
            deadline: cron.nextRun,
            priority: 'normal',
            freshness: input.sources.crons.state === 'live' ? 'live' : 'stale',
            open: { type: 'cron', id: job.id },
            detail: { error: cron.error, nextRun: cron.nextRun },
          },
        });
      } else if (lastFailure) {
        cronLines.push({ ...base, key: `cron:${job.id}:failed`, at: recoveredAt ?? lastFailure.at, failed: false });
      }

      if (ok.length > 0) {
        cronOk += ok.length;
        if (cron.partial) cronPartial = true;
        cronsOk.push({ ...base, key: `cron:${job.id}:ok`, at: ok.at(-1)!.at, failed: false });
      }
    }
  }
  failing.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
  cronLines.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
  cronsOk.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));

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
      const running = isRunning(session, input);
      const failingNow = !running && granular?.status === 'ERROR';
      chatRows.set(key, {
        key,
        title: sessionTitle(session, input),
        agentId: getSessionAgentId(key) ?? undefined,
        channel: channelOf(session),
        lastActivity: activity,
        topLevel: isTopLevelAgentSessionKey(key),
        spawned: isSpawnedSession(session),
        running,
        failing: failingNow,
        failed: failingNow || Boolean(end?.failed),
        ended: Boolean(end),
        ...(end ? { end: { at: end.at, status: end.status, ...(end.failed && session.lastRunError?.trim() ? { error: session.lastRunError.trim() } : {}) } } : {}),
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
  const failingChats = [...chatRows.values()].filter((row) => row.failing).length;

  return {
    dayStart,
    dayKey: localDayKey(now),
    stats: {
      sessions: chatRows.size,
      done: tasks.length,
      merged,
      cronOk,
      cronFailed: failing.length,
      failing: failing.length + failingChats,
      cronPartial,
    },
    failing,
    done: [...tasks, ...cronLines],
    cronsOk,
    chats,
  };
}

export function flattenChats(rows: ChatRow[]): ChatRow[] {
  return rows.flatMap((row) => [row, ...flattenChats(row.children)]);
}

/** Whose turn a chat is: Waiting on you, Working, or no marker. */
export type TurnMarker = 'waiting' | 'working' | null;

/**
 * Whose turn a chat is. Waiting on you when the Now board holds the session against the
 * operator; Working while a run is active; Waiting on you again when the thread's newest
 * message is the agent's and asks the operator something. A subagent's "user" is its parent
 * agent, so a spawned session never waits on the operator from its own thread.
 */
export function turnOf(row: ChatRow, summary: ThreadSummary | undefined): TurnMarker {
  if (row.needs) return 'waiting';
  if (row.running) return 'working';
  if (!row.spawned && !row.ended && summary?.lastSpeaker === 'agent' && summary.asksOperator) return 'waiting';
  return null;
}

/**
 * The first sentence of a summary, whole: it ends at `.`, `!` or `?` followed by a space and a
 * capital (or the end of the text), so "v1.6.0", "e.g. this" and "PR #460." do not cut it.
 */
export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const match = /^.+?[.!?]["')\]]*(?=\s+["'([]?[A-Z0-9]|$)/.exec(flat);
  return match ? match[0] : flat;
}

/**
 * The day's compact facts for the paragraph: counts, a short line per thing done and per chat,
 * and the sources that were not read. Successful and recovered cron runs are left out. Chat
 * lines carry no times, so the facts only change when something new happens.
 */
export function dayFacts(day: Day, missing: string[]): {
  day: string;
  counts: { sessions: number; done: number; merged: number; cronFailed: number };
  done: string[];
  chats: string[];
  missing: string[];
} {
  const clip = (text: string) => (text.length > 200 ? `${text.slice(0, 197).trimEnd()}...` : text);
  const failingLines = day.failing.map((row) => clip(`${formatClock(row.at)} Cron ${flatten(row.title)} failed`));
  const taskLines = day.done.filter((row) => row.kind === 'task').flatMap((row) => [
    clip(`${formatClock(row.at)} Task done: ${flatten(row.title)}`),
    ...(row.prs ?? []).map((pr) => clip(`${formatClock(pr.at)} PR #${pr.number} merged (${flatten(row.title)})`)),
  ]);
  const chatLines = flattenChats(day.chats).map((row) => clip([
    flatten(row.title),
    row.channel,
    row.running ? 'running' : undefined,
    row.failing ? 'failed' : row.ended ? (row.end && FAILED_END_STATUSES.has(row.end.status) ? `ended ${row.end.status}` : 'finished') : undefined,
    row.needs ? `needs the operator (${row.needs})` : undefined,
  ].filter(Boolean).join(', ')));
  return {
    day: day.dayKey,
    counts: {
      sessions: day.stats.sessions,
      done: day.stats.done,
      merged: day.stats.merged,
      cronFailed: day.stats.cronFailed,
    },
    done: [...failingLines, ...taskLines].slice(0, 40),
    chats: chatLines.slice(0, 30),
    missing,
  };
}
