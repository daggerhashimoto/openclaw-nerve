import { describe, expect, it } from 'vitest';
import { buildAttention } from './buildAttention';
import {
  formatClock,
  reasonFor,
  sinceHeading,
  sourceLine,
  summarySentence,
} from './briefCopy';
import type {
  AttentionBrief,
  AttentionItem,
  AttentionKind,
  AttentionSource,
  SourceStatus,
} from './types';

// Built from local calendar parts so formatClock is the same in every time zone.
function at(hour: number, minute: number, dayOffset = 0): number {
  return new Date(2026, 10, 27 + dayOffset, hour, minute).getTime();
}

const NOW = at(8, 22);
const MINUTE = 60_000;
const HOUR = 3_600_000;

function live(): Record<AttentionSource, SourceStatus> {
  return {
    tasks: { state: 'live', checkedAt: NOW },
    proposals: { state: 'live', checkedAt: NOW },
    crons: { state: 'live', checkedAt: NOW },
    sessions: { state: 'live', checkedAt: NOW },
  };
}

function item(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    key: 'tasks:t1:review',
    source: 'tasks',
    sourceId: 't1',
    kind: 'review',
    section: 'decide',
    title: 'Fix the backup',
    updatedAt: NOW - 2 * HOUR,
    priority: 'normal',
    freshness: 'live',
    open: { type: 'task', id: 't1' },
    detail: {},
    ...overrides,
  };
}

let counter = 0;
function many(count: number, overrides: Partial<AttentionItem> = {}): AttentionItem[] {
  return Array.from({ length: count }, () => {
    counter += 1;
    return item({ key: `k${counter}`, sourceId: `s${counter}`, ...overrides });
  });
}

function brief(overrides: Partial<AttentionBrief> = {}): AttentionBrief {
  return {
    decide: [],
    blocked: [],
    progress: [],
    finished: [],
    seen: { blocked: [], finished: [] },
    sources: live(),
    since: NOW - 8 * HOUR,
    allClear: false,
    ...overrides,
  };
}

function failingCron(title: string, nextRun?: number): AttentionItem {
  counter += 1;
  return item({
    key: `crons:c${counter}:cron-failed:x`,
    source: 'crons',
    sourceId: `c${counter}`,
    kind: 'cron-failed',
    section: 'blocked',
    title,
    updatedAt: NOW - 6 * HOUR,
    deadline: nextRun,
    open: { type: 'cron', id: `c${counter}` },
    detail: { nextRun, error: 'disk full' },
  });
}

describe('formatClock', () => {
  it('prints local 24-hour HH:MM with zero padding', () => {
    expect(formatClock(at(8, 5))).toBe('08:05');
    expect(formatClock(at(0, 0))).toBe('00:00');
    expect(formatClock(at(23, 59))).toBe('23:59');
    expect(formatClock(at(14, 30))).toBe('14:30');
  });
});

