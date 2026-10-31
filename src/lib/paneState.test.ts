import { describe, expect, it } from 'vitest';
import { fleetActivity, isSessionRunning, paneStateFor } from './paneState';
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
});
