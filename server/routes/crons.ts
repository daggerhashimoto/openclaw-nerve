/**
 * Cron API Routes — proxy to OpenClaw gateway
 *
 * GET    /api/crons            — List all cron jobs
 * POST   /api/crons            — Create a new cron job
 * PATCH  /api/crons/:id        — Update a cron job
 * DELETE /api/crons/:id        — Delete a cron job
 * POST   /api/crons/:id/toggle — Toggle enabled/disabled
 * POST   /api/crons/:id/run    — Run a cron job immediately
 * GET    /api/crons/:id/runs   — Get run history
 */

import { Hono } from 'hono';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { config } from '../lib/config.js';
import { invokeGatewayTool } from '../lib/gateway-client.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const scheduleSchema = z.union([
  z.object({ kind: z.literal('at'), at: z.string() }),
  z.object({ kind: z.literal('every'), everyMs: z.number(), anchorMs: z.number().optional() }),
  z.object({ kind: z.literal('cron'), expr: z.string(), tz: z.string().optional() }),
]);

const payloadSchema = z.union([
  z.object({ kind: z.literal('systemEvent'), text: z.string() }),
  z.object({ kind: z.literal('agentTurn'), message: z.string(), model: z.string().optional(), thinking: z.string().optional(), timeoutSeconds: z.number().optional() }),
]);

const deliverySchema = z.object({
  mode: z.enum(['none', 'announce']).optional(),
  channel: z.string().optional(),
  to: z.string().optional(),
  bestEffort: z.boolean().optional(),
}).optional();

const sessionAgentIdSchema = z.string().max(200).optional();

const cronJobSchema = z.object({
  job: z.object({
    name: z.string().min(1).max(200).optional(),
    schedule: scheduleSchema.optional(),
    payload: payloadSchema.optional(),
    delivery: deliverySchema,
    sessionTarget: z.enum(['main', 'isolated']).optional(),
    sessionKey: z.string().max(200).optional(),
    agentId: sessionAgentIdSchema,
    enabled: z.boolean().optional(),
    notify: z.boolean().optional(),
    // Legacy compat — Nerve may send these flat fields
    prompt: z.string().max(10000).optional(),
    model: z.string().max(200).optional(),
    thinkingLevel: z.string().max(50).optional(),
    channel: z.string().max(200).optional(),
  }),
});

const cronPatchSchema = z.object({
  patch: z.object({
    name: z.string().min(1).max(200).optional(),
    schedule: scheduleSchema.optional(),
    payload: payloadSchema.optional(),
    delivery: deliverySchema,
    sessionTarget: z.enum(['main', 'isolated']).optional(),
    sessionKey: z.string().max(200).optional(),
    agentId: sessionAgentIdSchema,
    enabled: z.boolean().optional(),
    notify: z.boolean().optional(),
    prompt: z.string().max(10000).optional(),
    model: z.string().max(200).optional(),
    thinkingLevel: z.string().max(50).optional(),
    channel: z.string().max(200).optional(),
  }),
});

const app = new Hono();

const GATEWAY_RUN_TIMEOUT_MS = 60_000;
const MANUAL_CRON_RUNS_DIR = join(config.home, '.openclaw', 'cron', 'nerve-manual-runs');

interface ManualCronRunEntry {
  ts: number;
  jobId: string;
  action: 'spawned';
  status: 'ok';
  summary: string;
  runAtMs: number;
  nextRunAtMs?: number;
  childSessionKey?: string;
  runId?: string;
  manual: true;
}

function getCronJobsFromResult(result: unknown): Record<string, unknown>[] {
  const r = result as { jobs?: unknown; details?: { jobs?: unknown } };
  if (Array.isArray(r?.jobs)) return r.jobs as Record<string, unknown>[];
  if (Array.isArray(r?.details?.jobs)) return r.details.jobs as Record<string, unknown>[];
  return Array.isArray(result) ? result as Record<string, unknown>[] : [];
}

function getCronRunEntriesFromResult(result: unknown): Record<string, unknown>[] {
  const r = result as { runs?: unknown; details?: { entries?: unknown; runs?: unknown } };
  if (Array.isArray(r?.runs)) return r.runs as Record<string, unknown>[];
  if (Array.isArray(r?.details?.entries)) return r.details.entries as Record<string, unknown>[];
  if (Array.isArray(r?.details?.runs)) return r.details.runs as Record<string, unknown>[];
  return Array.isArray(result) ? result as Record<string, unknown>[] : [];
}

function getManualCronRunsFilePath(jobId: string): string {
  return join(MANUAL_CRON_RUNS_DIR, `${jobId}.jsonl`);
}

async function appendManualCronRunEntry(jobId: string, entry: ManualCronRunEntry): Promise<void> {
  await fs.mkdir(MANUAL_CRON_RUNS_DIR, { recursive: true });
  await fs.appendFile(getManualCronRunsFilePath(jobId), `${JSON.stringify(entry)}\n`, 'utf8');
}

