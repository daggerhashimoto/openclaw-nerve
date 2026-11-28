import { describe, expect, it } from 'vitest';
import type { Session } from '@/types';
import { buildAgents } from './buildAgents';
import type { AttentionItem } from './types';

const NOW = Date.UTC(2026, 10, 28, 14, 16);
const MINUTE = 60_000;
const HOUR = 3_600_000;

function item(overrides: Partial<AttentionItem>): AttentionItem {
  return {
    key: 'k',
    source: 'tasks',
    sourceId: 's',
    kind: 'task-running',
    section: 'progress',
    title: 'Own PR 460 fix',
    updatedAt: NOW - 32 * MINUTE,
    priority: 'normal',
    freshness: 'live',
    open: { type: 'task', id: 's' },
    detail: {},
    ...overrides,
  };
}

const sessions: Session[] = [
  { key: 'agent:tuna:main', identityName: 'Tuna' },
  { key: 'agent:main:main', identityName: 'Kim', lastChannel: 'telegram' },
  { key: 'agent:linus:main', identityName: 'Linus' },
  { key: 'agent:linus:telegram:direct:9', channel: 'telegram' },
];
const agentNames = new Map([['main', 'Kim'], ['linus', 'Linus'], ['tuna', 'Tuna']]);

function build(progress: AttentionItem[], blocked: AttentionItem[] = [], extra: Partial<Parameters<typeof buildAgents>[0]> = {}) {
  return buildAgents({
    brief: { progress, blocked, seen: { blocked: [], finished: [] } },
    sessions,
    agentStatus: {},
    busyState: {},
    agentNames,
    now: NOW,
    ...extra,
  });
}

describe('buildAgents', () => {
  it('lists every top-level agent, working first, idle collapsed', () => {
    const lines = build([item({ ownerId: 'linus' })], [], {
      agentStatus: { 'agent:main:main': { status: 'THINKING', since: NOW - MINUTE } as never },
    });
    expect(lines.map((line) => [line.name, line.state, line.activity])).toEqual([
      ['Kim', 'working', 'replying on Telegram'],
      ['Linus', 'working', 'Own PR 460 fix'],
      ['Tuna', 'idle', undefined],
    ]);
    expect(lines[0].since).toBe(NOW - MINUTE);
    expect(lines[1]).toMatchObject({ open: { type: 'session', key: 'agent:linus:main' }, since: NOW - 32 * MINUTE });
    expect(lines[1].stopItem?.kind).toBe('task-running');
  });

  it('names another running session by its title, or its channel for a chat', () => {
    const lines = build([
      item({ kind: 'session-running', source: 'sessions', title: 'Research worker', ownerId: undefined, detail: { sessionKey: 'agent:tuna:subagent:r' } }),
      item({ key: 'k2', kind: 'session-running', source: 'sessions', title: 'Linus on telegram', ownerId: 'linus', detail: { sessionKey: 'agent:linus:telegram:direct:9' } }),
    ]);
    expect(lines.find((line) => line.name === 'Tuna')?.activity).toBe('Research worker');
    expect(lines.find((line) => line.name === 'Linus')?.activity).toBe('replying on Telegram');
  });

  it('a task run that went quiet marks the line quiet with the run to stop', () => {
    const quiet = item({ key: 'q', kind: 'gone-quiet', section: 'blocked', ownerId: 'linus', updatedAt: NOW - 4 * HOUR, detail: { quietSince: NOW - 4 * HOUR } });
    const [line] = build([], [quiet]);
    expect(line).toMatchObject({ name: 'Linus', state: 'quiet', activity: 'Own PR 460 fix', quietSince: NOW - 4 * HOUR });
    expect(line.stopItem?.key).toBe('q');
  });

  it('running work no listed agent holds still gets a line, never dropping off the board', () => {
    const orphan = item({ key: 'o', title: 'Index the archive', ownerId: undefined, detail: { sessionKey: 'kanban-root:kb-index-1795864537794' }, open: { type: 'task', id: 'o' } });
    const ghost = item({ key: 'g', title: 'Ghost work', ownerId: 'ghost', open: { type: 'task', id: 'g' } });
    const lines = build([orphan, ghost]);
    const unassigned = lines.find((line) => line.name === 'Unassigned');
    expect(unassigned).toMatchObject({ state: 'working', activity: 'Index the archive', open: { type: 'task', id: 'o' } });
    expect(unassigned?.agentId).toBeUndefined();
    expect(lines.find((line) => line.name === 'ghost')).toMatchObject({ agentId: 'ghost', activity: 'Ghost work' });
    expect(lines.filter((line) => line.state !== 'idle')).toHaveLength(2);
  });

  it('places a subagent run under the agent that spawned it', () => {
    const child = item({ key: 'c', kind: 'session-running', source: 'sessions', title: 'Helper', ownerId: undefined, detail: { sessionKey: 'odd-key' } });
    const lines = buildAgents({
      brief: { progress: [child], blocked: [], seen: { blocked: [], finished: [] } },
      sessions: [...sessions, { key: 'odd-key', spawnedBy: 'agent:tuna:main' }],
      agentStatus: {},
      busyState: {},
      agentNames,
      now: NOW,
    });
    expect(lines.find((line) => line.name === 'Tuna')).toMatchObject({ state: 'working', activity: 'Helper' });
  });

  it('counts further work beside the lead activity', () => {
    const lines = build([item({ ownerId: 'linus' }), item({ key: 'k2', title: 'Second', ownerId: 'linus' })]);
    expect(lines[0]).toMatchObject({ name: 'Linus', more: 1 });
  });
});
