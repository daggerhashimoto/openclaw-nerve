/**
 * GET /api/server-info — Server time and gateway uptime info.
 *
 * Returns `serverTime` (epoch ms), `gatewayStartedAt` (epoch ms), `timezone`,
 * and `agentName` so the frontend can show a real-time server clock and true
 * gateway uptime. Gateway start time is derived from `/proc` on Linux and
 * from `ps -o lstart` on platforms like macOS, then cached for 30 s.
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

async function execFileText(file: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile(file, args, { timeout: 2000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

const GATEWAY_COMM_PREFIX = 'openclaw-gatewa';

async function getGatewayPidFromPgrep(): Promise<string> {
  const stdout = await execFileText('pgrep', ['-f', GATEWAY_COMM_PREFIX]);
  return stdout.split('\n')[0] || '';
}

async function getGatewayPidFromPs(): Promise<string> {
  const stdout = await execFileText('ps', ['-axo', 'pid=,comm=']);
  for (const line of stdout.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const [, pid, comm] = match;
    if (comm === 'openclaw-gateway' || comm.startsWith(GATEWAY_COMM_PREFIX)) return pid;
  }
  return '';
}

async function getGatewayPid(): Promise<string> {
  if (isLinux) {
    try {
      const pid = await getGatewayPidFromPgrep();
      if (pid) return pid;
    } catch {
      // Fall through to ps-based lookup below.
    }
  }

  return await getGatewayPidFromPs();
}

async function getGatewayStartedAtLinux(pidStr: string): Promise<number | null> {
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
  return Math.round(startSecs * 1000);
}

async function getGatewayStartedAtPs(pidStr: string): Promise<number | null> {
  const lstart = await execFileText('ps', ['-p', pidStr, '-o', 'lstart=']);
  if (!lstart) return null;
  const startedAt = new Date(lstart).getTime();
  return Number.isFinite(startedAt) ? startedAt : null;
}

/**
 * Determine when the OpenClaw gateway process started.
 *
 * Uses `pgrep` to find the gateway PID, then reads `/proc/<pid>/stat` on
 * Linux or `ps -p <pid> -o lstart=` elsewhere. Result is cached for 30 s.
 *
 * @returns Epoch ms of gateway start, or `null` if not running / unavailable.
 */
async function getGatewayStartedAt(): Promise<number | null> {
  const now = Date.now();
  if (gatewayStartedAtCache && now - cacheTs < CACHE_TTL) return gatewayStartedAtCache;

  try {
    const pidStr = await getGatewayPid();
    if (!pidStr) return null;

    const startedAt = isLinux
      ? await getGatewayStartedAtLinux(pidStr)
      : await getGatewayStartedAtPs(pidStr);

    if (startedAt !== null) {
      gatewayStartedAtCache = startedAt;
      cacheTs = now;
    }
    return startedAt;
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
