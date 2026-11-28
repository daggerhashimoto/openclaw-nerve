import { describe, expect, it } from 'vitest';
import type { KanbanTask } from '@/features/kanban/types';
import type { CronJob } from '@/features/workspace/hooks/useCrons';
import type { Session } from '@/types';
import type { SourceStatus } from '../types';
import {
  CRON_FOLD_AFTER,
  CRON_RUNS_LIMIT,
  buildDay,
  flattenChats,
  channelOf,
  dayFacts,
  groupByHour,
  localDayKey,
  mergedPrs,
  prMentions,
  sessionEnd,
  startOfLocalDay,
  taskAgent,
  type CronRunEntry,
  type DayInput,
  type DaySource,
} from './buildDay';

// Local times, so the day boundary holds in any time zone the tests run in.
const NOW = new Date(2026, 10, 28, 15, 0).getTime();
const MIDNIGHT = new Date(2026, 10, 28, 0, 0).getTime();
const MINUTE = 60_000;
const HOUR = 3_600_000;
const at = (h: number, m = 0) => new Date(2026, 10, 28, h, m).getTime();

function task(overrides: Partial<KanbanTask> = {}): KanbanTask {
  const built: KanbanTask = {
    id: 't1',
    title: 'Fix the flaky retry test',
    status: 'done',
    priority: 'normal',
    assignee: 'agent:forge',
    createdBy: 'operator',
    createdAt: NOW - 30 * HOUR,
    updatedAt: at(14, 12),
    version: 1,
    labels: [],
    columnOrder: 0,
    feedback: [],
    ...overrides,
  };
  // Fixtures pass their finish time as updatedAt; the store stamps completedAt on entering done.
  if (built.status === 'done' && !('completedAt' in overrides)) built.completedAt = built.updatedAt;
  return built;
}

function cron(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: 'c1',
    name: 'Morning brief',
    enabled: true,
    scheduleKind: 'cron',
    payloadKind: 'agentTurn',
    lastStatus: 'ok',
    lastRun: new Date(at(7)).toISOString(),
    ...overrides,
  };
}

function live(): Record<DaySource, SourceStatus> {
  return {
    tasks: { state: 'live', checkedAt: NOW },
    crons: { state: 'live', checkedAt: NOW },
    cronRuns: { state: 'live', checkedAt: NOW },
    sessions: { state: 'live' },
  };
}

function input(overrides: Partial<DayInput> = {}): DayInput {
  return {
    now: NOW,
    tasks: [],
    crons: [],
    cronRuns: {},
    sessions: [],
    agentStatus: {},
    busyState: {},
    needsReply: new Map(),
    agentNames: new Map([['main', 'Kim'], ['forge', 'Forge']]),
    sources: live(),
    ...overrides,
  };
}

const run = (atMs: number, status = 'ok', extra: Partial<CronRunEntry> = {}): CronRunEntry => ({ at: atMs, status, ...extra });

describe('day boundary', () => {
  it('starts at local midnight and keys the local date', () => {
    expect(startOfLocalDay(NOW)).toBe(MIDNIGHT);
    expect(localDayKey(NOW)).toBe('2026-11-28');
    expect(localDayKey(MIDNIGHT - 1)).toBe('2026-11-27');
  });

  it('keeps what finished after midnight and drops what finished before it', () => {
    const day = buildDay(input({
      tasks: [
        task({ id: 'late', title: 'Late last night', updatedAt: MIDNIGHT - MINUTE }),
        task({ id: 'early', title: 'Just after midnight', updatedAt: MIDNIGHT + MINUTE }),
      ],
    }));
    expect(day.done.map((row) => row.title)).toEqual(['Just after midnight']);
    expect(day.dayKey).toBe('2026-11-28');
  });
});

