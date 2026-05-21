/**
 * Kanban API Routes
 *
 * GET    /api/kanban/tasks          — List tasks (with filters + pagination)
 * POST   /api/kanban/tasks          — Create a task
 * GET    /api/kanban/tasks/:id      — Get a task by id
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
  InvalidTaskStatusError,
  InvalidBoardConfigError,
  InvalidTransitionError,
  ProposalNotFoundError,
  ProposalAlreadyResolvedError,
} from '../lib/kanban-store.js';
import { InvalidKanbanAssigneeError, resolveKanbanAssigneeRootSessionKey } from '../lib/kanban-assignee.js';
import { invokeGatewayTool } from '../lib/gateway-client.js';
import { gatewayRpcCall } from '../lib/gateway-rpc.js';
import { withMutex } from '../lib/mutex.js';
import { parseKanbanMarkers, stripKanbanMarkers } from '../lib/parseMarkers.js';
import {
  buildKanbanFallbackRunKey,
  launchKanbanFallbackSubagentViaRpc,
} from '../lib/kanban-subagent-fallback.js';
import type {
  KanbanTask,
  TaskStatus,
  TaskPriority,
  TaskActor,
  ProposalStatus,
} from '../lib/kanban-store.js';

const app = new Hono();

const POLL_SESSIONS_ACTIVE_MINUTES = 24 * 60;
const PARENT_ROOT_LOOKUP_ACTIVE_MINUTES = 7 * 24 * 60;
const PARENT_ROOT_LOOKUP_SESSIONS_LIMIT = 1000;
const POLL_SESSIONS_LIMIT = 200;

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
const activeBackgroundTasks = new Set<Promise<unknown>>();

function trackTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  const id = setTimeout(() => {
    activePollTimers.delete(id);
    fn();
  }, ms);
  activePollTimers.add(id);
  return id;
}

function trackBackgroundTask<T>(task: Promise<T>): Promise<T> {
  const tracked = task.finally(() => {
    activeBackgroundTasks.delete(tracked);
  });
  activeBackgroundTasks.add(tracked);
  return tracked as Promise<T>;
}

/** Cancel all active poll timers and await pending async launch bookkeeping (call on shutdown). */
export async function cleanupKanbanPollers(): Promise<void> {
  const pendingBackgroundTasks = Array.from(activeBackgroundTasks);
  if (pendingBackgroundTasks.length > 0) {
    await Promise.allSettled(pendingBackgroundTasks);
  }

  for (const t of activePollTimers) clearTimeout(t);
  activePollTimers.clear();
}

interface GatewaySessionSummary {
  key?: string;
  sessionKey?: string;
  label?: string;
  status?: string;
  error?: string;
  agentState?: string;
  busy?: boolean;
  processing?: boolean;
}

interface KanbanRunIdentity {
  correlationKey: string;
  childSessionKey?: string;
  runId?: string;
}

interface KanbanFallbackRunIdentity {
  correlationKey: string;
  parentSessionKey: string;
  childSessionKey?: string;
  expectedChildLabel: string;
  knownSessionKeysBefore: string[];
  runId?: string;
}

interface PendingPrimarySpawn {
  runSessionKey: string;
  prompt: string;
  model?: string;
  thinking?: string;
}

interface PendingFallbackLaunch {
  sessionKey: string;
  parentSessionKey: string;
  label: string;
  prompt: string;
  model?: string;
  thinking?: string;
}

type ExecuteTaskAttempt =
  | { duplicate: true }
  | {
    duplicate: false;
    task: KanbanTask;
    primarySpawn?: PendingPrimarySpawn;
    fallbackLaunch?: PendingFallbackLaunch;
  };

class KanbanExecutionPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KanbanExecutionPreflightError';
  }
}

/**
 * Intentional platform compromise:
 * - Linux keeps the original master/session-spawn path as primary because it already works there.
 * - macOS defaults to the assignee-root fallback path because the primary subagent spawn flow is known to fail there.
 * Tests can override this with NERVE_KANBAN_EXECUTION_MODE.
 */
function shouldUseKanbanFallback(): boolean {
  const mode = process.env.NERVE_KANBAN_EXECUTION_MODE;
  if (mode === 'primary') return false;
  if (mode === 'fallback') return true;
  return process.platform === 'darwin';
}

