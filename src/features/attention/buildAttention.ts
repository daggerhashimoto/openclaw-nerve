/**
 * The Attention normalizer: turns tasks, proposals, crons and sessions into a
 * ranked brief. Pure: every time comes from `input.now`.
 */

import type { KanbanTask, TaskActor, TaskPriority } from '@/features/kanban/types';
import type { KanbanProposal } from '@/features/kanban/hooks/useProposals';
import type { CronJob } from '@/features/workspace/hooks/useCrons';
import { isFailedCronStatus, isOkCronStatus } from '@/features/workspace/cronStatus';
import { getSessionAgentId, isTopLevelAgentSessionKey } from '@/features/sessions/sessionKeys';
import { isGranularLive } from '@/lib/paneState';
import { getSessionKey, type Session } from '@/types';
import type { CronRunEntry } from './today/buildDay';
import { prMentions } from './today/buildDay';
import type { ExecApproval } from './execApprovals';
import { sessionDisplayName } from './sessionNames';
import type {
  AttentionBrief,
  AttentionInput,
  AttentionItem,
  AttentionSource,
  EvidenceLink,
  SourceStatus,
} from './types';

export const GONE_QUIET_MS = 3 * 3600_000;
export const FAILURE_WINDOW_MS = 7 * 86_400_000;
export const FIRST_RUN_WINDOW_MS = 86_400_000;

const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };
const OFF: SourceStatus = { state: 'off' };
const FAILED_TASK_STATUSES = new Set(['backlog', 'todo']);
const CLOSED_TASK_STATUSES = new Set(['done', 'cancelled']);
// Fields the server applies from an update proposal.
const UPDATE_FIELDS = ['title', 'description', 'status', 'priority', 'assignee', 'labels', 'result'];

/** Deadline first (overdue, then upcoming, then none), then priority, then oldest first. */
export function rankItems(items: AttentionItem[], now: number): AttentionItem[] {
  const tier = (item: AttentionItem) => {
    if (item.deadline === undefined) return 2;
    return item.deadline < now ? 0 : 1;
  };
  return [...items].sort((a, b) => (
    tier(a) - tier(b)
    || (a.deadline ?? 0) - (b.deadline ?? 0)
    || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || a.updatedAt - b.updatedAt
    || a.key.localeCompare(b.key)
  ));
}

function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PRIORITY_RANK, value);
}

function agentIdOf(actor?: TaskActor | string): string | undefined {
  return actor?.startsWith('agent:') ? actor.slice('agent:'.length) : undefined;
}

function isoToMs(value?: string): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

/** Pull request links a task's result and notes carry; bare `#123` without a link is left out. */
function taskLinks(task: KanbanTask): EvidenceLink[] | undefined {
  const texts = [task.result ?? '', ...(task.feedback ?? []).map((note) => note?.note ?? '')].join('\n');
  const links = prMentions(texts)
    .filter((mention) => mention.href)
    .map((mention) => ({ label: `PR #${mention.number}`, href: mention.href! }));
  return links.length > 0 ? links : undefined;
}

/** An errored source still contributes the data the hook kept, shown as stale; only off does not. */
function contributes(status: SourceStatus): boolean {
  return status.state !== 'off';
}

function freshnessOf(status: SourceStatus): AttentionItem['freshness'] {
  return status.state === 'live' ? 'live' : 'stale';
}

function sessionActivity(session: Session | undefined): number | undefined {
  if (!session) return undefined;
  const { updatedAt, lastActivity } = session;
  const times = [
    typeof updatedAt === 'number' ? updatedAt : undefined,
    typeof lastActivity === 'number' ? lastActivity : typeof lastActivity === 'string' ? isoToMs(lastActivity) : undefined,
  ].filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  return times.length ? Math.max(...times) : undefined;
}

