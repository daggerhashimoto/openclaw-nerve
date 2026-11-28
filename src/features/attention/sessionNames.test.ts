import { describe, expect, it } from 'vitest';
import type { KanbanTask } from '@/features/kanban/types';
import type { CronJob } from '@/features/workspace/hooks/useCrons';
import type { Session } from '@/types';
import { isKanbanRunLabel, sessionDisplayName } from './sessionNames';

function task(overrides: Partial<KanbanTask>): KanbanTask {
  return {
    id: 't1',
    title: 'Task',
    status: 'in-progress',
    priority: 'normal',
    createdBy: 'operator',
    createdAt: 0,
    updatedAt: 0,
    version: 1,
    labels: [],
    columnOrder: 0,
    feedback: [],
    ...overrides,
  };
}

const cron: CronJob = {
  id: 'abc123',
  name: 'factory-daily-pm-brief',
  enabled: true,
  scheduleKind: 'cron',
  payloadKind: 'agentTurn',
};

const tasks = [
  task({ id: 'attention-test-check-the-backu', title: 'Check the backup log', run: { sessionKey: 'kanban-root:kb-x-1', startedAt: 0, status: 'done' } }),
  task({ id: 'fix-2', title: 'Fix the drag into Review' }),
  task({ id: '2', title: 'Wrong match' }),
  task({ id: 'own-pr', title: 'Own PR 460 fix', run: { sessionKey: 'agent:linus:subagent:a', childSessionKey: 'agent:linus:subagent:b', startedAt: 0, status: 'running' } }),
];
const agentNames = new Map([['kim', 'Kim'], ['linus', 'Linus']]);

function name(key: string, sessions: Session[] = []): string {
  return sessionDisplayName(key, { tasks, crons: [cron], sessions, agentNames });
}

describe('sessionDisplayName', () => {
  it('names a kanban run after its task, by run key or child key', () => {
    expect(name('kanban-root:kb-x-1')).toBe('Check the backup log');
    expect(name('agent:linus:subagent:b')).toBe('Own PR 460 fix');
  });

  it('names an older run from its kb label, by the task id inside it', () => {
    const sessions = [
      { key: 'agent:kim:subagent:q1', label: 'kb-attention-test-check-the-backu-1795864537734' },
      { key: 'agent:kim:subagent:q2', label: 'kb-fix-the-drag-fix-2-v3-1795864537794' },
      { key: 'agent:kim:subagent:q3', label: 'kb-fix-2-1795864537794-2' },
    ];
    expect(name('agent:kim:subagent:q1', sessions)).toBe('Check the backup log');
    expect(name('agent:kim:subagent:q2', sessions)).toBe('Fix the drag into Review');
    expect(name('agent:kim:subagent:q3', sessions)).toBe('Fix the drag into Review');
    expect(name('kanban-root:kb-fix-2-1795864537794')).toBe('Fix the drag into Review');
  });

  it('names cron sessions and their runs after the job', () => {
    expect(name('agent:kim:cron:abc123')).toBe('factory-daily-pm-brief');
    expect(name('agent:kim:cron:abc123:run:r9')).toBe('factory-daily-pm-brief');
  });

  it('falls back to the label, then the agent on its channel, then the agent', () => {
    expect(name('agent:kim:subagent:r', [{ key: 'agent:kim:subagent:r', label: 'Research worker' }])).toBe('Research worker');
    expect(name('agent:kim:telegram:direct:42', [{ key: 'agent:kim:telegram:direct:42', channel: 'telegram' }])).toBe('Kim on telegram');
    expect(name('agent:linus:subagent:zz')).toBe('Linus');
    expect(name('agent:kim:main')).toBe('Kim');
  });

  it('never returns a session key or an unresolved kb label', () => {
    const sessions = [
      { key: 'agent:kim:subagent:gone', label: 'kb-deleted-task-1795864537734' },
      { key: 'agent:kim:subagent:self', label: 'agent:kim:subagent:self' },
    ];
    for (const key of ['agent:kim:subagent:gone', 'agent:kim:subagent:self', 'agent:ghost:cron:nope', 'weird-key']) {
      const result = name(key, sessions);
      expect(result).not.toContain(':');
      expect(isKanbanRunLabel(result)).toBe(false);
    }
    expect(name('agent:kim:subagent:gone', sessions)).toBe('Kim');
    expect(name('weird-key')).toBe('Session');
  });
});
