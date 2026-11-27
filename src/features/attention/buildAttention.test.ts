import { describe, expect, it } from 'vitest';
import type { KanbanTask, TaskRunLink } from '@/features/kanban/types';
import type { KanbanProposal } from '@/features/kanban/hooks/useProposals';
import type { CronJob } from '@/features/workspace/hooks/useCrons';
import type { Session } from '@/types';
import {
  buildAttention,
  rankItems,
  FAILURE_WINDOW_MS,
  GONE_QUIET_MS,
} from './buildAttention';
import type { AttentionInput, AttentionItem, AttentionSource, SourceStatus } from './types';

const NOW = Date.UTC(2026, 10, 27, 8, 22);
const HOUR = 3_600_000;
const DAY = 86_400_000;

function task(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: 't1',
    title: 'Fix the backup',
    status: 'todo',
    priority: 'normal',
    createdBy: 'operator',
    createdAt: NOW - 2 * DAY,
    updatedAt: NOW - HOUR,
    version: 1,
    labels: [],
    columnOrder: 0,
    feedback: [],
    ...overrides,
  };
}

function run(overrides: Partial<TaskRunLink> = {}): TaskRunLink {
  return {
    sessionKey: 'agent:kim:main',
    startedAt: NOW - 2 * HOUR,
    status: 'running',
    ...overrides,
  };
}

function proposal(overrides: Partial<KanbanProposal> = {}): KanbanProposal {
  return {
    id: 'p1',
    type: 'create',
    payload: { title: 'Write release notes' },
    proposedBy: 'agent:kim',
    proposedAt: NOW - 3 * HOUR,
    status: 'pending',
    version: 1,
    ...overrides,
  };
}

function cron(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: 'c1',
    name: 'Nightly backup',
    enabled: true,
    scheduleKind: 'cron',
    schedule: '0 2 * * *',
    payloadKind: 'agentTurn',
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    key: 'agent:kim:subagent:abc',
    label: 'Research worker',
    updatedAt: NOW - 10 * 60_000,
    ...overrides,
  };
}

function live(): Record<AttentionSource, SourceStatus> {
  return {
    tasks: { state: 'live', checkedAt: NOW },
    proposals: { state: 'live', checkedAt: NOW },
    crons: { state: 'live', checkedAt: NOW },
    sessions: { state: 'live', checkedAt: NOW },
  };
}

function input(overrides: Partial<AttentionInput> = {}): AttentionInput {
  return {
    now: NOW,
    lastLook: NOW - 8 * HOUR,
    seen: new Set<string>(),
    tasks: [],
    proposals: [],
    crons: [],
    sessions: [],
    agentStatus: {},
    busyState: {},
    sources: live(),
    ...overrides,
  };
}

function all(brief: ReturnType<typeof buildAttention>): AttentionItem[] {
  return [...brief.decide, ...brief.blocked, ...brief.progress, ...brief.finished];
}

