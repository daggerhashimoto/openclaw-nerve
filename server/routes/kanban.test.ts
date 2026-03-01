/** Tests for kanban API routes: CRUD, validation, CAS conflicts, reorder, config, workflow. */
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

  // Mock gateway client so fire-and-forget spawn doesn't interfere with test cleanup
  vi.doMock('../lib/gateway-client.js', () => ({
    invokeGatewayTool: vi.fn(() => Promise.resolve({ childSessionKey: 'test-session' })),
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
    await createTask(app, { title: 'A' });
    await createTask(app, { title: 'B' });
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

// ── POST /api/kanban/tasks/:id/execute ───────────────────────────────

describe('POST /api/kanban/tasks/:id/execute', () => {
  it('executes a todo task', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;
    expect(body.status).toBe('in-progress');
    expect(body.run).toBeDefined();
    expect(body.run!.status).toBe('running');
    expect(body.run!.sessionKey).toBeTruthy();
    expect(body.version).toBe(2);
  });

  it('executes a backlog task', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'backlog' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;
    expect(body.status).toBe('in-progress');
  });

  it('accepts empty body', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
  });

  it('applies model and thinking overrides', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({
      model: 'claude-opus',
      thinking: 'high',
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;
    expect(body.model).toBe('claude-opus');
    expect(body.thinking).toBe('high');
  });

  it('is idempotent for already-running task', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });

    const res1 = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    const body1 = await res1.json() as KanbanTask;

    const res2 = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res2.status).toBe(200);
    const body2 = await res2.json() as KanbanTask;
    expect(body2.run!.sessionKey).toBe(body1.run!.sessionKey);
    expect(body2.version).toBe(body1.version);
  });

  it('returns 409 for invalid transition (done task)', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });
    // Move to done
    await app.request(`/api/kanban/tasks/${task.id}`, jsonPatch({
      version: 1,
      status: 'done',
    }));

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string; from: string; to: string };
    expect(body.error).toBe('invalid_transition');
    expect(body.from).toBe('done');
    expect(body.to).toBe('in-progress');
  });

  it('returns 404 for missing task', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/tasks/missing/execute', json({}));
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid body', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });
    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad',
    });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/kanban/tasks/:id/approve ───────────────────────────────

describe('POST /api/kanban/tasks/:id/approve', () => {
  it('approves a review task', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });
    // Move to review
    await app.request(`/api/kanban/tasks/${task.id}`, jsonPatch({
      version: 1,
      status: 'review',
    }));

    const res = await app.request(`/api/kanban/tasks/${task.id}/approve`, json({}));
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;
    expect(body.status).toBe('done');
  });

  it('approves with a note', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });
    await app.request(`/api/kanban/tasks/${task.id}`, jsonPatch({
      version: 1,
      status: 'review',
    }));

    const res = await app.request(`/api/kanban/tasks/${task.id}/approve`, json({
      note: 'Ship it!',
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;
    expect(body.feedback.length).toBe(1);
    expect(body.feedback[0].note).toBe('Ship it!');
  });

  it('accepts empty body', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });
    await app.request(`/api/kanban/tasks/${task.id}`, jsonPatch({
      version: 1,
      status: 'review',
    }));

    const res = await app.request(`/api/kanban/tasks/${task.id}/approve`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
  });

  it('returns 409 for non-review task', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/approve`, json({}));
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_transition');
  });

  it('returns 404 for missing task', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/tasks/missing/approve', json({}));
    expect(res.status).toBe(404);
  });
});

// ── POST /api/kanban/tasks/:id/reject ────────────────────────────────

describe('POST /api/kanban/tasks/:id/reject', () => {
  it('rejects a review task with required note', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });
    await app.request(`/api/kanban/tasks/${task.id}`, jsonPatch({
      version: 1,
      status: 'review',
    }));

    const res = await app.request(`/api/kanban/tasks/${task.id}/reject`, json({
      note: 'Needs more work',
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;
    expect(body.status).toBe('todo');
    expect(body.feedback.length).toBe(1);
    expect(body.feedback[0].note).toBe('Needs more work');
  });

  it('returns 400 when note is missing', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });
    await app.request(`/api/kanban/tasks/${task.id}`, jsonPatch({
      version: 1,
      status: 'review',
    }));

    const res = await app.request(`/api/kanban/tasks/${task.id}/reject`, json({}));
    expect(res.status).toBe(400);
  });

  it('returns 400 when note is empty string', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });
    await app.request(`/api/kanban/tasks/${task.id}`, jsonPatch({
      version: 1,
      status: 'review',
    }));

    const res = await app.request(`/api/kanban/tasks/${task.id}/reject`, json({
      note: '',
    }));
    expect(res.status).toBe(400);
  });

  it('returns 409 for non-review task', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/reject`, json({
      note: 'nope',
    }));
    expect(res.status).toBe(409);
  });

  it('returns 404 for missing task', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/tasks/missing/reject', json({
      note: 'nope',
    }));
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid JSON', async () => {
    const app = await buildApp();
    const task = await createTask(app);
    const res = await app.request(`/api/kanban/tasks/${task.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/kanban/tasks/:id/abort ─────────────────────────────────

describe('POST /api/kanban/tasks/:id/abort', () => {
  it('aborts a running task', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });

    // Execute first
    await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));

    const res = await app.request(`/api/kanban/tasks/${task.id}/abort`, json({
      note: 'Taking too long',
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;
    expect(body.status).toBe('todo');
    expect(body.run!.status).toBe('aborted');
    expect(body.run!.endedAt).toBeGreaterThan(0);
    expect(body.feedback.length).toBe(1);
  });

  it('aborts without note', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });
    await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));

    const res = await app.request(`/api/kanban/tasks/${task.id}/abort`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;
    expect(body.status).toBe('todo');
    expect(body.feedback.length).toBe(0);
  });

  it('returns 409 for non-in-progress task', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/abort`, json({}));
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_transition');
  });

  it('returns 404 for missing task', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/tasks/missing/abort', json({}));
    expect(res.status).toBe(404);
  });
});

