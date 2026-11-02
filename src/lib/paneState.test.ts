import { describe, expect, it } from 'vitest';
import { fleetActivity, fleetCounts, fleetWords, isSessionRunning, paneStateFor, sessionPaneState } from './paneState';
import type { Session } from '@/types';

function session(overrides: Partial<Session> = {}): Session {
  return { key: 'agent:main', ...overrides } as Session;
}

describe('paneStateFor', () => {
  it('ranks error over live over waiting', () => {
    expect(paneStateFor({ error: true, running: true, unread: true })).toBe('error');
    expect(paneStateFor({ running: true, unread: true })).toBe('live');
    expect(paneStateFor({ unread: true })).toBe('operator');
    expect(paneStateFor({})).toBe('off');
  });
});

describe('isSessionRunning', () => {
  it('reads every gateway flag that means work in progress', () => {
    expect(isSessionRunning(session())).toBe(false);
    expect(isSessionRunning(session(), true)).toBe(true);
    expect(isSessionRunning(session({ state: 'running' } as Partial<Session>))).toBe(true);
    expect(isSessionRunning(session({ status: 'busy' } as Partial<Session>))).toBe(true);
  });
});

describe('fleetActivity', () => {
  const quiet = session({ key: 'agent:a' });
  const other = session({ key: 'agent:b' });

  it('is off when nothing runs and nothing waits', () => {
    expect(fleetActivity({ sessions: [quiet, other] })).toBe('off');
  });

  it('lights blue when any session is busy, even if another waits on you', () => {
    expect(fleetActivity({
      sessions: [quiet, other],
      busyState: { 'agent:b': true },
      unreadSessions: { 'agent:a': true },
    })).toBe('live');
  });

  it('lights blue while the open session is generating before the gateway says so', () => {
    expect(fleetActivity({ sessions: [quiet], generating: true })).toBe('live');
  });

  it('lights cantaloupe when finished work waits on the operator', () => {
    expect(fleetActivity({ sessions: [quiet, other], unreadSessions: { 'agent:a': true } })).toBe('operator');
  });

  it('lights red when a run failed, even while the stale busy flag says it is still working', () => {
    expect(fleetActivity({
      sessions: [quiet, other],
      busyState: { 'agent:a': true, 'agent:b': true },
      agentStatus: { 'agent:a': { status: 'ERROR', since: 0 } },
    })).toBe('error');
  });
});

describe('fleetCounts', () => {
  const a = session({ key: 'agent:a' });
  const b = session({ key: 'agent:b' });
  const c = session({ key: 'agent:c' });

  it('counts a failed run as failed, not running, and keeps the others', () => {
    expect(fleetCounts({
      sessions: [a, b, c],
      busyState: { 'agent:a': true, 'agent:b': true },
      unreadSessions: { 'agent:a': true, 'agent:c': true },
      agentStatus: { 'agent:a': { status: 'ERROR', since: 0 }, 'agent:b': { status: 'THINKING', since: 0 } },
    })).toEqual({ total: 3, running: 1, waiting: 1, failed: 1 });
  });

  it('counts the open session as working while it generates before the gateway says so', () => {
    expect(fleetCounts({ sessions: [a], generating: true })).toEqual({ total: 1, running: 1, waiting: 0, failed: 0 });
  });

  it('says it in words, failures last', () => {
    expect(fleetWords({ total: 3, running: 1, waiting: 1, failed: 1 })).toBe('1 working, 1 waiting on you, 1 failed');
    expect(fleetWords({ total: 2, running: 0, waiting: 0, failed: 0 })).toBe('2 agents, all quiet');
  });
});

describe('sessionPaneState', () => {
  it('reads error over the busy flag, then running, then unread', () => {
    const s = session({ key: 'agent:a' });
    expect(sessionPaneState(s, { busyState: { 'agent:a': true }, agentStatus: { 'agent:a': { status: 'ERROR', since: 0 } } })).toBe('error');
    expect(sessionPaneState(s, { busyState: { 'agent:a': true }, unreadSessions: { 'agent:a': true } })).toBe('live');
    expect(sessionPaneState(s, { unreadSessions: { 'agent:a': true } })).toBe('operator');
    expect(sessionPaneState(s, {})).toBe('off');
  });
});