function resolveKanbanLaunchOptions(options: {
  requestedModel?: string;
  taskModel?: string;
  defaultModel?: string;
  requestedThinking?: string;
  taskThinking?: string;
  defaultThinking?: string;
}): { model?: string; thinking: string } {
  const model = options.requestedModel ?? options.taskModel ?? options.defaultModel;
  const rawThinking = options.requestedThinking ?? options.taskThinking ?? options.defaultThinking;
  const thinking = typeof rawThinking === 'string' && rawThinking.trim() !== '' && rawThinking.toLowerCase() !== 'off'
    ? rawThinking
    : 'low';

  return { model, thinking };
}

function findGatewayRunMatch(
  sessions: Array<Record<string, unknown>>,
  identity: KanbanRunIdentity,
): Record<string, unknown> | undefined {
  if (identity.childSessionKey) {
    const byChildSessionKey = sessions.find((session) => (
      String(session.childSessionKey ?? session.sessionKey ?? session.sessionId ?? '') === identity.childSessionKey
    ));
    if (byChildSessionKey) return byChildSessionKey;
  }

  if (identity.runId) {
    const byRunId = sessions.find((session) => String(session.runId ?? '') === identity.runId);
    if (byRunId) return byRunId;
  }

  return sessions.find((session) => String(session.label ?? '') === identity.correlationKey);
}

function getSessionKey(session: GatewaySessionSummary): string | null {
  if (typeof session.sessionKey === 'string' && session.sessionKey.trim()) return session.sessionKey;
  if (typeof session.key === 'string' && session.key.trim()) return session.key;
  return null;
}

function isFallbackChildSession(sessionKey: string, parentSessionKey: string): boolean {
  const parentMatch = parentSessionKey.match(/^agent:([^:]+):main$/);
  if (!parentMatch) return false;
  return sessionKey.startsWith(`agent:${parentMatch[1]}:subagent:`);
}

function pickSpawnedChildSession(
  sessions: GatewaySessionSummary[],
  identity: KanbanFallbackRunIdentity,
): GatewaySessionSummary | null {
  const unseenChildren = sessions.filter((session) => {
    const sessionKey = getSessionKey(session);
    if (!sessionKey) return false;
    if (!isFallbackChildSession(sessionKey, identity.parentSessionKey)) return false;
    return !identity.knownSessionKeysBefore.includes(sessionKey);
  });

  if (unseenChildren.length === 0) return null;

  const exactLabelMatch = unseenChildren.find((session) => session.label === identity.expectedChildLabel);
  if (exactLabelMatch) return exactLabelMatch;

  return unseenChildren.length === 1 ? unseenChildren[0] : null;
}

function getLastAssistantText(
  messages: Array<Record<string, unknown>>,
  fallback = 'Completed (no result text)',
): string {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!lastAssistant) return fallback;

  const content = lastAssistant.content;
  if (typeof content === 'string' && content.trim()) return content;
  if (Array.isArray(content)) {
    const textPart = (content as Array<Record<string, unknown>>).find((p) => p.type === 'text');
    if (textPart && typeof textPart.text === 'string' && textPart.text.trim()) return textPart.text;
  }
  return fallback;
}