describe('summarySentence', () => {
  it('summary names counts in words', () => {
    expect(summarySentence(
      brief({ decide: many(2), blocked: many(1, { kind: 'task-failed', section: 'blocked' }) }),
      NOW,
    )).toBe('Two decisions and one failure need you.');

    expect(summarySentence(brief({ decide: many(1) }), NOW)).toBe('One decision needs you.');

    expect(summarySentence(
      brief({
        decide: many(1),
        blocked: [
          ...many(1, { kind: 'task-failed', section: 'blocked' }),
          ...many(1, { kind: 'session-failed', section: 'blocked', source: 'sessions' }),
          ...many(1, { kind: 'gone-quiet', section: 'blocked' }),
        ],
      }),
      NOW,
    )).toBe('One decision, two failures and one quiet task need you.');

    expect(summarySentence(brief({ decide: many(9) }), NOW)).toBe('Nine decisions need you.');
    expect(summarySentence(brief({ decide: many(12) }), NOW)).toBe('12 decisions need you.');
  });

  it('summary adds the next failing cron run', () => {
    const tomorrow = at(2, 0, 1);
    const sentence = summarySentence(
      brief({ blocked: [failingCron('Nightly backup', tomorrow)] }),
      NOW,
    );
    expect(sentence).toBe('One failure needs you. Nightly backup fails again at 02:00 unless fixed.');
  });

  it('summary names the soonest next run and skips crons without an upcoming one', () => {
    const sentence = summarySentence(
      brief({
        blocked: [
          failingCron('Weekly report', at(5, 30, 1)),
          failingCron('Nightly backup', at(2, 0, 1)),
          failingCron('Stale one', NOW - HOUR),
          failingCron('Unscheduled'),
        ],
      }),
      NOW,
    );
    expect(sentence).toBe('Four failures need you. Nightly backup fails again at 02:00 unless fixed.');

    expect(summarySentence(
      brief({ blocked: [failingCron('Unscheduled')] }),
      NOW,
    )).toBe('One failure needs you.');
  });

  it('all-clear summary only when brief.allClear', () => {
    expect(summarySentence(brief({ allClear: true }), NOW)).toBe('Nothing needs you.');

    const loading = summarySentence(
      brief({ sources: { ...live(), crons: { state: 'loading' } } }),
      NOW,
    );
    expect(loading).toBe('Still loading crons.');
    expect(loading).not.toContain('Nothing needs you');

    const errored = summarySentence(
      brief({ sources: { ...live(), crons: { state: 'error', error: 'HTTP 502' } } }),
      NOW,
    );
    expect(errored).toBe('Crons could not be read, so this may be incomplete.');
    expect(errored).not.toContain('Nothing needs you');

    const off = summarySentence(
      brief({ sources: { ...live(), tasks: { state: 'off' }, proposals: { state: 'off' } } }),
      NOW,
    );
    expect(off).toBe('Tasks are turned off.');
    expect(off).not.toContain('Nothing needs you');
  });

  it('summary names a source gap beside the counts', () => {
    expect(summarySentence(
      brief({ decide: many(1), sources: { ...live(), crons: { state: 'error', error: 'HTTP 502' } } }),
      NOW,
    )).toBe('One decision needs you. Crons could not be read, so this may be incomplete.');

    expect(summarySentence(
      brief({
        decide: many(1),
        sources: { ...live(), tasks: { state: 'loading' }, proposals: { state: 'loading' }, crons: { state: 'loading' } },
      }),
      NOW,
    )).toBe('One decision needs you. Still loading tasks, proposals and crons.');
  });

  it('summary says nothing is waiting only when every source is live', () => {
    expect(summarySentence(brief({ progress: many(2, { kind: 'task-running', section: 'progress' }) }), NOW))
      .toBe('Nothing is waiting on you. Two items are in progress.');
    expect(summarySentence(brief({ progress: many(1, { kind: 'task-running', section: 'progress' }) }), NOW))
      .toBe('Nothing is waiting on you. One item is in progress.');

    const gap = summarySentence(
      brief({
        progress: many(1, { kind: 'task-running', section: 'progress' }),
        sources: { ...live(), crons: { state: 'error', error: 'HTTP 502' } },
      }),
      NOW,
    );
    expect(gap).toBe('One item is in progress. Crons could not be read, so this may be incomplete.');
    expect(gap).not.toContain('Nothing is waiting');
  });

  it('summarizes a brief built by buildAttention', () => {
    const built = buildAttention({
      now: NOW,
      lastLook: NOW - 8 * HOUR,
      seen: new Set<string>(),
      tasks: [{
        id: 't1',
        title: 'Fix the backup',
        status: 'review',
        priority: 'normal',
        createdBy: 'operator',
        createdAt: NOW - 24 * HOUR,
        updatedAt: NOW - HOUR,
        version: 1,
        labels: [],
        columnOrder: 0,
        feedback: [],
      }],
      proposals: [{
        id: 'p1',
        type: 'create',
        payload: { title: 'Write release notes' },
        proposedBy: 'agent:kim',
        proposedAt: NOW - 3 * HOUR,
        status: 'pending',
        version: 1,
      }],
      crons: [{
        id: 'c1',
        name: 'Nightly backup',
        enabled: true,
        scheduleKind: 'cron',
        schedule: '0 2 * * *',
        payloadKind: 'agentTurn',
        lastStatus: 'error',
        lastRun: new Date(NOW - 6 * HOUR).toISOString(),
        nextRun: new Date(at(2, 0, 1)).toISOString(),
      }],
      sessions: [],
      agentStatus: {},
      busyState: {},
      sources: live(),
    });
    expect(summarySentence(built, NOW))
      .toBe('Two decisions and one failure need you. Nightly backup fails again at 02:00 unless fixed.');
    expect(sourceLine(built, NOW)).toBe(
      'Checked 08:22. Tasks, proposals and crons are live; session failures show from when this page opened.',
    );
  });
});

