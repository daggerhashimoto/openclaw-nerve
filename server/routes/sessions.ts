/**
 * Sessions API Routes
 *
 * GET /api/sessions/:id/model — Read the actual model used in a session from its transcript.
 *
 * The gateway's sessions.list returns the agent default model, not the model
 * actually used in a cron-run session (where payload.model overrides it).
 * This endpoint reads the session transcript to find the real model.
 */

import { Hono } from 'hono';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { access, readdir, readFile } from 'node:fs/promises';
import { config } from '../lib/config.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const app = new Hono();
const CRON_SESSION_RE = /^agent:[^:]+:cron:[^:]+(?::run:.+)?$/;

interface StoredSessionSummary {
  sessionId?: string;
  label?: string;
  displayName?: string;
  updatedAt?: number;
  model?: string;
  thinking?: string;
  thinkingLevel?: string;
  totalTokens?: number;
  contextTokens?: number;
}

function isCronLikeSessionKey(sessionKey: string): boolean {
  return CRON_SESSION_RE.test(sessionKey);
}

function inferParentSessionKey(sessionKey: string): string | null {
  const cronRunMatch = sessionKey.match(/^(.+:cron:[^:]+):run:.+$/);
  if (cronRunMatch) return cronRunMatch[1];

  const cronMatch = sessionKey.match(/^((?:agent:[^:]+)):cron:[^:]+$/);
  if (cronMatch) return `${cronMatch[1]}:main`;

  return null;
}

/** Resolve the transcript path for a session ID, checking both active and deleted files. */
async function findTranscript(sessionId: string): Promise<string | null> {
  const sessionsDir = config.sessionsDir;
  const activePath = join(sessionsDir, `${sessionId}.jsonl`);

  try {
    await access(activePath);
    return activePath;
  } catch {
    // Check for deleted transcripts (one-shot cron runs get cleaned up)
    try {
      const files = await readdir(sessionsDir);
      const deleted = files.find(f => f.startsWith(`${sessionId}.jsonl.deleted`));
      if (deleted) return join(sessionsDir, deleted);
    } catch { /* dir doesn't exist */ }
    return null;
  }
}

/** Read the first N lines of a JSONL file to find a model_change entry. */
async function readModelFromTranscript(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let lineCount = 0;
    let resolved = false;

    const done = (result: string | null) => {
      if (resolved) return;
      resolved = true;
      rl.close();
      stream.destroy();
      resolve(result);
    };

    rl.on('line', (line) => {
      if (resolved) return;
      lineCount++;
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'model_change' && entry.modelId) {
          done(entry.modelId);
          return;
        }
      } catch { /* skip malformed lines */ }

      // Only check first 10 lines — model_change is always near the top
      if (lineCount >= 10) {
        done(null);
      }
    });

    rl.on('close', () => done(null));
    rl.on('error', () => done(null));
  });
}

app.get('/api/sessions/hidden', rateLimitGeneral, async (c) => {
  const activeMinutesRaw = c.req.query('activeMinutes');
  const limitRaw = c.req.query('limit');

  const activeMinutes = Number.isFinite(Number(activeMinutesRaw)) && Number(activeMinutesRaw) > 0
    ? Number(activeMinutesRaw)
    : 24 * 60;
  const limit = Number.isFinite(Number(limitRaw)) && Number(limitRaw) > 0
    ? Math.min(Number(limitRaw), 2000)
    : 200;

  const sessionsFile = join(config.sessionsDir, 'sessions.json');
  const cutoffMs = Date.now() - activeMinutes * 60_000;

  try {
    const raw = await readFile(sessionsFile, 'utf-8');
    const store = JSON.parse(raw) as Record<string, StoredSessionSummary | undefined>;

    const sessions = Object.entries(store)
      .filter(([sessionKey, session]) => {
        if (!isCronLikeSessionKey(sessionKey) || !session) return false;
        const updatedAt = typeof session.updatedAt === 'number' ? session.updatedAt : 0;
        return updatedAt >= cutoffMs;
      })
      .sort(([, a], [, b]) => {
        const updatedA = typeof a?.updatedAt === 'number' ? a.updatedAt : 0;
        const updatedB = typeof b?.updatedAt === 'number' ? b.updatedAt : 0;
        return updatedB - updatedA;
      })
      .slice(0, limit)
      .map(([sessionKey, session]) => ({
        key: sessionKey,
        sessionKey,
        id: session?.sessionId,
        label: session?.label,
        displayName: session?.displayName || session?.label,
        updatedAt: session?.updatedAt,
        model: session?.model,
        thinking: session?.thinking,
        thinkingLevel: session?.thinkingLevel,
        totalTokens: session?.totalTokens,
        contextTokens: session?.contextTokens,
        parentId: inferParentSessionKey(sessionKey),
      }));

    return c.json({ ok: true, sessions });
  } catch (err) {
    console.debug('[sessions] hidden list failed:', (err as Error).message);
    return c.json({ ok: true, sessions: [] });
  }
});

app.get('/api/sessions/:id/model', rateLimitGeneral, async (c) => {
  const sessionId = c.req.param('id');

  // Basic validation — session IDs are UUIDs
  if (!/^[0-9a-f-]{36}$/.test(sessionId)) {
    return c.json({ ok: false, error: 'Invalid session ID' }, 400);
  }

  const transcriptPath = await findTranscript(sessionId);
  if (!transcriptPath) {
    // Avoid 404 noise in the UI when hovering sessions that no longer have transcripts
    // (e.g. one-shot cron runs that were cleaned up).
    return c.json({ ok: true, model: null, missing: true }, 200);
  }

  const modelId = await readModelFromTranscript(transcriptPath);
  return c.json({ ok: true, model: modelId, missing: false });
});

export default app;
