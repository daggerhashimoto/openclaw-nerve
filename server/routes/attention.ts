/**
 * Attention API Routes
 *
 * POST /api/attention/summaries  { sessionKeys: string[] }
 *   -> { summaries: { [sessionKey]: { status: 'ready' | 'pending' | 'error' | 'empty', text?, updatedAt? } } }
 *
 * "What happened" lines for the board's cards. Cached answers are cheap; a thread with new
 * messages comes back `pending` while it is summarized in the background, so the client polls.
 * See {@link createAttentionSummaries}.
 * @module
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { gatewayRpcCall } from '../lib/gateway-rpc.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import {
  createAttentionSummaries,
  defaultSummariesPath,
  type AttentionSummaries,
} from '../lib/attention-summaries.js';

/** Keys answered per request; the board shows only a handful of cards. */
export const MAX_SUMMARY_KEYS = 12;

const bodySchema = z.object({
  sessionKeys: z.array(z.string().trim().min(1).max(512)).max(50),
});

let service: AttentionSummaries | null = null;

function getService(): AttentionSummaries {
  service ??= createAttentionSummaries({
    rpc: gatewayRpcCall,
    filePath: defaultSummariesPath(),
    model: () => process.env.NERVE_ATTENTION_SUMMARY_MODEL,
  });
  return service;
}

/** Resolves once background summaries and their writes have finished (tests). */
export function whenSummariesIdle(): Promise<void> {
  return service ? service.whenIdle() : Promise.resolve();
}

const app = new Hono();

app.post('/api/attention/summaries', rateLimitGeneral, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Expected { sessionKeys: string[] }' }, 400);
  const keys = [...new Set(parsed.data.sessionKeys)].slice(0, MAX_SUMMARY_KEYS);
  const summaries = await getService().get(keys);
  return c.json({ summaries });
});

export default app;