describe('done tasks', () => {
  it('does not count an old done card that was only re-stamped today', () => {
    // A reorder re-stamps updatedAt on every card in the column; the card finished yesterday.
    const old = task({ id: 'old', updatedAt: at(10, 11), completedAt: undefined, feedback: [{ at: NOW - 20 * HOUR, by: 'agent:linus', note: 'Merged #452 as 68f8284' }] });
    const fresh = task({ id: 'fresh', updatedAt: at(10, 11), completedAt: undefined, feedback: [{ at: at(9, 30), by: 'agent:linus', note: 'Shipped' }] });
    const day = buildDay(input({ tasks: [old, fresh] }));
    expect(day.done.filter((r) => r.kind === 'task').map((r) => r.taskId)).toEqual(['fresh']);
    expect(day.done.some((r) => r.kind === 'pr')).toBe(false);
  });

  it('lists tasks that reached done today with their result, else the newest note', () => {
    const day = buildDay(input({
      tasks: [
        task({ id: 'a', title: 'With result', result: 'Patched and tested.', updatedAt: at(9) }),
        task({
          id: 'b',
          title: 'With notes',
          updatedAt: at(10),
          feedback: [
            { at: at(8), by: 'agent:forge', note: 'Older note' },
            { at: at(9, 30), by: 'agent:forge', note: 'Newest note' },
          ],
        }),
        task({ id: 'c', title: 'Still in review', status: 'review', updatedAt: at(11) }),
      ],
    }));
    expect(day.done.map((row) => [row.title, row.detail])).toEqual([
      ['With notes', 'Newest note'],
      ['With result', 'Patched and tested.'],
    ]);
    expect(day.stats.done).toBe(2);
    expect(day.done[0]).toMatchObject({ kind: 'task', taskId: 'b', agentId: 'forge' });
  });

  it('nudges the run session, or the assignee main session when there was no run', () => {
    const day = buildDay(input({
      tasks: [
        task({ id: 'a', run: { sessionKey: 'agent:forge:main', startedAt: at(8), endedAt: at(9), status: 'done' } }),
        task({ id: 'b', updatedAt: at(13) }),
      ],
    }));
    const byId = Object.fromEntries(day.done.map((row) => [row.taskId, row]));
    expect(byId.a.target).toMatchObject({ sessionKey: 'agent:forge:main', ask: false });
    expect(byId.a.target?.context).toContain('About the task "Fix the flaky retry test"');
    expect(byId.b.target).toMatchObject({ sessionKey: 'agent:forge:main', ask: false });
  });
});

describe('task owners', () => {
  it('finds the agent of a card worked through notes alone, as the real board has them', () => {
    // No assignee, no run, created by the operator: only the notes say who did the work.
    const card = task({
      assignee: undefined,
      run: undefined,
      createdBy: 'operator',
      feedback: [
        { at: at(9), by: 'operator', note: 'Please take this.' },
        { at: at(10), by: 'agent:linus', note: 'Merged #456 as 8a0b787. Closing card.' },
      ],
    });
    expect(taskAgent(card)).toBe('linus');
    const day = buildDay(input({ tasks: [card] }));
    for (const row of day.done) {
      expect(row.agentId).toBe('linus');
      expect(row.target).toMatchObject({ sessionKey: 'agent:linus:main', ask: false });
    }
    expect(day.done.map((row) => row.kind).sort()).toEqual(['pr', 'task']);
  });

  it('prefers the assignee, then the run, then the source session, then who created it', () => {
    expect(taskAgent(task({ assignee: 'agent:forge' }), 'agent:other:main')).toBe('forge');
    expect(taskAgent(task({ assignee: undefined }), 'agent:other:subagent:x')).toBe('other');
    expect(taskAgent(task({ assignee: undefined, sourceSessionKey: 'agent:kim:main' }))).toBe('kim');
    expect(taskAgent(task({ assignee: undefined, createdBy: 'agent:kim' }))).toBe('kim');
    expect(taskAgent(task({ assignee: 'operator', createdBy: 'operator' }))).toBeUndefined();
  });

  it('nudges the source session when the card came from one', () => {
    const day = buildDay(input({ tasks: [task({ assignee: undefined, sourceSessionKey: 'agent:kim:telegram:tuna:direct:42' })] }));
    expect(day.done[0].target?.sessionKey).toBe('agent:kim:telegram:tuna:direct:42');
  });
});

