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

import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import {
  getKanbanStore,
  VersionConflictError,
  TaskNotFoundError,
  InvalidTransitionError,
  ProposalNotFoundError,
  ProposalAlreadyResolvedError,
} from '../lib/kanban-store.js';
import { invokeGatewayTool } from '../lib/gateway-client.js';
import { parseKanbanMarkers, stripKanbanMarkers } from '../lib/parseMarkers.js';
import type {
  TaskStatus,
  TaskPriority,
  TaskActor,
  ProposalStatus,
} from '../lib/kanban-store.js';

const app = new Hono();

// ── Session completion poller ────────────────────────────────────────

/** Parse gateway tool response — unwraps content[0].text JSON wrapper if present. */
function parseGatewayResponse(result: unknown): Record<string, unknown> {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    // Gateway wraps tool results in { content: [{ type: "text", text: "..." }] }
    const content = r.content as Array<Record<string, unknown>> | undefined;
    if (content?.[0]?.text && typeof content[0].text === 'string') {
      try { return JSON.parse(content[0].text); } catch { /* fall through */ }
    }
    // Also check details (some tools put parsed data there)
    if (r.details && typeof r.details === 'object') return r.details as Record<string, unknown>;
    return r;
  }
  return {};
}

// ── Active poll timer tracking (for graceful shutdown) ───────────────

const activePollTimers = new Set<ReturnType<typeof setTimeout>>();

function trackTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  const id = setTimeout(() => {
    activePollTimers.delete(id);
    fn();
  }, ms);
  activePollTimers.add(id);
  return id;
}

/** Cancel all active poll timers (call on shutdown). */
export function cleanupKanbanPollers(): void {
  for (const t of activePollTimers) clearTimeout(t);
  activePollTimers.clear();
}

/** Poll gateway subagents for a kanban run label until it finishes, then complete the run. */
function pollSessionCompletion(
  store: ReturnType<typeof getKanbanStore>,
  taskId: string,
  label: string,
  intervalMs = 5_000,
  maxAttempts = 360, // 30 minutes max
): void {
  let attempts = 0;

  const poll = async () => {
    attempts++;
    if (attempts > maxAttempts) {
      console.warn(`[kanban] Polling timed out for task ${taskId} (label: ${label})`);
      await store.completeRun(taskId, undefined, 'Run timed out (polling limit reached)').catch(() => {});
      return;
    }

    try {
      // Check if task is still in-progress before polling
      const task = await store.getTask(taskId).catch(() => null);
      if (!task || task.status !== 'in-progress') return; // task was moved/aborted, stop

      const raw = await invokeGatewayTool('subagents', { action: 'list' });
      const parsed = parseGatewayResponse(raw);

      // subagents list returns { active: [...], recent: [...] }
      const active = (parsed.active ?? []) as Array<Record<string, unknown>>;
      const recent = (parsed.recent ?? []) as Array<Record<string, unknown>>;
      const all = [...active, ...recent];

      const match = all.find((s) => s.label === label);

      if (!match) {
        // Not found yet -- may not have registered, keep trying
        trackTimeout(poll, intervalMs);
        return;
      }

      const status = match.status as string;

      if (status === 'done') {
        // Fetch session history to get the result text
        let resultText = 'Completed (no result text)';
        try {
          const histRaw = await invokeGatewayTool('sessions_history', {
            sessionKey: match.sessionKey,
            limit: 3,
          });
          const histParsed = parseGatewayResponse(histRaw);
          const messages = (histParsed.messages ?? []) as Array<Record<string, unknown>>;
          const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
          if (lastAssistant) {
            const content = lastAssistant.content;
            if (typeof content === 'string') {
              resultText = content;
            } else if (Array.isArray(content)) {
              const textPart = (content as Array<Record<string, unknown>>).find((p) => p.type === 'text');
              if (textPart && typeof textPart.text === 'string') resultText = textPart.text;
            }
          }
        } catch (err) {
          console.warn(`[kanban] Could not fetch history for ${label}:`, err);
        }

        // Parse kanban markers from the result and create proposals
        const markers = parseKanbanMarkers(resultText);
        for (const marker of markers) {
          try {
            await store.createProposal({
              type: marker.type,
              payload: marker.payload,
              sourceSessionKey: label,
              proposedBy: `agent:${label}`,
            });
          } catch (err) {
            console.warn(`[kanban] Failed to create proposal from marker:`, err);
          }
        }

        // Strip markers from the stored result text
        const cleanResult = markers.length > 0 ? stripKanbanMarkers(resultText) : resultText;

        console.log(`[kanban] Run completed for task ${taskId} (label: ${label})`);
        await store.completeRun(taskId, cleanResult).catch((err) => {
          console.error(`[kanban] Failed to complete run for task ${taskId}:`, err);
        });
        return;
      }

      if (status === 'error' || status === 'failed') {
        const errorMsg = (match.error as string) || 'Agent session failed';
        await store.completeRun(taskId, undefined, errorMsg).catch(() => {});
        return;
      }

      if (status === 'running') {
        trackTimeout(poll, intervalMs);
        return;
      }

      // Unknown status -- keep polling
      trackTimeout(poll, intervalMs);
    } catch (err) {
      console.error(`[kanban] Poll error for task ${taskId}:`, err);
      trackTimeout(poll, intervalMs); // retry on transient errors
    }
  };

  // Start after a brief delay to let the session register
  trackTimeout(poll, 3_000);
}

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
  proposalPolicy: z.enum(['confirm', 'auto']).optional(),
  defaultModel: z.string().max(100).optional(),
});