describe('sourceLine', () => {
  it('states the live sources and the session limit', () => {
    expect(sourceLine(brief(), NOW)).toBe(
      'Checked 08:22. Tasks, proposals and crons are live; session failures show from when this page opened.',
    );
  });

  it('reads the check time from the stalest live source and falls back to now', () => {
    expect(sourceLine(
      brief({ sources: { ...live(), crons: { state: 'live', checkedAt: at(8, 21) } } }),
      NOW,
    )).toBe('Checked 08:21. Tasks, proposals and crons are live; session failures show from when this page opened.');

    expect(sourceLine(
      brief({
        sources: {
          tasks: { state: 'live' },
          proposals: { state: 'live' },
          crons: { state: 'live' },
          sessions: { state: 'live' },
        },
      }),
      NOW,
    )).toBe('Checked 08:22. Tasks, proposals and crons are live; session failures show from when this page opened.');
  });

  it('source line names an errored source and tasks off', () => {
    const errored = sourceLine(
      brief({ sources: { ...live(), crons: { state: 'error', error: 'HTTP 502' } } }),
      NOW,
    );
    expect(errored).toBe(
      'Checked 08:22. Tasks and proposals are live; session failures show from when this page opened. '
      + 'Crons could not be read (HTTP 502).',
    );

    const off = sourceLine(
      brief({ sources: { ...live(), tasks: { state: 'off' }, proposals: { state: 'off' } } }),
      NOW,
    );
    expect(off).toBe(
      'Checked 08:22. Crons are live; session failures show from when this page opened. Tasks are turned off.',
    );

    const both = sourceLine(
      brief({
        sources: {
          ...live(),
          tasks: { state: 'off' },
          proposals: { state: 'off' },
          crons: { state: 'error', error: 'HTTP 502' },
        },
      }),
      NOW,
    );
    expect(both).toBe(
      'Crons could not be read (HTTP 502). Tasks are turned off. Session failures show from when this page opened.',
    );
  });

  it('names an errored source without a message and a source still loading', () => {
    expect(sourceLine(
      brief({ sources: { ...live(), crons: { state: 'error' } } }),
      NOW,
    )).toContain('Crons could not be read.');

    expect(sourceLine(
      brief({
        sources: {
          tasks: { state: 'loading' },
          proposals: { state: 'loading' },
          crons: { state: 'loading' },
          sessions: { state: 'live' },
        },
      }),
      NOW,
    )).toBe('Loading tasks, proposals and crons. Session failures show from when this page opened.');
  });
});

describe('sinceHeading', () => {
  it('names the clock time of the last look', () => {
    expect(sinceHeading(brief({ since: at(7, 45) }), at(7, 45))).toBe('Since you left at 07:45');
  });

  it('heading falls back to the last 24 hours', () => {
    expect(sinceHeading(brief({ since: NOW - 24 * HOUR }), null)).toBe('In the last 24 hours');
  });
});