describe('pull requests', () => {
  it('reads full links and #refs', () => {
    expect(prMentions('See https://github.com/acme/app/pull/12 and #34, not &#56 or a/b#7')).toEqual([
      { number: 12, repo: 'acme/app', href: 'https://github.com/acme/app/pull/12' },
      { number: 34 },
    ]);
  });

  it('counts merges from the notes the merge watch and agents write, not from mentions', () => {
    const merged = mergedPrs(task({
      feedback: [
        { at: at(9), by: 'agent:linus', note: 'PR #456 @ dfac0d0: independent review APPROVE; CI green; awaiting human approval.' },
        { at: at(10), by: 'agent:linus', note: 'Merged #456 as 8a0b787. Closing card.' },
        { at: at(11), by: 'agent:linus', note: 'Merged as 68f8284 (#452). Closing card.' },
        { at: at(12), by: 'agent:linus', note: 'Merge watch: #458 merged as 5edad4f; closed automatically.' },
        { at: at(12, 30), by: 'agent:linus', note: 'Stacked on #454, merge #454 first.' },
      ],
    }), at(13));
    expect(merged.map((pr) => [pr.number, pr.at])).toEqual([[456, at(10)], [452, at(11)], [458, at(12)]]);
    expect(merged.every((pr) => pr.href === undefined)).toBe(true);
  });

  it('counts a pull link in the result, and links a bare #ref from a link elsewhere on the task', () => {
    const merged = mergedPrs(task({
      result: 'Shipped in https://github.com/acme/app/pull/77',
      resultAt: at(9),
      feedback: [{ at: at(10), by: 'agent:linus', note: 'Merged #78 as abc1234 (https://github.com/acme/app/pull/78 follow-up)' }],
    }), at(13));
    expect(merged).toEqual([
      { number: 77, repo: 'acme/app', href: 'https://github.com/acme/app/pull/77', at: at(9) },
      { number: 78, repo: 'acme/app', href: 'https://github.com/acme/app/pull/78', at: at(10) },
    ]);
  });

  it('lists each merged PR once across cards, at its merge note, and only merges made today', () => {
    const note = (n: number, when: number) => ({ at: when, by: 'agent:linus' as const, note: `Merged #${n} as 5edad4f. Closing card.` });
    const day = buildDay(input({
      tasks: [
        task({ id: 'flow', title: 'Render flow visualizations', updatedAt: at(14, 56), feedback: [note(458, at(14, 56))] }),
        task({ id: 'phone', title: 'Make flow diagrams fit phones', updatedAt: at(14, 57), feedback: [note(458, at(14, 56))] }),
        task({ id: 'old', title: 'Yesterday merge', updatedAt: at(9), feedback: [note(400, MIDNIGHT - HOUR)] }),
      ],
    }));
    const prs = day.done.filter((row) => row.kind === 'pr');
    expect(prs.map((row) => [row.title, row.at])).toEqual([['PR #458 merged', at(14, 56)]]);
    expect(prs[0].href).toBeUndefined();
    expect(day.stats.merged).toBe(1);
    expect(day.stats.done).toBe(3);
  });
});

