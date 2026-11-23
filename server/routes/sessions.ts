/**
 * Sessions API Routes
 *
 * GET  /api/sessions/:id/model        — Read runtime defaults used in a session from its transcript.
 * POST /api/sessions/spawn-subagent   — Server-side subagent spawn with lifecycle ownership.
 *
 * The gateway's sessions.list can omit the actual model/thinking bootstrapped into
 * a session, especially after reloads. This endpoint reads the session transcript
 * to recover the model and initial thinking level.
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
import { normalizeAgentId } from '../lib/agent-workspace.js';
import { gatewayRpcCall } from '../lib/gateway-rpc.js';
import { ALLOWED_IMAGE_TYPES } from './chat-media.js';

const app = new Hono();
const CRON_SESSION_RE = /^agent:[^:]+:cron:[^:]+(?::run:.+)?$/;

/** The id current OpenClaw puts on an image block chat.history omitted: a prefix and a base64url reference. */
const TRANSCRIPT_IMAGE_ARTIFACT_RE = /^artifact_transcript_image_[A-Za-z0-9_-]+$/;
/** The gateway refuses longer ids. */
const MAX_ARTIFACT_ID_LENGTH = 8192;
const ARTIFACT_DOWNLOAD_TIMEOUT_MS = 30_000;
/** Gateway errors that mean the image is gone, not that the gateway failed. */
const ARTIFACT_MISSING_ERRORS = new Set([
  'artifact not found',
  'no session found for artifact query',
  'artifact download is unsupported',
]);
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
};

/** Image bytes and the MIME type their source recorded, not yet checked against the allowlist. */
interface SessionImage {
  buffer: Buffer;
  mimeType: string;
}

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

async function loadSessionStoreFromDir(sessionsDir: string): Promise<Record<string, StoredSessionSummary | undefined>> {
  const sessionsFile = join(sessionsDir, 'sessions.json');
  const raw = await readFile(sessionsFile, 'utf-8');
  return JSON.parse(raw) as Record<string, StoredSessionSummary | undefined>;
}

async function loadSessionStore(): Promise<Record<string, StoredSessionSummary | undefined>> {
  return loadSessionStoreFromDir(config.sessionsDir);
}

function getAgentIdFromSessionKey(sessionKey: string): string {
  const match = sessionKey.match(/^agent:([^:]+):/);
  return match?.[1] || 'main';
}

function resolveSessionsDir(agentId?: string): string {
  const normalized = normalizeAgentId(agentId);
  if (normalized === 'main') return config.sessionsDir;
  return join(config.home, '.openclaw', 'agents', normalized, 'sessions');
}

/** Resolve the transcript path for a session ID, checking both active and deleted files. */
async function findTranscript(sessionId: string, sessionsDir = config.sessionsDir): Promise<string | null> {
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

/** Read the first N lines of a JSONL file to recover runtime defaults near the top. */
async function readRuntimeFromTranscript(filePath: string): Promise<{ model: string | null; thinking: string | null }> {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let lineCount = 0;
    let resolved = false;
    let model: string | null = null;
    let thinking: string | null = null;

    const done = () => {
      if (resolved) return;
      resolved = true;
      rl.close();
      stream.destroy();
      resolve({ model, thinking });
    };

    rl.on('line', (line) => {
      if (resolved) return;
      lineCount++;
      try {
        const entry = JSON.parse(line);
        if (!model && entry.type === 'model_change' && entry.modelId) {
          model = String(entry.modelId);
        }
        if (!thinking && entry.type === 'thinking_level_change' && entry.thinkingLevel) {
          thinking = String(entry.thinkingLevel).toLowerCase();
        }
        if (model && thinking) {
          done();
          return;
        }
      } catch { /* skip malformed lines */ }

      // Runtime defaults are emitted near the top when present.
      if (lineCount >= 20) {
        done();
      }
    });

    rl.on('close', () => done());
    rl.on('error', () => done());
    stream.on('error', () => done());
  });
}

async function readImageBlockFromTranscript(
  filePath: string,
  messageTimestamp: number,
  imageIndex: number,
): Promise<SessionImage | null> {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let resolved = false;

    const done = (result: SessionImage | null) => {
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
        if (!base64) return done(null);
        return done({
          buffer: Buffer.from(base64, 'base64'),
          mimeType: target.mimeType || target.source?.media_type || '',
        });
      } catch {
        // skip malformed lines
      }
    });

    rl.on('close', () => done(null));
    rl.on('error', () => done(null));
  });
}

/** An omitted image from current OpenClaw, by its artifact id; null when the gateway sends no inline bytes. */
async function downloadTranscriptImageArtifact(sessionKey: string, artifactId: string): Promise<SessionImage | null> {
  const result = await gatewayRpcCall(
    'artifacts.download',
    { sessionKey, artifactId },
    ARTIFACT_DOWNLOAD_TIMEOUT_MS,
  ) as { artifact?: { mimeType?: unknown }; encoding?: unknown; data?: unknown } | null;
  if (result?.encoding !== 'base64' || typeof result.data !== 'string') return null;
  return {
    buffer: Buffer.from(result.data, 'base64'),
    mimeType: typeof result.artifact?.mimeType === 'string' ? result.artifact.mimeType : '',
  };
}