// ── GET /api/kanban/proposals ─────────────────────────────────────────

describe('GET /api/kanban/proposals', () => {
  it('returns empty list when no proposals', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/proposals');
    expect(res.status).toBe(200);
    const body = await res.json() as { proposals: unknown[] };
    expect(body.proposals).toEqual([]);
  });

  it('returns pending proposals', async () => {
    const app = await buildApp();
    await app.request('/api/kanban/proposals', json({
      type: 'create',
      payload: { title: 'Test' },
      proposedBy: 'agent:codex',
    }));

    const res = await app.request('/api/kanban/proposals?status=pending');
    expect(res.status).toBe(200);
    const body = await res.json() as { proposals: unknown[] };
    expect(body.proposals).toHaveLength(1);
  });

  it('filters by status', async () => {
    const app = await buildApp();
    const createRes = await app.request('/api/kanban/proposals', json({
      type: 'create',
      payload: { title: 'Test' },
      proposedBy: 'agent:codex',
    }));
    const proposal = await createRes.json() as { id: string };

    // Approve it
    await app.request(`/api/kanban/proposals/${proposal.id}/approve`, { method: 'POST' });

    // Should not appear in pending
    const res = await app.request('/api/kanban/proposals?status=pending');
    const body = await res.json() as { proposals: unknown[] };
    expect(body.proposals).toHaveLength(0);

    // Should appear in approved
    const res2 = await app.request('/api/kanban/proposals?status=approved');
    const body2 = await res2.json() as { proposals: unknown[] };
    expect(body2.proposals).toHaveLength(1);
  });

  it('returns 400 for invalid status', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/proposals?status=invalid');
    expect(res.status).toBe(400);
  });
});

// ── POST /api/kanban/proposals ───────────────────────────────────────