describe('cron runs', () => {
  it('lists today\'s ok and failed runs, skips skipped ones and yesterday\'s', () => {
    const day = buildDay(input({
      crons: [cron()],
      cronRuns: {
        c1: [
          run(at(13), 'error', { error: 'AccessDenied' }),
          run(at(12), 'skipped'),
          run(at(7), 'ok', { summary: 'Brief sent' }),
          run(MIDNIGHT - HOUR, 'ok'),
        ],
      },
    }));
    expect(day.done.map((row) => [row.kind, row.at, row.failed, row.detail])).toEqual([
      ['cron', at(13), true, 'AccessDenied'],
      ['cron', at(7), false, 'Brief sent'],
    ]);
    expect(day.stats).toMatchObject({ cronOk: 1, cronFailed: 1, cronPartial: false });
  });

  it('folds a job that ran often into one row, and marks a run list cut at the limit as partial', () => {
    const many = Array.from({ length: CRON_RUNS_LIMIT }, (_, i) => run(at(14, 55) - i * 5 * MINUTE));
    const some = Array.from({ length: CRON_FOLD_AFTER + 1 }, (_, i) => run(at(6) + i * HOUR));
    const day = buildDay(input({
      crons: [cron({ id: 'watch', name: 'nerve-pr-merge-watch' }), cron({ id: 'hourly', name: 'Hourly sync' })],
      cronRuns: { watch: many, hourly: some },
    }));
    const watch = day.done.find((row) => row.cronId === 'watch');
    expect(day.done.filter((row) => row.cronId === 'watch')).toHaveLength(1);
    expect(watch).toMatchObject({ key: 'cron:watch:ok', at: at(14, 55), runs: { ok: CRON_RUNS_LIMIT, partial: true } });
    expect(day.done.find((row) => row.cronId === 'hourly')?.runs).toEqual({ ok: CRON_FOLD_AFTER + 1, partial: false });
    expect(day.stats).toMatchObject({ cronOk: CRON_RUNS_LIMIT + CRON_FOLD_AFTER + 1, cronPartial: true });
  });

  it('attaches the job\'s cron session for its summary', () => {
    const day = buildDay(input({
      crons: [cron({ id: 'e2e5' })],
      cronRuns: { e2e5: [run(at(7))] },
      sessions: [{ key: 'agent:main:cron:e2e5', updatedAt: at(7) }],
    }));
    expect(day.done[0]).toMatchObject({ sessionKey: 'agent:main:cron:e2e5', agentId: 'main' });
    expect(day.chats).toEqual([]);
  });
});

describe('sessions that ended', () => {
  const subagent = (overrides: Partial<Session> = {}): Session => ({
    key: 'agent:forge:subagent:fix',
    label: 'fix-retry',
    spawnedBy: 'agent:forge:main',
    status: 'done',
    startedAt: at(13),
    endedAt: at(13, 40),
    updatedAt: at(13, 40),
    hasActiveRun: false,
    ...overrides,
  });

  it('reads a terminal status with endedAt on spawned sessions only', () => {
    const base = input();
    expect(sessionEnd(subagent(), base)).toEqual({ at: at(13, 40), status: 'done', failed: false });
    expect(sessionEnd(subagent({ status: 'timeout' }), base)).toEqual({ at: at(13, 40), status: 'timeout', failed: true });
    // Mains and channel chats also report done after every turn; they are ongoing.
    expect(sessionEnd({ key: 'agent:main:main', status: 'done', endedAt: at(14) }, base)).toBeNull();
    expect(sessionEnd({ key: 'agent:main:telegram:tuna:direct:42', status: 'done', endedAt: at(14) }, base)).toBeNull();
    expect(sessionEnd({ key: 'agent:main:cron:abc', status: 'done', endedAt: at(14) }, base)).toBeNull();
  });

  it('does not count a session that is running again', () => {
    expect(sessionEnd(subagent({ hasActiveRun: true }), input())).toBeNull();
    expect(sessionEnd(subagent(), input({ busyState: { 'agent:forge:subagent:fix': true } }))).toBeNull();
    expect(sessionEnd(subagent(), input({ agentStatus: { 'agent:forge:subagent:fix': { status: 'THINKING', since: at(14) } } }))).toBeNull();
  });

  it('falls back to a failure or finish seen live when the row has no status', () => {
    const bare = subagent({ status: undefined, endedAt: undefined });
    expect(sessionEnd(bare, input())).toBeNull();
    expect(sessionEnd(bare, input({ agentStatus: { 'agent:forge:subagent:fix': { status: 'ERROR', since: at(14) } } })))
      .toEqual({ at: at(14), status: 'failed', failed: true });
  });

  it('lists each ended subagent as its own row that asks its parent', () => {
    const day = buildDay(input({
      sessions: [
        { key: 'agent:forge:main', updatedAt: at(14) },
        subagent(),
        subagent({ key: 'agent:forge:subagent:docs', label: 'docs', status: 'killed', endedAt: at(12), lastRunError: 'Stopped by operator' }),
        subagent({ key: 'agent:forge:subagent:old', label: 'old', endedAt: MIDNIGHT - HOUR, updatedAt: MIDNIGHT - HOUR }),
      ],
    }));
    const sessions = day.done.filter((row) => row.kind === 'session');
    expect(sessions.map((row) => [row.title, row.status, row.failed])).toEqual([
      ['fix-retry', 'done', false],
      ['docs', 'killed', true],
    ]);
    expect(sessions[0].target).toMatchObject({ sessionKey: 'agent:forge:main', ask: true });
    expect(sessions[0].target?.context).toContain('the subagent "fix-retry" (agent:forge:subagent:fix), which finished at');
    expect(sessions[1].detail).toBe('Stopped by operator');
    // A killed run ended but was not done.
    expect(day.stats.done).toBe(1);
  });

  it('folds a subagent into the done task that ran it', () => {
    const day = buildDay(input({
      tasks: [task({ run: { sessionKey: 'agent:forge:main', childSessionKey: 'agent:forge:subagent:fix', startedAt: at(13), endedAt: at(13, 40), status: 'done' } })],
      sessions: [subagent()],
    }));
    expect(day.done.map((row) => row.kind)).toEqual(['task']);
    expect(day.done[0].sessionKey).toBe('agent:forge:subagent:fix');
  });

  it('a done task whose run session ended asks that session\'s parent', () => {
    const day = buildDay(input({
      tasks: [task({ run: { sessionKey: 'agent:forge:subagent:fix', startedAt: at(13), status: 'done' } })],
      sessions: [subagent()],
    }));
    expect(day.done[0].target).toMatchObject({ sessionKey: 'agent:forge:main', ask: true });
    expect(day.done[0].target?.context).toMatch(/^About the task "Fix the flaky retry test", done at \d\d:\d\d\. It ran in the subagent/);
  });
});