function taskItems(input: AttentionInput, sessionsByKey: Map<string, Session>): AttentionItem[] {
  const { now, sources } = input;
  const freshness = freshnessOf(sources.tasks);
  const since = sinceOf(input);
  const items: AttentionItem[] = [];

  for (const task of input.tasks) {
    const run = task.run;
    const linkedKey = run ? run.childSessionKey ?? run.sessionKey : undefined;
    const base = {
      source: 'tasks' as const,
      sourceId: task.id,
      title: task.title,
      ownerId: agentIdOf(task.assignee),
      deadline: task.dueAt,
      priority: task.priority,
      freshness,
      open: { type: 'task' as const, id: task.id },
    };

    if (task.status === 'review') {
      items.push({
        ...base,
        key: `tasks:${task.id}:review`,
        kind: 'review',
        section: 'decide',
        updatedAt: task.resultAt ?? run?.endedAt ?? task.updatedAt,
        detail: { result: task.result, runStatus: run?.status, runEndedAt: run?.endedAt, sessionKey: linkedKey, links: taskLinks(task) },
      });
      continue;
    }
    if (!run) continue;

    if (run.status === 'error') {
      const endedAt = run.endedAt ?? task.updatedAt;
      if (FAILED_TASK_STATUSES.has(task.status) && now - endedAt <= FAILURE_WINDOW_MS) {
        items.push({
          ...base,
          key: `tasks:${task.id}:task-failed:${run.startedAt}`,
          kind: 'task-failed',
          section: 'blocked',
          updatedAt: endedAt,
          detail: { runStatus: run.status, runEndedAt: run.endedAt, sessionKey: linkedKey, error: run.error },
        });
      }
      continue;
    }

    if (run.status === 'running') {
      // Quiet time counts from this run's start, and only while session activity can be observed.
      const activity = Math.max(run.startedAt, sessionActivity(sessionsByKey.get(linkedKey ?? '')) ?? task.updatedAt);
      const quiet = sources.sessions.state === 'live' && now - activity > GONE_QUIET_MS;
      items.push({
        ...base,
        key: quiet ? `tasks:${task.id}:gone-quiet:${run.startedAt}` : `tasks:${task.id}:task-running`,
        kind: quiet ? 'gone-quiet' : 'task-running',
        section: quiet ? 'blocked' : 'progress',
        updatedAt: quiet ? activity : run.startedAt,
        detail: { runStatus: run.status, sessionKey: linkedKey, ...(quiet ? { quietSince: activity } : {}) },
      });
      continue;
    }

    if (run.status === 'done' && run.endedAt !== undefined && run.endedAt > since
      && !CLOSED_TASK_STATUSES.has(task.status)) {
      items.push({
        ...base,
        key: `tasks:${task.id}:task-finished:${run.startedAt}`,
        kind: 'task-finished',
        section: 'finished',
        updatedAt: run.endedAt,
        detail: { result: task.result, runStatus: run.status, runEndedAt: run.endedAt, sessionKey: linkedKey, links: taskLinks(task) },
      });
    }
  }
  return items;
}

function proposalItem(proposal: KanbanProposal, tasks: KanbanTask[], status: SourceStatus): AttentionItem {
  const payload = proposal.payload;
  const payloadTitle = typeof payload.title === 'string' && payload.title ? payload.title : undefined;
  let title = payloadTitle ?? 'New task';
  let priority: TaskPriority = isTaskPriority(payload.priority) ? payload.priority : 'normal';
  let proposalChange: string | undefined;

  if (proposal.type === 'update') {
    const target = tasks.find((t) => t.id === payload.id);
    title = target?.title ?? payloadTitle ?? 'Task update';
    // A proposal that changes priority ranks at the requested one
    if (!isTaskPriority(payload.priority)) priority = target?.priority ?? 'normal';
    const changed = UPDATE_FIELDS.filter((field) => field in payload);
    proposalChange = changed.length > 0 ? changed.join(', ') : undefined;
  }

  return {
    key: `proposals:${proposal.id}:proposal`,
    source: 'proposals',
    sourceId: proposal.id,
    kind: 'proposal',
    section: 'decide',
    title,
    ownerId: agentIdOf(proposal.proposedBy),
    updatedAt: proposal.proposedAt,
    priority,
    freshness: freshnessOf(status),
    open: { type: 'proposal', id: proposal.id },
    detail: { proposedBy: proposal.proposedBy, proposalChange },
  };
}

/**
 * A failing cron while its latest run failed, and a recovered one when a failure since the last
 * look was followed by a good run. The run history, when read, overrides the job's own last
 * status: a failure followed by a later good run is not failing. Good runs are not listed.
 */
