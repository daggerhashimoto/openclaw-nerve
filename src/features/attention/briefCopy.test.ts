import { describe, expect, it } from 'vitest';
import { buildAttention } from './buildAttention';
import {
  checkedAt,
  formatClock,
  formatDayClock,
  gapSentences,
  headline,
  NOT_CONNECTED,
  reasonFor,
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

function live(): Record<Exclude<AttentionSource, 'approvals'>, SourceStatus> {
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

describe('formatDayClock', () => {
  it('prints HH:MM on the same local day and a short weekday with HH:MM otherwise', () => {
    const now = new Date(2026, 10, 27, 8, 22).getTime();
    expect(formatDayClock(new Date(2026, 10, 27, 7, 57).getTime(), now)).toBe('07:57');
    expect(formatDayClock(new Date(2026, 10, 27, 23, 59).getTime(), now)).toBe('23:59');
    expect(formatDayClock(new Date(2026, 10, 27, 0, 0).getTime(), now)).toBe('00:00');
    // 2026-11-28 is a Saturday, 2026-11-29 a Sunday, 2026-11-26 a Thursday.
    expect(formatDayClock(new Date(2026, 10, 28, 7, 57).getTime(), now)).toBe('Sat 07:57');
    expect(formatDayClock(new Date(2026, 10, 29, 0, 5).getTime(), now)).toBe('Sun 00:05');
    expect(formatDayClock(new Date(2026, 10, 26, 23, 40).getTime(), now)).toBe('Thu 23:40');
  });

  it('treats the same clock time on another month or year as another day', () => {
    const now = new Date(2026, 10, 27, 8, 22).getTime();
    expect(formatDayClock(new Date(2026, 9, 27, 7, 57).getTime(), now)).toBe('Tue 07:57');
    expect(formatDayClock(new Date(2025, 10, 27, 7, 57).getTime(), now)).toBe('Thu 07:57');
  });
});

describe('headline', () => {
  it('counts failing, to decide and working, naming only counts above zero', () => {
    expect(headline(brief({
      decide: many(5),
      blocked: many(2, { kind: 'task-failed', section: 'blocked' }),
    }), 3).text).toBe('2 failing · 5 to decide · 3 working');
    expect(headline(brief({ decide: many(1) }), 0).text).toBe('1 to decide');
    expect(headline(brief({ decide: many(1) }), 2).parts.map((part) => part.tone)).toEqual(['operator', 'live']);
  });

  it('does not count a run that only went quiet as failing', () => {
    const quiet = many(1, { kind: 'gone-quiet', section: 'blocked' });
    expect(headline(brief({ blocked: quiet }), 1).text).toBe('1 working');
  });

  it('says nothing needs you only when the brief is all clear', () => {
    expect(headline(brief({ allClear: true }), 0).text).toBe('Nothing needs you');
    const loading = headline(brief({ sources: { ...live(), crons: { state: 'loading' } } }), 0).text;
    expect(loading).not.toContain('Nothing needs you');
  });
});

describe('gapSentences', () => {
  it('is empty when every source is live, and when a gateway has no approvals', () => {
    expect(gapSentences(brief())).toEqual([]);
    expect(gapSentences(brief({ sources: { ...live(), approvals: { state: 'off' } } }))).toEqual([]);
  });

  it('names sources that are loading, unreadable or off', () => {
    expect(gapSentences(brief({ sources: { ...live(), crons: { state: 'error', error: 'HTTP 502' } } })))
      .toEqual(['Crons could not be read, so this may be incomplete.']);
    expect(gapSentences(brief({ sources: { ...live(), tasks: { state: 'loading' }, proposals: { state: 'loading' } } })))
      .toEqual(['Loading tasks and proposals.']);
    expect(gapSentences(brief({ sources: { ...live(), tasks: { state: 'off' } } })))
      .toEqual(['Tasks are turned off.']);
    expect(gapSentences(brief({ sources: { ...live(), approvals: { state: 'error', error: 'boom' } } })))
      .toEqual(['Approvals could not be read, so this may be incomplete.']);
  });

  it('leaves a lost gateway to the outage notice', () => {
    expect(gapSentences(brief({ sources: { ...live(), sessions: { state: 'error', error: NOT_CONNECTED } } }))).toEqual([]);
  });
});

describe('checkedAt', () => {
  it('reads the check time from the stalest live polled source and falls back to now', () => {
    expect(checkedAt(brief({ sources: { ...live(), crons: { state: 'live', checkedAt: at(8, 21) } } }), NOW)).toBe(at(8, 21));
    expect(checkedAt(brief({ sources: { ...live(), tasks: { state: 'loading' }, proposals: { state: 'loading' }, crons: { state: 'loading' } } }), NOW)).toBe(NOW);
  });

  it('agrees with a brief built by buildAttention', () => {
    const built = buildAttention({
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
    });
    expect(formatClock(checkedAt(built, NOW))).toBe('08:22');
    expect(headline(built, 0).text).toBe('Nothing needs you');
  });
});

describe('reasonFor', () => {
  it('review: age and who says it is done', () => {
    expect(reasonFor(item({ updatedAt: NOW - HOUR }), NOW, 'Kim')).toBe('Ready 1h ago · Kim says done');
    expect(reasonFor(item({ updatedAt: NOW - 2 * HOUR }), NOW, 'Kim')).toBe('Ready 2h ago · Kim says done');
    expect(reasonFor(item({ updatedAt: NOW - 20_000 }), NOW, 'Kim')).toBe('Ready just now · Kim says done');
    expect(reasonFor(item({ updatedAt: NOW - 2 * HOUR }), NOW)).toBe('Ready 2h ago · Waiting for your review');
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

  it('cron: the age of the failure and the next run, dated when it is not today', () => {
    const tomorrow = failingCron('Nightly backup', at(7, 57, 1));
    expect(reasonFor(tomorrow, NOW)).toBe('Failed 6h ago · fails again Sat 07:57');

    const later = failingCron('Nightly backup', at(23, 30));
    expect(reasonFor(later, NOW)).toBe('Failed 6h ago · fails again at 23:30');

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
    expect(reasonFor(item({ kind: 'cron-recovered', updatedAt: at(12, 3), detail: { failedAt: at(9, 0) } }), at(13, 0)))
      .toBe('Failed 09:00, recovered 12:03');
    expect(reasonFor(item({ kind: 'approval', updatedAt: NOW - 2 * MINUTE, detail: { expiresAt: at(8, 52) } }), NOW))
      .toBe('Asked 2m ago · expires at 08:52');
  });

  it('reason strings never say verified or approved', () => {
    const kinds: AttentionKind[] = [
      'review', 'proposal', 'task-failed', 'gone-quiet', 'cron-failed',
      'session-failed', 'task-running', 'session-running', 'task-finished', 'cron-recovered', 'approval',
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
  it('headline, notes and reasons never say verified or approved, and use no dashes', () => {
    const texts = [
      headline(brief({ allClear: true }), 0).text,
      headline(brief({ decide: many(2), blocked: many(2, { kind: 'task-failed', section: 'blocked' }) }), 1).text,
      headline(brief(), 0).text,
      reasonFor(failingCron('Nightly backup', at(2, 0, 1)), NOW),
      ...gapSentences(brief({ sources: { ...live(), crons: { state: 'error', error: 'HTTP 502' }, tasks: { state: 'loading' } } })),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/verified|approved/i);
      expect(text).not.toMatch(/[\u2014\u2013]/);
    }
  });
});