describe('chats today', () => {
  it('lists sessions active today, top-level first, subagents under their parent', () => {
    const day = buildDay(input({
      sessions: [
        { key: 'agent:main:main', channel: 'telegram', displayName: 'Shaun (@shaunfi)', updatedAt: at(14, 50) },
        { key: 'agent:forge:main', label: 'Forge', updatedAt: at(10), participants: [{ identity: { type: 'observation', pluginId: null, id: 'cli' } }] },
        { key: 'agent:forge:subagent:fix', label: 'fix-retry', spawnedBy: 'agent:forge:main', status: 'done', endedAt: at(13), updatedAt: at(13) },
        { key: 'agent:lifestyle:telegram:tuna:direct:42', channel: 'telegram', updatedAt: at(9) },
        { key: 'agent:main:cron:abc', label: 'Automation', updatedAt: at(14) },
        { key: 'agent:main:explicit:model-run-123', updatedAt: at(14) },
        { key: 'agent:quiet:main', updatedAt: MIDNIGHT - HOUR },
      ],
      needsReply: new Map([['agent:main:main', 'Review']]),
    }));
    expect(day.chats.map((row) => [row.key, row.title, row.channel, row.topLevel])).toEqual([
      ['agent:main:main', 'Kim', 'telegram', true],
      ['agent:forge:main', 'Forge', 'cli', true],
      ['agent:lifestyle:telegram:tuna:direct:42', 'lifestyle on telegram', 'telegram', false],
    ]);
    expect(day.chats[0].needs).toBe('Review');
    expect(day.chats[1].children.map((row) => [row.key, row.ended])).toEqual([['agent:forge:subagent:fix', true]]);
    expect(day.chats[1].children[0].target).toMatchObject({ sessionKey: 'agent:forge:main', ask: true });
    expect(day.chats[0].target).toEqual({ sessionKey: 'agent:main:main', ask: false, context: undefined });
    expect(day.stats.sessions).toBe(4);
  });

  it('names kanban runs after their task and never shows a raw key or kb label', () => {
    const day = buildDay(input({
      tasks: [task({ id: 'attention-test-check-the-backu', title: 'Check the backup log', status: 'review' })],
      sessions: [
        { key: 'agent:forge:main', label: 'Forge', updatedAt: at(10) },
        { key: 'agent:forge:subagent:q1', label: 'kb-attention-test-check-the-backu-1795864537734', spawnedBy: 'agent:forge:main', status: 'done', endedAt: at(13), updatedAt: at(13) },
        { key: 'agent:forge:subagent:q2', label: 'kb-gone-task-1795864537734', spawnedBy: 'agent:forge:main', status: 'running', updatedAt: at(14) },
      ],
    }));
    const titles = flattenChats(day.chats).map((row) => row.title);
    expect(titles).toEqual(['Forge', 'Forge', 'Check the backup log']);
    expect(day.done.find((row) => row.kind === 'session')?.title).toBe('Check the backup log');
    for (const title of [...titles, ...day.done.map((row) => row.title)]) expect(title).not.toMatch(/agent:|kb-/);
  });

  it('names a channel from the row, its last channel or its participants', () => {
    expect(channelOf({ key: 'a', lastChannel: 'discord' })).toBe('discord');
    expect(channelOf({ key: 'a', participants: [{ identity: { type: 'observation', pluginId: 'telegram', id: '42' } }] })).toBe('telegram');
    expect(channelOf({ key: 'a', participants: [{ identity: { type: 'profile', id: 'gateway-owner' } }] })).toBeUndefined();
  });
});