describe('reasonFor', () => {
  it('review: age and who says it is done', () => {
    expect(reasonFor(item({ updatedAt: NOW - 2 * HOUR }), NOW, 'Kim')).toBe('Ready 2h · Kim says done');
    expect(reasonFor(item({ updatedAt: NOW - 20_000 }), NOW, 'Kim')).toBe('Ready now · Kim says done');
    expect(reasonFor(item({ updatedAt: NOW - 2 * HOUR }), NOW)).toBe('Ready 2h · Waiting for your review');
  });

  it('proposal: who proposes it', () => {
    const proposal = item({ kind: 'proposal', source: 'proposals', key: 'proposals:p1:proposal' });
    expect(reasonFor(proposal, NOW, 'Kim')).toBe('Kim proposes this');
    expect(reasonFor(proposal, NOW)).toBe('An agent proposes this');
  });

  it('failures carry their age', () => {
    expect(reasonFor(item({ kind: 'task-failed', updatedAt: NOW - 3 * HOUR }), NOW)).toBe('Run failed 3h ago');
    expect(reasonFor(item({ kind: 'task-failed', updatedAt: NOW - 10_000 }), NOW)).toBe('Run failed just now');
    expect(reasonFor(item({ kind: 'session-failed', updatedAt: NOW - HOUR }), NOW))
      .toBe('Run failed while this page was open');
  });

  it('gone quiet counts from the last activity', () => {
    const quiet = item({
      kind: 'gone-quiet',
      updatedAt: NOW - 4 * HOUR,
      detail: { quietSince: NOW - 4 * HOUR },
    });
    expect(reasonFor(quiet, NOW)).toBe('Quiet for 4h');
    expect(reasonFor(item({ kind: 'gone-quiet', updatedAt: NOW - 5 * HOUR }), NOW)).toBe('Quiet for 5h');
  });

  it('cron: the next run when upcoming, otherwise the age of the failure', () => {
    const upcoming = failingCron('Nightly backup', at(2, 0, 1));
    expect(reasonFor(upcoming, NOW)).toBe('Fails again at 02:00');

    const unscheduled = failingCron('Nightly backup');
    expect(reasonFor(unscheduled, NOW)).toBe('Failed 6h ago');

    const overdue = failingCron('Nightly backup', NOW - HOUR);
    expect(reasonFor(overdue, NOW)).toBe('Failed 6h ago');
  });

  it('running and finished items', () => {
    expect(reasonFor(item({ kind: 'task-running', updatedAt: NOW - 90 * MINUTE }), NOW)).toBe('Running for 1h');
    expect(reasonFor(item({ kind: 'session-running', updatedAt: NOW - 5 * MINUTE }), NOW)).toBe('Running for 5m');
    expect(reasonFor(item({ kind: 'session-running', updatedAt: NOW - 5_000 }), NOW)).toBe('Just started');
    expect(reasonFor(item({ kind: 'task-finished', updatedAt: NOW - HOUR }), NOW)).toBe('Run finished 1h ago');
    expect(reasonFor(item({ kind: 'cron-finished', updatedAt: NOW - HOUR }), NOW)).toBe('Last run finished 1h ago');
  });

  it('reason strings never say verified or approved', () => {
    const kinds: AttentionKind[] = [
      'review', 'proposal', 'task-failed', 'gone-quiet', 'cron-failed',
      'session-failed', 'task-running', 'session-running', 'task-finished', 'cron-finished',
    ];
    for (const kind of kinds) {
      for (const owner of [undefined, 'Kim']) {
        const upcoming = at(2, 0, 1);
        const reason = reasonFor(
          item({ kind, updatedAt: NOW - 3 * HOUR, deadline: upcoming, detail: { nextRun: upcoming, quietSince: NOW - 3 * HOUR } }),
          NOW,
          owner,
        );
        expect(reason.length).toBeGreaterThan(0);
        expect(reason).not.toMatch(/verified|approved/i);
        expect(reason).not.toMatch(/[\u2014\u2013]/);
      }
    }
  });
});

describe('copy hygiene', () => {
  it('summary, source line and heading never say verified or approved', () => {
    const texts = [
      summarySentence(brief({ allClear: true }), NOW),
      summarySentence(brief({ decide: many(2), blocked: many(2, { kind: 'task-failed', section: 'blocked' }) }), NOW),
      summarySentence(brief({ blocked: [failingCron('Nightly backup', at(2, 0, 1))] }), NOW),
      sourceLine(brief({ sources: { ...live(), crons: { state: 'error', error: 'HTTP 502' } } }), NOW),
      sinceHeading(brief(), NOW - HOUR),
      sinceHeading(brief(), null),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/verified|approved/i);
      expect(text).not.toMatch(/[\u2014\u2013]/);
    }
  });
});
