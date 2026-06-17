import { describe, it, expect, vi } from 'vitest';
import type { Session } from '@/types';
import { createCommands, createSessionCommands, filterCommands } from './commands';

function makeSession(key: string, extra: Partial<Session> = {}): Session {
  return { sessionKey: key, ...extra };
}

function noopActions() {
  return {
    onNewSession: vi.fn(),
    onResetSession: vi.fn(),
    onToggleSound: vi.fn(),
    onSettings: vi.fn(),
    onSearch: vi.fn(),
    onAbort: vi.fn(),
    onSetTheme: vi.fn(),
    onSetFont: vi.fn(),
    onTtsProviderChange: vi.fn(),
    onToggleWakeWord: vi.fn(),
    onToggleEvents: vi.fn(),
    onToggleLog: vi.fn(),
    onToggleTelemetry: vi.fn(),
    onOpenSettings: vi.fn(),
    onRefreshSessions: vi.fn(),
    onRefreshMemory: vi.fn(),
  };
}

describe('createSessionCommands', () => {
  it('returns one command per input session with category "sessions"', () => {
    const sessions = [
      makeSession('agent:main:main', { label: 'Main' }),
      makeSession('agent:reviewer:main', { label: 'Reviewer' }),
    ];
    const cmds = createSessionCommands(sessions, '', 'Agent', vi.fn());
    expect(cmds).toHaveLength(2);
    expect(cmds.every((c) => c.category === 'sessions')).toBe(true);
  });

  it('marks exactly the current session as isActive', () => {
    const sessions = [
      makeSession('agent:main:main', { label: 'Main' }),
      makeSession('agent:reviewer:main', { label: 'Reviewer' }),
      makeSession('agent:planner:main', { label: 'Planner' }),
    ];
    const cmds = createSessionCommands(sessions, 'agent:reviewer:main', 'Agent', vi.fn());
    const active = cmds.filter((c) => c.isActive);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('session-agent:reviewer:main');
    expect(cmds.find((c) => c.id === 'session-agent:main:main')?.isActive).toBe(false);
  });

  it('makes nested subagent sessions matchable by displayName', () => {
    const sessions = [
      makeSession('agent:main:subagent:abc123', { displayName: 'reviewer' }),
    ];
    const cmds = createSessionCommands(sessions, '', 'Agent', vi.fn());
    expect(cmds[0].keywords).toContain('reviewer');
  });

  it('includes display label, label, displayName, identityName, root agent id, and session key in keywords', () => {
    const sessions = [
      makeSession('agent:planner:main', {
        label: 'Plan Bot',
        displayName: 'plan-display',
        identityName: 'Plan Identity',
      }),
    ];
    const cmds = createSessionCommands(sessions, '', 'Agent', vi.fn());
    const keywords = cmds[0].keywords ?? [];
    expect(keywords).toContain('Plan Bot');
    expect(keywords).toContain('plan-display');
    expect(keywords).toContain('Plan Identity');
    expect(keywords).toContain('planner');
    expect(keywords).toContain('agent:planner:main');
  });

  it('skips missing/empty fields without producing undefined entries', () => {
    const sessions = [makeSession('agent:bare:main')];
    const cmds = createSessionCommands(sessions, '', 'Agent', vi.fn());
    const keywords = cmds[0].keywords ?? [];
    expect(keywords.every((k) => typeof k === 'string' && k.length > 0)).toBe(true);
  });

  it('falls back to a usable display label via getSessionDisplayLabel when label is empty', () => {
    const sessions = [
      makeSession('agent:main:main'),
      makeSession('agent:planner:main', { identityName: 'Planner Ident' }),
    ];
    const cmds = createSessionCommands(sessions, '', 'Agent', vi.fn());
    expect(cmds[0].label).toBe('Agent (main)');
    expect(cmds[1].label).toBe('Planner Ident (planner)');
  });

  it('action calls onSelectSession with the right session key exactly once', () => {
    const onSelect = vi.fn();
    const sessions = [makeSession('agent:reviewer:main', { label: 'Reviewer' })];
    const cmds = createSessionCommands(sessions, '', 'Agent', onSelect);
    cmds[0].action();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('agent:reviewer:main');
  });

  it('returns an empty array for an empty session list', () => {
    expect(createSessionCommands([], '', 'Agent', vi.fn())).toEqual([]);
  });
});

describe('filterCommands with merged static + session commands', () => {
  const sessions = [
    makeSession('agent:main:main', { label: 'Main' }),
    makeSession('agent:main:subagent:abc', { displayName: 'reviewer' }),
    makeSession('agent:planner:main'),
  ];

  function buildAll(currentKey = '') {
    const statics = createCommands(noopActions());
    const sessionCmds = createSessionCommands(sessions, currentKey, 'Agent', vi.fn());
    return [...statics, ...sessionCmds];
  }

  it('sorts the sessions group before appearance and voice', () => {
    const all = buildAll();
    const sorted = filterCommands(all, '');
    const firstSessions = sorted.findIndex((c) => c.category === 'sessions');
    const firstAppearance = sorted.findIndex((c) => c.category === 'appearance');
    const firstVoice = sorted.findIndex((c) => c.category === 'voice');
    expect(firstSessions).toBeGreaterThanOrEqual(0);
    expect(firstSessions).toBeLessThan(firstAppearance);
    expect(firstSessions).toBeLessThan(firstVoice);
  });

  it('returns the subagent labelled "reviewer" for query "review" (case-insensitive)', () => {
    const all = buildAll();
    const lower = filterCommands(all, 'review');
    const upper = filterCommands(all, 'REVIEW');
    const expectedId = 'session-agent:main:subagent:abc';
    expect(lower.some((c) => c.id === expectedId)).toBe(true);
    expect(upper.some((c) => c.id === expectedId)).toBe(true);
  });

  it('matches a session by its root-agent id when label/displayName are empty', () => {
    const all = buildAll();
    const results = filterCommands(all, 'planner');
    expect(results.some((c) => c.id === 'session-agent:planner:main')).toBe(true);
  });
});