// ── Proposal schemas ─────────────────────────────────────────────────

const proposalStatusSchema = z.enum(['pending', 'approved', 'rejected']);

const proposalCreatePayloadSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10_000).optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assignee: taskActorSchema.optional(),
  labels: z.array(z.string().max(100)).max(50).optional(),
  model: z.string().max(200).optional(),
  thinking: thinkingSchema.optional(),
  dueAt: z.number().optional(),
  estimateMin: z.number().min(0).optional(),
});

const proposalUpdatePayloadSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10_000).optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assignee: taskActorSchema.optional(),
  labels: z.array(z.string().max(100)).max(50).optional(),
  result: z.string().max(50_000).optional(),
});

const createProposalSchema = z.object({
  type: z.enum(['create', 'update']),
  payload: z.record(z.string(), z.unknown()),
  sourceSessionKey: z.string().max(500).optional(),
  proposedBy: taskActorSchema.default('operator'),
});

const rejectProposalSchema = z.object({
  reason: z.string().max(5000).optional(),
});

// ── Workflow schemas ─────────────────────────────────────────────────

const executeSchema = z.object({
  model: z.string().max(200).optional(),
  thinking: thinkingSchema.optional(),
});

const approveSchema = z.object({
  note: z.string().max(5000).optional(),
});

const rejectSchema = z.object({
  note: z.string().min(1).max(5000),
});

const abortSchema = z.object({
  note: z.string().max(5000).optional(),
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

  const { version, ...rawPatch } = parsed.data;

  // Convert nulls to undefined for optional clearing
  const cleanPatch = Object.fromEntries(
    Object.entries(rawPatch)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, v === null ? undefined : v]),
  ) as Record<string, unknown>;

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

// ── Proposal routes ──────────────────────────────────────────────────

// GET /api/kanban/proposals
app.get('/api/kanban/proposals', rateLimitGeneral, async (c) => {
  const store = getKanbanStore();
  const url = new URL(c.req.url);
  const statusParam = url.searchParams.get('status') as ProposalStatus | null;

  // Validate status param if provided
  if (statusParam) {
    const parsed = proposalStatusSchema.safeParse(statusParam);
    if (!parsed.success) {
      return c.json({ error: 'validation_error', details: 'Invalid status filter' }, 400);
    }
  }

  const proposals = await store.listProposals(statusParam ?? undefined);
  return c.json({ proposals });
});

