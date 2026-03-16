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
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { invokeGatewayTool } from '../lib/gateway-client.js';
import { resolveOpenclawBin } from '../lib/openclaw-bin.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const openclawBin = resolveOpenclawBin();
const nodeBinDir = process.execPath.replace(/\/node$/, '');
const openclawHome = (() => {
  const match = openclawBin.match(/^(\/home\/[^/]+|\/Users\/[^/]+)/);
  return match ? match[1] : (process.env.HOME || homedir());
})();

/** Run an openclaw CLI command and return parsed JSON. */
function runOpenclawCron(args: string[], timeoutMs = 15000, jsonFlag = true): Promise<unknown> {
  const cliArgs = ['cron', ...args];
  if (jsonFlag) cliArgs.push('--json');
  return new Promise((resolve, reject) => {
    execFile(openclawBin, cliArgs, {
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, HOME: openclawHome, PATH: `${nodeBinDir}:${process.env.PATH || '/usr/bin:/bin'}` },
    }, (err, stdout, stderr) => {
      // Extract JSON from stdout (may contain doctor warnings before the JSON)
      const jsonStr = stdout ? stdout.slice(stdout.indexOf('{')) : '';
      if (jsonStr) {
        try { return resolve(JSON.parse(jsonStr)); } catch { }
      }
      if (err) return reject(err);
      resolve({ raw: stdout || stderr });
    });
  });
}

/** Try gateway tool invoke first, fall back to CLI. */
async function invokeCronTool(action: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    return await invokeGatewayTool('cron', { action, ...args });
  } catch {
    console.log(`[crons] Gateway cron tool unavailable, using CLI fallback for: ${action}`);
    if (action === 'list') return await runOpenclawCron(['list']);
    if (action === 'remove') return await runOpenclawCron(['remove', args.jobId as string]);
    if (action === 'run') return await runOpenclawCron(['run', args.jobId as string], 60000, false);
    if (action === 'runs') return await runOpenclawCron(['runs', args.jobId as string]);
    if (action === 'update') return await runOpenclawCron(['update', args.jobId as string]);
    throw new Error(`Unsupported cron action: ${action}`);
  }
}

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

const cronJobSchema = z.object({
  job: z.object({
    name: z.string().min(1).max(200).optional(),
    schedule: scheduleSchema.optional(),
    payload: payloadSchema.optional(),
    delivery: deliverySchema,
    sessionTarget: z.enum(['main', 'isolated']).optional(),
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

app.get('/api/crons', rateLimitGeneral, async (c) => {
  try {
    const result = await invokeCronTool('list', { includeDisabled: true });
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
    console.log('[crons] add raw input:', JSON.stringify(raw, null, 2));
    console.log('[crons] add parsed job:', JSON.stringify(body.job, null, 2));
    const result = await invokeCronTool('add', { job: body.job });
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
    const result = await invokeCronTool('update', { jobId: id, patch: body.patch });
    return c.json({ ok: true, result });
  } catch (err) {
    console.error('[crons] update error:', (err as Error).message);
    return c.json({ ok: false, error: (err as Error).message }, 502);
  }
});

app.delete('/api/crons/:id', rateLimitGeneral, async (c) => {
  const id = c.req.param('id');
  try {
    const result = await invokeCronTool('remove', { jobId: id });
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
    const result = await invokeCronTool('update', { jobId: id, patch: { enabled: body.enabled } });
    return c.json({ ok: true, result });
  } catch (err) {
    console.error('[crons] toggle error:', (err as Error).message);
    return c.json({ ok: false, error: (err as Error).message }, 502);
  }
});

app.post('/api/crons/:id/run', rateLimitGeneral, async (c) => {
  const id = c.req.param('id');
  try {
    const result = await invokeCronTool('run', { jobId: id });
    return c.json({ ok: true, result });
  } catch (err) {
    console.error('[crons] run error:', (err as Error).message);
    return c.json({ ok: false, error: (err as Error).message }, 502);
  }
});

app.get('/api/crons/:id/runs', rateLimitGeneral, async (c) => {
  const id = c.req.param('id');
  try {
    const result = await invokeCronTool('runs', { jobId: id, limit: 10 });
    return c.json({ ok: true, result });
  } catch (err) {
    console.error('[crons] runs error:', (err as Error).message);
    return c.json({ ok: false, error: (err as Error).message }, 502);
  }
});

export default app;
