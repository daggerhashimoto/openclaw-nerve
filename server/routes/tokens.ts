/**
 * GET /api/tokens — Token usage statistics with persistent tracking.
 *
 * Scans `.jsonl` session transcript files in the sessions directory for
 * accumulated cost and token data, aggregated by provider. Results are
 * cached for 60 s and also persisted via the usage tracker (high-water mark).
 * @module
 */

import { Hono } from 'hono';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createReadStream } from 'node:fs';
import { updateUsage } from '../lib/usage-tracker.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import { config } from '../lib/config.js';

const app = new Hono();

// ── Types ────────────────────────────────────────────────────────────

interface ProviderStats {
  cost: number;
  messages: number;
  input: number;
  output: number;
  cacheRead: number;
  errors: number;
}

interface SessionCostData {
  totalCost: number;
  totalInput: number;
  totalOutput: number;
  totalMessages: number;
  entries: Array<{
    source: string;
    cost: number;
    messageCount: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    errorCount: number;
  }>;
}

// ── Session cost scanning (cached 60s) ───────────────────────────────

const EMPTY_COST_DATA: SessionCostData = { totalCost: 0, totalInput: 0, totalOutput: 0, totalMessages: 0, entries: [] };
const COST_CACHE_TTL = 60_000;
let costCache: { data: SessionCostData; ts: number } = { data: EMPTY_COST_DATA, ts: 0 };

function newProviderStats(): ProviderStats {
  return { cost: 0, messages: 0, input: 0, output: 0, cacheRead: 0, errors: 0 };
}

/**
 * Scan all `.jsonl` session files and aggregate token usage by provider.
 * Results are cached for {@link COST_CACHE_TTL} ms.
 */
async function scanSessionCosts(): Promise<SessionCostData> {
  const now = Date.now();
  if (costCache.ts && now - costCache.ts < COST_CACHE_TTL) return costCache.data;

  const costByProvider: Record<string, ProviderStats> = {};
  let totalCost = 0, totalInput = 0, totalOutput = 0, totalMessages = 0;

  try {
    const files = (await fs.readdir(config.sessionsDir)).filter((f) => f.endsWith('.jsonl'));

    for (const file of files) {
      try {
        const filePath = path.join(config.sessionsDir, file);
        const realPath = await fs.realpath(filePath);
        const sessionsRealDir = await fs.realpath(config.sessionsDir);
        if (!realPath.startsWith(sessionsRealDir + path.sep) && realPath !== sessionsRealDir) continue;

        const rl = readline.createInterface({
          input: createReadStream(realPath),
          crlfDelay: Infinity,
        });

        for await (const line of rl) {
          try {
            const entry = JSON.parse(line);

            if (entry.type === 'error') {
              const provider = entry.provider || entry.message?.provider || 'unknown';
              (costByProvider[provider] ??= newProviderStats()).errors++;
              continue;
            }

            if (entry.type !== 'message') continue;
            const msg = entry.message;
            if (!msg?.usage || !msg.provider || msg.provider === 'openclaw') continue;

            const { usage, provider = 'unknown' } = msg;
            const cost = usage.cost?.total || 0;
            const input = usage.input || 0;
            const output = usage.output || 0;
            const cacheRead = usage.cacheRead || usage.cache_read || 0;

            totalCost += cost;
            totalInput += input;
            totalOutput += output;
            totalMessages++;

            const stats = costByProvider[provider] ??= newProviderStats();
            stats.cost += cost;
            stats.messages++;
            stats.input += input;
            stats.output += output;
            stats.cacheRead += cacheRead;
          } catch { /* skip malformed lines */ }
        }
      } catch { /* skip unreadable files */ }
    }
  } catch { /* sessions dir might not exist yet */ }

  const round4 = (n: number) => Math.round(n * 10000) / 10000;

  const entries = Object.entries(costByProvider)
    .map(([source, d]) => ({
      source,
      cost: round4(d.cost),
      messageCount: d.messages,
      inputTokens: d.input,
      outputTokens: d.output,
      cacheReadTokens: d.cacheRead,
      errorCount: d.errors,
    }))
    .sort((a, b) => b.cost - a.cost);

  const result: SessionCostData = {
    totalCost: round4(totalCost),
    totalInput,
    totalOutput,
    totalMessages,
    entries,
  };

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
