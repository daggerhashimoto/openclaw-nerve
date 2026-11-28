import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { KanbanTask } from './types';

vi.mock('./hooks/useKanban', () => ({
  useKanban: () => ({
    tasks: [],
    loading: false,
    error: null,
    filters: { q: '', priority: [], assignee: '', labels: [] },
    setFilters: vi.fn(),
    fetchTasks: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    reorderTask: vi.fn(),
    tasksByStatus: {},
    statusCounts: {},
    boardColumns: [],
    executeTask: vi.fn(),
    approveTask: vi.fn(),
    rejectTask: vi.fn(),
    abortTask: vi.fn(),
  }),
}));

vi.mock('./hooks/useProposals', () => ({
  useProposals: () => ({
    proposals: [],
    pendingCount: 0,
    loading: false,
    approveProposal: vi.fn(),
    rejectProposal: vi.fn(),
  }),
}));

vi.mock('./KanbanHeader', () => ({ KanbanHeader: () => null }));
vi.mock('./KanbanBoard', () => ({ KanbanBoard: () => null }));
vi.mock('./CreateTaskDialog', () => ({ CreateTaskDialog: () => null }));
vi.mock('./TaskDetailDrawer', () => ({
  TaskDetailDrawer: ({ task }: { task: KanbanTask | null }) => (task ? <div>drawer: {task.title}</div> : null),
}));

import { KanbanPanel } from './KanbanPanel';

const farTask = {
  id: 'task-301',
  title: 'Task beyond the first page',
  status: 'review',
  priority: 'normal',
  createdBy: 'operator',
  createdAt: 1,
  updatedAt: 1,
  version: 1,
  labels: [],
  columnOrder: 0,
  feedback: [],
} as KanbanTask;

describe('KanbanPanel initial task', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(farTask), { status: 200 })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches a task that is not on the loaded page and opens its drawer', async () => {
    const consumed = vi.fn();
    render(<KanbanPanel initialTaskId="task-301" onInitialTaskConsumed={consumed} />);
    expect(await screen.findByText('drawer: Task beyond the first page')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith('/api/kanban/tasks/task-301');
    await waitFor(() => expect(consumed).toHaveBeenCalledTimes(1));
  });
});
