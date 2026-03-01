/** Tests for kanban API routes: CRUD, validation, CAS conflicts, reorder, config. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { KanbanTask } from '../lib/kanban-store.js';

let tmpDir: string;

beforeEach(async () => {
  vi.resetModules();
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kanban-route-test-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

async function buildApp(): Promise<Hono> {
  // Mock rate-limit to be a no-op for tests
  vi.doMock('../middleware/rate-limit.js', () => ({
    rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
  }));

  // Create store from the re-imported module so instanceof checks work
  const storeModule = await import('../lib/kanban-store.js');
  const store = new storeModule.KanbanStore(path.join(tmpDir, 'tasks.json'));
  await store.init();
  storeModule.setKanbanStore(store);

  const mod = await import('./kanban.js');
  const app = new Hono();
  app.route('/', mod.default);
  return app;
}

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function jsonPatch(body: unknown): RequestInit {
  return {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function jsonPut(body: unknown): RequestInit {
  return {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function createTask(app: Hono, overrides: Record<string, unknown> = {}): Promise<KanbanTask> {
  const res = await app.request('/api/kanban/tasks', json({
    title: 'Test task',
    createdBy: 'operator',
    ...overrides,
  }));
  return res.json() as Promise<KanbanTask>;
}

// ── GET /api/kanban/tasks ────────────────────────────────────────────

describe('GET /api/kanban/tasks', () => {
  it('returns empty list', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/tasks');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.hasMore).toBe(false);
  });

  it('returns created tasks', async () => {
    const app = await buildApp();
    await createTask(app, { title: 'A' });
    await createTask(app, { title: 'B' });

    const res = await app.request('/api/kanban/tasks');
    const body = await res.json() as { items: KanbanTask[]; total: number };
    expect(body.total).toBe(2);
    expect(body.items.length).toBe(2);
  });

  it('filters by status query param', async () => {
    const app = await buildApp();
    await createTask(app, { title: 'A', status: 'todo' });
    await createTask(app, { title: 'B', status: 'backlog' });

    const res = await app.request('/api/kanban/tasks?status=todo');
    const body = await res.json() as { items: KanbanTask[]; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0].title).toBe('A');
  });

  it('filters by multiple status values (comma-separated)', async () => {
    const app = await buildApp();
    await createTask(app, { title: 'A', status: 'todo' });
    await createTask(app, { title: 'B', status: 'backlog' });
    await createTask(app, { title: 'C', status: 'done' });

    const res = await app.request('/api/kanban/tasks?status=todo,backlog');
    const body = await res.json() as { items: KanbanTask[]; total: number };
    expect(body.total).toBe(2);
  });

  it('filters by priority', async () => {
    const app = await buildApp();
    await createTask(app, { title: 'Critical', priority: 'critical' });
    await createTask(app, { title: 'Low', priority: 'low' });

    const res = await app.request('/api/kanban/tasks?priority=critical');
    const body = await res.json() as { items: KanbanTask[]; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0].title).toBe('Critical');
  });

  it('filters by assignee', async () => {
    const app = await buildApp();
    await createTask(app, { assignee: 'agent:codex' });
    await createTask(app, { assignee: 'operator' });

    const res = await app.request('/api/kanban/tasks?assignee=agent:codex');
    const body = await res.json() as { items: KanbanTask[]; total: number };
    expect(body.total).toBe(1);
  });

  it('filters by label', async () => {
    const app = await buildApp();
    await createTask(app, { labels: ['bug'] });
    await createTask(app, { labels: ['feature'] });

    const res = await app.request('/api/kanban/tasks?label=bug');
    const body = await res.json() as { items: KanbanTask[]; total: number };
    expect(body.total).toBe(1);
  });

  it('searches by q (title/description/labels)', async () => {
    const app = await buildApp();
    await createTask(app, { title: 'Fix login page' });
    await createTask(app, { title: 'Update docs', description: 'Login flow documentation' });
    await createTask(app, { title: 'Unrelated' });

    const res = await app.request('/api/kanban/tasks?q=login');
    const body = await res.json() as { items: KanbanTask[]; total: number };
    expect(body.total).toBe(2);
  });

  it('paginates with limit and offset', async () => {
    const app = await buildApp();
    for (let i = 0; i < 5; i++) await createTask(app, { title: `Task ${i}` });

    const res = await app.request('/api/kanban/tasks?limit=2&offset=0');
    const body = await res.json() as { items: KanbanTask[]; total: number; hasMore: boolean };
    expect(body.items.length).toBe(2);
    expect(body.total).toBe(5);
    expect(body.hasMore).toBe(true);
  });
});

// ── POST /api/kanban/tasks ───────────────────────────────────────────

describe('POST /api/kanban/tasks', () => {
  it('creates a task and returns 201', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/tasks', json({
      title: 'New task',
      createdBy: 'operator',
    }));
    expect(res.status).toBe(201);

    const task = await res.json() as KanbanTask;
    expect(task.title).toBe('New task');
    expect(task.id).toBeTruthy();
    expect(task.status).toBe('todo');
    expect(task.priority).toBe('normal');
    expect(task.version).toBe(1);
  });

  it('returns 400 for missing title', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/tasks', json({
      createdBy: 'operator',
    }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('validation_error');
  });

  it('returns 400 for empty title', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/tasks', json({
      title: '',
      createdBy: 'operator',
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for title exceeding max length', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/tasks', json({
      title: 'x'.repeat(501),
      createdBy: 'operator',
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('accepts agent actor', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/tasks', json({
      title: 'Agent task',
      createdBy: 'agent:codex',
    }));
    expect(res.status).toBe(201);
    const task = await res.json() as KanbanTask;
    expect(task.createdBy).toBe('agent:codex');
  });

  it('returns 400 for invalid status', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/tasks', json({
      title: 'Task',
      createdBy: 'operator',
      status: 'invalid-status',
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid priority', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/tasks', json({
      title: 'Task',
      createdBy: 'operator',
      priority: 'ultra',
    }));
    expect(res.status).toBe(400);
  });
});

// ── PATCH /api/kanban/tasks/:id ──────────────────────────────────────

describe('PATCH /api/kanban/tasks/:id', () => {
  it('updates a task', async () => {
    const app = await buildApp();
    const task = await createTask(app);

    const res = await app.request(`/api/kanban/tasks/${task.id}`, jsonPatch({
      version: 1,
      title: 'Updated',
      priority: 'high',
    }));
    expect(res.status).toBe(200);
    const updated = await res.json() as KanbanTask;
    expect(updated.title).toBe('Updated');
    expect(updated.priority).toBe('high');
    expect(updated.version).toBe(2);
  });

  it('returns 409 on version conflict', async () => {
    const app = await buildApp();
    const task = await createTask(app);

    // Update to bump version
    await app.request(`/api/kanban/tasks/${task.id}`, jsonPatch({
      version: 1,
      title: 'V2',
    }));

    // Try with stale version
    const res = await app.request(`/api/kanban/tasks/${task.id}`, jsonPatch({
      version: 1,
      title: 'Stale',
    }));
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string; serverVersion: number; latest: KanbanTask };
    expect(body.error).toBe('version_conflict');
    expect(body.serverVersion).toBe(2);
    expect(body.latest.title).toBe('V2');
  });

  it('returns 404 for missing task', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/tasks/nonexistent', jsonPatch({
      version: 1,
      title: 'X',
    }));
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('not_found');
  });

  it('returns 400 for missing version', async () => {
    const app = await buildApp();
    const task = await createTask(app);
    const res = await app.request(`/api/kanban/tasks/${task.id}`, jsonPatch({
      title: 'No version',
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    const app = await buildApp();
    const task = await createTask(app);
    const res = await app.request(`/api/kanban/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad',
    });
    expect(res.status).toBe(400);
  });
});

// ── DELETE /api/kanban/tasks/:id ─────────────────────────────────────

describe('DELETE /api/kanban/tasks/:id', () => {
  it('deletes a task', async () => {
    const app = await buildApp();
    const task = await createTask(app);

    const res = await app.request(`/api/kanban/tasks/${task.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    // Verify gone
    const listRes = await app.request('/api/kanban/tasks');
    const body = await listRes.json() as { total: number };
    expect(body.total).toBe(0);
  });

  it('returns 404 for missing task', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/tasks/missing', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

// ── POST /api/kanban/tasks/:id/reorder ───────────────────────────────

describe('POST /api/kanban/tasks/:id/reorder', () => {
  it('reorders a task within the same column', async () => {
    const app = await buildApp();
    const t1 = await createTask(app, { title: 'A' });
    const t2 = await createTask(app, { title: 'B' });
    const t3 = await createTask(app, { title: 'C' });

    // Move C to top
    const res = await app.request(`/api/kanban/tasks/${t3.id}/reorder`, json({
      version: t3.version,
      targetStatus: 'todo',
      targetIndex: 0,
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;
    expect(body.columnOrder).toBe(0);
    expect(body.version).toBe(2);
  });

  it('moves task to a different column', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/reorder`, json({
      version: task.version,
      targetStatus: 'in-progress',
      targetIndex: 0,
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;
    expect(body.status).toBe('in-progress');
  });

  it('returns 409 on version conflict', async () => {
    const app = await buildApp();
    const task = await createTask(app);
    await app.request(`/api/kanban/tasks/${task.id}`, jsonPatch({
      version: 1,
      title: 'V2',
    }));

    const res = await app.request(`/api/kanban/tasks/${task.id}/reorder`, json({
      version: 1,
      targetStatus: 'backlog',
      targetIndex: 0,
    }));
    expect(res.status).toBe(409);
  });

  it('returns 404 for missing task', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/tasks/missing/reorder', json({
      version: 1,
      targetStatus: 'todo',
      targetIndex: 0,
    }));
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid body', async () => {
    const app = await buildApp();
    const task = await createTask(app);

    const res = await app.request(`/api/kanban/tasks/${task.id}/reorder`, json({
      version: task.version,
      targetStatus: 'invalid',
      targetIndex: 0,
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing version', async () => {
    const app = await buildApp();
    const task = await createTask(app);

    const res = await app.request(`/api/kanban/tasks/${task.id}/reorder`, json({
      targetStatus: 'todo',
      targetIndex: 0,
    }));
    expect(res.status).toBe(400);
  });
});

// ── GET /api/kanban/config ───────────────────────────────────────────

describe('GET /api/kanban/config', () => {
  it('returns default config', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/config');
    expect(res.status).toBe(200);
    const cfg = await res.json() as Record<string, unknown>;
    expect(cfg.reviewRequired).toBe(true);
    expect(cfg.allowDoneDragBypass).toBe(false);
    expect(cfg.quickViewLimit).toBe(5);
  });
});

// ── PUT /api/kanban/config ───────────────────────────────────────────

describe('PUT /api/kanban/config', () => {
  it('updates config', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/config', jsonPut({
      reviewRequired: false,
      quickViewLimit: 10,
    }));
    expect(res.status).toBe(200);
    const cfg = await res.json() as Record<string, unknown>;
    expect(cfg.reviewRequired).toBe(false);
    expect(cfg.quickViewLimit).toBe(10);
  });

  it('returns 400 for invalid config', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/config', jsonPut({
      quickViewLimit: -1,
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: 'bad json',
    });
    expect(res.status).toBe(400);
  });

  it('persists config across requests', async () => {
    const app = await buildApp();
    await app.request('/api/kanban/config', jsonPut({ reviewRequired: false }));

    const res = await app.request('/api/kanban/config');
    const cfg = await res.json() as Record<string, unknown>;
    expect(cfg.reviewRequired).toBe(false);
  });
});