describe('POST /api/kanban/proposals', () => {
  it('creates a create proposal', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/proposals', json({
      type: 'create',
      payload: { title: 'New task', priority: 'high' },
      proposedBy: 'agent:codex',
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; type: string; status: string };
    expect(body.type).toBe('create');
    expect(body.status).toBe('pending');
    expect(body.id).toBeTruthy();
  });

  it('creates an update proposal', async () => {
    const app = await buildApp();
    const task = await createTask(app);

    const res = await app.request('/api/kanban/proposals', json({
      type: 'update',
      payload: { id: task.id, status: 'done' },
      proposedBy: 'agent:codex',
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as { type: string; status: string };
    expect(body.type).toBe('update');
  });

  it('returns 400 for create payload without title', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/proposals', json({
      type: 'create',
      payload: { priority: 'high' },
      proposedBy: 'agent:codex',
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for update payload without id', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/proposals', json({
      type: 'update',
      payload: { status: 'done' },
      proposedBy: 'agent:codex',
    }));
    expect(res.status).toBe(400);
  });

  it('returns 404 for update referencing nonexistent task', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/proposals', json({
      type: 'update',
      payload: { id: 'nonexistent', status: 'done' },
      proposedBy: 'agent:codex',
    }));
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid JSON', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing type', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/proposals', json({
      payload: { title: 'test' },
      proposedBy: 'agent:codex',
    }));
    expect(res.status).toBe(400);
  });
});

// ── POST /api/kanban/proposals/:id/approve ───────────────────────────