// POST /api/kanban/proposals
app.post('/api/kanban/proposals', rateLimitGeneral, async (c) => {
  const store = getKanbanStore();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'validation_error', details: 'Invalid JSON body' }, 400);
  }

  const parsed = createProposalSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      error: 'validation_error',
      details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    }, 400);
  }

  const { type, payload, sourceSessionKey, proposedBy } = parsed.data;

  // Validate payload against type-specific schema
  let safePayload: Record<string, unknown>;
  if (type === 'create') {
    const payloadParsed = proposalCreatePayloadSchema.safeParse(payload);
    if (!payloadParsed.success) {
      return c.json({
        error: 'validation_error',
        details: payloadParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      }, 400);
    }
    safePayload = payloadParsed.data;
  } else {
    const payloadParsed = proposalUpdatePayloadSchema.safeParse(payload);
    if (!payloadParsed.success) {
      return c.json({
        error: 'validation_error',
        details: payloadParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      }, 400);
    }
    safePayload = payloadParsed.data;
    // Validate that referenced task exists
    try {
      await store.getTask(safePayload.id as string);
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return c.json({ error: 'not_found', details: `Referenced task not found: ${safePayload.id}` }, 404);
      }
      throw err;
    }
  }

  try {
    const proposal = await store.createProposal({ type, payload: safePayload, sourceSessionKey, proposedBy });
    return c.json(proposal, 201);
  } catch (err) {
    if (err instanceof TaskNotFoundError) {
      return c.json({ error: 'not_found', details: err.message }, 404);
    }
    throw err;
  }
});

// POST /api/kanban/proposals/:id/approve
app.post('/api/kanban/proposals/:id/approve', rateLimitGeneral, async (c) => {
  const store = getKanbanStore();
  const id = c.req.param('id');

  try {
    const { proposal, task } = await store.approveProposal(id);
    return c.json({ proposal, task });
  } catch (err) {
    if (err instanceof ProposalNotFoundError) {
      return c.json({ error: 'not_found', details: err.message }, 404);
    }
    if (err instanceof ProposalAlreadyResolvedError) {
      return c.json({ error: 'already_resolved', proposal: err.proposal }, 409);
    }
    if (err instanceof TaskNotFoundError) {
      return c.json({ error: 'not_found', details: err.message }, 404);
    }
    throw err;
  }
});

// POST /api/kanban/proposals/:id/reject
app.post('/api/kanban/proposals/:id/reject', rateLimitGeneral, async (c) => {
  const store = getKanbanStore();
  const id = c.req.param('id');

  let body: unknown = {};
  try {
    const text = await c.req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return c.json({ error: 'validation_error', details: 'Invalid JSON body' }, 400);
  }

  const parsed = rejectProposalSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      error: 'validation_error',
      details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    }, 400);
  }

  try {
    const proposal = await store.rejectProposal(id, parsed.data.reason);
    return c.json({ proposal });
  } catch (err) {
    if (err instanceof ProposalNotFoundError) {
      return c.json({ error: 'not_found', details: err.message }, 404);
    }
    if (err instanceof ProposalAlreadyResolvedError) {
      return c.json({ error: 'already_resolved', proposal: err.proposal }, 409);
    }
    throw err;
  }
});

// ── Workflow helpers ──────────────────────────────────────────────────

function handleWorkflowError(c: Context, err: unknown) {
  if (err instanceof InvalidTransitionError) {
    return c.json({
      error: 'invalid_transition',
      from: err.from,
      to: err.to,
      message: err.message,
    }, 409);
  }
  if (err instanceof TaskNotFoundError) {
    return c.json({ error: 'not_found', details: err.message }, 404);
  }
  throw err;
}

