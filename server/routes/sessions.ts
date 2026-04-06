/**
 * Sessions API Routes
 *
 * GET  /api/sessions/:id/model        — Read the actual model used in a session from its transcript.
 * POST /api/sessions/spawn-subagent   — Server-side subagent spawn with lifecycle ownership.
 *
 * The gateway's sessions.list returns the agent default model, not the model
 * actually used in a cron-run session (where payload.model overrides it).
 * This endpoint reads the session transcript to find the real model.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { access, readdir, readFile } from 'node:fs/promises';
import { config } from '../lib/config.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import { spawnSubagent } from '../lib/subagent-spawn.js';

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

interface TranscriptImageContentBlock {
  type?: string;
  data?: string;
  mimeType?: string;
  source?: {
    data?: string;
    media_type?: string;
  };
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

async function loadSessionStore(): Promise<Record<string, StoredSessionSummary | undefined>> {
  const sessionsFile = join(config.sessionsDir, 'sessions.json');
  const raw = await readFile(sessionsFile, 'utf-8');
  return JSON.parse(raw) as Record<string, StoredSessionSummary | undefined>;
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

async function readImageBlockFromTranscript(
  filePath: string,
  messageTimestamp: number,
  imageIndex: number,
): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let resolved = false;

    const done = (result: { buffer: Buffer; mimeType: string; filename: string } | null) => {
      if (resolved) return;
      resolved = true;
      rl.close();
      stream.destroy();
      resolve(result);
    };

    rl.on('line', (line) => {
      if (resolved) return;
      try {
        const entry = JSON.parse(line) as {
          type?: string;
          message?: { timestamp?: number; content?: TranscriptImageContentBlock[] | unknown };
        };
        if (entry.type !== 'message') return;
        if ((entry.message?.timestamp ?? null) !== messageTimestamp) return;
        const content = Array.isArray(entry.message?.content)
          ? entry.message.content as TranscriptImageContentBlock[]
          : [];
        const imageBlocks = content.filter((block) => block?.type === 'image');
        const target = imageBlocks[imageIndex];
        if (!target) return done(null);
        const base64 = target.data || target.source?.data;
        const mimeType = target.mimeType || target.source?.media_type || 'application/octet-stream';
        if (!base64) return done(null);
        const ext = mimeType === 'image/jpeg' ? '.jpg'
          : mimeType === 'image/png' ? '.png'
          : mimeType === 'image/gif' ? '.gif'
          : mimeType === 'image/webp' ? '.webp'
          : '';
        return done({
          buffer: Buffer.from(base64, 'base64'),
          mimeType,
          filename: `message-${messageTimestamp}-image-${imageIndex}${ext}`,
        });
      } catch {
        // skip malformed lines
      }
    });

    rl.on('close', () => done(null));
    rl.on('error', () => done(null));
  });
}

app.get('/api/sessions/media', rateLimitGeneral, async (c) => {
  const sessionKey = c.req.query('sessionKey') || '';
  const timestampRaw = c.req.query('timestamp') || '';
  const imageIndexRaw = c.req.query('imageIndex') || '0';
  const messageTimestamp = Number(timestampRaw);
  const imageIndex = Number(imageIndexRaw);

  if (!sessionKey || !Number.isFinite(messageTimestamp) || !Number.isInteger(imageIndex) || imageIndex < 0) {
    return c.json({ ok: false, error: 'Invalid media lookup params' }, 400);
  }

  try {
    const store = await loadSessionStore();
    const sessionId = store[sessionKey]?.sessionId;
    if (!sessionId) return c.json({ ok: false, error: 'Unknown session key' }, 404);
    const transcriptPath = await findTranscript(sessionId);
    if (!transcriptPath) return c.json({ ok: false, error: 'Transcript not found' }, 404);
    const media = await readImageBlockFromTranscript(transcriptPath, messageTimestamp, imageIndex);
    if (!media) return c.json({ ok: false, error: 'Image not found' }, 404);
    return new Response(media.buffer, {
      headers: {
        'Content-Type': media.mimeType,
        'Content-Disposition': `inline; filename="${media.filename}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    console.warn('[sessions] media lookup failed:', (err as Error).message);
    return c.json({ ok: false, error: 'Failed to load media' }, 500);
  }
});

app.get('/api/sessions/hidden', rateLimitGeneral, async (c) => {
  const activeMinutesRaw = c.req.query('activeMinutes');
  const limitRaw = c.req.query('limit');

  const activeMinutes = Number.isFinite(Number(activeMinutesRaw)) && Number(activeMinutesRaw) > 0
    ? Number(activeMinutesRaw)
    : 24 * 60;
  const limit = Number.isFinite(Number(limitRaw)) && Number(limitRaw) > 0
    ? Math.min(Number(limitRaw), 2000)
    : 200;

  const cutoffMs = Date.now() - activeMinutes * 60_000;

  try {
    const store = await loadSessionStore();

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
    const errCode = (err as NodeJS.ErrnoException).code;
    const isRemote = errCode === 'ENOENT';
    console.debug('[sessions] hidden list failed:', (err as Error).message);
    return c.json({ ok: true, sessions: [], ...(isRemote ? { remoteWorkspace: true } : {}) });
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

// ── POST /api/sessions/spawn-subagent ────────────────────────────────

const spawnSubagentSchema = z.object({
  parentSessionKey: z
    .string()
    .min(1)
    .max(500)
    .regex(/^agent:[^:]+:main$/, 'parentSessionKey must be a top-level root session key (agent:<id>:main)'),
  task: z.string().min(1).max(50_000),
  label: z.string().max(500).optional(),
  model: z.string().max(200).optional(),
  thinking: z.string().max(20).optional(),
  cleanup: z.enum(['keep', 'delete']).default('keep'),
});

app.post('/api/sessions/spawn-subagent', rateLimitGeneral, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const parsed = spawnSubagentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    }, 400);
  }

  try {
    const result = await spawnSubagent({
      parentSessionKey: parsed.data.parentSessionKey,
      task: parsed.data.task,
      label: parsed.data.label,
      model: parsed.data.model,
      thinking: parsed.data.thinking,
      cleanup: parsed.data.cleanup,
    });

    return c.json({
      ok: true,
      sessionKey: result.sessionKey,
      ...(result.runId ? { runId: result.runId } : {}),
      mode: result.mode,
    }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sessions] spawn-subagent failed:', message);
    return c.json({ ok: false, error: message }, 500);
  }
});

export default app;