describe('POST /api/kanban/proposals/:id/approve', () => {
  it('approves a create proposal and returns task', async () => {
    const app = await buildApp();
    const createRes = await app.request('/api/kanban/proposals', json({
      type: 'create',
      payload: { title: 'Approve me', priority: 'high' },
      proposedBy: 'agent:codex',
    }));
    const proposal = await createRes.json() as { id: string };

    const res = await app.request(`/api/kanban/proposals/${proposal.id}/approve`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { proposal: { status: string }; task: KanbanTask };
    expect(body.proposal.status).toBe('approved');
    expect(body.task.title).toBe('Approve me');
    expect(body.task.id).toBeTruthy();
  });

  it('approves an update proposal', async () => {
    const app = await buildApp();
    const task = await createTask(app, { title: 'Original' });

    const createRes = await app.request('/api/kanban/proposals', json({
      type: 'update',
      payload: { id: task.id, title: 'Updated' },
      proposedBy: 'agent:codex',
    }));
    const proposal = await createRes.json() as { id: string };

    const res = await app.request(`/api/kanban/proposals/${proposal.id}/approve`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { proposal: { status: string }; task: KanbanTask };
    expect(body.task.title).toBe('Updated');
  });

  it('returns 404 for missing proposal', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/proposals/nonexistent/approve', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('returns 409 for already-approved proposal', async () => {
    const app = await buildApp();
    const createRes = await app.request('/api/kanban/proposals', json({
      type: 'create',
      payload: { title: 'Double approve' },
      proposedBy: 'agent:codex',
    }));
    const proposal = await createRes.json() as { id: string };

    await app.request(`/api/kanban/proposals/${proposal.id}/approve`, { method: 'POST' });
    const res = await app.request(`/api/kanban/proposals/${proposal.id}/approve`, { method: 'POST' });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('already_resolved');
  });
});

// ── POST /api/kanban/proposals/:id/reject ────────────────────────────

describe('POST /api/kanban/proposals/:id/reject', () => {
  it('rejects a proposal with reason', async () => {
    const app = await buildApp();
    const createRes = await app.request('/api/kanban/proposals', json({
      type: 'create',
      payload: { title: 'Reject me' },
      proposedBy: 'agent:codex',
    }));
    const proposal = await createRes.json() as { id: string };

    const res = await app.request(`/api/kanban/proposals/${proposal.id}/reject`, json({
      reason: 'Not useful',
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { proposal: { status: string; reason: string } };
    expect(body.proposal.status).toBe('rejected');
    expect(body.proposal.reason).toBe('Not useful');
  });

  it('rejects without reason (empty body)', async () => {
    const app = await buildApp();
    const createRes = await app.request('/api/kanban/proposals', json({
      type: 'create',
      payload: { title: 'Reject' },
      proposedBy: 'agent:codex',
    }));
    const proposal = await createRes.json() as { id: string };

    const res = await app.request(`/api/kanban/proposals/${proposal.id}/reject`, { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('returns 404 for missing proposal', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/proposals/nonexistent/reject', json({}));
    expect(res.status).toBe(404);
  });

  it('returns 409 for already-rejected proposal', async () => {
    const app = await buildApp();
    const createRes = await app.request('/api/kanban/proposals', json({
      type: 'create',
      payload: { title: 'Double reject' },
      proposedBy: 'agent:codex',
    }));
    const proposal = await createRes.json() as { id: string };

    await app.request(`/api/kanban/proposals/${proposal.id}/reject`, { method: 'POST' });
    const res = await app.request(`/api/kanban/proposals/${proposal.id}/reject`, { method: 'POST' });
    expect(res.status).toBe(409);
  });
});

// ── Auto mode proposals ──────────────────────────────────────────────

describe('proposal auto mode via HTTP', () => {
  it('auto mode creates task immediately', async () => {
    const app = await buildApp();

    // Set auto mode
    await app.request('/api/kanban/config', jsonPut({ proposalPolicy: 'auto' }));

    const res = await app.request('/api/kanban/proposals', json({
      type: 'create',
      payload: { title: 'Auto task' },
      proposedBy: 'agent:codex',
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as { status: string; resultTaskId: string };
    expect(body.status).toBe('approved');
    expect(body.resultTaskId).toBeTruthy();

    // Verify task exists
    const listRes = await app.request('/api/kanban/tasks');
    const tasks = await listRes.json() as { items: KanbanTask[] };
    expect(tasks.items.some(t => t.title === 'Auto task')).toBe(true);
  });

  it('auto mode applies update immediately', async () => {
    const app = await buildApp();
    const task = await createTask(app, { title: 'Before' });

    await app.request('/api/kanban/config', jsonPut({ proposalPolicy: 'auto' }));

    const res = await app.request('/api/kanban/proposals', json({
      type: 'update',
      payload: { id: task.id, title: 'After auto' },
      proposedBy: 'agent:codex',
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('approved');

    // Verify update applied
    const getRes = await app.request('/api/kanban/tasks');
    const tasks = await getRes.json() as { items: KanbanTask[] };
    const found = tasks.items.find(t => t.id === task.id);
    expect(found?.title).toBe('After auto');
  });
});

// ── POST /api/kanban/tasks/:id/complete (marker parsing) ─────────────

describe('POST /api/kanban/tasks/:id/complete — marker parsing', () => {
  async function setupRunningTask(app: Hono): Promise<KanbanTask> {
    const task = await createTask(app, { status: 'todo' });
    const execRes = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    return execRes.json() as Promise<KanbanTask>;
  }

  it('creates proposals from markers in result text', async () => {
    const app = await buildApp();
    const task = await setupRunningTask(app);

    const resultText = 'Task done.\n[kanban:create]{"title":"Follow-up task","priority":"high"}[/kanban:create]\nEnd.';
    const res = await app.request(`/api/kanban/tasks/${task.id}/complete`, json({ result: resultText }));
    expect(res.status).toBe(200);

    // Verify proposal was created
    const proposalsRes = await app.request('/api/kanban/proposals?status=pending');
    const proposals = await proposalsRes.json() as { proposals: Array<{ type: string; payload: Record<string, unknown> }> };
    expect(proposals.proposals.length).toBeGreaterThanOrEqual(1);
    const found = proposals.proposals.find(p => p.payload.title === 'Follow-up task');
    expect(found).toBeDefined();
    expect(found!.type).toBe('create');
  });

  it('strips markers from stored result', async () => {
    const app = await buildApp();
    const task = await setupRunningTask(app);

    const resultText = 'Task done.\n[kanban:create]{"title":"Follow-up"}[/kanban:create]\nEnd.';
    const res = await app.request(`/api/kanban/tasks/${task.id}/complete`, json({ result: resultText }));
    expect(res.status).toBe(200);
    const completed = await res.json() as KanbanTask;
    expect(completed.result).not.toContain('[kanban:create]');
    expect(completed.result).toContain('Task done.');
    expect(completed.result).toContain('End.');
  });

  it('handles result with no markers (no proposals, result unchanged)', async () => {
    const app = await buildApp();
    const task = await setupRunningTask(app);

    const resultText = 'All work completed successfully.';
    const res = await app.request(`/api/kanban/tasks/${task.id}/complete`, json({ result: resultText }));
    expect(res.status).toBe(200);
    const completed = await res.json() as KanbanTask;
    expect(completed.result).toBe(resultText);

    const proposalsRes = await app.request('/api/kanban/proposals');
    const proposals = await proposalsRes.json() as { proposals: unknown[] };
    expect(proposals.proposals).toHaveLength(0);
  });

  it('handles invalid markers gracefully (result still stored)', async () => {
    const app = await buildApp();
    const task = await setupRunningTask(app);

    const resultText = 'Done.\n[kanban:create]{bad json}[/kanban:create]\nFinished.';
    const res = await app.request(`/api/kanban/tasks/${task.id}/complete`, json({ result: resultText }));
    expect(res.status).toBe(200);
    const completed = await res.json() as KanbanTask;
    // Invalid markers are not parsed but still stripped by the regex
    expect(completed.result).toBeDefined();

    // No proposals from invalid markers
    const proposalsRes = await app.request('/api/kanban/proposals');
    const proposals = await proposalsRes.json() as { proposals: unknown[] };
    expect(proposals.proposals).toHaveLength(0);
  });

  it('does not parse markers when error is provided', async () => {
    const app = await buildApp();
    const task = await setupRunningTask(app);

    const resultText = '[kanban:create]{"title":"Should not be created"}[/kanban:create]';
    const res = await app.request(`/api/kanban/tasks/${task.id}/complete`, json({
      result: resultText,
      error: 'Task failed',
    }));
    expect(res.status).toBe(200);

    const proposalsRes = await app.request('/api/kanban/proposals');
    const proposals = await proposalsRes.json() as { proposals: unknown[] };
    expect(proposals.proposals).toHaveLength(0);
  });

  it('handles multiple markers (create + update)', async () => {
    const app = await buildApp();
    // Create an existing task for the update marker to reference
    const existingTask = await createTask(app, { title: 'Existing task' });
    const task = await setupRunningTask(app);

    const resultText = [
      'Work done.',
      `[kanban:create]{"title":"New task from agent"}[/kanban:create]`,
      `[kanban:update]{"id":"${existingTask.id}","status":"done"}[/kanban:update]`,
      'Finished.',
    ].join('\n');

    const res = await app.request(`/api/kanban/tasks/${task.id}/complete`, json({ result: resultText }));
    expect(res.status).toBe(200);

    const proposalsRes = await app.request('/api/kanban/proposals');
    const proposals = await proposalsRes.json() as { proposals: Array<{ type: string }> };
    expect(proposals.proposals).toHaveLength(2);
    expect(proposals.proposals.some(p => p.type === 'create')).toBe(true);
    expect(proposals.proposals.some(p => p.type === 'update')).toBe(true);
  });
});

// ── Full workflow through HTTP ───────────────────────────────────────

describe('full workflow via HTTP', () => {
  it('execute → approve', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });

    // Execute
    const execRes = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(execRes.status).toBe(200);
    const executed = await execRes.json() as KanbanTask;
    expect(executed.status).toBe('in-progress');

    // Manually move to review (simulating completeRun via PATCH)
    const reviewRes = await app.request(`/api/kanban/tasks/${task.id}`, jsonPatch({
      version: executed.version,
      status: 'review',
    }));
    expect(reviewRes.status).toBe(200);
    await reviewRes.json();

    // Approve
    const approveRes = await app.request(`/api/kanban/tasks/${task.id}/approve`, json({
      note: 'LGTM',
    }));
    expect(approveRes.status).toBe(200);
    const approved = await approveRes.json() as KanbanTask;
    expect(approved.status).toBe('done');
  });

  it('execute → abort → re-execute', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });

    // Execute
    await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));

    // Abort
    const abortRes = await app.request(`/api/kanban/tasks/${task.id}/abort`, json({
      note: 'Wrong model',
    }));
    expect(abortRes.status).toBe(200);
    const aborted = await abortRes.json() as KanbanTask;
    expect(aborted.status).toBe('todo');

    // Re-execute
    const reExecRes = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(reExecRes.status).toBe(200);
    const reExecuted = await reExecRes.json() as KanbanTask;
    expect(reExecuted.status).toBe('in-progress');
    expect(reExecuted.run!.status).toBe('running');
  });
});