function cronItems(
  crons: CronJob[],
  runsByJob: Record<string, CronRunEntry[]> | undefined,
  since: number,
  now: number,
  status: SourceStatus,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const job of crons) {
    if (!job.enabled) continue;
    const lastRun = isoToMs(job.lastRun);
    const nextRun = isoToMs(job.nextRun);
    const base = {
      source: 'crons' as const,
      sourceId: job.id,
      title: job.name || job.label || job.id,
      priority: 'normal' as const,
      freshness: freshnessOf(status),
      open: { type: 'cron' as const, id: job.id },
    };
    const runs = [...(runsByJob?.[job.id] ?? [])]
      .filter((entry) => entry.status.toLowerCase() !== 'skipped')
      .sort((a, b) => b.at - a.at);
    const newest = runs[0];
    const newestIsLater = newest !== undefined && (lastRun === undefined || newest.at > lastRun);
    const latestOk = newestIsLater ? isOkCronStatus(newest.status) : isOkCronStatus(job.lastStatus);
    const latestFailed = newestIsLater ? isFailedCronStatus(newest.status) : isFailedCronStatus(job.lastStatus);

    if (latestFailed) {
      const failedAt = newestIsLater ? newest.at : lastRun;
      items.push({
        ...base,
        // The job's own last run names the failure, so reading the history never re-keys it.
        key: `crons:${job.id}:cron-failed:${job.lastRun ?? new Date(newest.at).toISOString()}`,
        kind: 'cron-failed',
        section: 'blocked',
        updatedAt: failedAt ?? now,
        deadline: nextRun,
        detail: { error: (newestIsLater ? newest.error : undefined) ?? job.lastError, nextRun },
      });
      continue;
    }
    if (!latestOk || runs.length === 0) continue;
    // The newest failure since the last look that a good run came after.
    const okAt = newestIsLater ? newest.at : lastRun ?? newest.at;
    const failure = runs.find((entry) => isFailedCronStatus(entry.status) && entry.at > since && entry.at < okAt);
    if (!failure) continue;
    // Runs are newest first, so the last good run after the failure is the first to recover it.
    const recoveredAt = runs.filter((entry) => isOkCronStatus(entry.status) && entry.at > failure.at).at(-1)?.at ?? okAt;
    items.push({
      ...base,
      key: `crons:${job.id}:cron-recovered:${failure.at}`,
      kind: 'cron-recovered',
      section: 'finished',
      updatedAt: recoveredAt,
      detail: { error: failure.error, failedAt: failure.at, nextRun },
    });
  }
  return items;
}

/** Pending exec approvals: they hold an agent until the operator answers, so they rank first. */
function approvalItems(approvals: ExecApproval[], input: AttentionInput, status: SourceStatus): AttentionItem[] {
  const { now } = input;
  return approvals
    .filter((approval) => approval.expiresAt === undefined || approval.expiresAt > now)
    .map((approval) => ({
      key: `approvals:${approval.id}:approval`,
      source: 'approvals' as const,
      sourceId: approval.id,
      kind: 'approval' as const,
      section: 'decide' as const,
      title: (approval.preview ?? approval.command).split('\n')[0],
      ownerId: approval.agentId ?? (approval.sessionKey ? getSessionAgentId(approval.sessionKey) ?? undefined : undefined),
      updatedAt: approval.createdAt,
      deadline: approval.expiresAt,
      priority: 'high' as const,
      freshness: freshnessOf(status),
      open: approval.sessionKey ? { type: 'session' as const, key: approval.sessionKey } : null,
      detail: {
        sessionKey: approval.sessionKey,
        command: approval.command,
        commandPreview: approval.preview,
        sessionName: approval.sessionKey
          ? sessionDisplayName(approval.sessionKey, { tasks: input.tasks, crons: input.crons, sessions: input.sessions })
          : undefined,
        cwd: approval.cwd,
        host: approval.host,
        decisions: approval.decisions,
        warning: approval.warning,
        expiresAt: approval.expiresAt,
      },
    }));
}

