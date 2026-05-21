/** Tests for kanban API routes: CRUD, validation, CAS conflicts, reorder, config, workflow. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { KanbanTask } from '../lib/kanban-store.js';

let tmpDir: string;

type GatewayToolMock = (tool: string, args?: Record<string, unknown>) => Promise<unknown>;
type GatewayRpcMock = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

function buildMockRootSessionKey(label: string): string {
  const normalized = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `kanban-root:${normalized}`;
}

beforeEach(async () => {
  vi.resetModules();
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kanban-route-test-'));

  // Default mock for the new root-session helper (tests can override with vi.doMock before buildApp)
  vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
    buildKanbanFallbackRunKey: buildMockRootSessionKey,
    resolveKanbanFallbackParentSessionKey: vi.fn((assignee?: string) => {
      if (!assignee || assignee === 'operator') return null;
      const match = assignee.match(/^agent:([^:]+)/);
      if (!match || match[1] === 'main') return null;
      return `agent:${match[1]}:main`;
    }),
    launchKanbanFallbackSubagentViaRpc: vi.fn(async ({ label, parentSessionKey }: { label: string; parentSessionKey: string }) => ({
      sessionKey: buildMockRootSessionKey(label),
      parentSessionKey,
      knownSessionKeysBefore: [parentSessionKey],
      runId: undefined,
    })),
  }));
});

afterEach(async () => {
  try {
    const mod = await import('./kanban.js');
    await mod.cleanupKanbanPollers();
  } catch {
    // route module may not have been loaded in this test
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.NERVE_KANBAN_EXECUTION_MODE;
  await new Promise(resolve => setTimeout(resolve, 50));
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY' || attempt === 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
});

async function buildApp(options: { invokeGatewayToolMock?: GatewayToolMock; gatewayRpcMock?: GatewayRpcMock; executionMode?: 'primary' | 'fallback' } = {}): Promise<Hono> {
  // Mock rate-limit to be a no-op for tests
  vi.doMock('../middleware/rate-limit.js', () => ({
    rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
  }));

  process.env.NERVE_KANBAN_EXECUTION_MODE = options.executionMode ?? 'primary';

  const invokeGatewayToolMock = options.invokeGatewayToolMock
    ?? (vi.fn(() => Promise.resolve({})) as GatewayToolMock);
  const gatewayRpcMock = options.gatewayRpcMock
    ?? (vi.fn(async (method: string) => {
      if (method === 'sessions.list') {
        return { sessions: [{ sessionKey: 'agent:reviewer:main' }] };
      }
      return {};
    }) as GatewayRpcMock);

  // Mock gateway client so fire-and-forget spawn doesn't interfere with test cleanup
  vi.doMock('../lib/gateway-client.js', () => ({
    invokeGatewayTool: invokeGatewayToolMock,
  }));
  vi.doMock('../lib/gateway-rpc.js', () => ({
    gatewayRpcCall: gatewayRpcMock,
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

async function overwriteStoredTaskAssignee(taskId: string, assignee?: string | null): Promise<void> {
  const storePath = path.join(tmpDir, 'tasks.json');
  const raw = JSON.parse(await fs.promises.readFile(storePath, 'utf8')) as {
    tasks: Array<Record<string, unknown>>;
  };
  const task = raw.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Task not found in raw fixture: ${taskId}`);

  if (assignee == null) {
    delete task.assignee;
  } else {
    task.assignee = assignee;
  }

  await fs.promises.writeFile(storePath, `${JSON.stringify(raw, null, 2)}\n`);
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

// ── GET /api/kanban/tasks/:id ───────────────────────────────────────

describe('GET /api/kanban/tasks/:id', () => {
  it('returns a task by path param id', async () => {
    const app = await buildApp();
    const task = await createTask(app, { title: 'Route lookup task' });

    const res = await app.request(`/api/kanban/tasks/${task.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;
    expect(body.id).toBe(task.id);
    expect(body.title).toBe('Route lookup task');
  });

  it('returns 404 for missing task id', async () => {
    const app = await buildApp();

    const res = await app.request('/api/kanban/tasks/missing');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('not_found');
  });

  it('returns 500 when getTask throws a non-not-found error', async () => {
    const app = await buildApp();
    const storeModule = await import('../lib/kanban-store.js');
    const store = storeModule.getKanbanStore();
    vi.spyOn(store, 'getTask').mockRejectedValueOnce(new Error('boom'));

    const res = await app.request('/api/kanban/tasks/exploded');
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('Internal Server Error');
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

  it('canonicalizes assignee in the response', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/tasks', json({
      title: 'Assigned task',
      createdBy: 'operator',
      assignee: 'agent:designer:main',
    }));
    expect(res.status).toBe(201);
    const task = await res.json() as KanbanTask;
    expect(task.assignee).toBe('agent:designer');
  });

  it('returns 400 for invalid root assignee', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/tasks', json({
      title: 'Bad assignee',
      createdBy: 'operator',
      assignee: 'agent:main',
    }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; details: string };
    expect(body.error).toBe('validation_error');
    expect(body.details).toBe('Invalid Kanban assignee: agent:main');
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

  it('accepts a configured custom status', async () => {
    const app = await buildApp();
    const cfgRes = await app.request('/api/kanban/config', jsonPut({
      columns: [
        { key: 'backlog', title: 'Backlog', visible: true },
        { key: 'todo', title: 'To Do', visible: true },
        { key: 'in-progress', title: 'In Progress', visible: true },
        { key: 'review', title: 'Review', visible: true },
        { key: 'blocked', title: 'Blocked', visible: true },
        { key: 'done', title: 'Done', visible: true },
      ],
    }));
    expect(cfgRes.status).toBe(200);

    const res = await app.request('/api/kanban/tasks', json({
      title: 'Blocked task',
      createdBy: 'operator',
      status: 'blocked',
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as KanbanTask;
    expect(body.status).toBe('blocked');
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

  it('ignores client attempts to patch server-owned run fields', async () => {
    const app = await buildApp();
    const task = await createTask(app);

    const res = await app.request(`/api/kanban/tasks/${task.id}`, jsonPatch({
      version: task.version,
      title: 'Updated',
      run: {
        sessionKey: 'malicious-run',
        startedAt: Date.now(),
        status: 'done',
      },
    }));
    expect(res.status).toBe(200);
    const updated = await res.json() as KanbanTask;
    expect(updated.title).toBe('Updated');
    expect(updated.run).toBeUndefined();

    const listRes = await app.request('/api/kanban/tasks');
    const body = await listRes.json() as { items: KanbanTask[] };
    const fresh = body.items.find((item) => item.id === task.id);
    expect(fresh?.run).toBeUndefined();
  });

  it('canonicalizes assignee in the response', async () => {
    const app = await buildApp();
    const task = await createTask(app, { assignee: 'agent:codex' });

    const res = await app.request(`/api/kanban/tasks/${task.id}`, jsonPatch({
      version: task.version,
      assignee: 'agent:designer:subagent:child',
    }));
    expect(res.status).toBe(200);
    const updated = await res.json() as KanbanTask;
    expect(updated.assignee).toBe('agent:designer');
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
    const app = await buildApp({ executionMode: 'fallback' });
    const task = await createTask(app, { status: 'todo', assignee: 'agent:reviewer' });

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

  it('reorders into a configured custom status', async () => {
    const app = await buildApp();
    const cfgRes = await app.request('/api/kanban/config', jsonPut({
      columns: [
        { key: 'backlog', title: 'Backlog', visible: true },
        { key: 'todo', title: 'To Do', visible: true },
        { key: 'in-progress', title: 'In Progress', visible: true },
        { key: 'review', title: 'Review', visible: true },
        { key: 'blocked', title: 'Blocked', visible: true },
        { key: 'done', title: 'Done', visible: true },
      ],
    }));
    expect(cfgRes.status).toBe(200);

    const task = await createTask(app, { status: 'todo' });
    const res = await app.request(`/api/kanban/tasks/${task.id}/reorder`, json({
      version: task.version,
      targetStatus: 'blocked',
      targetIndex: 0,
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;
    expect(body.status).toBe('blocked');
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

  it('returns 400 when config removes a status used by existing tasks', async () => {
    const app = await buildApp();
    const cfgRes = await app.request('/api/kanban/config', jsonPut({
      columns: [
        { key: 'backlog', title: 'Backlog', visible: true },
        { key: 'todo', title: 'To Do', visible: true },
        { key: 'in-progress', title: 'In Progress', visible: true },
        { key: 'review', title: 'Review', visible: true },
        { key: 'blocked', title: 'Blocked', visible: true },
        { key: 'done', title: 'Done', visible: true },
        { key: 'cancelled', title: 'Cancelled', visible: false },
      ],
    }));
    expect(cfgRes.status).toBe(200);
    await createTask(app, { status: 'blocked' });

    const res = await app.request('/api/kanban/config', jsonPut({
      columns: [
        { key: 'backlog', title: 'Backlog', visible: true },
        { key: 'todo', title: 'To Do', visible: true },
        { key: 'in-progress', title: 'In Progress', visible: true },
        { key: 'review', title: 'Review', visible: true },
        { key: 'done', title: 'Done', visible: true },
        { key: 'cancelled', title: 'Cancelled', visible: false },
      ],
    }));
    expect(res.status).toBe(400);
  });
});

// ── POST /api/kanban/tasks/:id/execute ───────────────────────────────

describe('POST /api/kanban/tasks/:id/execute', () => {
  it('routes assigned execution through the owning root session with a 1-week preflight lookup', async () => {
    const invokeGatewayToolMock = vi.fn(async () => ({ sessionKey: 'agent:main:subagent:unexpected' }));
    const launchMock = vi.fn(async ({ label, parentSessionKey }: { label: string; parentSessionKey: string }) => ({
      sessionKey: buildMockRootSessionKey(label),
      parentSessionKey,
      knownSessionKeysBefore: [parentSessionKey],
      runId: 'run-assigned-1',
    }));
    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn((assignee?: string) => {
        if (!assignee || assignee === 'operator') return null;
        const match = assignee.match(/^agent:([^:]+)/);
        if (!match || match[1] === 'main') return null;
        return `agent:${match[1]}:main`;
      }),
      launchKanbanFallbackSubagentViaRpc: launchMock,
    }));

    const gatewayRpcMock: GatewayRpcMock = vi.fn(async (method) => {
      if (method === 'sessions.list') {
        return { sessions: [{ sessionKey: 'agent:reviewer:main' }] };
      }
      return {};
    });

    const app = await buildApp({ invokeGatewayToolMock, gatewayRpcMock, executionMode: 'primary' });
    const task = await createTask(app, { status: 'todo', assignee: 'agent:reviewer' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;
    expect(body.status).toBe('in-progress');
    expect(body.run?.sessionKey).toMatch(/^kanban-root:/);

    expect(invokeGatewayToolMock).not.toHaveBeenCalledWith('sessions_spawn', expect.anything());
    expect(gatewayRpcMock).toHaveBeenCalledWith('sessions.list', {
      activeMinutes: 7 * 24 * 60,
      limit: 1000,
    });
    expect(launchMock).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionKey: 'agent:reviewer:main',
    }));
  });

  it('resolves a legacy stored assignee to the owning root session', async () => {
    const launchMock = vi.fn(async ({ label, parentSessionKey }: { label: string; parentSessionKey: string }) => ({
      sessionKey: buildMockRootSessionKey(label),
      parentSessionKey,
      knownSessionKeysBefore: [parentSessionKey],
      runId: 'run-legacy-assignee',
    }));
    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn((assignee?: string) => {
        if (!assignee || assignee === 'operator') return null;
        const match = assignee.match(/^agent:([^:]+)/);
        if (!match || match[1] === 'main') return null;
        return `agent:${match[1]}:main`;
      }),
      launchKanbanFallbackSubagentViaRpc: launchMock,
    }));

    const gatewayRpcMock: GatewayRpcMock = vi.fn(async (method) => {
      if (method === 'sessions.list') {
        return { sessions: [{ sessionKey: 'agent:reviewer:main' }] };
      }
      return {};
    });

    const app = await buildApp({ gatewayRpcMock, executionMode: 'primary' });
    const task = await createTask(app, { status: 'todo', assignee: 'agent:codex' });
    await overwriteStoredTaskAssignee(task.id, 'agent:reviewer:subagent:child');

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(200);

    expect(launchMock).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionKey: 'agent:reviewer:main',
    }));
  });

  it('prefers execute-time overrides over stored task settings for assigned runs', async () => {
    const launchMock = vi.fn(async ({ label, parentSessionKey, model, thinking }: {
      label: string;
      parentSessionKey: string;
      model?: string;
      thinking?: string;
    }) => ({
      sessionKey: buildMockRootSessionKey(label),
      parentSessionKey,
      knownSessionKeysBefore: [parentSessionKey],
      runId: 'run-assigned-override',
      model,
      thinking,
    }));
    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn((assignee?: string) => {
        if (!assignee || assignee === 'operator') return null;
        const match = assignee.match(/^agent:([^:]+)/);
        if (!match || match[1] === 'main') return null;
        return `agent:${match[1]}:main`;
      }),
      launchKanbanFallbackSubagentViaRpc: launchMock,
    }));

    const gatewayRpcMock: GatewayRpcMock = vi.fn(async (method) => {
      if (method === 'sessions.list') {
        return { sessions: [{ sessionKey: 'agent:reviewer:main' }] };
      }
      return {};
    });

    const app = await buildApp({ gatewayRpcMock, executionMode: 'primary' });
    const task = await createTask(app, {
      status: 'todo',
      assignee: 'agent:reviewer',
      model: 'stored-model',
      thinking: 'low',
    });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({
      model: 'override-model',
      thinking: 'high',
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;
    expect(body.model).toBe('override-model');
    expect(body.thinking).toBe('high');

    expect(launchMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'override-model',
      thinking: 'high',
      parentSessionKey: 'agent:reviewer:main',
    }));
  });

  it('treats legacy agent:main assignees as unassigned on the normal path', async () => {
    const invokeGatewayToolMock = vi.fn(async () => ({ sessionKey: 'agent:main:subagent:new-child' }));
    const gatewayRpcMock: GatewayRpcMock = vi.fn(async () => ({ sessions: [] }));
    const app = await buildApp({ invokeGatewayToolMock, gatewayRpcMock, executionMode: 'primary' });
    const task = await createTask(app, { status: 'todo', assignee: 'agent:codex' });
    await overwriteStoredTaskAssignee(task.id, 'agent:main');

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(200);

    expect(invokeGatewayToolMock).toHaveBeenCalledWith('sessions_spawn', expect.any(Object));
    expect(gatewayRpcMock).not.toHaveBeenCalledWith('chat.send', expect.anything());
  });

  it('waits for pending spawn bookkeeping during cleanup', async () => {
    let releaseAttachRunIdentifiers: (() => void) | undefined;
    const attachRunIdentifiersBlocked = new Promise<void>((resolve) => {
      releaseAttachRunIdentifiers = resolve;
    });

    const invokeGatewayToolMock = vi.fn(async () => ({ sessionKey: 'agent:main:subagent:new-child' }));
    const app = await buildApp({ invokeGatewayToolMock, executionMode: 'primary' });

    const storeModule = await import('../lib/kanban-store.js');
    const store = storeModule.getKanbanStore();
    const originalAttachRunIdentifiers = store.attachRunIdentifiers.bind(store);
    vi.spyOn(store, 'attachRunIdentifiers').mockImplementation(async (...args) => {
      await attachRunIdentifiersBlocked;
      return originalAttachRunIdentifiers(...args);
    });

    const task = await createTask(app, { status: 'todo' });
    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(200);

    const mod = await import('./kanban.js');
    let cleanupResolved = false;
    const cleanupPromise = Promise.resolve(mod.cleanupKanbanPollers()).then(() => {
      cleanupResolved = true;
    });

    await Promise.resolve();
    expect(cleanupResolved).toBe(false);

    releaseAttachRunIdentifiers?.();
    await cleanupPromise;

    const tasksRes = await app.request('/api/kanban/tasks');
    const tasks = await tasksRes.json() as { items: KanbanTask[] };
    const updated = tasks.items.find((item) => item.id === task.id);
    expect(updated?.run?.childSessionKey).toBe('agent:main:subagent:new-child');
  });

  it('rejects unassigned execution on the fallback path', async () => {
    const app = await buildApp({ executionMode: 'fallback' });
    const task = await createTask(app, { status: 'todo' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string; details: string };
    expect(body.error).toBe('invalid_execution_target');
    expect(body.details).toContain('requires assigning the task to a live worker agent root');
  });

  it('rejects legacy agent:main assignees on the fallback path', async () => {
    const app = await buildApp({ executionMode: 'fallback' });
    const task = await createTask(app, { status: 'todo', assignee: 'agent:codex' });
    await overwriteStoredTaskAssignee(task.id, 'agent:main');

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string; details: string };
    expect(body.error).toBe('invalid_execution_target');
  });

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

  it('launches unassigned tasks with low thinking when nothing usable is configured', async () => {
    const invokeGatewayToolMock = vi.fn(async () => ({ sessionKey: 'agent:main:subagent:spawned-child' }));
    const app = await buildApp({ executionMode: 'primary', invokeGatewayToolMock });
    const task = await createTask(app, { status: 'todo' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;

    expect(body.thinking).toBeUndefined();
    expect(invokeGatewayToolMock).toHaveBeenCalledWith('sessions_spawn', expect.objectContaining({
      thinking: 'low',
    }));
  });

  it('launches assigned tasks with low thinking when nothing usable is configured', async () => {
    let launchArgs: { model?: string; thinking?: string } | undefined;

    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn(() => 'agent:reviewer:main'),
      launchKanbanFallbackSubagentViaRpc: vi.fn(async ({ label, parentSessionKey, model, thinking }: {
        label: string;
        parentSessionKey: string;
        model?: string;
        thinking?: string;
      }) => {
        launchArgs = { model, thinking };
        return {
          sessionKey: buildMockRootSessionKey(label),
          parentSessionKey,
          knownSessionKeysBefore: [parentSessionKey],
          runId: 'run-123',
        };
      }),
    }));

    const app = await buildApp({ executionMode: 'fallback' });
    const task = await createTask(app, { status: 'todo', assignee: 'agent:reviewer' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;

    expect(body.thinking).toBeUndefined();
    expect(launchArgs?.thinking).toBe('low');
  });

  it('preserves configured board thinking for unassigned launches', async () => {
    const invokeGatewayToolMock = vi.fn(async () => ({ sessionKey: 'agent:main:subagent:spawned-child' }));
    const app = await buildApp({ executionMode: 'primary', invokeGatewayToolMock });
    await app.request('/api/kanban/config', jsonPut({ defaultThinking: 'high' }));
    const task = await createTask(app, { status: 'todo' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(200);
    expect(invokeGatewayToolMock).toHaveBeenCalledWith('sessions_spawn', expect.objectContaining({
      thinking: 'high',
    }));
  });

  it('preserves configured board thinking for assigned launches', async () => {
    let launchArgs: { model?: string; thinking?: string } | undefined;

    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn(() => 'agent:reviewer:main'),
      launchKanbanFallbackSubagentViaRpc: vi.fn(async ({ label, parentSessionKey, model, thinking }: {
        label: string;
        parentSessionKey: string;
        model?: string;
        thinking?: string;
      }) => {
        launchArgs = { model, thinking };
        return {
          sessionKey: buildMockRootSessionKey(label),
          parentSessionKey,
          knownSessionKeysBefore: [parentSessionKey],
          runId: 'run-123',
        };
      }),
    }));

    const app = await buildApp({ executionMode: 'fallback' });
    await app.request('/api/kanban/config', jsonPut({ defaultThinking: 'high' }));
    const task = await createTask(app, { status: 'todo', assignee: 'agent:reviewer' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(200);
    expect(launchArgs?.thinking).toBe('high');
  });

  it('rejects duplicate execution of already-running task', async () => {
    const app = await buildApp();
    const task = await createTask(app, { status: 'todo' });

    const res1 = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res1.status).toBe(200);

    const res2 = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res2.status).toBe(409);
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

  it('launches via the macOS fallback helper', async () => {
    let rootHelperCalled = false;
    let helperLabel = '';

    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn(() => 'agent:reviewer:main'),
      launchKanbanFallbackSubagentViaRpc: vi.fn(async ({ label, parentSessionKey }: { label: string; parentSessionKey: string }) => {
        rootHelperCalled = true;
        helperLabel = label;
        return {
          sessionKey: buildMockRootSessionKey(label),
          parentSessionKey,
          knownSessionKeysBefore: [parentSessionKey],
          runId: 'run-123',
        };
      }),
    }));

    const app = await buildApp({ executionMode: 'fallback' });
    const task = await createTask(app, { status: 'todo', assignee: 'agent:reviewer' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;

    expect(rootHelperCalled).toBe(true);
    expect(body.run?.sessionKey).toBe(`kanban-root:${helperLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`);
  });

  it('stores the deterministic run correlation key before macOS fallback launch completes', async () => {
    let helperLabel = '';

    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn(() => 'agent:reviewer:main'),
      launchKanbanFallbackSubagentViaRpc: vi.fn(async ({ label, parentSessionKey }: { label: string; parentSessionKey: string }) => {
        helperLabel = label;
        return {
          sessionKey: buildMockRootSessionKey(label),
          parentSessionKey,
          knownSessionKeysBefore: [parentSessionKey],
          runId: undefined,
        };
      }),
    }));

    const app = await buildApp({ executionMode: 'fallback' });
    const task = await createTask(app, { status: 'todo', title: 'Root session key test', assignee: 'agent:reviewer' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;

    expect(body.status).toBe('in-progress');
    expect(body.run).toBeDefined();
    expect(body.run!.sessionKey).toBe(`kanban-root:${helperLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`);
  });

  it('returns in-progress immediately while macOS fallback launch continues in the background', async () => {
    let resolveLaunch: ((value: { sessionKey: string; parentSessionKey: string; knownSessionKeysBefore: string[]; runId?: string }) => void) | undefined;

    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn(() => 'agent:reviewer:main'),
      launchKanbanFallbackSubagentViaRpc: vi.fn(() => new Promise((resolve) => {
        resolveLaunch = resolve;
      })),
    }));

    const app = await buildApp({ executionMode: 'fallback' });
    const task = await createTask(app, { status: 'todo', title: 'Slow launch test', assignee: 'agent:reviewer' });

    let settled = false;
    const responsePromise = app.request(`/api/kanban/tasks/${task.id}/execute`, json({})).then((response) => {
      settled = true;
      return response;
    });

    const deadline = Date.now() + 250;
    while (!settled && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(settled).toBe(true);

    const res = await responsePromise;
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;
    expect(body.status).toBe('in-progress');
    expect(body.run?.status).toBe('running');
    expect(body.run?.sessionKey).toBeTruthy();

    resolveLaunch?.({ sessionKey: body.run!.sessionKey, parentSessionKey: 'agent:reviewer:main', knownSessionKeysBefore: ['agent:reviewer:main'] });
    await new Promise(resolve => setTimeout(resolve, 20));
  });

  it('attaches child session metadata immediately when fallback launch returns it', async () => {
    const expectedRunId = 'run-xyz-789';
    const expectedChildSessionKey = 'agent:reviewer:subagent:worker-xyz';

    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn(() => 'agent:reviewer:main'),
      launchKanbanFallbackSubagentViaRpc: vi.fn(async ({ label, parentSessionKey }: { label: string; parentSessionKey: string }) => ({
        sessionKey: buildMockRootSessionKey(label),
        parentSessionKey,
        childSessionKey: expectedChildSessionKey,
        knownSessionKeysBefore: [parentSessionKey],
        runId: expectedRunId,
      })),
    }));

    const app = await buildApp({ executionMode: 'fallback' });
    const task = await createTask(app, { status: 'todo', title: 'RunId attachment test', assignee: 'agent:reviewer' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(200);

    // Wait for fire-and-forget to attach launch metadata
    await new Promise(resolve => setTimeout(resolve, 100));

    const refetchRes = await app.request(`/api/kanban/tasks/${task.id}`);
    const latest = await refetchRes.json() as KanbanTask;

    expect(latest.run).toBeDefined();
    expect(latest.run!.runId).toBe(expectedRunId);
    expect(latest.run!.childSessionKey).toBe(expectedChildSessionKey);
  });

  it('marks the run back to todo with Spawn failed error after macOS fallback launch rejection', async () => {
    const errorMessage = 'RPC connection timeout';
    let rejectLaunch: ((reason?: unknown) => void) | undefined;

    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn(() => 'agent:reviewer:main'),
      launchKanbanFallbackSubagentViaRpc: vi.fn(() => new Promise((_, reject) => {
        rejectLaunch = reject;
      })),
    }));

    const app = await buildApp({ executionMode: 'fallback' });
    const task = await createTask(app, { status: 'todo', title: 'Helper rejection test', assignee: 'agent:reviewer' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;

    expect(body.status).toBe('in-progress');
    expect(body.run?.status).toBe('running');
    expect(body.run?.sessionKey).toBeTruthy();

    rejectLaunch?.(new Error(errorMessage));
    await new Promise(resolve => setTimeout(resolve, 20));

    const refetchRes = await app.request(`/api/kanban/tasks/${task.id}`);
    const latest = await refetchRes.json() as KanbanTask;
    expect(latest.status).toBe('todo');
    expect(latest.run).toBeDefined();
    expect(latest.run!.status).toBe('error');
    expect(latest.run!.error).toContain('Spawn failed:');
    expect(latest.run!.error).toContain(errorMessage);
  });

  it('routes assigned normal-path execution through the owning root session', async () => {
    const invokeGatewayToolMock = vi.fn(async () => ({ sessionKey: 'agent:main:subagent:unexpected' }));
    const launchMock = vi.fn(async ({ label, parentSessionKey }: { label: string; parentSessionKey: string }) => ({
      sessionKey: buildMockRootSessionKey(label),
      parentSessionKey,
      knownSessionKeysBefore: [parentSessionKey],
      runId: 'run-assigned-primary',
    }));

    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn((assignee?: string) => {
        if (!assignee || assignee === 'operator') return null;
        const match = assignee.match(/^agent:([^:]+)/);
        if (!match || match[1] === 'main') return null;
        return `agent:${match[1]}:main`;
      }),
      launchKanbanFallbackSubagentViaRpc: launchMock,
    }));

    const gatewayRpcMock = vi.fn(async (method: string) => {
      if (method === 'sessions.list') {
        return { sessions: [{ sessionKey: 'agent:designer:main' }] };
      }
      return {};
    });

    const app = await buildApp({
      executionMode: 'primary',
      invokeGatewayToolMock,
      gatewayRpcMock,
    });
    const task = await createTask(app, { status: 'todo', assignee: 'agent:designer' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;

    expect(body.status).toBe('in-progress');
    expect(launchMock).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionKey: 'agent:designer:main',
    }));
    expect(gatewayRpcMock).toHaveBeenCalledWith('sessions.list', {
      activeMinutes: 7 * 24 * 60,
      limit: 1000,
    });
    expect(invokeGatewayToolMock).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'operator assignee', assignee: 'operator' },
    { label: 'unassigned task', assignee: undefined },
  ])('keeps sessions_spawn for $label on the normal path', async ({ assignee }) => {
    const invokeGatewayToolMock = vi.fn(async () => ({ sessionKey: 'agent:main:subagent:spawned-child' }));
    const launchMock = vi.fn(async ({ label, parentSessionKey }: { label: string; parentSessionKey: string }) => ({
      sessionKey: buildMockRootSessionKey(label),
      parentSessionKey,
      knownSessionKeysBefore: [parentSessionKey],
    }));

    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn((value?: string) => value == null || value === 'operator' ? null : 'agent:designer:main'),
      launchKanbanFallbackSubagentViaRpc: launchMock,
    }));

    const app = await buildApp({ executionMode: 'primary', invokeGatewayToolMock });
    const task = await createTask(app, {
      status: 'todo',
      ...(assignee === undefined ? {} : { assignee }),
    });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(200);

    expect(invokeGatewayToolMock).toHaveBeenCalledWith('sessions_spawn', expect.objectContaining({
      mode: 'run',
    }));
    expect(launchMock).not.toHaveBeenCalled();
  });

  it('fails fast when an assigned normal-path root session is missing', async () => {
    const invokeGatewayToolMock = vi.fn(async () => ({ sessionKey: 'agent:main:subagent:unexpected' }));
    const launchMock = vi.fn(async ({ label, parentSessionKey }: { label: string; parentSessionKey: string }) => ({
      sessionKey: buildMockRootSessionKey(label),
      parentSessionKey,
      knownSessionKeysBefore: [parentSessionKey],
    }));

    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn((assignee?: string) => {
        if (!assignee || assignee === 'operator') return null;
        const match = assignee.match(/^agent:([^:]+)/);
        if (!match || match[1] === 'main') return null;
        return `agent:${match[1]}:main`;
      }),
      launchKanbanFallbackSubagentViaRpc: launchMock,
    }));

    const gatewayRpcMock = vi.fn(async (method: string) => {
      if (method === 'sessions.list') {
        return { sessions: [{ sessionKey: 'agent:reviewer:main' }] };
      }
      return {};
    });

    const app = await buildApp({
      executionMode: 'primary',
      invokeGatewayToolMock,
      gatewayRpcMock,
    });
    const task = await createTask(app, { status: 'todo', assignee: 'agent:designer' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'invalid_execution_target',
      details: 'Parent agent session not found: agent:designer:main',
    });
    expect(launchMock).not.toHaveBeenCalled();
    expect(invokeGatewayToolMock).not.toHaveBeenCalled();
  });

  it('falls back to the full session list when the assigned root is older than the recent-session window', async () => {
    const invokeGatewayToolMock = vi.fn(async () => ({ sessionKey: 'agent:main:subagent:unexpected' }));
    const launchMock = vi.fn(async ({ label, parentSessionKey }: { label: string; parentSessionKey: string }) => ({
      sessionKey: buildMockRootSessionKey(label),
      parentSessionKey,
      knownSessionKeysBefore: [parentSessionKey],
    }));

    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn((assignee?: string) => {
        if (!assignee || assignee === 'operator') return null;
        const match = assignee.match(/^agent:([^:]+)/);
        if (!match || match[1] === 'main') return null;
        return `agent:${match[1]}:main`;
      }),
      launchKanbanFallbackSubagentViaRpc: launchMock,
    }));

    const gatewayRpcMock = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'sessions.list' && params?.activeMinutes === 7 * 24 * 60) {
        return { sessions: [{ sessionKey: 'agent:reviewer:main' }] };
      }
      if (method === 'sessions.list' && params?.limit === 1000) {
        return { sessions: [{ sessionKey: 'agent:reviewer:main' }, { sessionKey: 'agent:designer:main' }] };
      }
      return {};
    });

    const app = await buildApp({
      executionMode: 'primary',
      invokeGatewayToolMock,
      gatewayRpcMock,
    });
    const task = await createTask(app, { status: 'todo', assignee: 'agent:designer' });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(200);

    expect(gatewayRpcMock).toHaveBeenCalledWith('sessions.list', {
      activeMinutes: 7 * 24 * 60,
      limit: 1000,
    });
    expect(gatewayRpcMock).toHaveBeenCalledWith('sessions.list', {
      limit: 1000,
    });
    expect(launchMock).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionKey: 'agent:designer:main',
    }));
  });

  it.each([
    'agent:designer:main',
    'agent:designer:subagent:child',
  ])('routes legacy stored assignee %s through the owning root on the normal path', async (legacyAssignee) => {
    const invokeGatewayToolMock = vi.fn(async () => ({ sessionKey: 'agent:main:subagent:unexpected' }));
    const launchMock = vi.fn(async ({ label, parentSessionKey }: { label: string; parentSessionKey: string }) => ({
      sessionKey: buildMockRootSessionKey(label),
      parentSessionKey,
      knownSessionKeysBefore: [parentSessionKey],
    }));

    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn((assignee?: string) => {
        if (!assignee || assignee === 'operator') return null;
        const match = assignee.match(/^agent:([^:]+)/);
        if (!match || match[1] === 'main') return null;
        return `agent:${match[1]}:main`;
      }),
      launchKanbanFallbackSubagentViaRpc: launchMock,
    }));

    const gatewayRpcMock = vi.fn(async (method: string) => {
      if (method === 'sessions.list') {
        return { sessions: [{ sessionKey: 'agent:designer:main' }] };
      }
      return {};
    });

    const app = await buildApp({
      executionMode: 'primary',
      invokeGatewayToolMock,
      gatewayRpcMock,
    });
    const task = await createTask(app, { status: 'todo', assignee: 'agent:designer' });
    await overwriteStoredTaskAssignee(task.id, legacyAssignee);

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(200);
    expect(launchMock).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionKey: 'agent:designer:main',
    }));
    expect(invokeGatewayToolMock).not.toHaveBeenCalled();
  });

  it('treats legacy stored agent:main as unassigned on the normal path', async () => {
    const invokeGatewayToolMock = vi.fn(async () => ({ sessionKey: 'agent:main:subagent:spawned-child' }));
    const launchMock = vi.fn(async ({ label, parentSessionKey }: { label: string; parentSessionKey: string }) => ({
      sessionKey: buildMockRootSessionKey(label),
      parentSessionKey,
      knownSessionKeysBefore: [parentSessionKey],
    }));

    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn((assignee?: string) => {
        if (!assignee || assignee === 'operator') return null;
        const match = assignee.match(/^agent:([^:]+)/);
        if (!match || match[1] === 'main') return null;
        return `agent:${match[1]}:main`;
      }),
      launchKanbanFallbackSubagentViaRpc: launchMock,
    }));

    const app = await buildApp({ executionMode: 'primary', invokeGatewayToolMock });
    const task = await createTask(app, { status: 'todo', assignee: 'agent:designer' });
    await overwriteStoredTaskAssignee(task.id, 'agent:main');

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(200);
    expect(invokeGatewayToolMock).toHaveBeenCalledWith('sessions_spawn', expect.objectContaining({
      mode: 'run',
    }));
    expect(launchMock).not.toHaveBeenCalled();
  });

  it('rejects legacy stored agent:main on the fallback path', async () => {
    const launchMock = vi.fn(async ({ label, parentSessionKey }: { label: string; parentSessionKey: string }) => ({
      sessionKey: buildMockRootSessionKey(label),
      parentSessionKey,
      knownSessionKeysBefore: [parentSessionKey],
    }));

    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn((assignee?: string) => {
        if (!assignee || assignee === 'operator') return null;
        const match = assignee.match(/^agent:([^:]+)/);
        if (!match || match[1] === 'main') return null;
        return `agent:${match[1]}:main`;
      }),
      launchKanbanFallbackSubagentViaRpc: launchMock,
    }));

    const app = await buildApp({ executionMode: 'fallback' });
    const task = await createTask(app, { status: 'todo', assignee: 'agent:designer' });
    await overwriteStoredTaskAssignee(task.id, 'agent:main');

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'invalid_execution_target',
      details: 'Kanban automation on macOS requires assigning the task to a live worker agent root (not @main).',
    });
    expect(launchMock).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'operator assignee', assignee: 'operator' },
    { label: 'unassigned task', assignee: undefined },
  ])('rejects $label on the fallback path', async ({ assignee }) => {
    const launchMock = vi.fn(async ({ label, parentSessionKey }: { label: string; parentSessionKey: string }) => ({
      sessionKey: buildMockRootSessionKey(label),
      parentSessionKey,
      knownSessionKeysBefore: [parentSessionKey],
    }));

    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn((value?: string) => value == null || value === 'operator' ? null : 'agent:designer:main'),
      launchKanbanFallbackSubagentViaRpc: launchMock,
    }));

    const app = await buildApp({ executionMode: 'fallback' });
    const task = await createTask(app, {
      status: 'todo',
      ...(assignee === undefined ? {} : { assignee }),
    });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'invalid_execution_target',
      details: 'Kanban automation on macOS requires assigning the task to a live worker agent root (not @main).',
    });
    expect(launchMock).not.toHaveBeenCalled();
  });

  it('keeps stored execution settings aligned with the macOS fallback launch', async () => {
    let launchArgs: { model?: string; thinking?: string } | undefined;

    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn(() => 'agent:reviewer:main'),
      launchKanbanFallbackSubagentViaRpc: vi.fn(async ({ label, parentSessionKey, model, thinking }: {
        label: string;
        parentSessionKey: string;
        model?: string;
        thinking?: string;
      }) => {
        launchArgs = { model, thinking };
        return {
          sessionKey: buildMockRootSessionKey(label),
          parentSessionKey,
          knownSessionKeysBefore: [parentSessionKey],
          runId: 'run-123',
        };
      }),
    }));

    const app = await buildApp({ executionMode: 'fallback' });
    const task = await createTask(app, {
      status: 'todo',
      assignee: 'agent:reviewer',
      model: 'task-model',
      thinking: 'low',
    });

    const res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({
      model: 'request-model',
      thinking: 'high',
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as KanbanTask;

    expect(launchArgs).toBeDefined();
    expect(body.model).toBe(launchArgs?.model);
    expect(body.thinking).toBe(launchArgs?.thinking);
  });

  it('uses a fresh run correlation key when the same macOS fallback task is rerun under the same clock tick', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_716_710_400_000);

    const app = await buildApp({ executionMode: 'fallback' });
    const task = await createTask(app, { status: 'todo', title: 'Same title', assignee: 'agent:reviewer' });

    const run1Res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(run1Res.status).toBe(200);
    const run1 = await run1Res.json() as KanbanTask;

    const abortRes = await app.request(`/api/kanban/tasks/${task.id}/abort`, json({ note: 'rerun' }));
    expect(abortRes.status).toBe(200);

    const run2Res = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(run2Res.status).toBe(200);
    const run2 = await run2Res.json() as KanbanTask;

    expect(run2.run?.sessionKey).toBeTruthy();
    expect(run2.run?.sessionKey).not.toBe(run1.run?.sessionKey);
  });

  it('prevents race condition: concurrent execute calls launch only one macOS fallback session', async () => {
    const launchMock = vi.fn(async ({ label, parentSessionKey }: { label: string; parentSessionKey: string }) => {
      // Simulate realistic launch delay
      await new Promise(resolve => setTimeout(resolve, 50));
      const normalized = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      return {
        sessionKey: `kanban-root:${normalized}`,
        parentSessionKey,
        knownSessionKeysBefore: [parentSessionKey],
        runId: undefined,
      };
    });

    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn(() => 'agent:reviewer:main'),
      launchKanbanFallbackSubagentViaRpc: launchMock,
    }));

    const app = await buildApp({ executionMode: 'fallback' });
    const task = await createTask(app, { status: 'todo', assignee: 'agent:reviewer' });

    // Fire two concurrent execute requests
    const [res1, res2] = await Promise.all([
      app.request(`/api/kanban/tasks/${task.id}/execute`, json({})),
      app.request(`/api/kanban/tasks/${task.id}/execute`, json({})),
    ]);

    // One should succeed, one should be rejected
    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    // Most importantly: launch helper should be called exactly once
    expect(launchMock).toHaveBeenCalledTimes(1);
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

  it('canonicalizes assignee in the returned payload', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/proposals', json({
      type: 'create',
      payload: { title: 'New task', assignee: 'agent:designer:main' },
      proposedBy: 'agent:codex',
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as { payload: { assignee?: string } };
    expect(body.payload.assignee).toBe('agent:designer');
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

  it('returns 400 for invalid custom status on create proposal', async () => {
    const app = await buildApp();
    const res = await app.request('/api/kanban/proposals', json({
      type: 'create',
      payload: { title: 'Bad proposal', status: 'blocked' },
      proposedBy: 'agent:codex',
    }));
    expect(res.status).toBe(400);
  });

  it('accepts configured custom status on create proposal', async () => {
    const app = await buildApp();
    const cfgRes = await app.request('/api/kanban/config', jsonPut({
      columns: [
        { key: 'backlog', title: 'Backlog', visible: true },
        { key: 'todo', title: 'To Do', visible: true },
        { key: 'in-progress', title: 'In Progress', visible: true },
        { key: 'review', title: 'Review', visible: true },
        { key: 'blocked', title: 'Blocked', visible: true },
        { key: 'done', title: 'Done', visible: true },
      ],
    }));
    expect(cfgRes.status).toBe(200);

    const res = await app.request('/api/kanban/proposals', json({
      type: 'create',
      payload: { title: 'Blocked proposal', status: 'blocked' },
      proposedBy: 'agent:codex',
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as { status: string; type: string };
    expect(body.status).toBe('pending');
    expect(body.type).toBe('create');
  });

  it('returns 400 for invalid custom status on update proposal', async () => {
    const app = await buildApp();
    const task = await createTask(app);

    const res = await app.request('/api/kanban/proposals', json({
      type: 'update',
      payload: { id: task.id, status: 'blocked' },
      proposedBy: 'agent:codex',
    }));
    expect(res.status).toBe(400);
  });

  it('accepts configured custom status on update proposal', async () => {
    const app = await buildApp();
    const cfgRes = await app.request('/api/kanban/config', jsonPut({
      columns: [
        { key: 'backlog', title: 'Backlog', visible: true },
        { key: 'todo', title: 'To Do', visible: true },
        { key: 'in-progress', title: 'In Progress', visible: true },
        { key: 'review', title: 'Review', visible: true },
        { key: 'blocked', title: 'Blocked', visible: true },
        { key: 'done', title: 'Done', visible: true },
      ],
    }));
    expect(cfgRes.status).toBe(200);
    const task = await createTask(app);

    const res = await app.request('/api/kanban/proposals', json({
      type: 'update',
      payload: { id: task.id, status: 'blocked' },
      proposedBy: 'agent:codex',
    }));
    expect(res.status).toBe(201);
    const proposal = await res.json() as { id: string };

    const approveRes = await app.request(`/api/kanban/proposals/${proposal.id}/approve`, { method: 'POST' });
    expect(approveRes.status).toBe(200);
    const approveBody = await approveRes.json() as { task: KanbanTask };
    expect(approveBody.task.status).toBe('blocked');
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
    const res = await app.request(`/api/kanban/tasks/${task.id}/complete`, json({
      sessionKey: task.run!.sessionKey,
      result: resultText,
    }));
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
    const res = await app.request(`/api/kanban/tasks/${task.id}/complete`, json({
      sessionKey: task.run!.sessionKey,
      result: resultText,
    }));
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
    const res = await app.request(`/api/kanban/tasks/${task.id}/complete`, json({
      sessionKey: task.run!.sessionKey,
      result: resultText,
    }));
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
    const res = await app.request(`/api/kanban/tasks/${task.id}/complete`, json({
      sessionKey: task.run!.sessionKey,
      result: resultText,
    }));
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
      sessionKey: task.run!.sessionKey,
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

    const res = await app.request(`/api/kanban/tasks/${task.id}/complete`, json({
      sessionKey: task.run!.sessionKey,
      result: resultText,
    }));
    expect(res.status).toBe(200);

    const proposalsRes = await app.request('/api/kanban/proposals');
    const proposals = await proposalsRes.json() as { proposals: Array<{ type: string }> };
    expect(proposals.proposals).toHaveLength(2);
    expect(proposals.proposals.some(p => p.type === 'create')).toBe(true);
    expect(proposals.proposals.some(p => p.type === 'update')).toBe(true);
  });
});

// ── POST /api/kanban/tasks/:id/complete (run key integrity) ─────────

describe('POST /api/kanban/tasks/:id/complete — run key integrity', () => {
  async function setupRunningTask(app: Hono): Promise<KanbanTask> {
    const task = await createTask(app, { status: 'todo' });
    const execRes = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    return execRes.json() as Promise<KanbanTask>;
  }

  it('returns 400 when sessionKey is missing', async () => {
    const app = await buildApp();
    const task = await setupRunningTask(app);

    const res = await app.request(`/api/kanban/tasks/${task.id}/complete`, json({
      result: 'done',
    }));
    expect(res.status).toBe(400);

    const proposalsRes = await app.request('/api/kanban/proposals');
    const proposals = await proposalsRes.json() as { proposals: unknown[] };
    expect(proposals.proposals).toHaveLength(0);

    const tasksRes = await app.request('/api/kanban/tasks');
    const tasks = await tasksRes.json() as { items: KanbanTask[] };
    const latest = tasks.items.find((item) => item.id === task.id);
    expect(latest?.status).toBe('in-progress');
    expect(latest?.run?.sessionKey).toBe(task.run?.sessionKey);
  });

  it('rejects mismatched sessionKey and does not persist proposals', async () => {
    const app = await buildApp();
    const task = await setupRunningTask(app);

    const res = await app.request(`/api/kanban/tasks/${task.id}/complete`, json({
      sessionKey: `${task.run!.sessionKey}-stale`,
      result: '[kanban:create]{"title":"stale follow-up"}[/kanban:create]',
    }));
    expect(res.status).toBe(409);

    const proposalsRes = await app.request('/api/kanban/proposals');
    const proposals = await proposalsRes.json() as { proposals: unknown[] };
    expect(proposals.proposals).toHaveLength(0);

    const tasksRes = await app.request('/api/kanban/tasks');
    const tasks = await tasksRes.json() as { items: KanbanTask[] };
    const latest = tasks.items.find((item) => item.id === task.id);
    expect(latest?.status).toBe('in-progress');
    expect(latest?.run?.status).toBe('running');
    expect(latest?.run?.sessionKey).toBe(task.run?.sessionKey);
    expect(latest?.result).toBeUndefined();
  });

  it('polls the exact child session returned by fallback launch without relying on label discovery', async () => {
    const childSessionKey = 'agent:reviewer:subagent:exact-child';

    vi.doMock('../lib/kanban-subagent-fallback.js', () => ({
      buildKanbanFallbackRunKey: buildMockRootSessionKey,
      resolveKanbanFallbackParentSessionKey: vi.fn(() => 'agent:reviewer:main'),
      launchKanbanFallbackSubagentViaRpc: vi.fn(async ({ label, parentSessionKey }: { label: string; parentSessionKey: string }) => ({
        sessionKey: buildMockRootSessionKey(label),
        parentSessionKey,
        childSessionKey,
        knownSessionKeysBefore: [parentSessionKey],
        runId: 'run-exact-child',
      })),
    }));

    const gatewayRpcMock = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { sessionKey: 'agent:reviewer:main' },
            {
              sessionKey: childSessionKey,
              status: 'done',
            },
          ],
        };
      }
      if (method === 'sessions.get') {
        expect(params?.key).toBe(childSessionKey);
        return {
          messages: [
            {
              role: 'assistant',
              content: 'Exact child done',
            },
          ],
        };
      }
      return {};
    });

    const app = await buildApp({ gatewayRpcMock, executionMode: 'fallback' });
    const task = await createTask(app, { status: 'todo', title: 'Exact child task', assignee: 'agent:reviewer' });

    const execRes = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(execRes.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 3_200));

    const tasksRes = await app.request('/api/kanban/tasks');
    const tasks = await tasksRes.json() as { items: KanbanTask[] };
    const completed = tasks.items.find((item) => item.id === task.id);
    expect(completed?.status).toBe('review');
    expect(completed?.run?.childSessionKey).toBe(childSessionKey);
    expect(completed?.result).toContain('Exact child done');

    const parentReportCall = (gatewayRpcMock as ReturnType<typeof vi.fn>).mock.calls.find(
      ([method, params]) => method === 'sessions.send' && params?.key === 'agent:reviewer:main'
    );
    expect(parentReportCall).toBeDefined();
    expect(parentReportCall?.[1]).toMatchObject({
      key: 'agent:reviewer:main',
    });
    expect(String((parentReportCall?.[1] as Record<string, unknown>).message ?? '')).toContain('Exact child task');
    expect(String((parentReportCall?.[1] as Record<string, unknown>).message ?? '')).toContain(childSessionKey);
    expect(String((parentReportCall?.[1] as Record<string, unknown>).message ?? '')).toContain('Exact child done');
  });

  it('polls the spawned child session via gateway RPC and completes when session reports done status', async () => {
    let runKey = '';
    const childSessionKey = 'agent:reviewer:subagent:test-child';

    const gatewayRpcMock = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { sessionKey: 'agent:reviewer:main' },
            {
              sessionKey: 'other-session',
              agentState: 'busy',
              busy: true,
              processing: true,
            },
            {
              sessionKey: childSessionKey,
              label: 'kb-test-task-test-task-v2-123',
              status: 'done',
            },
          ].filter((session) => session.sessionKey),
        };
      }
      if (method === 'sessions.get') {
        expect(params?.key).toBe(childSessionKey);
        return {
          messages: [
            {
              role: 'assistant',
              content: 'Done\n[kanban:create]{"title":"proposal from child session"}[/kanban:create]',
            },
          ],
        };
      }
      return {};
    });

    vi.spyOn(Date, 'now').mockReturnValue(123);

    const app = await buildApp({ gatewayRpcMock, executionMode: 'fallback' });
    const task = await createTask(app, { status: 'todo', title: 'Test task', assignee: 'agent:reviewer' });

    const execRes = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(execRes.status).toBe(200);
    const running = await execRes.json() as KanbanTask;
    runKey = running.run!.sessionKey;

    expect(runKey).toBeTruthy();

    // Wait for poller to detect completion
    await new Promise((resolve) => setTimeout(resolve, 3_200));

    const sessionListCalls = (gatewayRpcMock as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => call[0] === 'sessions.list'
    );
    expect(sessionListCalls.length).toBeGreaterThan(0);
    expect(sessionListCalls).toContainEqual(['sessions.list', { activeMinutes: 24 * 60, limit: 200 }]);
    expect(sessionListCalls.every(([, args]) => args && !('sessionKey' in args))).toBe(true);

    expect(gatewayRpcMock).toHaveBeenCalledWith('sessions.get', {
      key: childSessionKey,
      limit: 3,
      includeTools: true,
    });

    const tasksRes = await app.request('/api/kanban/tasks');
    const tasks = await tasksRes.json() as { items: KanbanTask[] };
    const completed = tasks.items.find((item) => item.id === task.id);
    expect(completed?.status).toBe('review');
    expect(completed?.run?.status).toBe('done');
    expect(completed?.run?.sessionKey).toBe(runKey);
    expect(completed?.run?.childSessionKey).toBe(childSessionKey);
    expect(completed?.result).toContain('Done');

    const proposalsRes = await app.request('/api/kanban/proposals');
    const proposals = await proposalsRes.json() as { proposals: Array<{ payload: Record<string, unknown> }> };
    expect(proposals.proposals.find((proposal) => proposal.payload.title === 'proposal from child session')).toBeDefined();
  });

  it('treats terminal failed child sessions as errors even when they are idle', async () => {
    let runKey = '';
    const childSessionKey = 'agent:reviewer:subagent:failed-child';

    const gatewayRpcMock = vi.fn(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { sessionKey: 'agent:reviewer:main' },
            {
              sessionKey: childSessionKey,
              label: 'kb-failed-task-failed-task-v2-456',
              status: 'failed',
              error: 'Worker crashed',
              agentState: 'idle',
              busy: false,
              processing: false,
            },
          ].filter((session) => session.sessionKey),
        };
      }
      if (method === 'sessions.get') {
        return {
          messages: [
            {
              role: 'assistant',
              content: 'should not be read',
            },
          ],
        };
      }
      return {};
    });

    vi.spyOn(Date, 'now').mockReturnValue(456);

    const app = await buildApp({ gatewayRpcMock, executionMode: 'fallback' });
    const task = await createTask(app, { status: 'todo', title: 'Failed task', assignee: 'agent:reviewer' });

    const execRes = await app.request(`/api/kanban/tasks/${task.id}/execute`, json({}));
    expect(execRes.status).toBe(200);
    const running = await execRes.json() as KanbanTask;
    runKey = running.run!.sessionKey;

    await new Promise((resolve) => setTimeout(resolve, 3_200));

    expect(gatewayRpcMock).not.toHaveBeenCalledWith('sessions.get', {
      key: childSessionKey,
      limit: 3,
      includeTools: true,
    });

    const tasksRes = await app.request('/api/kanban/tasks');
    const tasks = await tasksRes.json() as { items: KanbanTask[] };
    const failed = tasks.items.find((item) => item.id === task.id);
    expect(failed?.status).toBe('todo');
    expect(failed?.run?.status).toBe('error');
    expect(failed?.run?.sessionKey).toBe(runKey);
    expect(failed?.run?.childSessionKey).toBe(childSessionKey);
    expect(failed?.run?.error).toBe('Worker crashed');

    const parentReportCall = (gatewayRpcMock as ReturnType<typeof vi.fn>).mock.calls.find(
      ([method, params]) => method === 'sessions.send' && params?.key === 'agent:reviewer:main'
    );
    expect(parentReportCall).toBeDefined();
    expect(String((parentReportCall?.[1] as Record<string, unknown>).message ?? '')).toContain('Failed task');
    expect(String((parentReportCall?.[1] as Record<string, unknown>).message ?? '')).toContain(childSessionKey);
    expect(String((parentReportCall?.[1] as Record<string, unknown>).message ?? '')).toContain('Worker crashed');
  });

  it('ignores late stale poller completion from run 1 after run 2 is active', async () => {
    vi.useFakeTimers();

    const runState: { run1SessionKey?: string; run2SessionKey?: string; run1Label?: string; run2Label?: string } = {};

    const gatewayRpcMock: GatewayRpcMock = vi.fn(async (method) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { sessionKey: 'agent:reviewer:main' },
            runState.run1SessionKey && {
              sessionKey: runState.run1SessionKey,
              label: runState.run1Label,
              status: 'done',
            },
            runState.run2SessionKey && {
              sessionKey: runState.run2SessionKey,
              label: runState.run2Label,
              agentState: 'busy',
              busy: true,
              processing: true,
            },
          ].filter(Boolean),
        };
      }
      if (method === 'sessions.get') {
        return {
          messages: [
            {
              role: 'assistant',
              content: 'Run 1 done\n[kanban:create]{"title":"stale rerun proposal"}[/kanban:create]',
            },
          ],
        };
      }
      return {};
    });

    const app = await buildApp({ gatewayRpcMock, executionMode: 'fallback' });
    const created = await createTask(app, { status: 'todo', assignee: 'agent:reviewer' });

    const run1Res = await app.request(`/api/kanban/tasks/${created.id}/execute`, json({}));
    expect(run1Res.status).toBe(200);
    const run1 = await run1Res.json() as KanbanTask;
    runState.run1SessionKey = 'agent:reviewer:subagent:run-1';
    runState.run1Label = String(run1.run!.sessionKey).replace(/^kanban-root:/, '');

    const abortRes = await app.request(`/api/kanban/tasks/${created.id}/abort`, json({ note: 'rerun' }));
    expect(abortRes.status).toBe(200);

    await vi.advanceTimersByTimeAsync(1);

    const run2Res = await app.request(`/api/kanban/tasks/${created.id}/execute`, json({}));
    expect(run2Res.status).toBe(200);
    const run2 = await run2Res.json() as KanbanTask;
    runState.run2SessionKey = 'agent:reviewer:subagent:run-2';
    runState.run2Label = String(run2.run!.sessionKey).replace(/^kanban-root:/, '');

    await vi.advanceTimersByTimeAsync(3_000);

    // Stale poller from run 1 should not create proposals
    const proposalsRes = await app.request('/api/kanban/proposals');
    const proposals = await proposalsRes.json() as { proposals: Array<{ payload: Record<string, unknown> }> };
    expect(proposals.proposals.find((proposal) => proposal.payload.title === 'stale rerun proposal')).toBeUndefined();

    // Task should still be on run 2
    const tasksRes = await app.request('/api/kanban/tasks');
    const tasks = await tasksRes.json() as { items: KanbanTask[] };
    const latest = tasks.items.find((item) => item.id === created.id);
    expect(latest?.status).toBe('in-progress');
    expect(latest?.run?.status).toBe('running');
    expect(latest?.run?.sessionKey).toBe(run2.run?.sessionKey);
    expect(latest?.result).toBeUndefined();
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

    // Wait for fire-and-forget RPC helper to attach identifiers
    await new Promise(resolve => setTimeout(resolve, 100));

    // Refetch to get latest version
    const refetchRes = await app.request(`/api/kanban/tasks/${task.id}`);
    const latest = await refetchRes.json() as KanbanTask;

    // Manually move to review (simulating completeRun via PATCH)
    const reviewRes = await app.request(`/api/kanban/tasks/${task.id}`, jsonPatch({
      version: latest.version,
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
