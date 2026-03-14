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
import { z } from 'zod';
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

app.get('/api/crons', rateLimitGeneral, async (c) => {
  try {
    const result = await invokeGatewayTool('cron', {
      action: 'list',
      includeDisabled: true,
    });
    return c.json({ ok: true, result });
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
    console.log('[crons] add raw input:', JSON.stringify(raw, null, 2));
    console.log('[crons] add parsed job:', JSON.stringify(normalizedJob, null, 2));
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
    const result = await invokeGatewayTool('cron', {
      action: 'runs',
      jobId: id,
      limit: 10,
    });
    return c.json({ ok: true, result });
  } catch (err) {
    console.error('[crons] runs error:', (err as Error).message);
    return c.json({ ok: false, error: (err as Error).message }, 502);
  }
});

export default app;
