import { describe, expect, it } from 'vitest';
import type { Session } from '@/types';
import { getSessionKey } from '@/types';
import {
  buildAgentRootSessionKey,
  getRootAgentSessionKey,
  getSessionDisplayLabel,
  getTopLevelAgentSessions,
  isRootChildSession,
  isTopLevelAgentSessionKey,
  pickDefaultSessionKey,
  resolveParentSessionKey,
} from './sessionKeys';

function session(sessionKey: string, extra: Partial<Session> = {}): Session {
  return { sessionKey, ...extra };
}

describe('sessionKeys', () => {
  it('detects top-level agent sessions', () => {
    expect(isTopLevelAgentSessionKey('agent:main:main')).toBe(true);
    expect(isTopLevelAgentSessionKey('agent:reviewer:main')).toBe(true);
    expect(isTopLevelAgentSessionKey('agent:reviewer:subagent:abc')).toBe(false);
    expect(isTopLevelAgentSessionKey('agent:main:telegram:direct:123')).toBe(false);
  });

  it('resolves root keys for subagents and crons', () => {
    expect(getRootAgentSessionKey('agent:reviewer:subagent:abc')).toBe('agent:reviewer:main');
    expect(getRootAgentSessionKey('agent:reviewer:cron:daily')).toBe('agent:reviewer:main');
    expect(getRootAgentSessionKey('agent:reviewer:cron:daily:run:xyz')).toBe('agent:reviewer:main');
  });

  it('detects root-child relationships', () => {
    expect(isRootChildSession('agent:reviewer:subagent:abc', 'agent:reviewer:main')).toBe(true);
    expect(isRootChildSession('agent:main:subagent:abc', 'agent:reviewer:main')).toBe(false);
  });

  it('builds unique root session keys', () => {
    const existing = new Set(['agent:reviewer:main', 'agent:reviewer-2:main']);
    expect(buildAgentRootSessionKey('Reviewer', existing)).toBe('agent:reviewer-3:main');
  });

  it('picks top-level agent roots and prefers main', () => {
    const sessions = [
      session('agent:reviewer:main', { label: 'Reviewer' }),
      session('agent:main:main'),
      session('agent:main:telegram:direct:123', { displayName: 'Telegram DM' }),
    ];
    expect(getTopLevelAgentSessions(sessions).map(getSessionKey)).toEqual([
      'agent:main:main',
      'agent:reviewer:main',
    ]);
    expect(pickDefaultSessionKey(sessions)).toBe('agent:main:main');
  });

  it('builds display labels from label, displayName, then root id', () => {
    expect(getSessionDisplayLabel(session('agent:reviewer:main', { label: 'Reviewer', displayName: 'webchat:reviewer' }), 'Nerve')).toBe('Reviewer');
    expect(getSessionDisplayLabel(session('agent:reviewer:main', { displayName: 'Reviewer Prime' }), 'Nerve')).toBe('Reviewer Prime');
    expect(getSessionDisplayLabel(session('agent:reviewer:main', { label: 'Reviewer' }), 'Nerve')).toBe('Reviewer');
    expect(getSessionDisplayLabel(session('agent:reviewer:main'), 'Nerve')).toBe('Agent reviewer');
    expect(getSessionDisplayLabel(session('agent:main:main'), 'Nerve')).toBe('Nerve (main)');
  });

  it('falls back to inferred parent when explicit parentId is outside the current window', () => {
    const knownKeys = new Set(['agent:reviewer:main', 'agent:reviewer:subagent:child']);
    const child = session('agent:reviewer:subagent:child', { parentId: 'agent:missing:main' });
    expect(resolveParentSessionKey(child, knownKeys)).toBe('agent:reviewer:main');
  });
});