function trimKanbanParentReportText(text: string, maxChars = 4_000): string {
  const normalized = text.trim();
  if (!normalized) return 'Completed (no result text)';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 13).trimEnd()}\n\n[truncated]`;
}

function buildKanbanParentCompletionMessage(params: {
  task: KanbanTask;
  parentSessionKey: string;
  childSessionKey: string;
  outcome: 'completed' | 'failed';
  result?: string;
  error?: string;
}): string {
  const lines = [
    'Kanban child session completion report.',
    '',
    'Use this as context from work that ran under this root. This is a completion update, not a fresh task unless follow-up is needed.',
    '',
    `Task ID: ${params.task.id}`,
    `Title: ${params.task.title}`,
    `Parent root: ${params.parentSessionKey}`,
    `Child session: ${params.childSessionKey}`,
    `Outcome: ${params.outcome}`,
  ];

  if (params.outcome === 'completed') {
    lines.push('', 'Result:', trimKanbanParentReportText(params.result ?? 'Completed (no result text)'));
  } else {
    lines.push('', 'Error:', trimKanbanParentReportText(params.error ?? 'Child session failed'));
  }

  return lines.join('\n');
}

async function reportKanbanChildCompletionToParent(params: {
  task: KanbanTask;
  parentSessionKey: string;
  childSessionKey: string;
  outcome: 'completed' | 'failed';
  result?: string;
  error?: string;
}): Promise<void> {
  const message = buildKanbanParentCompletionMessage(params);
  const suffix = params.outcome === 'completed' ? 'done' : 'failed';

  await gatewayRpcCall('sessions.send', {
    key: params.parentSessionKey,
    message,
    idempotencyKey: `kanban-parent-report:${params.task.id}:${params.childSessionKey}:${suffix}`,
  });
}

/** Poll gateway subagents for a kanban run until it finishes, then complete the run. */
function pollSessionCompletion(
  store: ReturnType<typeof getKanbanStore>,
  taskId: string,
  identity: KanbanRunIdentity,
  intervalMs = 5_000,
  maxAttempts = 720, // 60 minutes max
): void {
  let attempts = 0;

  const poll = async () => {
    attempts++;
    if (attempts > maxAttempts) {
      console.warn(`[kanban] Polling timed out for task ${taskId} (runKey: ${identity.correlationKey})`);
      await store.completeRun(taskId, identity.correlationKey, undefined, 'Run timed out (polling limit reached)').catch(() => {});
      return;
    }

    try {
      const task = await store.getTask(taskId).catch(() => null);
      if (
        !task
        || task.status !== 'in-progress'
        || task.run?.status !== 'running'
        || task.run?.sessionKey !== identity.correlationKey
      ) {
        return;
      }

      const raw = await invokeGatewayTool('subagents', { action: 'list', recentMinutes: 120 });
      const parsed = parseGatewayResponse(raw);
      const active = (parsed.active ?? []) as Array<Record<string, unknown>>;
      const recent = (parsed.recent ?? []) as Array<Record<string, unknown>>;
      const all = [...active, ...recent];

      const match = findGatewayRunMatch(all, identity);
      if (!match) {
        trackTimeout(poll, intervalMs);
        return;
      }

      const status = match.status as string;
      const childSessionKey = typeof match.childSessionKey === 'string'
        ? match.childSessionKey
        : typeof match.sessionKey === 'string'
          ? match.sessionKey
          : typeof match.sessionId === 'string'
            ? match.sessionId
            : identity.childSessionKey;

      if (status === 'done') {
        let resultText = 'Completed (no result text)';
        if (!childSessionKey) {
          console.warn(`[kanban] Run ${identity.correlationKey} completed without a child session key`);
        } else {
          try {
            const histRaw = await invokeGatewayTool('sessions_history', {
              sessionKey: childSessionKey,
              limit: 3,
            });
            const histParsed = parseGatewayResponse(histRaw);
            const messages = (histParsed.messages ?? []) as Array<Record<string, unknown>>;
            resultText = getLastAssistantText(messages, resultText);
          } catch (err) {
            console.warn(`[kanban] Could not fetch history for ${identity.correlationKey}:`, err);
          }
        }

        const markers = parseKanbanMarkers(resultText);
        const cleanResult = markers.length > 0 ? stripKanbanMarkers(resultText) : resultText;

        const completedTask = await store.completeRun(taskId, identity.correlationKey, cleanResult).catch((err) => {
          console.error(`[kanban] Failed to complete run for task ${taskId}:`, err);
          return null;
        });
        if (!completedTask) return;

        console.log(`[kanban] Run completed for task ${taskId} (runKey: ${identity.correlationKey})`);

        for (const marker of markers) {
          try {
            await store.createProposal({
              type: marker.type,
              payload: marker.payload,
              sourceSessionKey: identity.correlationKey,
              proposedBy: `agent:${identity.correlationKey}`,
            });
          } catch (err) {
            console.warn(`[kanban] Failed to create proposal from marker:`, err);
          }
        }
        return;
      }

      if (status === 'error' || status === 'failed') {
        const errorMsg = (match.error as string) || 'Agent session failed';
        await store.completeRun(taskId, identity.correlationKey, undefined, errorMsg).catch(() => {});
        return;
      }

      trackTimeout(poll, intervalMs);
    } catch (err) {
      console.error(`[kanban] Poll error for task ${taskId}:`, err);
      trackTimeout(poll, intervalMs);
    }
  };

  trackTimeout(poll, 3_000);
}

/** Poll spawned macOS fallback child session until the task finishes. */
function pollFallbackSessionCompletion(
  store: ReturnType<typeof getKanbanStore>,
  taskId: string,
  identity: KanbanFallbackRunIdentity,
  intervalMs = 5_000,
  maxAttempts = 720,
): void {
  let attempts = 0;

  const poll = async () => {
    attempts++;
    if (attempts > maxAttempts) {
      console.warn(`[kanban] Polling timed out for task ${taskId} (runKey: ${identity.correlationKey})`);
      await store.completeRun(taskId, identity.correlationKey, undefined, 'Run timed out (polling limit reached)').catch(() => {});
      return;
    }

    try {
      const task = await store.getTask(taskId).catch(() => null);
      if (
        !task
        || task.status !== 'in-progress'
        || task.run?.status !== 'running'
        || task.run?.sessionKey !== identity.correlationKey
      ) {
        return;
      }

      const sessionsResponse = await gatewayRpcCall('sessions.list', {
        activeMinutes: POLL_SESSIONS_ACTIVE_MINUTES,
        limit: POLL_SESSIONS_LIMIT,
      }) as { sessions?: GatewaySessionSummary[] };
      const sessions = Array.isArray(sessionsResponse.sessions) ? sessionsResponse.sessions : [];

      let activeSessionKey = task.run?.childSessionKey ?? task.run?.sessionId ?? identity.childSessionKey;
      if (!activeSessionKey) {
        const spawned = pickSpawnedChildSession(sessions, identity);
        const spawnedSessionKey = spawned ? getSessionKey(spawned) : null;
        if (spawnedSessionKey) {
          activeSessionKey = spawnedSessionKey;
          try {
            await store.attachRunIdentifiers(taskId, identity.correlationKey, {
              childSessionKey: spawnedSessionKey,
              runId: identity.runId,
            });
          } catch (err) {
            console.warn(`[kanban] Failed to attach spawned child session for task ${taskId}:`, err);
          }
        }
      }

      if (!activeSessionKey) {
        trackTimeout(poll, intervalMs);
        return;
      }

      const session = sessions.find((candidate) => getSessionKey(candidate) === activeSessionKey);
      if (!session) {
        trackTimeout(poll, intervalMs);
        return;
      }

      const status = session.status;
      if (status === 'error' || status === 'failed') {
        const errorMsg = session.error || 'Session failed';
        const failedTask = await store.completeRun(taskId, identity.correlationKey, undefined, errorMsg).catch(() => null);
        if (failedTask) {
          try {
            await reportKanbanChildCompletionToParent({
              task: failedTask,
              parentSessionKey: identity.parentSessionKey,
              childSessionKey: activeSessionKey,
              outcome: 'failed',
              error: errorMsg,
            });
          } catch (err) {
            console.warn(`[kanban] Failed to report child failure back to ${identity.parentSessionKey}:`, err);
          }
        }
        return;
      }

      const agentState = session.agentState;
      const busy = session.busy;
      const processing = session.processing;
      const isDone = status === 'done' || (agentState === 'idle' && !busy && !processing);

      if (isDone) {
        let resultText = 'Completed (no result text)';
        try {
          const histResponse = await gatewayRpcCall('sessions.get', {
            key: activeSessionKey,
            limit: 3,
            includeTools: true,
          }) as { messages?: Array<Record<string, unknown>> };
          const messages = Array.isArray(histResponse.messages) ? histResponse.messages : [];
          resultText = getLastAssistantText(messages, resultText);
        } catch (err) {
          console.warn(`[kanban] Could not fetch history for ${activeSessionKey}:`, err);
        }

        const markers = parseKanbanMarkers(resultText);
        const cleanResult = markers.length > 0 ? stripKanbanMarkers(resultText) : resultText;

        const completedTask = await store.completeRun(taskId, identity.correlationKey, cleanResult).catch((err) => {
          console.error(`[kanban] Failed to complete run for task ${taskId}:`, err);
          return null;
        });
        if (!completedTask) return;

        console.log(`[kanban] Run completed for task ${taskId} (runKey: ${identity.correlationKey}, child: ${activeSessionKey})`);

        for (const marker of markers) {
          try {
            await store.createProposal({
              type: marker.type,
              payload: marker.payload,
              sourceSessionKey: activeSessionKey,
              proposedBy: task.assignee ?? 'operator',
            });
          } catch (err) {
            console.warn(`[kanban] Failed to create proposal from marker:`, err);
          }
        }

        try {
          await reportKanbanChildCompletionToParent({
            task: completedTask,
            parentSessionKey: identity.parentSessionKey,
            childSessionKey: activeSessionKey,
            outcome: 'completed',
            result: cleanResult,
          });
        } catch (err) {
          console.warn(`[kanban] Failed to report child completion back to ${identity.parentSessionKey}:`, err);
        }
        return;
      }

      trackTimeout(poll, intervalMs);
    } catch (err) {
      console.error(`[kanban] Poll error for task ${taskId}:`, err);
      trackTimeout(poll, intervalMs);
    }
  };

  trackTimeout(poll, 3_000);
}

// ── Zod schemas ──────────────────────────────────────────────────────

const taskStatusSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Status key must be lowercase-kebab-case (e.g. "in-progress", "blocked")');
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
  childSessionKey: z.string().optional(),
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
  defaultThinking: z.string().max(20).optional(),
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

// GET /api/kanban/tasks/:id
app.get('/api/kanban/tasks/:id', rateLimitGeneral, async (c) => {
  const store = getKanbanStore();
  const id = c.req.param('id');

  try {
    const task = await store.getTask(id);
    return c.json(task);
  } catch (err) {
    if (err instanceof TaskNotFoundError) {
      return c.json({ error: 'not_found' }, 404);
    }
    throw err;
  }
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

  try {
    const task = await store.createTask(parsed.data);
    return c.json(task, 201);
  } catch (err) {
    const invalidStatusResponse = handleInvalidTaskStatusError(c, err);
    if (invalidStatusResponse) return invalidStatusResponse;
    throw err;
  }
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
      .filter(([k, v]) => k !== 'run' && v !== undefined)
      .map(([k, v]) => [k, v === null ? undefined : v]),
  ) as Record<string, unknown>;

  try {
    const updated = await store.updateTask(id, version, cleanPatch);
    return c.json(updated);
  } catch (err) {
    const invalidStatusResponse = handleInvalidTaskStatusError(c, err);
    if (invalidStatusResponse) return invalidStatusResponse;
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
    const invalidStatusResponse = handleInvalidTaskStatusError(c, err);
    if (invalidStatusResponse) return invalidStatusResponse;
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

  try {
    const config = await store.updateConfig(parsed.data);
    return c.json(config);
  } catch (err) {
    const invalidStatusResponse = handleInvalidTaskStatusError(c, err);
    if (invalidStatusResponse) return invalidStatusResponse;
    throw err;
  }
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
    const invalidStatusResponse = handleInvalidTaskStatusError(c, err);
    if (invalidStatusResponse) return invalidStatusResponse;
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
    const invalidStatusResponse = handleInvalidTaskStatusError(c, err);
    if (invalidStatusResponse) return invalidStatusResponse;
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

function handleInvalidTaskStatusError(c: Context, err: unknown) {
  if (err instanceof InvalidTaskStatusError) {
    return c.json({
      error: 'validation_error',
      details: `status: Unknown status "${err.status}"`,
      allowed: err.allowed,
    }, 400);
  }
  if (err instanceof InvalidKanbanAssigneeError) {
    return c.json({
      error: 'validation_error',
      details: err.message,
    }, 400);
  }
  if (err instanceof InvalidBoardConfigError) {
    return c.json({
      error: 'validation_error',
      details: err.details,
      statuses: err.statuses,
    }, 400);
  }
  return null;
}

function handleWorkflowError(c: Context, err: unknown) {
  const invalidStatusResponse = handleInvalidTaskStatusError(c, err);
  if (invalidStatusResponse) return invalidStatusResponse;
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
    const useFallback = shouldUseKanbanFallback();

    const execution = await withMutex<ExecuteTaskAttempt>(`kanban-execute:${id}`, async () => {
      const existing = await store.getTask(id);
      if (existing.status === 'in-progress') {
        return { duplicate: true } as const;
      }

      const assignedParentSessionKey = resolveKanbanAssigneeRootSessionKey(existing.assignee);
      if (assignedParentSessionKey) {
        const recentSessionsResponse = await gatewayRpcCall('sessions.list', {
          activeMinutes: PARENT_ROOT_LOOKUP_ACTIVE_MINUTES,
          limit: PARENT_ROOT_LOOKUP_SESSIONS_LIMIT,
        }) as { sessions?: GatewaySessionSummary[] };
        const recentSessions = Array.isArray(recentSessionsResponse.sessions) ? recentSessionsResponse.sessions : [];

        let parentSessionExists = recentSessions.some((session) => getSessionKey(session) === assignedParentSessionKey);
        if (!parentSessionExists) {
          const fullSessionsResponse = await gatewayRpcCall('sessions.list', {
            limit: PARENT_ROOT_LOOKUP_SESSIONS_LIMIT,
          }) as { sessions?: GatewaySessionSummary[] };
          const fullSessions = Array.isArray(fullSessionsResponse.sessions) ? fullSessionsResponse.sessions : [];
          parentSessionExists = fullSessions.some((session) => getSessionKey(session) === assignedParentSessionKey);
        }

        if (!parentSessionExists) {
          throw new KanbanExecutionPreflightError(`Parent agent session not found: ${assignedParentSessionKey}`);
        }

        const config = await store.getConfig();
        const { model, thinking } = resolveKanbanLaunchOptions({
          requestedModel: parsed.data.model,
          taskModel: existing.model,
          defaultModel: config.defaultModel,
          requestedThinking: parsed.data.thinking,
          taskThinking: existing.thinking,
          defaultThinking: config.defaultThinking,
        });
        const persistedModel = parsed.data.model ?? existing.model;
        const persistedThinking = parsed.data.thinking ?? existing.thinking;
        const titleSlug = existing.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'task';
        const label = `kb-${titleSlug}-${existing.id}-v${existing.version + 1}-${Date.now()}`;
        const sessionKey = buildKanbanFallbackRunKey(label);
        const taskDescription = existing.description || existing.title;
        const prompt = `You are working on a Kanban task.

