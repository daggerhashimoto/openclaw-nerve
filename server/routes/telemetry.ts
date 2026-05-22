import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { z } from 'zod';
import { getTelemetryRuntime } from '../lib/telemetry/runtime.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const app = new Hono();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TELEMETRY_DOC_PATH = path.resolve(__dirname, '../../docs/TELEMETRY.md');

const sessionOpenedEventSchema = z.object({
  event: z.literal('session_opened'),
}).strict();

const branchCreatedEventSchema = z.object({
  event: z.literal('branch_created'),
}).strict();

const branchSwitchedEventSchema = z.object({
  event: z.literal('branch_switched'),
  properties: z.object({
    success: z.boolean(),
  }).strict(),
}).strict();

const uiTelemetryEventSchema = z.union([
  sessionOpenedEventSchema,
  branchCreatedEventSchema,
  branchSwitchedEventSchema,
]);

async function recordUiTelemetryEvent(payload: z.infer<typeof uiTelemetryEventSchema>): Promise<void> {
  const telemetry = getTelemetryRuntime();
  if (!telemetry) return;

  try {
    if (payload.event === 'session_opened') {
      await telemetry.markFeatureUsed('sessions');
      return;
    }

    if (payload.event === 'branch_created') {
      await telemetry.markFeatureUsed('branches');
      return;
    }

    if (payload.event === 'branch_switched') {
      await Promise.allSettled([
        telemetry.markFeatureUsed('branches'),
        telemetry.recordClientDetailedEvent(payload),
      ]);
      return;
    }

    // Exhaustiveness check - if a new event variant is added to
    // uiTelemetryEventSchema without a corresponding branch above, TypeScript
    // flags it here. No runtime call needed; every reachable variant returned.
    const _exhaustive: never = payload;
    void _exhaustive;
  } catch {
    return;
  }
}

app.get('/api/telemetry/docs', rateLimitGeneral, async (c) => {
  try {
    const doc = await fs.readFile(TELEMETRY_DOC_PATH, 'utf8');
    c.header('Content-Type', 'text/markdown; charset=utf-8');
    return c.body(doc);
  } catch {
    return c.json({ error: 'telemetry_docs_unavailable' }, 503);
  }
});

app.post('/api/telemetry/events', rateLimitGeneral, async (c) => {
  let body: unknown;

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const parsed = uiTelemetryEventSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_telemetry_payload' }, 400);
  }

  // Best-effort, non-blocking: do not await the store write chain.
  // The browser only needs the 200 acknowledgement; ws-proxy uses the same
  // fire-and-forget pattern via runInBackground for all telemetry calls.
  void recordUiTelemetryEvent(parsed.data).catch(() => { /* swallow */ });
  return c.json({ ok: true });
});

export default app;
