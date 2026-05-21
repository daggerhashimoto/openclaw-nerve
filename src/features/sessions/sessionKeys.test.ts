import { describe, expect, it } from 'vitest';
import type { Session } from '@/types';
import { getSessionKey } from '@/types';
import {
  buildAgentRootSessionKey,
  extractIdentityName,
  getAgentRegistrationName,
  getRootAgentId,
  getRootAgentSessionKey,
  getSessionDisplayLabel,
  getTopLevelAgentSessions,
  inferParentSessionKey,
  isRootChildSession,
  isTopLevelAgentSessionKey,
  pickDefaultSessionKey,
  resolveParentSessionKey,
} from './sessionKeys';

function session(sessionKey: string, extra: Partial<Session> = {}): Session {
  return { sessionKey, ...extra };
}

describe('sessionKeys', () => {
  it('extracts agent names from IDENTITY.md variants', () => {
    expect(extractIdentityName('# IDENTITY.md - Who Am I?\n\n- **Name:** Blende\n- **Creature:** AI workshop familiar\n')).toBe('Blende');
    expect(extractIdentityName('# IDENTITY.md\n- Name: forge\n- Role: Coding\n')).toBe('forge');
    expect(extractIdentityName('# IDENTITY.md\nName: Reviewer Prime\nRole: Review agent\n')).toBe('Reviewer Prime');
    expect(extractIdentityName('# IDENTITY.md\n- Role: Coding only\n')).toBeNull();
  });

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

  it('resolves root agent id and parent for direct and channel delivery sessions', () => {
    // per-channel-peer: agent:X:<channel>:direct:<peerId>
    expect(getRootAgentId('agent:reviewer:telegram:direct:123')).toBe('reviewer');
    expect(getRootAgentSessionKey('agent:reviewer:telegram:direct:123')).toBe('agent:reviewer:main');
    expect(inferParentSessionKey('agent:reviewer:telegram:direct:123')).toBe('agent:reviewer:main');

    // per-account-channel-peer: agent:X:<channel>:<accountId>:direct:<peerId>
    expect(getRootAgentId('agent:reviewer:telegram:myaccount:direct:123')).toBe('reviewer');
    expect(inferParentSessionKey('agent:reviewer:telegram:myaccount:direct:123')).toBe('agent:reviewer:main');

    // per-peer: agent:X:direct:<peerId>
    expect(getRootAgentId('agent:main:direct:456')).toBe('main');
    expect(inferParentSessionKey('agent:main:direct:456')).toBe('agent:main:main');

    // channel sessions should also resolve back to their root agent
    expect(getRootAgentId('agent:varys:discord:channel:1488657713385701408')).toBe('varys');
    expect(getRootAgentSessionKey('agent:varys:discord:channel:1488657713385701408')).toBe('agent:varys:main');
    expect(inferParentSessionKey('agent:varys:discord:channel:1488657713385701408')).toBe('agent:varys:main');

    // root sessions still return null parent
    expect(inferParentSessionKey('agent:main:main')).toBeNull();
    expect(inferParentSessionKey('agent:reviewer:main')).toBeNull();
  });

  it('detects root-child relationships', () => {
    expect(isRootChildSession('agent:reviewer:subagent:abc', 'agent:reviewer:main')).toBe(true);
    expect(isRootChildSession('agent:main:subagent:abc', 'agent:reviewer:main')).toBe(false);
  });

  it('builds unique root session keys', () => {
    const existing = new Set(['agent:reviewer:main', 'agent:reviewer-2:main']);
    expect(buildAgentRootSessionKey('Reviewer', existing)).toBe('agent:reviewer-3:main');
  });

  it('builds a unique agent registration name for duplicate roots', () => {
    expect(getAgentRegistrationName('Reviewer', 'agent:reviewer:main')).toBe('Reviewer');
    expect(getAgentRegistrationName('Reviewer', 'agent:reviewer-2:main')).toBe('Reviewer 2');
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

  it('prefers explicit labels for root sessions, then falls back to identity name and root id', () => {
    expect(getSessionDisplayLabel(session('agent:reviewer:main', { label: 'Reviewer', displayName: 'webchat:reviewer' }), 'Nerve')).toBe('Reviewer');
    expect(getSessionDisplayLabel(session('agent:reviewer:main', { label: 'Release QA', identityName: 'Reviewer Prime' }), 'Nerve')).toBe('Release QA');
    expect(getSessionDisplayLabel(session('agent:reviewer:main', { displayName: 'Reviewer Prime' }), 'Nerve')).toBe('reviewer');
    expect(getSessionDisplayLabel(session('agent:reviewer:main', { identityName: 'Reviewer Prime' }), 'Nerve')).toBe('Reviewer Prime (reviewer)');
    expect(getSessionDisplayLabel(session('agent:reviewer:main'), 'Nerve')).toBe('reviewer');
    expect(getSessionDisplayLabel(session('agent:main:main'), 'Nerve')).toBe('Nerve (main)');
  });

  it('ignores gateway display names for non-main root sessions', () => {
    expect(
      getSessionDisplayLabel(
        session('agent:coding:main', { displayName: 'Jordan Humphreys id:8243587348' }),
        'Nerve',
      ),
    ).toBe('coding');
  });

  it('uses an explicit custom label for the main root, but ignores heartbeat metadata', () => {
    expect(getSessionDisplayLabel(session('agent:main:main', { label: 'Ops Desk' }), 'Nerve')).toBe('Ops Desk');
    expect(getSessionDisplayLabel(session('agent:main:main', { label: 'heartbeat' }), 'Nerve')).toBe('Nerve (main)');
    expect(getSessionDisplayLabel(session('agent:main:main', { displayName: 'heartbeat' }), 'Nerve')).toBe('Nerve (main)');
  });

  it('falls back to inferred parent when explicit parentId is outside the current window', () => {
    const knownKeys = new Set(['agent:reviewer:main', 'agent:reviewer:subagent:child']);
    const child = session('agent:reviewer:subagent:child', { parentId: 'agent:missing:main' });
    expect(resolveParentSessionKey(child, knownKeys)).toBe('agent:reviewer:main');
  });

  it('uses parentSessionKey when the gateway provides it', () => {
    const knownKeys = new Set(['agent:main:main', 'custom-direct-key']);
    const child = session('custom-direct-key', { parentSessionKey: 'agent:main:main' });
    expect(resolveParentSessionKey(child, knownKeys)).toBe('agent:main:main');
  });

  it('falls back to parentId when parentSessionKey is stale', () => {
    const knownKeys = new Set(['agent:main:main', 'custom-direct-key']);
    const child = session('custom-direct-key', {
      parentSessionKey: 'stale-parent-key',
      parentId: ' agent:main:main ',
    });
    expect(resolveParentSessionKey(child, knownKeys)).toBe('agent:main:main');
  });
});