Title: ${existing.title}

Description: ${taskDescription}

Deliver your result as a clear summary of what was done.`;

        const task = await store.executeTask(
          id,
          {
            sessionKey,
            model: persistedModel,
            thinking: persistedThinking,
          },
          'operator',
        );

        return {
          duplicate: false,
          task,
          fallbackLaunch: {
            sessionKey,
            parentSessionKey: assignedParentSessionKey,
            label,
            prompt,
            model,
            thinking,
          },
        } as const;
      }

      if (useFallback) {
        throw new KanbanExecutionPreflightError('Kanban automation on macOS requires assigning the task to a live worker agent root (not @main).');
      }

      const task = await store.executeTask(id, parsed.data, 'operator');
      const taskDescription = task.description || task.title;
      const runSessionKey = task.run?.sessionKey;
      if (!runSessionKey) {
        throw new Error(`executeTask did not produce a run session key for task ${id}`);
      }

      const config = await store.getConfig();
      const { model, thinking } = resolveKanbanLaunchOptions({
        taskModel: task.model,
        defaultModel: config.defaultModel,
        taskThinking: task.thinking,
        defaultThinking: config.defaultThinking,
      });

      return {
        duplicate: false,
        task,
        primarySpawn: {
          runSessionKey,
          prompt: `You are working on a Kanban task.

