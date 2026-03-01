/**
 * Kanban API Routes
 *
 * GET    /api/kanban/tasks          — List tasks (with filters + pagination)
 * POST   /api/kanban/tasks          — Create a task
 * PATCH  /api/kanban/tasks/:id      — Update a task (CAS versioned)
 * DELETE /api/kanban/tasks/:id      — Delete a task
 * POST   /api/kanban/tasks/:id/reorder — Reorder / move a task
 * GET    /api/kanban/config         — Get board config
 * PUT    /api/kanban/config         — Update board config
 * @module
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import {
  getKanbanStore,
  VersionConflictError,
  TaskNotFoundError,
} from '../lib/kanban-store.js';
import type {
  TaskStatus,
  TaskPriority,
  TaskActor,
} from '../lib/kanban-store.js';

const app = new Hono();

// ── Zod schemas ──────────────────────────────────────────────────────

const taskStatusSchema = z.enum(['backlog', 'todo', 'in-progress', 'review', 'done', 'cancelled']);
const taskPrioritySchema = z.enum(['critical', 'high', 'normal', 'low']);
const taskActorSchema = z.union([
  z.literal('operator'),
  z.string().regex(/^agent:.+$/),
]) as z.ZodType<TaskActor>;
const thinkingSchema = z.enum(['off', 'low', 'medium', 'high']);

const feedbackSchema = z.object({
  at: z.number(),
  by: taskActorSchema,
  note: z.string(),
});

const runLinkSchema = z.object({
  sessionKey: z.string(),
  sessionId: z.string().optional(),
  runId: z.string().optional(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  status: z.enum(['running', 'done', 'error', 'aborted']),
  error: z.string().optional(),
});

const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10_000).optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  createdBy: taskActorSchema.default('operator'),
  sourceSessionKey: z.string().max(500).optional(),
  assignee: taskActorSchema.optional(),
  labels: z.array(z.string().max(100)).max(50).default([]),
  model: z.string().max(200).optional(),
  thinking: thinkingSchema.optional(),
  dueAt: z.number().optional(),
  estimateMin: z.number().min(0).optional(),
});

const updateTaskSchema = z.object({
  version: z.number().int().min(1),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10_000).optional().nullable(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assignee: taskActorSchema.optional().nullable(),
  labels: z.array(z.string().max(100)).max(50).optional(),
  model: z.string().max(200).optional().nullable(),
  thinking: thinkingSchema.optional().nullable(),
  dueAt: z.number().optional().nullable(),
  estimateMin: z.number().min(0).optional().nullable(),
  actualMin: z.number().min(0).optional().nullable(),
  result: z.string().max(50_000).optional().nullable(),
  resultAt: z.number().optional().nullable(),
  run: runLinkSchema.optional().nullable(),
  feedback: z.array(feedbackSchema).optional(),
});

const reorderSchema = z.object({
  version: z.number().int().min(1),
  targetStatus: taskStatusSchema,
  targetIndex: z.number().int().min(0),
});

const columnSchema = z.object({
  key: taskStatusSchema,
  title: z.string().min(1).max(100),
  wipLimit: z.number().int().min(0).optional(),
  visible: z.boolean(),
});

const configSchema = z.object({
  columns: z.array(columnSchema).min(1).max(10).optional(),
  defaults: z.object({
    status: taskStatusSchema,
    priority: taskPrioritySchema,
  }).optional(),
  reviewRequired: z.boolean().optional(),
  allowDoneDragBypass: z.boolean().optional(),
  quickViewLimit: z.number().int().min(1).max(50).optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────

function parseArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  // Each item might be comma-separated (e.g. "todo,backlog")
  return items.flatMap((s) => s.split(',').map((v) => v.trim()).filter(Boolean));
}

// ── Routes ───────────────────────────────────────────────────────────

// GET /api/kanban/tasks
app.get('/api/kanban/tasks', rateLimitGeneral, async (c) => {
  const store = getKanbanStore();
  const url = new URL(c.req.url);

  const status = parseArray(url.searchParams.getAll('status').length > 0
    ? url.searchParams.getAll('status')
    : url.searchParams.get('status[]') ? url.searchParams.getAll('status[]') : undefined,
  ) as TaskStatus[];

  const priority = parseArray(url.searchParams.getAll('priority').length > 0
    ? url.searchParams.getAll('priority')
    : url.searchParams.get('priority[]') ? url.searchParams.getAll('priority[]') : undefined,
  ) as TaskPriority[];

  const assignee = url.searchParams.get('assignee') || undefined;
  const label = url.searchParams.get('label') || undefined;
  const q = url.searchParams.get('q') || undefined;
  const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined;
  const offset = url.searchParams.get('offset') ? Number(url.searchParams.get('offset')) : undefined;

  const result = await store.listTasks({ status, priority, assignee, label, q, limit, offset });
  return c.json(result);
});

// POST /api/kanban/tasks
app.post('/api/kanban/tasks', rateLimitGeneral, async (c) => {
  const store = getKanbanStore();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'validation_error', details: 'Invalid JSON body' }, 400);
  }

  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      error: 'validation_error',
      details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    }, 400);
  }

  const task = await store.createTask(parsed.data);
  return c.json(task, 201);
});

// PATCH /api/kanban/tasks/:id
app.patch('/api/kanban/tasks/:id', rateLimitGeneral, async (c) => {
  const store = getKanbanStore();
  const id = c.req.param('id');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'validation_error', details: 'Invalid JSON body' }, 400);
  }

  const parsed = updateTaskSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      error: 'validation_error',
      details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    }, 400);
  }

  const { version, ...patch } = parsed.data;

  // Convert nulls to undefined for optional clearing
  const cleanPatch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) cleanPatch[k] = v === null ? undefined : v;
  }

  try {
    const updated = await store.updateTask(id, version, cleanPatch);
    return c.json(updated);
  } catch (err) {
    if (err instanceof VersionConflictError) {
      return c.json({
        error: 'version_conflict',
        serverVersion: err.serverVersion,
        latest: err.latest,
      }, 409);
    }
    if (err instanceof TaskNotFoundError) {
      return c.json({ error: 'not_found', details: err.message }, 404);
    }
    throw err;
  }
});

// DELETE /api/kanban/tasks/:id
app.delete('/api/kanban/tasks/:id', rateLimitGeneral, async (c) => {
  const store = getKanbanStore();
  const id = c.req.param('id');

  try {
    await store.deleteTask(id, 'operator');
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof TaskNotFoundError) {
      return c.json({ error: 'not_found', details: err.message }, 404);
    }
    throw err;
  }
});

// POST /api/kanban/tasks/:id/reorder
app.post('/api/kanban/tasks/:id/reorder', rateLimitGeneral, async (c) => {
  const store = getKanbanStore();
  const id = c.req.param('id');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'validation_error', details: 'Invalid JSON body' }, 400);
  }

  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      error: 'validation_error',
      details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    }, 400);
  }

  try {
    const task = await store.reorderTask(
      id,
      parsed.data.version,
      parsed.data.targetStatus,
      parsed.data.targetIndex,
      'operator',
    );
    return c.json(task);
  } catch (err) {
    if (err instanceof VersionConflictError) {
      return c.json({
        error: 'version_conflict',
        serverVersion: err.serverVersion,
        latest: err.latest,
      }, 409);
    }
    if (err instanceof TaskNotFoundError) {
      return c.json({ error: 'not_found', details: err.message }, 404);
    }
    throw err;
  }
});

// GET /api/kanban/config
app.get('/api/kanban/config', rateLimitGeneral, async (c) => {
  const store = getKanbanStore();
  const config = await store.getConfig();
  return c.json(config);
});

// PUT /api/kanban/config
app.put('/api/kanban/config', rateLimitGeneral, async (c) => {
  const store = getKanbanStore();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'validation_error', details: 'Invalid JSON body' }, 400);
  }

  const parsed = configSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      error: 'validation_error',
      details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    }, 400);
  }

  const config = await store.updateConfig(parsed.data);
  return c.json(config);
});

export default app;