describe('buildAttention', () => {
  it('review task becomes a decide item with its result and run detail', () => {
    const t = task({
      status: 'review',
      assignee: 'agent:kim',
      result: 'Rotated the keys and updated the docs.',
      run: run({ status: 'done', endedAt: NOW - HOUR, childSessionKey: 'agent:kim:subagent:w1' }),
    });
    const brief = buildAttention(input({ tasks: [t] }));
    expect(brief.decide).toHaveLength(1);
    const item = brief.decide[0];
    expect(item).toMatchObject({
      key: 'tasks:t1:review',
      source: 'tasks',
      sourceId: 't1',
      kind: 'review',
      section: 'decide',
      title: 'Fix the backup',
      ownerId: 'kim',
      priority: 'normal',
      freshness: 'live',
      open: { type: 'task', id: 't1' },
    });
    expect(item.detail).toMatchObject({
      result: 'Rotated the keys and updated the docs.',
      runStatus: 'done',
      runEndedAt: NOW - HOUR,
      sessionKey: 'agent:kim:subagent:w1',
    });
    expect(all(brief)).toHaveLength(1);
  });

  it('an update proposal that changes priority ranks at the requested one', () => {
    const target = task({ id: 'deploy', title: 'Deploy the site', status: 'in-progress', priority: 'normal' });
    const p = proposal({ type: 'update', payload: { id: 'deploy', priority: 'critical' } });
    const brief = buildAttention(input({ tasks: [target], proposals: [p] }));
    expect(brief.decide.find((i) => i.kind === 'proposal')?.priority).toBe('critical');
  });

  it('pending proposal for an update takes the target task title and priority', () => {
    const target = task({ id: 'deploy', title: 'Deploy the site', status: 'in-progress', priority: 'high' });
    const p = proposal({ type: 'update', payload: { id: 'deploy', status: 'review' } });
    const brief = buildAttention(input({ tasks: [target], proposals: [p] }));
    const item = brief.decide.find((i) => i.kind === 'proposal');
    expect(item).toMatchObject({
      key: 'proposals:p1:proposal',
      source: 'proposals',
      title: 'Deploy the site',
      priority: 'high',
      ownerId: 'kim',
      updatedAt: NOW - 3 * HOUR,
      open: { type: 'proposal', id: 'p1' },
    });
    expect(item?.detail.proposedBy).toBe('agent:kim');
    expect(item?.detail.proposalChange).toBe('status');
  });

  it('failed run in todo within 7 days is blocked; older or aborted is not', () => {
    const recent = task({ id: 'recent', run: run({ status: 'error', endedAt: NOW - DAY, error: 'boom' }) });
    const old = task({ id: 'old', run: run({ status: 'error', endedAt: NOW - FAILURE_WINDOW_MS - HOUR }) });
    const aborted = task({ id: 'aborted', run: run({ status: 'aborted', endedAt: NOW - HOUR }) });
    const brief = buildAttention(input({ tasks: [recent, old, aborted] }));
    expect(brief.blocked.map((i) => i.sourceId)).toEqual(['recent']);
    expect(brief.blocked[0]).toMatchObject({
      kind: 'task-failed',
      key: `tasks:recent:task-failed:${NOW - 2 * HOUR}`,
      updatedAt: NOW - DAY,
    });
    expect(brief.blocked[0].detail.error).toBe('boom');
    expect(all(brief).some((i) => i.sourceId === 'old' || i.sourceId === 'aborted')).toBe(false);
  });

  it('failed run on a task no longer in backlog or todo is not shown', () => {
    const moved = task({ status: 'in-progress', run: run({ status: 'error', endedAt: NOW - HOUR }) });
    const done = task({ id: 't2', status: 'done', run: run({ status: 'error', endedAt: NOW - HOUR }) });
    const brief = buildAttention(input({ tasks: [moved, done] }));
    expect(all(brief)).toHaveLength(0);
  });

  it('running task whose session is silent for 3h is gone quiet, not in progress', () => {
    const quietKey = 'agent:kim:subagent:quiet';
    const busyKey = 'agent:kim:subagent:busy';
    const quiet = task({ id: 'quiet', status: 'in-progress', run: run({ sessionKey: quietKey, startedAt: NOW - 5 * HOUR }) });
    const busy = task({ id: 'busy', status: 'in-progress', run: run({ sessionKey: busyKey }) });
    const brief = buildAttention(input({
      tasks: [quiet, busy],
      sessions: [
        session({ key: quietKey, updatedAt: NOW - GONE_QUIET_MS - 60_000 }),
        session({ key: busyKey, updatedAt: NOW - 60_000 }),
      ],
    }));
    expect(brief.blocked.map((i) => i.sourceId)).toEqual(['quiet']);
    expect(brief.blocked[0].kind).toBe('gone-quiet');
    expect(brief.blocked[0].key).toBe(`tasks:quiet:gone-quiet:${NOW - 5 * HOUR}`);
    expect(brief.blocked[0].detail.quietSince).toBe(NOW - GONE_QUIET_MS - 60_000);
    expect(brief.progress.map((i) => i.sourceId)).toEqual(['busy']);
    expect(brief.progress[0].kind).toBe('task-running');
  });

  it('folds a session into its task', () => {
    const childKey = 'agent:kim:subagent:child';
    const t = task({ status: 'in-progress', run: run({ sessionKey: 'agent:kim:main', childSessionKey: childKey }) });
    const brief = buildAttention(input({
      tasks: [t],
      sessions: [session({ key: childKey, updatedAt: NOW - 60_000 })],
      busyState: { [childKey]: true },
    }));
    expect(brief.progress).toHaveLength(1);
    expect(brief.progress[0]).toMatchObject({ kind: 'task-running', sourceId: 't1' });
    expect(all(brief).some((i) => i.source === 'sessions')).toBe(false);
  });

  it('top-level agent sessions never appear', () => {
    const mainKey = 'agent:kim:main';
    const brief = buildAttention(input({
      sessions: [session({ key: mainKey })],
      busyState: { [mainKey]: true },
      agentStatus: { [mainKey]: { status: 'ERROR', since: NOW - HOUR } },
    }));
    expect(all(brief)).toHaveLength(0);
  });

  it('errored subagent session is a live-only blocked item', () => {
    const key = 'agent:kim:subagent:broken';
    const since = NOW - 20 * 60_000;
    const brief = buildAttention(input({
      sessions: [session({ key })],
      agentStatus: { [key]: { status: 'ERROR', since } },
      busyState: { [key]: true },
    }));
    expect(brief.blocked).toHaveLength(1);
    expect(brief.blocked[0]).toMatchObject({
      key: `sessions:${key}:session-failed:${since}`,
      kind: 'session-failed',
      source: 'sessions',
      ownerId: 'kim',
      updatedAt: since,
      open: { type: 'session', key },
    });
    expect(brief.progress).toHaveLength(0);
  });

  it('failing enabled cron is blocked with nextRun as deadline; disabled cron is ignored', () => {
    const lastRun = new Date(NOW - 6 * HOUR).toISOString();
    const nextRun = new Date(NOW + 18 * HOUR).toISOString();
    const failing = cron({ lastStatus: 'error', lastError: 'disk full', lastRun, nextRun });
    const disabled = cron({ id: 'c2', enabled: false, lastStatus: 'error', lastRun, nextRun });
    const brief = buildAttention(input({ crons: [failing, disabled] }));
    expect(brief.blocked).toHaveLength(1);
    expect(brief.blocked[0]).toMatchObject({
      key: `crons:c1:cron-failed:${lastRun}`,
      kind: 'cron-failed',
      title: 'Nightly backup',
      deadline: NOW + 18 * HOUR,
      updatedAt: NOW - 6 * HOUR,
      priority: 'normal',
      open: { type: 'cron', id: 'c1' },
    });
    expect(brief.blocked[0].detail).toMatchObject({ error: 'disk full', nextRun: NOW + 18 * HOUR });
  });

  it('successful cron run after lastLook is finished; before lastLook is not', () => {
    const after = cron({ id: 'after', name: 'Morning brief', lastStatus: 'ok', lastRun: new Date(NOW - HOUR).toISOString() });
    const before = cron({ id: 'before', lastStatus: 'success', lastRun: new Date(NOW - 10 * HOUR).toISOString() });
    const brief = buildAttention(input({ crons: [after, before] }));
    expect(brief.finished.map((i) => i.sourceId)).toEqual(['after']);
    expect(brief.finished[0].kind).toBe('cron-finished');
  });

  it('review task is not also finished', () => {
    const t = task({ status: 'review', run: run({ status: 'done', endedAt: NOW - HOUR }) });
    const brief = buildAttention(input({ tasks: [t] }));
    expect(brief.decide.map((i) => i.sourceId)).toEqual(['t1']);
    expect(brief.finished).toHaveLength(0);
  });

  it('seen keys move to brief.seen; a new failure of the same task has a new key and is shown', () => {
    const first = task({ run: run({ status: 'error', startedAt: NOW - 5 * HOUR, endedAt: NOW - 4 * HOUR }) });
    const seenKey = buildAttention(input({ tasks: [first] })).blocked[0].key;

    const seenBrief = buildAttention(input({ tasks: [first], seen: new Set([seenKey]) }));
    expect(seenBrief.blocked).toHaveLength(0);
    expect(seenBrief.seen.blocked.map((i) => i.key)).toEqual([seenKey]);

    const again = task({ run: run({ status: 'error', startedAt: NOW - HOUR, endedAt: NOW - 30 * 60_000 }) });
    const againBrief = buildAttention(input({ tasks: [again], seen: new Set([seenKey]) }));
    expect(againBrief.blocked).toHaveLength(1);
    expect(againBrief.blocked[0].key).not.toBe(seenKey);
    expect(againBrief.seen.blocked).toHaveLength(0);
  });

  it('brief is not clear while a source is loading or errored', () => {
    const empty = buildAttention(input());
    expect(empty.allClear).toBe(true);

    const loading = buildAttention(input({ sources: { ...live(), crons: { state: 'loading' } } }));
    expect(loading.allClear).toBe(false);

    const errored = buildAttention(input({
      crons: [cron({ lastStatus: 'error', lastRun: new Date(NOW - HOUR).toISOString() })],
      sources: { ...live(), crons: { state: 'error', error: 'HTTP 502' } },
    }));
    expect(errored.allClear).toBe(false);
    expect(errored.sources.crons).toEqual({ state: 'error', error: 'HTTP 502' });
  });

  it('an errored source keeps contributing its retained items, shown as stale', () => {
    const errored = buildAttention(input({
      tasks: [task({ status: 'review' })],
      crons: [cron({ lastStatus: 'error', lastRun: new Date(NOW - HOUR).toISOString() })],
      sources: {
        ...live(),
        tasks: { state: 'error', error: 'HTTP 503' },
        crons: { state: 'error', error: 'HTTP 502' },
      },
    }));
    expect(errored.decide.map((i) => [i.sourceId, i.freshness])).toEqual([['t1', 'stale']]);
    expect(errored.blocked.map((i) => [i.sourceId, i.freshness])).toEqual([['c1', 'stale']]);
    expect(errored.allClear).toBe(false);
  });

  it('tasks source off produces no task or proposal items and allClear stays false', () => {
    const brief = buildAttention(input({
      tasks: [task({ status: 'review' })],
      proposals: [proposal()],
      sources: { ...live(), tasks: { state: 'off' } },
    }));
    expect(all(brief).some((i) => i.source === 'tasks' || i.source === 'proposals')).toBe(false);
    expect(brief.allClear).toBe(false);
  });

  it('a create proposal takes its payload priority when it is a valid one, else normal', () => {
    const brief = buildAttention(input({
      proposals: [
        proposal({ id: 'urgent', payload: { title: 'Patch the gateway', priority: 'critical' } }),
        proposal({ id: 'odd', payload: { title: 'Odd one', priority: 'urgent' } }),
        proposal({ id: 'none', payload: { title: 'No priority' } }),
      ],
    }));
    const priorityOf = (id: string) => brief.decide.find((i) => i.sourceId === id)?.priority;
    expect(priorityOf('urgent')).toBe('critical');
    expect(priorityOf('odd')).toBe('normal');
    expect(priorityOf('none')).toBe('normal');
  });

  it('reads a string lastActivity as session activity', () => {
    const key = 'agent:kim:subagent:iso';
    const t = task({
      status: 'in-progress',
      updatedAt: NOW - 5 * HOUR,
      run: run({ sessionKey: key }),
    });
    const brief = buildAttention(input({
      tasks: [t],
      sessions: [session({ key, updatedAt: undefined, lastActivity: new Date(NOW - 60_000).toISOString() })],
    }));
    expect(brief.progress.map((i) => i.kind)).toEqual(['task-running']);
    expect(brief.blocked).toHaveLength(0);
  });

  it('uses the newest of updatedAt and lastActivity', () => {
    const key = 'agent:kim:subagent:both';
    const t = task({
      status: 'in-progress',
      updatedAt: NOW - 5 * HOUR,
      run: run({ sessionKey: key }),
    });
    const brief = buildAttention(input({
      tasks: [t],
      sessions: [session({ key, updatedAt: NOW - 4 * HOUR, lastActivity: new Date(NOW - 60_000).toISOString() })],
    }));
    expect(brief.progress.map((i) => i.kind)).toEqual(['task-running']);
    expect(brief.blocked).toHaveLength(0);
  });

  it('an errored session linked to a finished task run still shows as session-failed', () => {
    const key = 'agent:kim:subagent:err';
    const since = NOW - 20 * 60_000;
    const done = task({
      status: 'done',
      run: run({ status: 'done', sessionKey: key, endedAt: NOW - HOUR }),
    });
    const brief = buildAttention(input({
      tasks: [done],
      sessions: [session({ key })],
      agentStatus: { [key]: { status: 'ERROR', since } },
    }));
    expect(brief.blocked.map((i) => i.kind)).toEqual(['session-failed']);
  });

  it('counts quiet time from the run start, not older session activity', () => {
    const key = 'agent:kim:subagent:fresh';
    const t = task({ status: 'in-progress', updatedAt: NOW - 5 * HOUR, run: run({ sessionKey: key, startedAt: NOW - 60_000 }) });
    const brief = buildAttention(input({ tasks: [t], sessions: [session({ key, updatedAt: NOW - 4 * HOUR })] }));
    expect(brief.progress.map((i) => i.kind)).toEqual(['task-running']);
    expect(brief.blocked).toHaveLength(0);
  });

  it('does not report gone quiet while sessions cannot be read', () => {
    const key = 'agent:kim:subagent:dark';
    const t = task({ status: 'in-progress', run: run({ sessionKey: key, startedAt: NOW - 5 * HOUR }) });
    const brief = buildAttention(input({
      tasks: [t],
      sessions: [session({ key, updatedAt: NOW - 4 * HOUR })],
      sources: { ...live(), sessions: { state: 'error' } },
    }));
    expect(brief.progress.map((i) => i.kind)).toEqual(['task-running']);
    expect(brief.blocked).toHaveLength(0);
  });

  it('an errored session linked to a running task run shows as session-failed', () => {
    const key = 'agent:kim:subagent:running-err';
    const since = NOW - 10 * 60_000;
    const t = task({ status: 'in-progress', run: run({ sessionKey: key, startedAt: NOW - 30 * 60_000 }) });
    const brief = buildAttention(input({
      tasks: [t],
      sessions: [session({ key, updatedAt: NOW - 60_000 })],
      agentStatus: { [key]: { status: 'ERROR', since } },
    }));
    expect(brief.blocked.map((i) => i.kind)).toEqual(['session-failed']);
  });

  it('uses lastLook for since and falls back to the last 24 hours', () => {
    expect(buildAttention(input({ lastLook: NOW - HOUR })).since).toBe(NOW - HOUR);
    expect(buildAttention(input({ lastLook: null })).since).toBe(NOW - DAY);
  });
});

describe('rankItems', () => {
  function item(key: string, overrides: Partial<AttentionItem> = {}): AttentionItem {
    return {
      key,
      source: 'tasks',
      sourceId: key,
      kind: 'review',
      section: 'decide',
      title: key,
      updatedAt: NOW - HOUR,
      priority: 'normal',
      freshness: 'live',
      open: { type: 'task', id: key },
      detail: {},
      ...overrides,
    };
  }

  it('rankItems: overdue deadline, then soonest deadline, then critical before normal, then oldest first', () => {
    const items = [
      item('newer-normal', { updatedAt: NOW - HOUR }),
      item('later-deadline', { deadline: NOW + 5 * HOUR }),
      item('critical', { priority: 'critical', updatedAt: NOW - 60_000 }),
      item('overdue', { deadline: NOW - HOUR }),
      item('older-normal', { updatedAt: NOW - 5 * HOUR }),
      item('soon-deadline', { deadline: NOW + HOUR }),
    ];
    const ranked = rankItems(items, NOW);
    expect(ranked.map((i) => i.key)).toEqual([
      'overdue',
      'soon-deadline',
      'later-deadline',
      'critical',
      'older-normal',
      'newer-normal',
    ]);
    expect(items[0].key).toBe('newer-normal');
  });
});