Title: ${task.title}

Description: ${taskDescription}

Deliver your result as a clear summary of what was done.`,
          model,
          thinking,
        },
      } as const;
    });

    if (execution.duplicate) {
      return c.json({ error: 'duplicate_execution', details: 'Task is already being executed' }, 409);
    }

    if (execution.primarySpawn) {
      const { runSessionKey, prompt, model, thinking } = execution.primarySpawn;
      const spawnArgs: Record<string, unknown> = {
        task: prompt,
        mode: 'run',
        label: runSessionKey,
      };
      if (model) spawnArgs.model = model;
      if (thinking) spawnArgs.thinking = thinking;

      void trackBackgroundTask(
        invokeGatewayTool('sessions_spawn', spawnArgs)
          .then(async (spawnRaw) => {
            const spawn = parseGatewayResponse(spawnRaw);
            const childSessionKey = typeof spawn.childSessionKey === 'string'
              ? spawn.childSessionKey
              : typeof spawn.sessionKey === 'string'
                ? spawn.sessionKey
                : typeof spawn.sessionId === 'string'
                  ? spawn.sessionId
                  : undefined;
            const runId = typeof spawn.runId === 'string' ? spawn.runId : undefined;

            const linkedTask = await store.attachRunIdentifiers(id, runSessionKey, {
              childSessionKey,
              runId,
            });
            if (!linkedTask) {
              console.warn(`[kanban] Spawned run metadata arrived after task ${id} moved on from run ${runSessionKey}`);
              return;
            }

            pollSessionCompletion(store, id, {
              correlationKey: runSessionKey,
              childSessionKey: linkedTask.run?.childSessionKey ?? childSessionKey,
              runId: linkedTask.run?.runId ?? runId,
            });
          })
          .catch((err) => {
            console.error(`[kanban] Failed to spawn session for task ${id}:`, err);
            store.completeRun(id, runSessionKey, undefined, `Spawn failed: ${err.message}`).catch(() => {});
          }),
      );

      return c.json(execution.task);
    }

    const { fallbackLaunch } = execution;
    if (!fallbackLaunch) {
      throw new Error(`No kanban launch strategy was selected for task ${id}`);
    }

    void trackBackgroundTask((async () => {
      let launchResult: {
        sessionKey: string;
        parentSessionKey: string;
        childSessionKey?: string;
        knownSessionKeysBefore: string[];
        runId?: string;
      };
      try {
        launchResult = await launchKanbanFallbackSubagentViaRpc({
          label: fallbackLaunch.label,
          task: fallbackLaunch.prompt,
          parentSessionKey: fallbackLaunch.parentSessionKey,
          model: fallbackLaunch.model,
          thinking: fallbackLaunch.thinking,
        });

        if (launchResult.sessionKey !== fallbackLaunch.sessionKey) {
          throw new Error(
            `Run correlation key mismatch, expected ${fallbackLaunch.sessionKey}, got ${launchResult.sessionKey}`,
          );
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`[kanban] Failed to launch assignee subagent for task ${id}:`, err);
        await store.completeRun(
          id,
          fallbackLaunch.sessionKey,
          undefined,
          `Spawn failed: ${errorMessage}`,
        ).catch((completeErr) => {
          console.warn(`[kanban] Failed to mark spawn failure for task ${id}:`, completeErr);
        });
        return;
      }

      try {
        if (launchResult.runId || launchResult.childSessionKey) {
          await store.attachRunIdentifiers(id, fallbackLaunch.sessionKey, {
            childSessionKey: launchResult.childSessionKey,
            runId: launchResult.runId,
          });
        }
      } catch (err) {
        console.error(`[kanban] Failed to attach run metadata for task ${id}:`, err);
      }

      pollFallbackSessionCompletion(store, id, {
        correlationKey: fallbackLaunch.sessionKey,
        parentSessionKey: fallbackLaunch.parentSessionKey,
        childSessionKey: launchResult.childSessionKey,
        expectedChildLabel: fallbackLaunch.label,
        knownSessionKeysBefore: launchResult.knownSessionKeysBefore,
        runId: launchResult.runId,
      });
    })());

    return c.json(execution.task);
  } catch (err) {
    if (err instanceof KanbanExecutionPreflightError) {
      return c.json({ error: 'invalid_execution_target', details: err.message }, 409);
    }
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
  sessionKey: z.string().min(1).max(500),
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
    const { sessionKey, error } = parsed.data;
    const resultText = parsed.data.result;
    const markers = resultText && !error ? parseKanbanMarkers(resultText) : [];
    const cleanResult = markers.length > 0 ? stripKanbanMarkers(resultText!) : resultText;

    const task = await store.completeRun(id, sessionKey, cleanResult, error);

    for (const marker of markers) {
      try {
        await store.createProposal({
          type: marker.type,
          payload: marker.payload,
          sourceSessionKey: sessionKey,
          proposedBy: `agent:${sessionKey}`,
        });
      } catch (err) {
        console.warn(`[kanban] Failed to create proposal from marker in complete:`, err);
      }
    }

    return c.json(task);
  } catch (err) {
    return handleWorkflowError(c, err);
  }
});

export default app;
