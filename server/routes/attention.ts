/**
 * Attention API Routes
 *
 * POST /api/attention/summaries  { sessionKeys: string[] }
 *   -> { summaries: { [sessionKey]: { status: 'ready' | 'pending' | 'error' | 'empty', text?, updatedAt?,
 *        lastSpeaker?: 'operator' | 'agent', lastAt?, asksOperator? } } }
 *
 * "What happened" for the board's cards and Today's chats, with whose turn it is. Cached
 * answers are cheap; a thread with new messages comes back `pending` while it is summarized in
 * the background, so the client polls.
 * See {@link createAttentionSummaries}.
 *
 * POST /api/attention/day-summary  { facts: DayFacts }
 *   -> { summary: { status: 'ready' | 'pending' | 'error', text?, updatedAt? } }
 *
 * The Today digest's paragraph, from the day's compact facts the client sends (bounded here).
 * Same facts, same text; new facts are written in the background at most every ten minutes.
 * See {@link createDaySummary}.
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
import {
  createDaySummary,
  defaultDaySummaryPath,
  type DaySummary,
} from '../lib/attention-day-summary.js';

/** Keys answered per request: every chat Today lists, plus the open rows. */
export const MAX_SUMMARY_KEYS = 50;

const bodySchema = z.object({
  sessionKeys: z.array(z.string().trim().min(1).max(512)).max(80),
});

const line = z.string().trim().max(300);
const count = z.number().int().min(0).max(1_000_000);
const factsSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  counts: z.object({
    sessions: count,
    done: count,
    merged: count,
    // Older pages still send it; successful cron runs are left out of the paragraph.
    cronOk: count.optional(),
    cronFailed: count,
  }),
  done: z.array(line).max(60),
  chats: z.array(line).max(60),
  missing: z.array(z.string().trim().max(40)).max(8),
});
const dayBodySchema = z.object({ facts: factsSchema });

let service: AttentionSummaries | null = null;
let daySummary: DaySummary | null = null;

function getService(): AttentionSummaries {
  service ??= createAttentionSummaries({
    rpc: gatewayRpcCall,
    filePath: defaultSummariesPath(),
    model: () => process.env.NERVE_ATTENTION_SUMMARY_MODEL,
  });
  return service;
}

function getDaySummary(): DaySummary {
  daySummary ??= createDaySummary({
    rpc: gatewayRpcCall,
    filePath: defaultDaySummaryPath(),
    model: () => process.env.NERVE_ATTENTION_SUMMARY_MODEL,
  });
  return daySummary;
}

/** Resolves once background summaries and their writes have finished (tests). */
export async function whenSummariesIdle(): Promise<void> {
  await Promise.all([service?.whenIdle(), daySummary?.whenIdle()]);
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

app.post('/api/attention/day-summary', rateLimitGeneral, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = dayBodySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Expected { facts }' }, 400);
  const summary = await getDaySummary().get(parsed.data.facts);
  return c.json({ summary });
});

export default app;