app.get('/api/sessions/media', rateLimitGeneral, async (c) => {
  const sessionKey = c.req.query('sessionKey') || '';
  const timestampRaw = c.req.query('timestamp') || '';
  const imageIndexRaw = c.req.query('imageIndex') || '0';
  const artifactId = c.req.query('artifactId');
  const messageTimestamp = Number(timestampRaw);
  const imageIndex = Number(imageIndexRaw);

  if (!sessionKey || !Number.isFinite(messageTimestamp) || !Number.isInteger(imageIndex) || imageIndex < 0) {
    return c.json({ ok: false, error: 'Invalid media lookup params' }, 400);
  }
  if (artifactId !== undefined
    && (artifactId.length > MAX_ARTIFACT_ID_LENGTH || !TRANSCRIPT_IMAGE_ARTIFACT_RE.test(artifactId))) {
    return c.json({ ok: false, error: 'Invalid media lookup params' }, 400);
  }

  let media: SessionImage | null;
  if (artifactId) {
    // Current OpenClaw keeps transcripts in a database; the gateway returns the image by its id.
    try {
      media = await downloadTranscriptImageArtifact(sessionKey, artifactId);
    } catch (err) {
      const message = (err as Error).message;
      if (ARTIFACT_MISSING_ERRORS.has(message)) return c.json({ ok: false, error: 'Image not found' }, 404);
      console.warn('[sessions] gateway media lookup failed:', message);
      return c.json({ ok: false, error: 'Gateway unavailable' }, 502);
    }
  } else {
    // Older OpenClaw: sessions.json maps the key to a JSONL transcript that still holds the bytes.
    let store: Record<string, StoredSessionSummary | undefined>;
    try {
      store = await loadSessionStore();
    } catch (err) {
      // No sessions.json is a miss, not a failure: current OpenClaw writes none.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return c.json({ ok: false, error: 'Unknown session key' }, 404);
      }
      console.warn('[sessions] media lookup failed:', (err as Error).message);
      return c.json({ ok: false, error: 'Failed to load media' }, 500);
    }
    const sessionId = store[sessionKey]?.sessionId;
    if (!sessionId) return c.json({ ok: false, error: 'Unknown session key' }, 404);
    const transcriptPath = await findTranscript(sessionId);
    if (!transcriptPath) return c.json({ ok: false, error: 'Transcript not found' }, 404);
    media = await readImageBlockFromTranscript(transcriptPath, messageTimestamp, imageIndex);
  }
  if (!media) return c.json({ ok: false, error: 'Image not found' }, 404);

  // Only raster images: whatever type a transcript records, Nerve never serves SVG or HTML from its origin.
  const mimeType = media.mimeType.split(';')[0].trim().toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    return c.json({ ok: false, error: 'Not a supported image type' }, 415);
  }
  return new Response(media.buffer, {
    headers: {
      'Content-Type': mimeType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="message-${messageTimestamp}-image-${imageIndex}${IMAGE_EXTENSIONS[mimeType] ?? ''}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
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
    // No sessions.json is the normal case, not a failure: current OpenClaw keeps sessions in a
    // database and already lists cron sessions in sessions.list (as does a remote gateway, whose
    // store is not on this machine). storeMissing tells the client to stop asking.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return c.json({ ok: true, sessions: [], storeMissing: true, remoteWorkspace: true });
    }
    console.debug('[sessions] hidden list failed:', (err as Error).message);
    return c.json({ ok: true, sessions: [] });
  }
});

app.get('/api/sessions/runtime', rateLimitGeneral, async (c) => {
  const sessionKey = c.req.query('sessionKey')?.trim() || '';
  if (!sessionKey) {
    return c.json({ ok: false, error: 'sessionKey is required' }, 400);
  }

  const sessionsDir = resolveSessionsDir(getAgentIdFromSessionKey(sessionKey));
  const store = await loadSessionStoreFromDir(sessionsDir).catch(() => ({} as Record<string, StoredSessionSummary | undefined>));
  const session = store[sessionKey];
  const storeThinking = session?.thinkingLevel || session?.thinking;
  const info: { model: string | null; thinking: string | null; missing: boolean } = {
    model: session?.model || null,
    thinking: storeThinking ? String(storeThinking).toLowerCase() : null,
    missing: false,
  };

  const sessionId = session?.sessionId;
  if (!sessionId || !/^[0-9a-f-]{36}$/.test(sessionId)) {
    return c.json({ ok: true, ...info, missing: true });
  }

  const transcriptPath = await findTranscript(sessionId, sessionsDir);
  if (!transcriptPath) {
    return c.json({ ok: true, ...info, missing: true });
  }

  const runtime = await readRuntimeFromTranscript(transcriptPath);
  return c.json({
    ok: true,
    model: runtime.model ?? info.model,
    thinking: runtime.thinking ?? info.thinking,
    missing: false,
  });
});

app.get('/api/sessions/:id/model', rateLimitGeneral, async (c) => {
  const sessionId = c.req.param('id');
  const agentId = c.req.query('agentId')?.trim() || 'main';

  // Basic validation — session IDs are UUIDs
  if (!/^[0-9a-f-]{36}$/.test(sessionId)) {
    return c.json({ ok: false, error: 'Invalid session ID' }, 400);
  }

  const transcriptPath = await findTranscript(sessionId, resolveSessionsDir(agentId));
  if (!transcriptPath) {
    // Avoid 404 noise in the UI when hovering sessions that no longer have transcripts
    // (e.g. one-shot cron runs that were cleaned up).
    return c.json({ ok: true, model: null, thinking: null, missing: true }, 200);
  }

  const runtime = await readRuntimeFromTranscript(transcriptPath);
  return c.json({ ok: true, model: runtime.model, thinking: runtime.thinking, missing: false });
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
