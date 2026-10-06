import { describe, expect, it } from 'vitest';
import type { Session } from '@/types';
import { isLiveSupplementalSession, mergeAuthoritativeSessions } from './sessionReconciliation';

function session(sessionKey: string, extra: Partial<Session> = {}): Session {
  return { sessionKey, ...extra };
}

describe('session reconciliation', () => {
  it('keeps live spawnedBy supplements missing from the full list', () => {
    const merged = mergeAuthoritativeSessions(
      [session('agent:main:main')],
      [[session('agent:main:subagent:active-child', { status: 'running' })]],
    );

    expect(merged.map((item) => item.sessionKey)).toEqual([
      'agent:main:main',
      'agent:main:subagent:active-child',
    ]);
  });

  it('prunes terminal spawnedBy supplements missing from the full list', () => {
    const merged = mergeAuthoritativeSessions(
      [session('agent:main:main')],
      [[
        session('agent:main:subagent:done-child', { status: 'done' }),
        session('agent:main:subagent:failed-child', { status: 'failed' }),
        session('agent:main:subagent:archived-child', { status: 'archived' }),
      ]],
    );

    expect(merged.map((item) => item.sessionKey)).toEqual(['agent:main:main']);
  });

  it('prunes stale base-list children missing from current spawnedBy truth', () => {
    const merged = mergeAuthoritativeSessions(
      [
        session('agent:main:main'),
        session('agent:main:subagent:stale-cache-child', { label: 'Old cached child', status: 'idle' }),
        session('agent:main:subagent:current-child', { label: 'Current child', status: 'idle' }),
      ],
      [[session('agent:main:subagent:current-child', { label: 'Current child' })]],
    );

    expect(merged.map((item) => item.sessionKey)).toEqual([
      'agent:main:main',
      'agent:main:subagent:current-child',
    ]);
  });

  it('keeps base-list children with live state even before spawnedBy catches up', () => {
    const merged = mergeAuthoritativeSessions(
      [
        session('agent:main:main'),
        session('agent:main:subagent:streaming-child', { status: 'running' }),
      ],
      [[]],
    );

    expect(merged.map((item) => item.sessionKey)).toEqual([
      'agent:main:main',
      'agent:main:subagent:streaming-child',
    ]);
  });

  it('preserves base sessions when spawnedBy lookups all fail', () => {
    const merged = mergeAuthoritativeSessions(
      [
        session('agent:main:main'),
        session('agent:main:subagent:unknown-child', { label: 'Unknown child' }),
      ],
      [[]],
      { spawnedByAuthoritative: false },
    );

    expect(merged.map((item) => item.sessionKey)).toEqual([
      'agent:main:main',
      'agent:main:subagent:unknown-child',
    ]);
  });

  it('only prunes children for roots with successful spawnedBy lookups', () => {
    const merged = mergeAuthoritativeSessions(
      [
        session('agent:main:main'),
        session('agent:main:subagent:stale-main-child', { label: 'Old main child', status: 'idle' }),
        session('agent:reviewer:main'),
        session('agent:reviewer:subagent:unknown-reviewer-child', { label: 'Reviewer child', status: 'idle' }),
      ],
      [[]],
      {
        spawnedByAuthoritative: true,
        authoritativeSpawnedByRoots: new Set(['agent:main:main']),
      },
    );

    expect(merged.map((item) => item.sessionKey)).toEqual([
      'agent:main:main',
      'agent:reviewer:main',
      'agent:reviewer:subagent:unknown-reviewer-child',
    ]);
  });

  it('preserves terminal sessions when the full list still reports them', () => {
    const merged = mergeAuthoritativeSessions(
      [
        session('agent:main:main'),
        session('agent:main:subagent:done-child', { status: 'done' }),
      ],
      [[session('agent:main:subagent:done-child', { status: 'done', label: 'stale duplicate' })]],
    );

    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({ sessionKey: 'agent:main:subagent:done-child', status: 'done' });
    expect(merged[1].label).toBeUndefined();
  });

  it('requires a positive live signal for supplemental sessions with unknown state', () => {
    expect(isLiveSupplementalSession(session('agent:main:subagent:unknown-child'))).toBe(false);
    expect(isLiveSupplementalSession(session('agent:main:subagent:busy-child', { processing: true }))).toBe(true);
  });
});
