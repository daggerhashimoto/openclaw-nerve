/**
 * GET /api/tokens — Token usage statistics with persistent tracking.
 *
 * Scans `.jsonl` session transcript files in the sessions directory for
 * accumulated cost and token data, aggregated by provider. Results are
 * cached for 60 s and also persisted via the usage tracker (high-water mark).
 * @module
 */

import { Hono } from 'hono';
import { updateUsage } from '../lib/usage-tracker.js';
import {
  resolveSessionTranscriptDirs,
  scanTranscriptUsageFromDirs,
  type SessionCostData,
} from '../lib/token-usage.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import { config } from '../lib/config.js';

const app = new Hono();

// ── Session cost scanning (cached 60s) ───────────────────────────────

const EMPTY_COST_DATA: SessionCostData = { totalCost: 0, totalInput: 0, totalOutput: 0, totalMessages: 0, entries: [] };
const COST_CACHE_TTL = 60_000;
let costCache: { data: SessionCostData; ts: number } = { data: EMPTY_COST_DATA, ts: 0 };

/**
 * Scan all `.jsonl` session files and aggregate token usage by provider.
 * Results are cached for {@link COST_CACHE_TTL} ms.
 */
async function scanSessionCosts(): Promise<SessionCostData> {
  const now = Date.now();
  if (costCache.ts && now - costCache.ts < COST_CACHE_TTL) return costCache.data;

  const sessionDirs = await resolveSessionTranscriptDirs(config.sessionsDir);
  const result = await scanTranscriptUsageFromDirs(sessionDirs);
  costCache = { data: result, ts: now };
  return result;
}

// ── Route ────────────────────────────────────────────────────────────

app.get('/api/tokens', rateLimitGeneral, async (c) => {
  const costData = await scanSessionCosts();
  const persistent = await updateUsage(costData.totalInput, costData.totalOutput, costData.totalCost);

  return c.json({
    ...costData,
    persistent: {
      totalInput: persistent.totalInput,
      totalOutput: persistent.totalOutput,
      totalCost: persistent.totalCost,
      lastUpdated: persistent.lastUpdated,
    },
    updatedAt: Date.now(),
  });
});

export default app;