// POST /api/kanban/tasks/:id/execute
app.post('/api/kanban/tasks/:id/execute', rateLimitGeneral, async (c) => {
  const store = getKanbanStore();
  const id = c.req.param('id');

  let body: unknown = {};
  try {
    const text = await c.req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return c.json({ error: 'validation_error', details: 'Invalid JSON body' }, 400);
  }

  const parsed = executeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      error: 'validation_error',
      details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    }, 400);
  }

  try {
    const task = await store.executeTask(id, parsed.data, 'operator');

    // Spawn agent session via gateway (fire-and-forget)
    const taskDescription = task.description || task.title;
    const spawnArgs: Record<string, unknown> = {
      task: `You are working on a Kanban task.\n\nTitle: ${task.title}\n\nDescription: ${taskDescription}\n\nDeliver your result as a clear summary of what was done.`,
      mode: 'run',
      label: `kanban-run-${id}-${Date.now()}`,
    };
    // Use task's model, or fall back to kanban config default, or Sonnet 4.5
    const config = await store.getConfig();
    const model = task.model || config.defaultModel || 'anthropic/claude-sonnet-4-5';
    spawnArgs.model = model;
    if (task.thinking) spawnArgs.thinking = task.thinking;

    const runLabel = spawnArgs.label as string;
    invokeGatewayTool('sessions_spawn', spawnArgs)
      .then(() => {
        // Poll for session completion in the background
        pollSessionCompletion(store, id, runLabel);
      })
      .catch((err) => {
        console.error(`[kanban] Failed to spawn session for task ${id}:`, err);
        store.completeRun(id, undefined, `Spawn failed: ${err.message}`).catch(() => {});
      });

    return c.json(task);
  } catch (err) {
    return handleWorkflowError(c, err);
  }
});

// POST /api/kanban/tasks/:id/approve
app.post('/api/kanban/tasks/:id/approve', rateLimitGeneral, async (c) => {
  const store = getKanbanStore();
  const id = c.req.param('id');

  let body: unknown = {};
  try {
    const text = await c.req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return c.json({ error: 'validation_error', details: 'Invalid JSON body' }, 400);
  }

  const parsed = approveSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      error: 'validation_error',
      details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    }, 400);
  }

  try {
    const task = await store.approveTask(id, parsed.data.note, 'operator');
    return c.json(task);
  } catch (err) {
    return handleWorkflowError(c, err);
  }
});

// POST /api/kanban/tasks/:id/reject
app.post('/api/kanban/tasks/:id/reject', rateLimitGeneral, async (c) => {
  const store = getKanbanStore();
  const id = c.req.param('id');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'validation_error', details: 'Invalid JSON body' }, 400);
  }

  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      error: 'validation_error',
      details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    }, 400);
  }

  try {
    const task = await store.rejectTask(id, parsed.data.note, 'operator');
    return c.json(task);
  } catch (err) {
    return handleWorkflowError(c, err);
  }
});

// POST /api/kanban/tasks/:id/abort
app.post('/api/kanban/tasks/:id/abort', rateLimitGeneral, async (c) => {
  const store = getKanbanStore();
  const id = c.req.param('id');

  let body: unknown = {};
  try {
    const text = await c.req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return c.json({ error: 'validation_error', details: 'Invalid JSON body' }, 400);
  }

  const parsed = abortSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      error: 'validation_error',
      details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    }, 400);
  }

  try {
    const task = await store.abortTask(id, parsed.data.note, 'operator');
    return c.json(task);
  } catch (err) {
    return handleWorkflowError(c, err);
  }
});

// ── Completion webhook ───────────────────────────────────────────────

const completeSchema = z.object({
  result: z.string().max(50_000).optional(),
  error: z.string().max(5000).optional(),
});

// POST /api/kanban/tasks/:id/complete
app.post('/api/kanban/tasks/:id/complete', rateLimitGeneral, async (c) => {
  const store = getKanbanStore();
  const id = c.req.param('id');

  let body: unknown = {};
  try {
    const text = await c.req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return c.json({ error: 'validation_error', details: 'Invalid JSON body' }, 400);
  }

  const parsed = completeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      error: 'validation_error',
      details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    }, 400);
  }

  try {
    let resultText = parsed.data.result;

    // Parse kanban markers from the result text and create proposals
    if (resultText && !parsed.data.error) {
      const markers = parseKanbanMarkers(resultText);
      for (const marker of markers) {
        try {
          await store.createProposal({
            type: marker.type,
            payload: marker.payload,
            sourceSessionKey: `complete:${id}`,
            proposedBy: 'operator',
          });
        } catch (err) {
          console.warn(`[kanban] Failed to create proposal from marker in complete:`, err);
        }
      }
      if (markers.length > 0) {
        resultText = stripKanbanMarkers(resultText);
      }
    }

    const task = await store.completeRun(id, resultText, parsed.data.error);
    return c.json(task);
  } catch (err) {
    return handleWorkflowError(c, err);
  }
});

export default app;
