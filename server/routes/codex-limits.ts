/**
 * GET /api/codex-limits — Codex (OpenAI) rate limit information.
 *
 * Fetches usage data from the OpenAI WHAM API using a locally-stored access
 * token (`~/.codex/auth.json`). Falls back to parsing the most recent local
 * `.jsonl` session files if the API is unreachable. Results are cached via
 * {@link createCachedFetch} (5 min TTL, 30 s on failure).
 * @module
 */

import { Hono } from 'hono';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CODEX_DIR } from '../lib/constants.js';
import { createCachedFetch } from '../lib/cached-fetch.js';

const app = new Hono();

// ── Types ────────────────────────────────────────────────────────────

interface LimitWindow {
  used_percent: number;
  left_percent: number;
  resets_at: number | null;
  resets_at_formatted: string | null;
}

interface Credits {
  has_credits: boolean;
  unlimited: boolean;
  balance: number | null;
}

interface RateLimits {
  five_hour_limit: LimitWindow;
  weekly_limit: LimitWindow;
  credits: Credits;
  plan_type: string | null;
}

interface CodexLimitsResponse {
  available: boolean;
  source?: string;
  error?: string;
  five_hour_limit?: LimitWindow;
  weekly_limit?: LimitWindow;
  credits?: Credits;
  plan_type?: string | null;
}

interface OpenAIUsageResponse {
  plan_type: string;
  rate_limit: {
    primary_window: { used_percent: number; reset_at: number };
    secondary_window: { used_percent: number; reset_at: number };
  };
  credits: { has_credits: boolean; unlimited: boolean; balance: string };
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatTime(epoch: number): string {
  return new Date(epoch * 1000).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDateTime(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    day: '2-digit',
    month: 'short',
  });
}

function buildLimitWindow(usedPercent: number, resetAt: number | null, includeDate = false): LimitWindow {
  return {
    used_percent: usedPercent,
    left_percent: 100 - usedPercent,
    resets_at: resetAt,
    resets_at_formatted: resetAt
      ? (includeDate ? formatDateTime(resetAt) : formatTime(resetAt))
      : null,
  };
}

// ── Access token ─────────────────────────────────────────────────────

async function getAccessToken(): Promise<string | null> {
  try {
    const authPath = path.join(os.homedir(), CODEX_DIR, 'auth.json');
    try {
      await fs.promises.access(authPath);
    } catch {
      return null;
    }
    const authData = JSON.parse(await fs.promises.readFile(authPath, 'utf-8'));
    return authData?.tokens?.access_token || null;
  } catch {
    return null;
  }
}

// ── API fetch ────────────────────────────────────────────────────────

async function fetchFromAPI(token: string): Promise<RateLimits | null> {
  try {
    const response = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error(`[codex-limits] API returned ${response.status}`);
      return null;
    }

    const data = (await response.json()) as OpenAIUsageResponse;
    const primary = data.rate_limit?.primary_window;
    const secondary = data.rate_limit?.secondary_window;

    return {
      five_hour_limit: buildLimitWindow(primary?.used_percent || 0, primary?.reset_at || null),
      weekly_limit: buildLimitWindow(secondary?.used_percent || 0, secondary?.reset_at || null, true),
      credits: {
        has_credits: data.credits?.has_credits || false,
        unlimited: data.credits?.unlimited || false,
        balance: data.credits?.balance ? parseFloat(data.credits.balance) : null,
      },
      plan_type: data.plan_type || null,
    };
  } catch (error) {
    console.error('[codex-limits] API fetch failed:', error);
    return null;
  }
}

// ── Local session fallback ───────────────────────────────────────────

async function parseLocalSessions(): Promise<RateLimits | null> {
  const codexDir = path.join(os.homedir(), CODEX_DIR, 'sessions');
  try {
    await fs.promises.access(codexDir);
  } catch {
    return null;
  }

  const sessionFiles: string[] = [];

  async function findJsonlFiles(dir: string) {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue; // skip symlinks to prevent escape
        const fullPath = path.join(dir, entry.name);
        const realPath = await fs.promises.realpath(fullPath);
        if (!realPath.startsWith(codexDir)) continue; // boundary check
        if (entry.isDirectory()) await findJsonlFiles(realPath);
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) sessionFiles.push(realPath);
      }
    } catch { /* ignore permission errors */ }
  }

  await findJsonlFiles(codexDir);

  // Sort by mtime async
  const fileStats = await Promise.all(
    sessionFiles.map(async (f) => ({ file: f, mtime: (await fs.promises.stat(f)).mtime.getTime() }))
  );
  fileStats.sort((a, b) => b.mtime - a.mtime);

  for (const { file: sessionFile } of fileStats.slice(0, 10)) {
    try {
      const lines = (await fs.promises.readFile(sessionFile, 'utf-8')).split('\n').filter(Boolean);

      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (
            entry.type !== 'event_msg' ||
            entry.payload?.type !== 'token_count' ||
            !entry.payload?.rate_limits
          ) continue;

          const rl = entry.payload.rate_limits;
          const primary = rl.primary || {};
          const secondary = rl.secondary || {};

          return {
            five_hour_limit: buildLimitWindow(primary.used_percent || 0, primary.resets_at || null),
            weekly_limit: buildLimitWindow(secondary.used_percent || 0, secondary.resets_at || null, true),
            credits: rl.credits || { has_credits: false, unlimited: false, balance: null },
            plan_type: rl.plan_type || null,
          };
        } catch { continue; }
      }
    } catch { continue; }
  }

  return null;
}

// ── Cached fetcher ───────────────────────────────────────────────────

async function getCodexLimits(): Promise<CodexLimitsResponse> {
  const token = await getAccessToken();
  if (token) {
    const apiLimits = await fetchFromAPI(token);
    if (apiLimits) return { available: true, source: 'api', ...apiLimits };
  }

  const localLimits = await parseLocalSessions();
  if (localLimits) return { available: true, source: 'local', ...localLimits };

  return { available: false, error: 'No Codex data found' };
}

const getCodexLimitsCached = createCachedFetch(getCodexLimits, undefined, {
  isValid: (r) => r.available,
});

// ── Route ────────────────────────────────────────────────────────────

app.get('/api/codex-limits', async (c) => {
  try {
    return c.json(await getCodexLimitsCached());
  } catch (error) {
    console.error('Error fetching Codex limits:', error);
    return c.json({ available: false, error: 'Failed to fetch Codex limits' }, 500);
  }
});

export default app;
