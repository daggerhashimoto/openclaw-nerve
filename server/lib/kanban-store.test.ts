/** Tests for kanban-store: CRUD, CAS conflicts, reorder, config, filters. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { KanbanStore, VersionConflictError, TaskNotFoundError } from './kanban-store.js';
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
    const t1 = await createSampleTask({ title: 'Backlog', status: 'backlog' });
    const t2 = await createSampleTask({ title: 'Todo 1', status: 'todo' });
    const t3 = await createSampleTask({ title: 'Todo 2', status: 'todo' });
    const t4 = await createSampleTask({ title: 'Done', status: 'done' });

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
    const t1 = await createSampleTask({ title: 'A', status: 'review' });
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
    const t1 = await createSampleTask({ title: 'Keep' });
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
    const t1 = await createSampleTask({ title: 'A', status: 'todo' });
    const t2 = await createSampleTask({ title: 'B', status: 'todo' });
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
    const t2 = await createSampleTask({ title: 'B', status: 'in-progress' });

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