async function readManualCronRunEntries(jobId: string): Promise<Record<string, unknown>[]> {
  try {
    const raw = await fs.readFile(getManualCronRunsFilePath(jobId), 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function sortCronRunEntries(entries: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...entries].sort((a, b) => {
    const aTs = Number(a.ts || a.runAtMs || 0);
    const bTs = Number(b.ts || b.runAtMs || 0);
    return bTs - aTs;
  });
}

async function mergeManualRunStateIntoJobs(jobs: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  return Promise.all(jobs.map(async (job) => {
    const jobId = typeof job.id === 'string'
      ? job.id
      : typeof job.jobId === 'string'
        ? job.jobId
        : '';
    if (!jobId) return job;

    const latestManualEntry = sortCronRunEntries(await readManualCronRunEntries(jobId))[0];
    const latestManualTs = Number(latestManualEntry?.ts || latestManualEntry?.runAtMs || 0);
    if (!latestManualTs) return job;

    const state = ((job.state as Record<string, unknown> | undefined) ?? {});
    const gatewayLastRunTs = typeof state.lastRunAtMs === 'number' ? state.lastRunAtMs : 0;
    if (gatewayLastRunTs >= latestManualTs) return job;

    return {
      ...job,
      state: {
        ...state,
        lastRunAtMs: latestManualTs,
      },
    };
  }));
}

function replaceCronJobsInResult(result: unknown, jobs: Record<string, unknown>[]): unknown {
  const r = result as {
    jobs?: unknown;
    details?: Record<string, unknown>;
    content?: Array<{ type?: string; text?: string }>;
  };
  const syncContent = (nextResult: Record<string, unknown>) => {
    if (!Array.isArray(r?.content)) return nextResult;
    const nextContent = r.content.map((item) => {
      if (item?.type !== 'text' || typeof item.text !== 'string') return item;
      try {
        const parsed = JSON.parse(item.text) as Record<string, unknown>;
        if (!Array.isArray(parsed.jobs)) return item;
        return {
          ...item,
          text: JSON.stringify({ ...parsed, jobs }, null, 2),
        };
      } catch {
        return item;
      }
    });
    return {
      ...nextResult,
      content: nextContent,
    };
  };
  if (Array.isArray(r?.jobs)) {
    return syncContent({ ...r, jobs });
  }
  if (Array.isArray(r?.details?.jobs)) {
    return syncContent({
      ...r,
      details: {
        ...r.details,
        jobs,
      },
    });
  }
  if (Array.isArray(result)) {
    return jobs;
  }
  return result;
}

async function getGatewayCronRunEntries(jobId: string): Promise<Record<string, unknown>[]> {
  try {
    const gatewayResult = await invokeGatewayTool('cron', {
      action: 'runs',
      jobId,
      limit: 10,
    });
    return getCronRunEntriesFromResult(gatewayResult);
  } catch (err) {
    console.warn('[crons] gateway runs unavailable, falling back to manual history only:', (err as Error).message);
    return [];
  }
}

function deriveAgentIdFromSessionKey(sessionKey?: string): string | undefined {
  if (!sessionKey) return undefined;
  const match = sessionKey.match(/^agent:([^:]+):/);
  return match?.[1];
}

function normalizeCronTarget<T extends { sessionKey?: string; agentId?: string }>(job: T): T {
  const agentId = deriveAgentIdFromSessionKey(job.sessionKey);
  if (!agentId) return job;
  return { ...job, agentId };
}

function isIsolatedAgentTurnCron(job: Record<string, unknown>): boolean {
  const payload = (job.payload || {}) as Record<string, unknown>;
  return job.sessionTarget === 'isolated'
    && payload.kind === 'agentTurn'
    && typeof payload.message === 'string'
    && payload.message.trim().length > 0;
}

function buildCronSpawnLabel(job: Record<string, unknown>): string {
  const base = typeof job.name === 'string' && job.name.trim()
    ? job.name.trim()
    : `cron ${String(job.id || job.jobId || '').slice(0, 8)}`;
  const stamp = new Date().toISOString().slice(11, 16);
  return `Cron · ${base} · ${stamp}`;
}

app.get('/api/crons', rateLimitGeneral, async (c) => {
  try {
    const result = await invokeGatewayTool('cron', {
      action: 'list',
      includeDisabled: true,
    });
    const jobs = getCronJobsFromResult(result);
    const mergedJobs = jobs.length > 0 ? await mergeManualRunStateIntoJobs(jobs) : jobs;
    return c.json({ ok: true, result: replaceCronJobsInResult(result, mergedJobs) });
  } catch (err) {
    console.error('[crons] list error:', (err as Error).message);
    return c.json({ ok: false, error: (err as Error).message }, 502);
  }
});

app.post('/api/crons', rateLimitGeneral, async (c) => {
  try {
    const raw = await c.req.json();
    const parsed = cronJobSchema.safeParse(raw);
    if (!parsed.success) return c.json({ ok: false, error: parsed.error.issues[0]?.message || 'Invalid body' }, 400);
    const body = parsed.data;
    const normalizedJob = normalizeCronTarget(body.job);
    const result = await invokeGatewayTool('cron', {
      action: 'add',
      job: normalizedJob,
    });
    return c.json({ ok: true, result });
  } catch (err) {
    console.error('[crons] add error:', (err as Error).message);
    return c.json({ ok: false, error: (err as Error).message }, 502);
  }
});

app.patch('/api/crons/:id', rateLimitGeneral, async (c) => {
  const id = c.req.param('id');
  try {
    const raw = await c.req.json();
    const parsed = cronPatchSchema.safeParse(raw);
    if (!parsed.success) return c.json({ ok: false, error: parsed.error.issues[0]?.message || 'Invalid body' }, 400);
    const body = parsed.data;
    const normalizedPatch = normalizeCronTarget(body.patch);
    const result = await invokeGatewayTool('cron', {
      action: 'update',
      jobId: id,
      patch: normalizedPatch,
    });
    return c.json({ ok: true, result });
  } catch (err) {
    console.error('[crons] update error:', (err as Error).message);
    return c.json({ ok: false, error: (err as Error).message }, 502);
  }
});

app.delete('/api/crons/:id', rateLimitGeneral, async (c) => {
  const id = c.req.param('id');
  try {
    const result = await invokeGatewayTool('cron', {
      action: 'remove',
      jobId: id,
    });
    return c.json({ ok: true, result });
  } catch (err) {
    console.error('[crons] remove error:', (err as Error).message);
    return c.json({ ok: false, error: (err as Error).message }, 502);
  }
});

app.post('/api/crons/:id/toggle', rateLimitGeneral, async (c) => {
  const id = c.req.param('id');
  // Get current state first, then flip
  try {
    const body = await c.req.json<{ enabled: boolean }>().catch(() => ({ enabled: true }));
    const result = await invokeGatewayTool('cron', {
      action: 'update',
      jobId: id,
      patch: { enabled: body.enabled },
    });
    return c.json({ ok: true, result });
  } catch (err) {
    console.error('[crons] toggle error:', (err as Error).message);
    return c.json({ ok: false, error: (err as Error).message }, 502);
  }
});

app.post('/api/crons/:id/run', rateLimitGeneral, async (c) => {
  const id = c.req.param('id');
  try {
    const listResult = await invokeGatewayTool('cron', {
      action: 'list',
      includeDisabled: true,
    }, GATEWAY_RUN_TIMEOUT_MS) as Record<string, unknown>;
    const jobs = getCronJobsFromResult(listResult);
    const job = jobs.find((entry) => (entry.id || entry.jobId) === id);

    if (job && isIsolatedAgentTurnCron(job)) {
      const payload = job.payload as Record<string, unknown>;
      const runAtMs = Date.now();
      const spawnArgs: Record<string, unknown> = {
        task: String(payload.message || '').trim(),
        mode: 'run',
        label: buildCronSpawnLabel(job),
      };
      if (typeof payload.model === 'string' && payload.model.trim()) {
        spawnArgs.model = payload.model.trim();
      }
      if (typeof payload.thinking === 'string' && payload.thinking.trim()) {
        spawnArgs.thinking = payload.thinking.trim();
      }
      if (typeof job.agentId === 'string' && job.agentId.trim()) {
        spawnArgs.agentId = job.agentId.trim();
      }

      const result = await invokeGatewayTool('sessions_spawn', spawnArgs, GATEWAY_RUN_TIMEOUT_MS);
      const details = (result as { details?: Record<string, unknown> })?.details ?? {};
      try {
        await appendManualCronRunEntry(id, {
          ts: runAtMs,
          jobId: id,
          action: 'spawned',
          status: 'ok',
          summary: 'Manual run started in a separate cron session.',
          runAtMs,
          nextRunAtMs: typeof (job.state as Record<string, unknown> | undefined)?.nextRunAtMs === 'number'
            ? (job.state as Record<string, unknown>).nextRunAtMs as number
            : undefined,
          childSessionKey: typeof details.childSessionKey === 'string' ? details.childSessionKey : undefined,
          runId: typeof details.runId === 'string' ? details.runId : undefined,
          manual: true,
        });
      } catch (ledgerErr) {
        console.warn('[crons] manual run history write failed:', (ledgerErr as Error).message);
      }
      return c.json({ ok: true, result });
    }

    const result = await invokeGatewayTool('cron', {
      action: 'run',
      jobId: id,
    }, GATEWAY_RUN_TIMEOUT_MS);
    return c.json({ ok: true, result });
  } catch (err) {
    console.error('[crons] run error:', (err as Error).message);
    return c.json({ ok: false, error: (err as Error).message }, 502);
  }
});

app.get('/api/crons/:id/runs', rateLimitGeneral, async (c) => {
  const id = c.req.param('id');
  try {
    const gatewayEntries = await getGatewayCronRunEntries(id);
    const manualEntries = await readManualCronRunEntries(id);
    const entries = sortCronRunEntries([...gatewayEntries, ...manualEntries]).slice(0, 10);
    return c.json({
      ok: true,
      result: {
        entries,
        total: entries.length,
        offset: 0,
        limit: 10,
        hasMore: false,
        nextOffset: null,
      },
    });
  } catch (err) {
    console.error('[crons] runs error:', (err as Error).message);
    return c.json({ ok: false, error: (err as Error).message }, 502);
  }
});

export default app;
