import { describe, expect, it } from 'vitest';
import type { Session } from '@/types';
import { getSessionKey } from '@/types';
import {
  buildAgentRootSessionKey,
  extractIdentityName,
  getAgentRegistrationName,
  getChatRoomNames,
  getRootAgentId,
  getRootAgentSessionKey,
  getSessionAgentId,
  getSessionDisplayLabel,
  getTopLevelAgentSessions,
  inferParentSessionKey,
  isRootChildSession,
  isTopLevelAgentSessionKey,
  pickDefaultSessionKey,
  resolveParentSessionKey,
} from './sessionKeys';

describe('getSessionAgentId', () => {
  it('reads the agent from any agent-scoped key, also kinds getRootAgentId does not know', () => {
    expect(getSessionAgentId('agent:ops:main')).toBe('ops');
    expect(getSessionAgentId('agent:ops:subagent:worker')).toBe('ops');
    expect(getSessionAgentId('agent:ops:acp:abc')).toBe('ops');
    expect(getSessionAgentId('global')).toBeNull();
    expect(getSessionAgentId('agent::main')).toBeNull();
  });
});

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

describe('getChatRoomNames', () => {
  const telegramDm = 'agent:main:telegram:direct:469914749';
  const discordChannel = 'agent:ops:discord:channel:1488657713385701408';
  const sessions = [
    session('agent:main:main'),
    session(telegramDm, { label: 'Shaun (@shaunfi) id:469914749', displayName: 'Shaun (@shaunfi) id:469914749' }),
    session('agent:main:subagent:abc', { label: 'Release notes' }),
    session('agent:main:cron:daily', { label: 'Morning brief' }),
    session('agent:main:cron:daily:run:r1', { displayName: 'Morning brief run' }),
    session('agent:main:telegram:group:-1001234:topic:7', { displayName: 'Family chat' }),
    session('agent:ops:main', { identityName: 'Varys' }),
    session(discordChannel, { displayName: '#releases' }),
    session(`${discordChannel}:thread:789`, { displayName: 'Release thread' }),
  ];

  it('names the main room after the agent and shows no separate session name', () => {
    expect(getChatRoomNames('agent:main:main', sessions, 'Jen')).toEqual({ agentId: 'main', agentName: 'Jen (main)' });
  });

  it('gives a Telegram direct session to the agent and keeps the peer as the session name', () => {
    expect(getChatRoomNames(telegramDm, sessions, 'Jen')).toEqual({
      agentId: 'main',
      agentName: 'Jen (main)',
      sessionName: 'Shaun (@shaunfi) id:469914749',
    });
  });

  it('gives a Discord channel and its threads to the agent family, named as its root row', () => {
    expect(getChatRoomNames(discordChannel, sessions, 'Jen')).toEqual({
      agentId: 'ops',
      agentName: 'Varys (ops)',
      sessionName: '#releases',
    });
    expect(getChatRoomNames(`${discordChannel}:thread:789`, sessions, 'Jen')).toEqual({
      agentId: 'ops',
      agentName: 'Varys (ops)',
      sessionName: 'Release thread',
    });
  });

  it('gives group topics and cron jobs to the agent that runs them', () => {
    expect(getChatRoomNames('agent:main:telegram:group:-1001234:topic:7', sessions, 'Jen')).toEqual({
      agentId: 'main',
      agentName: 'Jen (main)',
      sessionName: 'Family chat',
    });
    expect(getChatRoomNames('agent:main:cron:daily', sessions, 'Jen')).toEqual({
      agentId: 'main',
      agentName: 'Jen (main)',
      sessionName: 'Morning brief',
    });
    expect(getChatRoomNames('agent:main:cron:daily:run:r1', sessions, 'Jen')).toEqual({
      agentId: 'main',
      agentName: 'Jen (main)',
      sessionName: 'Morning brief run',
    });
  });

  it('keeps root agents and subagents named after themselves', () => {
    expect(getChatRoomNames('agent:ops:main', sessions, 'Jen')).toEqual({ agentId: 'ops', agentName: 'Varys (ops)' });
    expect(getChatRoomNames('agent:main:subagent:abc', sessions, 'Jen')).toEqual({ agentId: 'main', agentName: 'Release notes' });
  });

  it('names the family from the session key when its root row is not loaded', () => {
    expect(getChatRoomNames('agent:ghost:discord:channel:1', [session('agent:ghost:discord:channel:1', { displayName: '#ghosts' })], 'Jen')).toEqual({
      agentId: 'ghost',
      agentName: 'ghost',
      sessionName: '#ghosts',
    });
    expect(getChatRoomNames(telegramDm, [], 'Jen')).toEqual({ agentId: 'main', agentName: 'Jen (main)' });
  });

  it('falls back to the agent name before the open session row has loaded', () => {
    expect(getChatRoomNames('agent:main:main', [], 'Jen')).toEqual({ agentId: 'main', agentName: 'Jen' });
  });

  it('keeps a session outside any agent family named by its own row', () => {
    expect(getChatRoomNames('custom-key', [session('custom-key', { label: 'Side room' })], 'Jen')).toEqual({ agentId: null, agentName: 'Side room' });
  });

  it('follows an explicit parent to the agent family when the key carries no agent', () => {
    const withParents = [
      ...sessions,
      session('custom-direct-key', { label: 'Alice', parentSessionKey: 'agent:main:main' }),
      session('custom-ops-key', { label: 'Bob', parentId: 'agent:ops:main' }),
      session('custom-stale-key', { label: 'Carol', parentSessionKey: 'stale-parent-key', parentId: ' agent:main:main ' }),
      session('custom-ghost-key', { label: 'Dana', parentSessionKey: 'agent:ghost:main' }),
    ];

    expect(getChatRoomNames('custom-direct-key', withParents, 'Jen')).toEqual({ agentId: 'main', agentName: 'Jen (main)', sessionName: 'Alice' });
    expect(getChatRoomNames('custom-ops-key', withParents, 'Jen')).toEqual({ agentId: 'ops', agentName: 'Varys (ops)', sessionName: 'Bob' });
    // A stale parentSessionKey falls through to parentId, as the sidebar tree does.
    expect(getChatRoomNames('custom-stale-key', withParents, 'Jen')).toEqual({ agentId: 'main', agentName: 'Jen (main)', sessionName: 'Carol' });
    // The parent names its agent even when that agent's root row is not loaded.
    expect(getChatRoomNames('custom-ghost-key', withParents, 'Jen')).toEqual({ agentId: 'ghost', agentName: 'ghost', sessionName: 'Dana' });
  });

  it('follows a two-level explicit parent chain to the agent family', () => {
    const chain = [
      ...sessions,
      session('custom-parent', { label: 'Alice', parentSessionKey: 'agent:ops:discord:channel:1488657713385701408' }),
      session('custom-child', { label: 'Alice follow-up', parentId: 'custom-parent' }),
    ];

    expect(getChatRoomNames('custom-child', chain, 'Jen')).toEqual({ agentId: 'ops', agentName: 'Varys (ops)', sessionName: 'Alice follow-up' });
  });

  it('stops on a parent cycle and keeps the session named by its own row', () => {
    const cycle = [
      session('loop-a', { label: 'Loop A', parentSessionKey: 'loop-b' }),
      session('loop-b', { label: 'Loop B', parentId: 'loop-a' }),
      session('loop-self', { label: 'Loop self', parentSessionKey: 'loop-self' }),
    ];

    expect(getChatRoomNames('loop-a', cycle, 'Jen')).toEqual({ agentId: null, agentName: 'Loop A' });
    expect(getChatRoomNames('loop-self', cycle, 'Jen')).toEqual({ agentId: null, agentName: 'Loop self' });
  });

  it('lets an agent-scoped key name its family over an explicit parent from another agent', () => {
    const crossSpawn = [...sessions, session('agent:ops:subagent:x', { label: 'Ops helper', parentSessionKey: 'agent:main:main' })];

    expect(getChatRoomNames('agent:ops:subagent:x', crossSpawn, 'Jen')).toEqual({ agentId: 'ops', agentName: 'Ops helper' });
  });
});