function sessionItems(input: AttentionInput, linkedKeys: ReadonlySet<string>): AttentionItem[] {
  const items: AttentionItem[] = [];
  const freshness = freshnessOf(input.sources.sessions);
  for (const session of input.sessions) {
    const key = getSessionKey(session);
    if (!key || isTopLevelAgentSessionKey(key) || linkedKeys.has(key)) continue;
    const granular = input.agentStatus[key];
    const base = {
      source: 'sessions' as const,
      sourceId: key,
      title: sessionDisplayName(key, { tasks: input.tasks, crons: input.crons, sessions: input.sessions }),
      ownerId: getSessionAgentId(key) ?? undefined,
      priority: 'normal' as const,
      freshness,
      open: { type: 'session' as const, key },
    };
    if (granular?.status === 'ERROR') {
      items.push({
        ...base,
        key: `sessions:${key}:session-failed:${granular.since}`,
        kind: 'session-failed',
        section: 'blocked',
        updatedAt: granular.since,
        detail: { sessionKey: key },
      });
    } else if (input.busyState[key] || (granular && isGranularLive(granular))) {
      items.push({
        ...base,
        key: `sessions:${key}:session-running`,
        kind: 'session-running',
        section: 'progress',
        updatedAt: granular?.since ?? sessionActivity(session) ?? input.now,
        detail: { sessionKey: key },
      });
    }
  }
  return items;
}

function sinceOf(input: AttentionInput): number {
  return input.lastLook ?? input.now - FIRST_RUN_WINDOW_MS;
}

export function buildAttention(input: AttentionInput): AttentionBrief {
  const { now, seen } = input;
  const sources = { ...input.sources, approvals: input.sources.approvals ?? OFF };
  const since = sinceOf(input);
  const tasksOn = contributes(sources.tasks);
  // Proposals live on the task board, so tasks turned off hides them too.
  const proposalsOn = contributes(sources.proposals) && sources.tasks.state !== 'off';

  const sessionsByKey = new Map<string, Session>();
  for (const session of input.sessions) {
    const key = getSessionKey(session);
    if (key) sessionsByKey.set(key, session);
  }

  // Sessions linked to a running task fold into its running or gone-quiet card. A session
  // linked to any other run stays its own item, so its failure is not hidden.
  const linkedKeys = new Set<string>();
  if (tasksOn) {
    for (const task of input.tasks) {
      if (task.run?.status !== 'running') continue;
      // An errored session stays out so it still shows as a session failure.
      for (const key of [task.run.sessionKey, task.run.childSessionKey]) {
        if (key && input.agentStatus[key]?.status !== 'ERROR') linkedKeys.add(key);
      }
    }
  }

  const items: AttentionItem[] = [
    ...(tasksOn ? taskItems(input, sessionsByKey) : []),
    ...(proposalsOn
      ? input.proposals
        .filter((p) => p.status === 'pending')
        .map((p) => proposalItem(p, input.tasks, sources.proposals))
      : []),
    ...(contributes(sources.crons) ? cronItems(input.crons, input.cronRuns, since, now, sources.crons) : []),
    ...(contributes(sources.approvals) ? approvalItems(input.approvals ?? [], input, sources.approvals) : []),
    ...(contributes(sources.sessions) ? sessionItems(input, linkedKeys) : []),
  ];

  const decide = [
    ...rankItems(items.filter((i) => i.kind === 'approval'), now),
    ...rankItems(items.filter((i) => i.section === 'decide' && i.kind !== 'approval'), now),
  ];
  const decideIds = new Set(decide.map((i) => `${i.source}:${i.sourceId}`));
  const blockedAll = rankItems(items.filter((i) => i.section === 'blocked'), now);
  const progress = rankItems(items.filter((i) => i.section === 'progress'), now);
  const finishedAll = items
    .filter((i) => i.section === 'finished' && !decideIds.has(`${i.source}:${i.sourceId}`))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key));

  // A gateway without exec approvals has nothing to hold back; every other source must be live.
  const allLive = (Object.keys(sources) as AttentionSource[]).every((s) => (
    sources[s].state === 'live' || (s === 'approvals' && sources[s].state === 'off')
  ));

  const blocked = blockedAll.filter((i) => !seen.has(i.key));

  return {
    decide,
    blocked,
    progress,
    finished: finishedAll.filter((i) => !seen.has(i.key)),
    seen: {
      blocked: blockedAll.filter((i) => seen.has(i.key)),
      finished: finishedAll.filter((i) => seen.has(i.key)),
    },
    sources,
    since,
    allClear: allLive && decide.length === 0 && blocked.length === 0 && progress.length === 0,
  };
}
