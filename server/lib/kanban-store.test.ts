/** Tests for kanban-store: CRUD, CAS conflicts, reorder, config, filters, workflow, proposals. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  KanbanStore,
  VersionConflictError,
  TaskNotFoundError,
  InvalidTransitionError,
  ProposalNotFoundError,
  ProposalAlreadyResolvedError,
} from './kanban-store.js';
import type { KanbanTask } from './kanban-store.js';

let store: KanbanStore;
let tmpDir: string;
let filePath: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kanban-test-'));
  filePath = path.join(tmpDir, 'tasks.json');
  store = new KanbanStore(filePath);
  await store.init();
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

// ── Helpers ──────────────────────────────────────────────────────────

async function createSampleTask(overrides: Partial<Parameters<KanbanStore['createTask']>[0]> = {}): Promise<KanbanTask> {
  return store.createTask({
    title: 'Test task',
    createdBy: 'operator',
    ...overrides,
  });
}

// ── Init ─────────────────────────────────────────────────────────────

describe('init', () => {
  it('creates store file on first init', async () => {
    const exists = fs.existsSync(filePath);
    expect(exists).toBe(true);

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(raw.meta.schemaVersion).toBe(1);
    expect(raw.tasks).toEqual([]);
  });

  it('does not overwrite existing store on re-init', async () => {
    await createSampleTask();
    await store.init(); // re-init
    const result = await store.listTasks();
    expect(result.total).toBe(1);
  });
});

// ── Create ───────────────────────────────────────────────────────────

describe('createTask', () => {
  it('creates a task with defaults', async () => {
    const task = await createSampleTask();
    expect(task.id).toBeTruthy();
    expect(task.title).toBe('Test task');
    expect(task.status).toBe('todo');
    expect(task.priority).toBe('normal');
    expect(task.version).toBe(1);
    expect(task.labels).toEqual([]);
    expect(task.feedback).toEqual([]);
    expect(task.createdBy).toBe('operator');
    expect(task.columnOrder).toBe(0);
    expect(task.createdAt).toBeGreaterThan(0);
    expect(task.updatedAt).toBe(task.createdAt);
  });

  it('respects explicit status and priority', async () => {
    const task = await createSampleTask({ status: 'backlog', priority: 'critical' });
    expect(task.status).toBe('backlog');
    expect(task.priority).toBe('critical');
  });

  it('assigns sequential columnOrder within same status', async () => {
    const t1 = await createSampleTask({ title: 'A' });
    const t2 = await createSampleTask({ title: 'B' });
    const t3 = await createSampleTask({ title: 'C' });
    expect(t1.columnOrder).toBe(0);
    expect(t2.columnOrder).toBe(1);
    expect(t3.columnOrder).toBe(2);
  });

  it('starts columnOrder at 0 for different status columns', async () => {
    const t1 = await createSampleTask({ status: 'todo' });
    const t2 = await createSampleTask({ status: 'backlog' });
    expect(t1.columnOrder).toBe(0);
    expect(t2.columnOrder).toBe(0);
  });

  it('stores optional fields', async () => {
    const task = await createSampleTask({
      description: 'My description',
      assignee: 'agent:codex',
      labels: ['bug', 'urgent'],
      model: 'gpt-4',
      thinking: 'high',
      dueAt: 9999999,
      estimateMin: 30,
      sourceSessionKey: 'sess-123',
    });
    expect(task.description).toBe('My description');
    expect(task.assignee).toBe('agent:codex');
    expect(task.labels).toEqual(['bug', 'urgent']);
    expect(task.model).toBe('gpt-4');
    expect(task.thinking).toBe('high');
    expect(task.dueAt).toBe(9999999);
    expect(task.estimateMin).toBe(30);
    expect(task.sourceSessionKey).toBe('sess-123');
  });

  it('persists to disk', async () => {
    await createSampleTask({ title: 'Persisted' });
    // Read directly from file
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(raw.tasks.length).toBe(1);
    expect(raw.tasks[0].title).toBe('Persisted');
  });
});

// ── List + filters ───────────────────────────────────────────────────

describe('listTasks', () => {
  it('returns empty list when no tasks', async () => {
    const result = await store.listTasks();
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
  });

  it('filters by status', async () => {
    await createSampleTask({ title: 'A', status: 'todo' });
    await createSampleTask({ title: 'B', status: 'backlog' });
    await createSampleTask({ title: 'C', status: 'todo' });

    const result = await store.listTasks({ status: ['todo'] });
    expect(result.total).toBe(2);
    expect(result.items.every((t) => t.status === 'todo')).toBe(true);
  });

  it('filters by multiple statuses', async () => {
    await createSampleTask({ status: 'todo' });
    await createSampleTask({ status: 'backlog' });
    await createSampleTask({ status: 'done' });

    const result = await store.listTasks({ status: ['todo', 'backlog'] });
    expect(result.total).toBe(2);
  });

  it('filters by priority', async () => {
    await createSampleTask({ title: 'A', priority: 'high' });
    await createSampleTask({ title: 'B', priority: 'low' });

    const result = await store.listTasks({ priority: ['high'] });
    expect(result.total).toBe(1);
    expect(result.items[0].title).toBe('A');
  });

  it('filters by assignee', async () => {
    await createSampleTask({ assignee: 'agent:codex' });
    await createSampleTask({ assignee: 'operator' });
    await createSampleTask();

    const result = await store.listTasks({ assignee: 'agent:codex' });
    expect(result.total).toBe(1);
    expect(result.items[0].assignee).toBe('agent:codex');
  });

  it('filters by label', async () => {
    await createSampleTask({ labels: ['bug', 'ui'] });
    await createSampleTask({ labels: ['feature'] });

    const result = await store.listTasks({ label: 'bug' });
    expect(result.total).toBe(1);
    expect(result.items[0].labels).toContain('bug');
  });

  it('filters by search query (title, description, labels)', async () => {
    await createSampleTask({ title: 'Fix login button', labels: ['auth'] });
    await createSampleTask({ title: 'Add search', description: 'Full-text search for login page' });
    await createSampleTask({ title: 'Update README' });

    const result = await store.listTasks({ q: 'login' });
    expect(result.total).toBe(2);
  });

  it('search is case-insensitive', async () => {
    await createSampleTask({ title: 'Fix LOGIN Issue' });
    const result = await store.listTasks({ q: 'login' });
    expect(result.total).toBe(1);
  });

  it('paginates with limit and offset', async () => {
    for (let i = 0; i < 5; i++) {
      await createSampleTask({ title: `Task ${i}` });
    }
    const page1 = await store.listTasks({ limit: 2, offset: 0 });
    expect(page1.items.length).toBe(2);
    expect(page1.total).toBe(5);
    expect(page1.hasMore).toBe(true);
    expect(page1.limit).toBe(2);
    expect(page1.offset).toBe(0);

    const page2 = await store.listTasks({ limit: 2, offset: 2 });
    expect(page2.items.length).toBe(2);
    expect(page2.hasMore).toBe(true);

    const page3 = await store.listTasks({ limit: 2, offset: 4 });
    expect(page3.items.length).toBe(1);
    expect(page3.hasMore).toBe(false);
  });

  it('clamps limit to MAX_LIMIT (200)', async () => {
    const result = await store.listTasks({ limit: 999 });
    expect(result.limit).toBe(200);
  });

  it('clamps limit minimum to 1', async () => {
    const result = await store.listTasks({ limit: 0 });
    expect(result.limit).toBe(1);
  });

  it('sorts by status order, then columnOrder, then updatedAt desc', async () => {
    await createSampleTask({ title: 'Backlog', status: 'backlog' });
    await createSampleTask({ title: 'Todo 1', status: 'todo' });
    await createSampleTask({ title: 'Todo 2', status: 'todo' });
    await createSampleTask({ title: 'Done', status: 'done' });

    const result = await store.listTasks();
    expect(result.items.map((t) => t.title)).toEqual(['Backlog', 'Todo 1', 'Todo 2', 'Done']);
  });
});

// ── Get ──────────────────────────────────────────────────────────────

describe('getTask', () => {
  it('returns task by id', async () => {
    const created = await createSampleTask({ title: 'Find me' });
    const found = await store.getTask(created.id);
    expect(found.title).toBe('Find me');
    expect(found.id).toBe(created.id);
  });

  it('throws TaskNotFoundError for missing id', async () => {
    await expect(store.getTask('nonexistent')).rejects.toThrow(TaskNotFoundError);
  });
});

// ── Update (CAS) ────────────────────────────────────────────────────

describe('updateTask', () => {
  it('updates fields and bumps version', async () => {
    const task = await createSampleTask();
    const updated = await store.updateTask(task.id, 1, {
      title: 'Updated',
      priority: 'high',
      labels: ['updated'],
    });
    expect(updated.title).toBe('Updated');
    expect(updated.priority).toBe('high');
    expect(updated.labels).toEqual(['updated']);
    expect(updated.version).toBe(2);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(task.updatedAt);
  });

  it('throws VersionConflictError on stale version', async () => {
    const task = await createSampleTask();
    // Update once to bump version to 2
    await store.updateTask(task.id, 1, { title: 'V2' });

    // Try to update with stale version 1
    try {
      await store.updateTask(task.id, 1, { title: 'Stale' });
      expect.fail('Expected VersionConflictError');
    } catch (err) {
      expect(err).toBeInstanceOf(VersionConflictError);
      const conflict = err as VersionConflictError;
      expect(conflict.serverVersion).toBe(2);
      expect(conflict.latest.title).toBe('V2');
    }
  });

  it('re-computes columnOrder on status change', async () => {
    await createSampleTask({ title: 'A', status: 'review' });
    const t2 = await createSampleTask({ title: 'B', status: 'todo' });

    // Move B to review column
    const updated = await store.updateTask(t2.id, t2.version, { status: 'review' });
    // Should be appended after t1 in review column
    expect(updated.status).toBe('review');
    expect(updated.columnOrder).toBe(1);
  });

  it('throws TaskNotFoundError for missing task', async () => {
    await expect(store.updateTask('missing', 1, { title: 'X' })).rejects.toThrow(TaskNotFoundError);
  });

  it('persists updates across reads', async () => {
    const task = await createSampleTask();
    await store.updateTask(task.id, 1, { title: 'Persisted update' });

    const found = await store.getTask(task.id);
    expect(found.title).toBe('Persisted update');
    expect(found.version).toBe(2);
  });
});

// ── Delete ───────────────────────────────────────────────────────────

describe('deleteTask', () => {
  it('removes a task', async () => {
    const task = await createSampleTask();
    await store.deleteTask(task.id);
    const result = await store.listTasks();
    expect(result.total).toBe(0);
  });

  it('throws TaskNotFoundError for missing task', async () => {
    await expect(store.deleteTask('missing')).rejects.toThrow(TaskNotFoundError);
  });

  it('does not affect other tasks', async () => {
    await createSampleTask({ title: 'Keep' });
    const t2 = await createSampleTask({ title: 'Delete' });
    await store.deleteTask(t2.id);
    const result = await store.listTasks();
    expect(result.total).toBe(1);
    expect(result.items[0].title).toBe('Keep');
  });
});

// ── Reorder ──────────────────────────────────────────────────────────

describe('reorderTask', () => {
  it('moves task within same column', async () => {
    await createSampleTask({ title: 'A', status: 'todo' });
    await createSampleTask({ title: 'B', status: 'todo' });
    const t3 = await createSampleTask({ title: 'C', status: 'todo' });

    // Move C to index 0 (top)
    const reordered = await store.reorderTask(t3.id, t3.version, 'todo', 0);
    expect(reordered.columnOrder).toBe(0);

    // Verify full order
    const result = await store.listTasks({ status: ['todo'] });
    expect(result.items.map((t) => t.title)).toEqual(['C', 'A', 'B']);
  });

  it('moves task to a different column', async () => {
    const t1 = await createSampleTask({ title: 'A', status: 'todo' });
    await createSampleTask({ title: 'B', status: 'in-progress' });

    // Move A to in-progress at index 0
    const reordered = await store.reorderTask(t1.id, t1.version, 'in-progress', 0);
    expect(reordered.status).toBe('in-progress');
    expect(reordered.columnOrder).toBe(0);

    // B should now be at index 1
    const result = await store.listTasks({ status: ['in-progress'] });
    expect(result.items.map((t) => t.title)).toEqual(['A', 'B']);
  });

  it('clamps index to column bounds', async () => {
    const t1 = await createSampleTask({ title: 'A', status: 'todo' });
    // Move to index 999 (should clamp to end)
    const reordered = await store.reorderTask(t1.id, t1.version, 'review', 999);
    expect(reordered.status).toBe('review');
    expect(reordered.columnOrder).toBe(0); // only task in column
  });

  it('throws VersionConflictError on stale version', async () => {
    const task = await createSampleTask();
    await store.updateTask(task.id, 1, { title: 'V2' }); // bumps to version 2

    try {
      await store.reorderTask(task.id, 1, 'backlog', 0); // stale version 1
      expect.fail('Expected VersionConflictError');
    } catch (err) {
      expect(err).toBeInstanceOf(VersionConflictError);
    }
  });

  it('throws TaskNotFoundError for missing task', async () => {
    await expect(store.reorderTask('missing', 1, 'todo', 0)).rejects.toThrow(TaskNotFoundError);
  });

  it('bumps version on reorder', async () => {
    const task = await createSampleTask();
    const reordered = await store.reorderTask(task.id, task.version, 'todo', 0);
    expect(reordered.version).toBe(2);
  });
});

// ── Config ───────────────────────────────────────────────────────────

describe('config', () => {
  it('returns default config', async () => {
    const cfg = await store.getConfig();
    expect(cfg.reviewRequired).toBe(true);
    expect(cfg.allowDoneDragBypass).toBe(false);
    expect(cfg.quickViewLimit).toBe(5);
    expect(cfg.defaults.status).toBe('todo');
    expect(cfg.defaults.priority).toBe('normal');
    expect(cfg.columns.length).toBe(6);
  });

  it('updates config partially', async () => {
    const updated = await store.updateConfig({ reviewRequired: false, quickViewLimit: 10 });
    expect(updated.reviewRequired).toBe(false);
    expect(updated.quickViewLimit).toBe(10);
    // Other fields untouched
    expect(updated.allowDoneDragBypass).toBe(false);
  });

  it('updates defaults nested', async () => {
    const updated = await store.updateConfig({ defaults: { status: 'backlog', priority: 'high' } });
    expect(updated.defaults.status).toBe('backlog');
    expect(updated.defaults.priority).toBe('high');
  });

  it('persists config changes', async () => {
    await store.updateConfig({ quickViewLimit: 20 });
    const cfg = await store.getConfig();
    expect(cfg.quickViewLimit).toBe(20);
  });
});

// ── Concurrency ──────────────────────────────────────────────────────

describe('concurrency', () => {
  it('serializes concurrent creates correctly', async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      store.createTask({ title: `Task ${i}`, createdBy: 'operator' }),
    );
    const tasks = await Promise.all(promises);
    expect(tasks.length).toBe(10);

    const result = await store.listTasks({ limit: 200 });
    expect(result.total).toBe(10);
    // All IDs should be unique
    const ids = new Set(result.items.map((t) => t.id));
    expect(ids.size).toBe(10);
  });
});

// ── Reset ────────────────────────────────────────────────────────────

describe('reset', () => {
  it('clears all tasks', async () => {
    await createSampleTask();
    await createSampleTask();
    await store.reset();

    const result = await store.listTasks();
    expect(result.total).toBe(0);
  });
});

// ── Execute ──────────────────────────────────────────────────────────

describe('executeTask', () => {
  it('moves task from todo to in-progress with run link', async () => {
    const task = await createSampleTask({ status: 'todo' });
    const executed = await store.executeTask(task.id);

    expect(executed.status).toBe('in-progress');
    expect(executed.run).toBeDefined();
    expect(executed.run!.status).toBe('running');
    expect(executed.run!.sessionKey).toContain(`kanban-run-${task.id}`);
    expect(executed.run!.startedAt).toBeGreaterThan(0);
    expect(executed.run!.endedAt).toBeUndefined();
    expect(executed.version).toBe(task.version + 1);
  });

  it('moves task from backlog to in-progress', async () => {
    const task = await createSampleTask({ status: 'backlog' });
    const executed = await store.executeTask(task.id);
    expect(executed.status).toBe('in-progress');
    expect(executed.run!.status).toBe('running');
  });

  it('applies model and thinking overrides', async () => {
    const task = await createSampleTask({ status: 'todo' });
    const executed = await store.executeTask(task.id, { model: 'gpt-5', thinking: 'high' });
    expect(executed.model).toBe('gpt-5');
    expect(executed.thinking).toBe('high');
  });

  it('is idempotent when task already has active run', async () => {
    const task = await createSampleTask({ status: 'todo' });
    const first = await store.executeTask(task.id);
    const second = await store.executeTask(first.id);

    // Should return same data without version bump
    expect(second.version).toBe(first.version);
    expect(second.run!.sessionKey).toBe(first.run!.sessionKey);
  });

  it('throws InvalidTransitionError for done task', async () => {
    const task = await createSampleTask({ status: 'todo' });
    // Manually set to done via updateTask
    await store.updateTask(task.id, task.version, { status: 'done' });

    try {
      await store.executeTask(task.id);
      expect.fail('Expected InvalidTransitionError');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      const ite = err as InvalidTransitionError;
      expect(ite.from).toBe('done');
      expect(ite.to).toBe('in-progress');
    }
  });

  it('throws InvalidTransitionError for review task', async () => {
    const task = await createSampleTask({ status: 'todo' });
    await store.updateTask(task.id, task.version, { status: 'review' });
    await expect(store.executeTask(task.id)).rejects.toThrow(InvalidTransitionError);
  });

  it('throws TaskNotFoundError for missing task', async () => {
    await expect(store.executeTask('nonexistent')).rejects.toThrow(TaskNotFoundError);
  });

  it('re-computes columnOrder for in-progress column', async () => {
    const existing = await createSampleTask({ status: 'todo' });
    // Put an existing task in in-progress
    await store.updateTask(existing.id, existing.version, { status: 'in-progress' });

    const task = await createSampleTask({ status: 'todo' });
    const executed = await store.executeTask(task.id);
    expect(executed.columnOrder).toBe(1); // after existing
  });
});

// ── Approve ──────────────────────────────────────────────────────────

describe('approveTask', () => {
  it('moves task from review to done', async () => {
    const task = await createSampleTask({ status: 'todo' });
    await store.updateTask(task.id, task.version, { status: 'review' });
    const reviewed = await store.getTask(task.id);

    const approved = await store.approveTask(reviewed.id);
    expect(approved.status).toBe('done');
    expect(approved.version).toBe(reviewed.version + 1);
  });

  it('adds feedback note when provided', async () => {
    const task = await createSampleTask({ status: 'todo' });
    await store.updateTask(task.id, task.version, { status: 'review' });
    const reviewed = await store.getTask(task.id);

    const approved = await store.approveTask(reviewed.id, 'Looks great!', 'operator');
    expect(approved.feedback.length).toBe(1);
    expect(approved.feedback[0].note).toBe('Looks great!');
    expect(approved.feedback[0].by).toBe('operator');
  });

  it('does not add feedback when no note', async () => {
    const task = await createSampleTask({ status: 'todo' });
    await store.updateTask(task.id, task.version, { status: 'review' });
    const reviewed = await store.getTask(task.id);

    const approved = await store.approveTask(reviewed.id);
    expect(approved.feedback.length).toBe(0);
  });

  it('throws InvalidTransitionError for non-review task', async () => {
    const task = await createSampleTask({ status: 'todo' });

    try {
      await store.approveTask(task.id);
      expect.fail('Expected InvalidTransitionError');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      const ite = err as InvalidTransitionError;
      expect(ite.from).toBe('todo');
      expect(ite.to).toBe('done');
    }
  });

  it('throws TaskNotFoundError for missing task', async () => {
    await expect(store.approveTask('nonexistent')).rejects.toThrow(TaskNotFoundError);
  });
});

// ── Reject ───────────────────────────────────────────────────────────

describe('rejectTask', () => {
  it('moves task from review to todo with feedback', async () => {
    const task = await createSampleTask({ status: 'todo' });
    await store.updateTask(task.id, task.version, { status: 'review' });
    const reviewed = await store.getTask(task.id);

    const rejected = await store.rejectTask(reviewed.id, 'Needs more work');
    expect(rejected.status).toBe('todo');
    expect(rejected.feedback.length).toBe(1);
    expect(rejected.feedback[0].note).toBe('Needs more work');
    expect(rejected.version).toBe(reviewed.version + 1);
  });

  it('clears run and result on reject', async () => {
    const task = await createSampleTask({ status: 'todo' });
    // Simulate an executed + completed task in review
    await store.updateTask(task.id, task.version, {
      status: 'review',
      run: { sessionKey: 'test', startedAt: Date.now(), endedAt: Date.now(), status: 'done' },
      result: 'Some result',
      resultAt: Date.now(),
    });
    const reviewed = await store.getTask(task.id);

    const rejected = await store.rejectTask(reviewed.id, 'Redo this');
    expect(rejected.run).toBeUndefined();
    expect(rejected.result).toBeUndefined();
    expect(rejected.resultAt).toBeUndefined();
  });

  it('throws InvalidTransitionError for non-review task', async () => {
    const task = await createSampleTask({ status: 'todo' });
    await expect(store.rejectTask(task.id, 'nope')).rejects.toThrow(InvalidTransitionError);
  });

  it('throws TaskNotFoundError for missing task', async () => {
    await expect(store.rejectTask('nonexistent', 'nope')).rejects.toThrow(TaskNotFoundError);
  });
});

// ── Abort ────────────────────────────────────────────────────────────

describe('abortTask', () => {
  it('aborts running task and moves back to todo', async () => {
    const task = await createSampleTask({ status: 'todo' });
    const executed = await store.executeTask(task.id);

    const aborted = await store.abortTask(executed.id, 'Taking too long');
    expect(aborted.status).toBe('todo');
    expect(aborted.run!.status).toBe('aborted');
    expect(aborted.run!.endedAt).toBeGreaterThan(0);
    expect(aborted.feedback.length).toBe(1);
    expect(aborted.feedback[0].note).toBe('Taking too long');
    expect(aborted.version).toBe(executed.version + 1);
  });

  it('aborts without note', async () => {
    const task = await createSampleTask({ status: 'todo' });
    const executed = await store.executeTask(task.id);

    const aborted = await store.abortTask(executed.id);
    expect(aborted.status).toBe('todo');
    expect(aborted.run!.status).toBe('aborted');
    expect(aborted.feedback.length).toBe(0);
  });

  it('throws InvalidTransitionError for non-in-progress task', async () => {
    const task = await createSampleTask({ status: 'todo' });
    await expect(store.abortTask(task.id)).rejects.toThrow(InvalidTransitionError);
  });

  it('throws InvalidTransitionError for in-progress task without active run', async () => {
    const task = await createSampleTask({ status: 'todo' });
    // Set to in-progress without run
    await store.updateTask(task.id, task.version, { status: 'in-progress' });
    const updated = await store.getTask(task.id);
    await expect(store.abortTask(updated.id)).rejects.toThrow(InvalidTransitionError);
  });

  it('throws TaskNotFoundError for missing task', async () => {
    await expect(store.abortTask('nonexistent')).rejects.toThrow(TaskNotFoundError);
  });
});

// ── Complete run ─────────────────────────────────────────────────────

describe('completeRun', () => {
  it('completes successfully: moves to review with result', async () => {
    const task = await createSampleTask({ status: 'todo' });
    const executed = await store.executeTask(task.id);

    const completed = await store.completeRun(executed.id, 'Task output here');
    expect(completed.status).toBe('review');
    expect(completed.run!.status).toBe('done');
    expect(completed.run!.endedAt).toBeGreaterThan(0);
    expect(completed.result).toBe('Task output here');
    expect(completed.resultAt).toBeGreaterThan(0);
    expect(completed.version).toBe(executed.version + 1);
  });

  it('completes with error: moves back to todo', async () => {
    const task = await createSampleTask({ status: 'todo' });
    const executed = await store.executeTask(task.id);

    const completed = await store.completeRun(executed.id, undefined, 'Runtime error');
    expect(completed.status).toBe('todo');
    expect(completed.run!.status).toBe('error');
    expect(completed.run!.error).toBe('Runtime error');
    expect(completed.run!.endedAt).toBeGreaterThan(0);
  });

  it('throws InvalidTransitionError when no active run', async () => {
    const task = await createSampleTask({ status: 'todo' });
    await expect(store.completeRun(task.id, 'result')).rejects.toThrow(InvalidTransitionError);
  });

  it('throws TaskNotFoundError for missing task', async () => {
    await expect(store.completeRun('nonexistent', 'result')).rejects.toThrow(TaskNotFoundError);
  });

  it('completes without result string on success', async () => {
    const task = await createSampleTask({ status: 'todo' });
    const executed = await store.executeTask(task.id);

    const completed = await store.completeRun(executed.id);
    expect(completed.status).toBe('review');
    expect(completed.run!.status).toBe('done');
    expect(completed.result).toBeUndefined();
  });
});

// ── Reconcile stale runs ─────────────────────────────────────────────

describe('reconcileStaleRuns', () => {
  it('reconciles stale running tasks', async () => {
    const task = await createSampleTask({ status: 'todo' });
    const executed = await store.executeTask(task.id);

    // Manually backdate the run start time
    await store.updateTask(executed.id, executed.version, {
      run: { ...executed.run!, startedAt: Date.now() - 100_000 },
    });

    const reconciled = await store.reconcileStaleRuns(50_000);
    expect(reconciled.length).toBe(1);
    expect(reconciled[0].status).toBe('todo');
    expect(reconciled[0].run!.status).toBe('error');
    expect(reconciled[0].run!.error).toBe('stale run reconciled');
  });

  it('does not reconcile fresh runs', async () => {
    const task = await createSampleTask({ status: 'todo' });
    await store.executeTask(task.id);

    const reconciled = await store.reconcileStaleRuns(999_999_999);
    expect(reconciled.length).toBe(0);
  });

  it('does not reconcile non-running tasks', async () => {
    await createSampleTask({ status: 'todo' });
    // Task is in todo, not in-progress
    const reconciled = await store.reconcileStaleRuns(0);
    expect(reconciled.length).toBe(0);
  });

  it('reconciles multiple stale tasks', async () => {
    const t1 = await createSampleTask({ status: 'todo', title: 'A' });
    const t2 = await createSampleTask({ status: 'todo', title: 'B' });
    const e1 = await store.executeTask(t1.id);
    const e2 = await store.executeTask(t2.id);

    // Backdate both
    await store.updateTask(e1.id, e1.version, {
      run: { ...e1.run!, startedAt: Date.now() - 100_000 },
    });
    const e2Updated = await store.getTask(e2.id);
    await store.updateTask(e2Updated.id, e2Updated.version, {
      run: { ...e2Updated.run!, startedAt: Date.now() - 100_000 },
    });

    const reconciled = await store.reconcileStaleRuns(50_000);
    expect(reconciled.length).toBe(2);
    expect(reconciled.every((t) => t.status === 'todo')).toBe(true);
    expect(reconciled.every((t) => t.run!.status === 'error')).toBe(true);
  });

  it('returns empty array when nothing to reconcile', async () => {
    const reconciled = await store.reconcileStaleRuns(50_000);
    expect(reconciled).toEqual([]);
  });
});

// ── Full workflow (execute → complete → approve) ─────────────────────

describe('full workflow', () => {
  it('execute → completeRun → approve', async () => {
    const task = await createSampleTask({ status: 'todo' });

    // Execute
    const executed = await store.executeTask(task.id);
    expect(executed.status).toBe('in-progress');

    // Complete run
    const completed = await store.completeRun(executed.id, 'Done!');
    expect(completed.status).toBe('review');

    // Approve
    const approved = await store.approveTask(completed.id, 'LGTM');
    expect(approved.status).toBe('done');
    expect(approved.feedback.length).toBe(1);
  });

  it('execute → completeRun → reject → re-execute', async () => {
    const task = await createSampleTask({ status: 'todo' });

    const executed = await store.executeTask(task.id);
    const completed = await store.completeRun(executed.id, 'Half done');
    const rejected = await store.rejectTask(completed.id, 'Not good enough');
    expect(rejected.status).toBe('todo');
    expect(rejected.run).toBeUndefined();

    // Can re-execute after reject
    const reExecuted = await store.executeTask(rejected.id);
    expect(reExecuted.status).toBe('in-progress');
    expect(reExecuted.run!.status).toBe('running');
  });

  it('execute → abort → re-execute', async () => {
    const task = await createSampleTask({ status: 'todo' });

    const executed = await store.executeTask(task.id);
    const aborted = await store.abortTask(executed.id, 'Too slow');
    expect(aborted.status).toBe('todo');

    // Can re-execute after abort (run is still on task but aborted)
    const reExecuted = await store.executeTask(aborted.id);
    expect(reExecuted.status).toBe('in-progress');
    expect(reExecuted.run!.status).toBe('running');
  });
});

// ── Proposals ────────────────────────────────────────────────────────

describe('createProposal', () => {
  it('creates a pending create proposal', async () => {
    const proposal = await store.createProposal({
      type: 'create',
      payload: { title: 'New feature', priority: 'high' },
      proposedBy: 'agent:codex',
    });
    expect(proposal.id).toBeTruthy();
    expect(proposal.type).toBe('create');
    expect(proposal.status).toBe('pending');
    expect(proposal.version).toBe(1);
    expect(proposal.payload.title).toBe('New feature');
    expect(proposal.proposedBy).toBe('agent:codex');
    expect(proposal.proposedAt).toBeGreaterThan(0);
  });

  it('creates a pending update proposal', async () => {
    const task = await createSampleTask();
    const proposal = await store.createProposal({
      type: 'update',
      payload: { id: task.id, status: 'done', result: 'Completed' },
      proposedBy: 'agent:codex',
    });
    expect(proposal.type).toBe('update');
    expect(proposal.status).toBe('pending');
    expect(proposal.payload.id).toBe(task.id);
  });

  it('stores sourceSessionKey', async () => {
    const proposal = await store.createProposal({
      type: 'create',
      payload: { title: 'Tracked' },
      proposedBy: 'agent:codex',
      sourceSessionKey: 'sess-abc',
    });
    expect(proposal.sourceSessionKey).toBe('sess-abc');
  });
});

describe('approveProposal', () => {
  it('approve create → task exists', async () => {
    const proposal = await store.createProposal({
      type: 'create',
      payload: { title: 'Agent task', priority: 'high', labels: ['agent'] },
      proposedBy: 'agent:codex',
    });

    const { proposal: approved, task } = await store.approveProposal(proposal.id);
    expect(approved.status).toBe('approved');
    expect(approved.resolvedBy).toBe('operator');
    expect(approved.resolvedAt).toBeGreaterThan(0);
    expect(approved.resultTaskId).toBe(task.id);
    expect(approved.version).toBe(2);

    // Task actually exists in the store
    const found = await store.getTask(task.id);
    expect(found.title).toBe('Agent task');
    expect(found.priority).toBe('high');
    expect(found.labels).toContain('agent');
    expect(found.createdBy).toBe('agent:codex');
  });

  it('approve update → task modified', async () => {
    const task = await createSampleTask({ title: 'Original' });
    const proposal = await store.createProposal({
      type: 'update',
      payload: { id: task.id, title: 'Updated by agent', status: 'done' },
      proposedBy: 'agent:codex',
    });

    const { proposal: approved } = await store.approveProposal(proposal.id);
    expect(approved.status).toBe('approved');
    expect(approved.resultTaskId).toBe(task.id);

    const found = await store.getTask(task.id);
    expect(found.title).toBe('Updated by agent');
    expect(found.status).toBe('done');
  });

  it('double approve → error', async () => {
    const proposal = await store.createProposal({
      type: 'create',
      payload: { title: 'Double' },
      proposedBy: 'agent:codex',
    });
    await store.approveProposal(proposal.id);

    await expect(store.approveProposal(proposal.id)).rejects.toThrow(ProposalAlreadyResolvedError);
  });

  it('throws ProposalNotFoundError for missing proposal', async () => {
    await expect(store.approveProposal('nonexistent')).rejects.toThrow(ProposalNotFoundError);
  });

  it('throws TaskNotFoundError when update references missing task', async () => {
    const proposal = await store.createProposal({
      type: 'update',
      payload: { id: 'nonexistent-task', status: 'done' },
      proposedBy: 'agent:codex',
    });
    await expect(store.approveProposal(proposal.id)).rejects.toThrow(TaskNotFoundError);
  });
});

describe('rejectProposal', () => {
  it('rejects a pending proposal', async () => {
    const proposal = await store.createProposal({
      type: 'create',
      payload: { title: 'Reject me' },
      proposedBy: 'agent:codex',
    });

    const rejected = await store.rejectProposal(proposal.id, 'Not needed');
    expect(rejected.status).toBe('rejected');
    expect(rejected.reason).toBe('Not needed');
    expect(rejected.resolvedBy).toBe('operator');
    expect(rejected.resolvedAt).toBeGreaterThan(0);
    expect(rejected.version).toBe(2);
  });

  it('reject then approve → error', async () => {
    const proposal = await store.createProposal({
      type: 'create',
      payload: { title: 'Reject first' },
      proposedBy: 'agent:codex',
    });
    await store.rejectProposal(proposal.id, 'No');

    await expect(store.approveProposal(proposal.id)).rejects.toThrow(ProposalAlreadyResolvedError);
  });

  it('throws ProposalNotFoundError for missing proposal', async () => {
    await expect(store.rejectProposal('nonexistent')).rejects.toThrow(ProposalNotFoundError);
  });

  it('double reject → error', async () => {
    const proposal = await store.createProposal({
      type: 'create',
      payload: { title: 'Double reject' },
      proposedBy: 'agent:codex',
    });
    await store.rejectProposal(proposal.id);
    await expect(store.rejectProposal(proposal.id)).rejects.toThrow(ProposalAlreadyResolvedError);
  });
});

describe('listProposals', () => {
  it('lists all proposals', async () => {
    await store.createProposal({ type: 'create', payload: { title: 'A' }, proposedBy: 'agent:a' });
    await store.createProposal({ type: 'create', payload: { title: 'B' }, proposedBy: 'agent:b' });

    const all = await store.listProposals();
    expect(all).toHaveLength(2);
    // Most recent first
    expect(all[0].payload.title).toBe('B');
  });

  it('filters by status', async () => {
    const p1 = await store.createProposal({ type: 'create', payload: { title: 'A' }, proposedBy: 'agent:a' });
    await store.createProposal({ type: 'create', payload: { title: 'B' }, proposedBy: 'agent:b' });
    await store.approveProposal(p1.id);

    const pending = await store.listProposals('pending');
    expect(pending).toHaveLength(1);
    expect(pending[0].payload.title).toBe('B');

    const approved = await store.listProposals('approved');
    expect(approved).toHaveLength(1);
    expect(approved[0].payload.title).toBe('A');
  });

  it('returns empty array when no proposals', async () => {
    const all = await store.listProposals();
    expect(all).toEqual([]);
  });
});

describe('proposal auto mode', () => {
  it('auto mode immediately creates task', async () => {
    await store.updateConfig({ proposalPolicy: 'auto' });

    const proposal = await store.createProposal({
      type: 'create',
      payload: { title: 'Auto-created' },
      proposedBy: 'agent:codex',
    });
    expect(proposal.status).toBe('approved');
    expect(proposal.resultTaskId).toBeTruthy();

    // Task exists
    const task = await store.getTask(proposal.resultTaskId!);
    expect(task.title).toBe('Auto-created');
  });

  it('auto mode immediately applies update', async () => {
    const task = await createSampleTask({ title: 'Before' });
    await store.updateConfig({ proposalPolicy: 'auto' });

    const proposal = await store.createProposal({
      type: 'update',
      payload: { id: task.id, title: 'After auto' },
      proposedBy: 'agent:codex',
    });
    expect(proposal.status).toBe('approved');

    const updated = await store.getTask(task.id);
    expect(updated.title).toBe('After auto');
  });
});

// ── Migration / corrupt data ─────────────────────────────────────────

describe('migration', () => {
  it('handles missing meta gracefully', async () => {
    fs.writeFileSync(filePath, JSON.stringify({ tasks: [], config: null }));
    const result = await store.listTasks();
    expect(result.total).toBe(0);
  });

  it('handles missing tasks array gracefully', async () => {
    fs.writeFileSync(filePath, JSON.stringify({ meta: { schemaVersion: 1 } }));
    const result = await store.listTasks();
    expect(result.total).toBe(0);
  });
});
