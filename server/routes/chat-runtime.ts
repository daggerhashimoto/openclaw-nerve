import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { gatewayRpcCall } from '../lib/gateway-rpc.js';
import { getChatRuntime } from '../lib/chat-runtime/singleton.js';
import type { TimelinePatch, TimelineSnapshot } from '../lib/chat-runtime/types.js';

const app = new Hono();

const PING_INTERVAL_MS = 30_000;

type CatchupBaseline =
  | { kind: 'patches'; patches: TimelinePatch[]; coveredCursor?: string }
  | { kind: 'snapshot'; snapshot: TimelineSnapshot; coveredCursor: string };

const nonBlankString = (field: string) => z
  .string()
  .refine((value) => value.trim().length > 0, `${field} must be a non-empty string`);

const sendMessageSchema = z.object({
  text: nonBlankString('text'),
  idempotencyKey: nonBlankString('idempotencyKey'),
});

app.get('/api/chat-runtime/stream', async (c) => {
  const sessionKey = c.req.query('sessionKey')?.trim() ?? '';
  if (!sessionKey) {
    return c.json({ ok: false, error: 'sessionKey is required' }, 400);
  }

  const cursor = normalizeCursor(c.req.query('cursor'));
  const runtime = getChatRuntime();

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');
  c.header('X-Accel-Buffering', 'no');

  return streamSSE(c, async (stream) => {
    let connected = true;
    let unsubscribe: (() => void) | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let resolveDisconnect: (() => void) | undefined;
    let writeQueue = Promise.resolve();

    const disconnect = () => {
      if (!connected) return;
      connected = false;
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = undefined;
      unsubscribe?.();
      unsubscribe = undefined;
      resolveDisconnect?.();
    };

    const writeJsonEvent = async (event: string, data: unknown) => {
      if (!connected) return;

      try {
        await stream.writeSSE({ event, data: JSON.stringify(data) });
        if (stream.aborted) disconnect();
      } catch {
        disconnect();
      }
    };

    const enqueueJsonEvent = (event: string, data: unknown) => {
      writeQueue = writeQueue
        .then(() => writeJsonEvent(event, data))
        .catch(() => {
          disconnect();
        });
    };

    stream.onAbort(disconnect);

    try {
      try {
        await runtime.hydrateSession(sessionKey);
      } catch (err) {
        await writeJsonEvent('error', {
          type: 'error',
          sessionKey,
          error: errorMessage(err),
          ts: Date.now(),
        });
        return;
      }

      if (!connected) return;

      const queuedLivePatches: TimelinePatch[] = [];
      let forwardLivePatches = false;

      unsubscribe = runtime.subscribe(sessionKey, (patch) => {
        if (forwardLivePatches) {
          enqueueJsonEvent('patch', patch);
          return;
        }

        queuedLivePatches.push(patch);
      });

      const replay = runtime.replayAfter(sessionKey, cursor);
      const catchupBaseline: CatchupBaseline = replay.kind === 'patches'
        ? {
          kind: 'patches',
          patches: replay.patches,
          coveredCursor: latestReplayCursor(replay.patches) ?? cursor ?? undefined,
        }
        : snapshotBaseline(runtime.snapshot(sessionKey, 'cursor_expired'));

      await writeJsonEvent('connected', {
        type: 'connected',
        sessionKey,
        ts: Date.now(),
      });

      if (catchupBaseline.kind === 'patches') {
        for (const patch of catchupBaseline.patches) {
          await writeJsonEvent('patch', patch);
          if (!connected) return;
        }
      } else {
        await writeJsonEvent('snapshot', catchupBaseline.snapshot);
      }

      if (!connected) return;

      while (queuedLivePatches.length > 0) {
        const patch = queuedLivePatches.shift();
        if (!patch) continue;
        if (isPatchCoveredByBaseline(patch, catchupBaseline.coveredCursor)) continue;
        await writeJsonEvent('patch', patch);
        if (!connected) return;
      }
      forwardLivePatches = true;

      pingTimer = setInterval(() => {
        enqueueJsonEvent('ping', { type: 'ping', ts: Date.now() });
      }, PING_INTERVAL_MS);

      await new Promise<void>((resolve) => {
        resolveDisconnect = resolve;
        if (!connected) resolve();
      });
    } finally {
      disconnect();
      await writeQueue;
    }
  });
});

app.post('/api/chat-runtime/sessions/:sessionKey/messages', async (c) => {
  const sessionKey = c.req.param('sessionKey')?.trim() ?? '';
  if (!sessionKey) {
    return c.json({ ok: false, error: 'sessionKey is required' }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const parsed = sendMessageSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      ok: false,
      error: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    }, 400);
  }

  const runtime = getChatRuntime();
  const optimisticPatch = runtime.applyOptimisticUserMessage({
    sessionKey,
    text: parsed.data.text,
    idempotencyKey: parsed.data.idempotencyKey,
  });

  try {
    const gatewayResult = await gatewayRpcCall('chat.send', {
      sessionKey,
      message: parsed.data.text,
      deliver: false,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    const runId = extractRunId(gatewayResult);
    const committedPatch = runId
      ? runtime.applyOptimisticUserMessage({
        sessionKey,
        text: parsed.data.text,
        idempotencyKey: parsed.data.idempotencyKey,
        runId,
      })
      : optimisticPatch;

    return c.json({
      ok: true,
      sessionKey,
      ...(runId ? { runId } : {}),
      cursor: committedPatch.cursor,
    });
  } catch (err) {
    const message = errorMessage(err);
    const error = `chat.send failed: ${message}`;
    runtime.failOptimisticUserMessage({
      sessionKey,
      idempotencyKey: parsed.data.idempotencyKey,
      error,
    });
    return c.json({ ok: false, error }, 502);
  }
});

function normalizeCursor(cursor: string | undefined): string | null {
  const normalized = cursor?.trim();
  return normalized ? normalized : null;
}

function extractRunId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.runId !== 'string') return undefined;
  const runId = value.runId.trim();
  return runId ? runId : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function latestReplayCursor(patches: TimelinePatch[]): string | undefined {
  return patches[patches.length - 1]?.cursor;
}

function snapshotBaseline(snapshot: TimelineSnapshot): CatchupBaseline {
  return {
    kind: 'snapshot',
    snapshot,
    coveredCursor: snapshot.cursor,
  };
}

function isPatchCoveredByBaseline(patch: TimelinePatch, coveredCursor: string | undefined): boolean {
  return coveredCursor !== undefined && compareCursor(patch.cursor, coveredCursor) <= 0;
}

function compareCursor(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (
    Number.isSafeInteger(leftNumber) &&
    Number.isSafeInteger(rightNumber) &&
    String(leftNumber) === left &&
    String(rightNumber) === right
  ) {
    return leftNumber - rightNumber;
  }

  return left === right ? 0 : 1;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default app;