describe('ordering, sources and facts', () => {
  it('orders every kind newest first', () => {
    const day = buildDay(input({
      tasks: [task({ updatedAt: at(9) })],
      crons: [cron()],
      cronRuns: { c1: [run(at(11))] },
      sessions: [{ key: 'agent:forge:subagent:x', label: 'x', spawnedBy: 'agent:forge:main', status: 'done', endedAt: at(10), updatedAt: at(10) }],
    }));
    expect(day.done.map((row) => row.kind)).toEqual(['cron', 'session', 'task']);
  });

  it('leaves out what an off source would have given', () => {
    const sources = { ...live(), tasks: { state: 'off' as const } };
    const day = buildDay(input({ tasks: [task()], sources }));
    expect(day.done).toEqual([]);
  });

  it('builds compact facts with the missing sources named and no times on chat lines', () => {
    const day = buildDay(input({
      tasks: [task({ title: 'Ship it', updatedAt: at(14, 12) })],
      sessions: [{ key: 'agent:main:main', updatedAt: at(14) }],
    }));
    const facts = dayFacts(day, ['cron runs']);
    expect(facts).toMatchObject({
      day: '2026-11-28',
      counts: { sessions: 1, done: 1, merged: 0, cronFailed: 0 },
      chats: ['Kim'],
      missing: ['cron runs'],
    });
    expect(facts.done).toEqual([expect.stringMatching(/^\d\d:\d\d Task done: Ship it$/)]);
  });

  it('tells the paragraph only about cron runs that failed', () => {
    const day = buildDay(input({
      crons: [cron({ id: 'c1', name: 'Nightly backup' })],
      cronRuns: {
        c1: [run(at(13), 'error', { error: 'AccessDenied' }), run(at(7), 'ok', { summary: 'Brief sent' })],
      },
    }));
    const facts = dayFacts(day, []);
    expect(facts.done).toEqual([expect.stringMatching(/^\d\d:\d\d Cron Nightly backup failed$/)]);
    expect(facts.counts).not.toHaveProperty('cronOk');
    expect(facts.counts.cronFailed).toBe(1);
  });
});

describe('groupByHour', () => {
  it('leaves a short list ungrouped and groups a long one by local hour', () => {
    const rows = (times: number[]) => times.map((t) => ({ at: t }));
    expect(groupByHour(rows([at(14), at(13)]), 8)).toEqual([{ label: null, rows: rows([at(14), at(13)]) }]);
    const groups = groupByHour(rows([at(14, 50), at(14, 10), at(13, 5), at(9)]), 3);
    expect(groups.map((group) => [group.label, group.rows.length])).toEqual([['14:00', 2], ['13:00', 1], ['09:00', 1]]);
  });
});
