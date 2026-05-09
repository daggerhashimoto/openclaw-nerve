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
  text: z.string(),
  idempotencyKey: nonBlankString('idempotencyKey'),
  images: z.array(z.object({
    mimeType: nonBlankString('images[].mimeType'),
    content: nonBlankString('images[].content'),
    preview: z.string().optional(),
    name: z.string().optional(),
  })).optional(),
  uploadPayload: z.object({
    descriptors: z.array(z.object({}).passthrough()),
    manifest: z.object({
      enabled: z.boolean(),
      exposeInlineBase64ToAgent: z.boolean(),
      allowSubagentForwarding: z.boolean(),
    }).passthrough(),
  }).passthrough().optional(),
}).refine((value) => (
  value.text.trim().length > 0 ||
  Boolean(value.images?.length) ||
  Boolean(value.uploadPayload?.descriptors.length)
), {
  path: ['text'],
  message: 'text or attachments must be provided',
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
  const images = normalizeMessageImages(parsed.data.images);
  const uploadAttachments = parsed.data.uploadPayload?.descriptors;
  const gatewayMessage = applyVoiceTTSHint(appendUploadManifest(parsed.data.text, parsed.data.uploadPayload));
  const optimisticInput = {
    sessionKey,
    text: parsed.data.text,
    idempotencyKey: parsed.data.idempotencyKey,
    ...(images.length > 0 ? { images } : {}),
    ...(uploadAttachments?.length ? { uploadAttachments } : {}),
  };
  const optimisticPatch = runtime.applyOptimisticUserMessage(optimisticInput);

  try {
    const gatewayParams: Record<string, unknown> = {
      sessionKey,
      message: gatewayMessage,
      deliver: false,
      idempotencyKey: parsed.data.idempotencyKey,
    };
    if (images.length > 0) {
      gatewayParams.attachments = images.map((image) => ({
        mimeType: image.mimeType,
        content: image.content,
      }));
    }

    const gatewayResult = await gatewayRpcCall('chat.send', gatewayParams);
    const runId = extractRunId(gatewayResult);
    const committedPatch = runId
      ? runtime.applyOptimisticUserMessage({
        ...optimisticInput,
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

type ParsedUploadPayload = z.infer<typeof sendMessageSchema>['uploadPayload'];
type ParsedImage = NonNullable<z.infer<typeof sendMessageSchema>['images']>[number];

const VOICE_PREFIX = '[voice] ';
const TTS_HINT = '\n\n[system: User sent a voice message. Always include your full text reply AND a [tts:...] marker so it plays back as audio. Never send only TTS markers - the response must be readable in chat too. TTS marker format: [tts: your spoken text here] - place it at the end of your reply. Example reply:\n\nHere is my text response.\n\n[tts: Here is my text response.]]';
const UPLOAD_MANIFEST_OPEN = '<nerve-upload-manifest>';
const UPLOAD_MANIFEST_CLOSE = '</nerve-upload-manifest>';

function applyVoiceTTSHint(text: string): string {
  if (!text.startsWith(VOICE_PREFIX)) return text;
  return text + TTS_HINT;
}

function appendUploadManifest(text: string, uploadPayload?: ParsedUploadPayload): string {
  if (!uploadPayload?.manifest.enabled) return text;
  if (uploadPayload.descriptors.length === 0) return text;

  const manifest = {
    version: 1,
    attachments: uploadPayload.descriptors.map((descriptor) =>
      sanitizeUploadDescriptor(descriptor, uploadPayload.manifest.exposeInlineBase64ToAgent),
    ),
  };

  return `${text}\n\n${UPLOAD_MANIFEST_OPEN}${JSON.stringify(manifest)}${UPLOAD_MANIFEST_CLOSE}`;
}

function sanitizeUploadDescriptor(
  descriptor: Record<string, unknown>,
  exposeInlineBase64ToAgent: boolean,
): Record<string, unknown> {
  const inline = descriptor.inline;
  if (descriptor.mode !== 'inline' || !isRecord(inline)) {
    return descriptor;
  }

  return {
    ...descriptor,
    inline: {
      ...inline,
      previewUrl: undefined,
      base64: exposeInlineBase64ToAgent && typeof inline.base64 === 'string' ? inline.base64 : '',
    },
  };
}

function normalizeMessageImages(images: ParsedImage[] | undefined) {
  return (images ?? []).map((image) => ({
    mimeType: image.mimeType,
    content: image.content,
    preview: image.preview || `data:${image.mimeType};base64,${image.content}`,
    name: image.name || 'image',
  }));
}

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
