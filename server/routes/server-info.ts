/**
 * GET /api/server-info — Server time and gateway uptime info.
 *
 * Returns `serverTime` (epoch ms), `gatewayStartedAt` (epoch ms), `timezone`,
 * and `agentName` so the frontend can show a real-time server clock and true
 * gateway uptime. Gateway start time is derived from `/proc` on Linux and
 * cached for 30 s.
 * @module
 */

import { Hono } from 'hono';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { config } from '../lib/config.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const app = new Hono();

const isLinux = os.platform() === 'linux';

/** Tick rate on Linux — SC_CLK_TCK is virtually always 100 */
const CLK_TCK = 100;

// Cache gateway start time (only changes on restart)
let gatewayStartedAtCache: number | null = null;
let cacheTs = 0;
const CACHE_TTL = 30_000;

/**
 * Determine when the OpenClaw gateway process started (Linux only).
 *
 * Uses `pgrep` to find the gateway PID, then reads `/proc/<pid>/stat`
 * to extract the start time in clock ticks, converting to epoch ms
 * via the system boot time from `/proc/stat`. Result is cached for 30 s.
 *
 * @returns Epoch ms of gateway start, or `null` on non-Linux / if not running.
 */
async function getGatewayStartedAt(): Promise<number | null> {
  if (!isLinux) return null; // /proc and pgrep are Linux-only

  const now = Date.now();
  if (gatewayStartedAtCache && now - cacheTs < CACHE_TTL) return gatewayStartedAtCache;

  try {
    const pidStr = await new Promise<string>((resolve, reject) => {
      execFile('pgrep', ['-x', 'openclaw-gateway', '-o'], { timeout: 2000 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout.trim().split('\n')[0] || '');
      });
    });
    if (!pidStr) return null;

    const stat = await fs.promises.readFile(`/proc/${pidStr}/stat`, 'utf8');
    // Parse starttime (field 22, 0-indexed 21) after the comm field.
    // comm can contain spaces/parens, so find the last ')' first.
    const afterComm = stat.slice(stat.lastIndexOf(')') + 2);
    const startTimeTicks = parseInt(afterComm.split(' ')[19], 10); // field 22 = index 19 after pid+comm

    const procStat = await fs.promises.readFile('/proc/stat', 'utf8');
    const btimeLine = procStat.split('\n').find((l) => l.startsWith('btime'));
    if (!btimeLine) return null;
    const btime = parseInt(btimeLine.split(' ')[1], 10);

    const startSecs = btime + startTimeTicks / CLK_TCK;
    gatewayStartedAtCache = Math.round(startSecs * 1000);
    cacheTs = now;
    return gatewayStartedAtCache;
  } catch {
    return gatewayStartedAtCache; // return stale if available
  }
}

app.get('/api/server-info', rateLimitGeneral, async (c) => {
  return c.json({
    serverTime: Date.now(),
    gatewayStartedAt: await getGatewayStartedAt(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    agentName: config.agentName,
  });
});

export default app;
