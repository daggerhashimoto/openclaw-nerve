/**
 * Work reports pushed by other machines.
 *
 * POST /api/work/reports          — append a report (reporter bearer token)
 * GET  /api/work/reports          — read reports (session cookie or token)
 * GET  /api/work/reports/summary  — aggregate for a daily brief
 * GET  /api/work/ping             — reporter handshake (token configured?)
 * GET  /install/mac-reporter.sh   — installer served to a new machine
 * GET  /install/nerve-report.mjs  — CLI served to a new machine
 *
 * The reporter cannot use the browser's session cookie, so these routes
 * authenticate in-route instead of relying on the cookie middleware: a
 * constant-time bearer token for machine calls, and the normal signed session
 * cookie for the UI. `authMiddleware` exempts this path on purpose; every
 * handler below checks its own caller.
 * @module
 */

import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { config, SESSION_COOKIE_NAME } from '../lib/config.js';
import { verifySession } from '../lib/session.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import {
  appendWorkReport,
  readWorkReports,
  summarizeWorkReports,
  type WorkReport,
} from '../lib/work-reports.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTER_DIR = path.resolve(__dirname, '../../scripts/mac-reporter');

const app = new Hono();

const observedSchema = z.object({
  kind: z.enum(['test', 'build', 'lint', 'commit', 'push', 'pr', 'merge', 'other']),
  text: z.string().min(1).max(300),
  ok: z.boolean().optional(),
  at: z.string().max(40).optional(),
});

const reportSchema = z.object({
  id: z.string().min(8).max(100),
  at: z.string().max(40),
  workstream: z.string().min(1).max(64),
  agent: z.object({
    kind: z.string().min(1).max(40),
    sessionId: z.string().max(200).optional(),
    model: z.string().max(120).optional(),
  }),
  repo: z.object({
    path: z.string().min(1).max(500),
    remote: z.string().max(500).optional(),
    branch: z.string().max(200),
    commit: z.string().max(80),
    commitSubject: z.string().max(300).optional(),
    dirty: z.boolean(),
    changedFiles: z.number().int().min(0).max(100_000),
    ahead: z.number().int().min(0).max(100_000).optional(),
    behind: z.number().int().min(0).max(100_000).optional(),
    upstream: z.string().max(200).optional(),
  }).optional(),
  outcome: z.object({
    summary: z.string().max(1000).optional(),
    claims: z.array(z.string().max(300)).max(20).optional(),
    status: z.enum(['completed', 'partial', 'blocked', 'aborted']),
  }).optional(),
  observed: z.array(observedSchema).max(50).optional(),
  links: z.object({
    pr: z.string().max(500).optional(),
    commit: z.string().max(500).optional(),
    issue: z.string().max(500).optional(),
  }).optional(),
  meta: z.object({
    hostname: z.string().max(200).optional(),
    reporterVersion: z.string().max(40).optional(),
    queuedAt: z.string().max(40).optional(),
  }).optional(),
});

/** Constant-time comparison that does not leak length. */
function tokensMatch(candidate: string): boolean {
  const expected = config.reporterToken;
  if (!expected || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearer(c: Context): string {
  const header = c.req.header('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? '';
}

/** Machine token, or the browser's signed session when auth is on. */
function canRead(c: Context): boolean {
  if (tokensMatch(bearer(c))) return true;
  if (!config.auth) return true;
  const token = getCookie(c, SESSION_COOKIE_NAME);
  return Boolean(token && verifySession(token, config.sessionSecret));
}

function parseSince(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms);
}

/** POST /api/work/reports — append one report. */
app.post(
  '/api/work/reports',
  rateLimitGeneral,
  zValidator('json', reportSchema, (result, c) => {
    if (!result.success) {
      return c.json({ ok: false, error: result.error.issues[0]?.message ?? 'Invalid report' }, 400);
    }
  }),
  async (c) => {
    if (!config.reporterToken) {
      return c.json({ ok: false, error: 'Reporter is not configured on this server' }, 503);
    }
    if (!tokensMatch(bearer(c))) {
      return c.json({ ok: false, error: 'Invalid reporter token' }, 401);
    }

    const report = c.req.valid('json') as WorkReport;
    if (Number.isNaN(Date.parse(report.at))) {
      return c.json({ ok: false, error: 'Invalid report time' }, 400);
    }

    try {
      const result = await appendWorkReport(config.workReportsDir, report);
      return c.json({ ok: true, id: report.id, duplicate: result.duplicate, storedAt: result.storedAt }, result.duplicate ? 200 : 201);
    } catch (err) {
      console.error('[work-reports] append failed:', (err as Error).message);
      return c.json({ ok: false, error: 'Could not store the report' }, 500);
    }
  },
);

/** GET /api/work/reports — newest first, bounded. */
app.get('/api/work/reports', rateLimitGeneral, async (c) => {
  if (!canRead(c)) return c.json({ ok: false, error: 'Authentication required' }, 401);

  const limitRaw = Number(c.req.query('limit') ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 500) : 100;

  try {
    const reports = await readWorkReports(config.workReportsDir, {
      since: parseSince(c.req.query('since')),
      until: parseSince(c.req.query('until')),
      workstream: c.req.query('workstream') || undefined,
      limit,
    });
    return c.json({ ok: true, count: reports.length, reports });
  } catch (err) {
    console.error('[work-reports] read failed:', (err as Error).message);
    return c.json({ ok: false, error: 'Could not read reports' }, 500);
  }
});

/** GET /api/work/reports/summary — aggregate for a daily brief. */
app.get('/api/work/reports/summary', rateLimitGeneral, async (c) => {
  if (!canRead(c)) return c.json({ ok: false, error: 'Authentication required' }, 401);

  const since = parseSince(c.req.query('since')) ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const until = parseSince(c.req.query('until'));

  try {
    const reports = await readWorkReports(config.workReportsDir, {
      since,
      until,
      workstream: c.req.query('workstream') || undefined,
    });
    const summary = summarizeWorkReports(reports);
    return c.json({ ok: true, since: since.toISOString(), until: (until ?? new Date()).toISOString(), ...summary, reports: summary.reports.slice(0, 50) });
  } catch (err) {
    console.error('[work-reports] summary failed:', (err as Error).message);
    return c.json({ ok: false, error: 'Could not summarize reports' }, 500);
  }
});

/** GET /api/work/ping — does this server accept the token we hold? */
app.get('/api/work/ping', rateLimitGeneral, (c) => {
  if (!tokensMatch(bearer(c))) return c.json({ ok: false, error: 'Invalid reporter token' }, 401);
  return c.json({ ok: true, configured: Boolean(config.reporterToken) });
});

/** Serve the installer and CLI so a new machine needs one command. */
async function serveReporterFile(c: Context, fileName: string, contentType: string) {
  try {
    const body = await fs.readFile(path.join(REPORTER_DIR, fileName), 'utf8');
    return c.body(body, 200, {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    });
  } catch {
    return c.text('Not found', 404);
  }
}

app.get('/install/mac-reporter.sh', async (c) => serveReporterFile(c, 'install.sh', 'text/x-shellscript; charset=utf-8'));
app.get('/install/nerve-report.mjs', async (c) => serveReporterFile(c, 'nerve-report.mjs', 'text/javascript; charset=utf-8'));

export default app;
