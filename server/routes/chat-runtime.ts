import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { gatewayRpcCall } from '../lib/gateway-rpc.js';
import { getChatRuntime } from '../lib/chat-runtime/singleton.js';
import type { TimelinePatch, TimelineSnapshot } from '../lib/chat-runtime/types.js';
import { getUploadFeatureConfig } from '../lib/upload-config.js';
import { appendUploadManifest, applyVoiceTTSHint, sanitizeUploadDescriptor } from '../../shared/chat-upload-manifest.js';

const app = new Hono();

const PING_INTERVAL_MS = 30_000;
const uploadFeatureConfig = getUploadFeatureConfig();
const MAX_INLINE_ATTACHMENT_BYTES = Math.max(1, Math.floor(uploadFeatureConfig.inlineAttachmentMaxMb * 1024 * 1024));
const MAX_INLINE_BASE64_CHARS = Math.max(4, Math.ceil(MAX_INLINE_ATTACHMENT_BYTES / 3) * 4);
const MAX_IMAGE_MIME_TYPE_CHARS = 96;
const MAX_IMAGE_NAME_CHARS = 256;
const MAX_IMAGE_PREVIEW_CHARS = MAX_INLINE_BASE64_CHARS + 'data:'.length + ';base64,'.length + MAX_IMAGE_MIME_TYPE_CHARS;
const MAX_UPLOAD_DESCRIPTOR_METADATA_CHARS = Math.max(1, Math.floor(uploadFeatureConfig.inlineImageContextMaxBytes));

type CatchupBaseline =
  | { kind: 'patches'; patches: TimelinePatch[]; coveredCursor?: string }
  | { kind: 'snapshot'; snapshot: TimelineSnapshot; coveredCursor: string };

const nonBlankString = (field: string, maxLength?: number) => {
  let schema = z.string();
  if (maxLength !== undefined) {
    schema = schema.max(maxLength, `${field} must be at most ${maxLength} characters`);
  }
  return schema
  .refine((value) => value.trim().length > 0, `${field} must be a non-empty string`);
};

const jsonPayloadWithinLimit = (value: unknown, maxChars: number): boolean => {
  if (value === undefined) return true;
  try {
    return JSON.stringify(value).length <= maxChars;
  } catch {
    return false;
  }
};

const inlinePayloadWithinLimit = (inline: unknown): boolean =>
  jsonPayloadWithinLimit(inline, MAX_INLINE_BASE64_CHARS);

const uploadModeSchema = z.enum(['inline', 'file_reference']);

const descriptorMetadataWithinLimit = (descriptor: Record<string, unknown>): boolean => {
  const metadata = { ...descriptor };
  delete metadata.inline;
  return jsonPayloadWithinLimit(metadata, MAX_UPLOAD_DESCRIPTOR_METADATA_CHARS);
};

const sendMessageSchema = z.object({
  text: z.string(),
  idempotencyKey: nonBlankString('idempotencyKey'),
  images: z.array(z.object({
    mimeType: nonBlankString('images[].mimeType', MAX_IMAGE_MIME_TYPE_CHARS),
    content: nonBlankString('images[].content', MAX_INLINE_BASE64_CHARS),
    preview: z.string().max(
      MAX_IMAGE_PREVIEW_CHARS,
      `images[].preview must be at most ${MAX_IMAGE_PREVIEW_CHARS} characters`,
    ).optional(),
    name: z.string().max(
      MAX_IMAGE_NAME_CHARS,
      `images[].name must be at most ${MAX_IMAGE_NAME_CHARS} characters`,
    ).optional(),
  }).refine((image) => image.preview === undefined || isTrustedImagePreview(image.preview, image.mimeType), {
    path: ['preview'],
    message: 'images[].preview must be a data image URL',
  })).optional(),
  uploadPayload: z.object({
    descriptors: z.array(z.object({
      id: nonBlankString('uploadPayload.descriptors[].id'),
      origin: nonBlankString('uploadPayload.descriptors[].origin'),
      mode: uploadModeSchema,
      name: nonBlankString('uploadPayload.descriptors[].name'),
      mimeType: nonBlankString('uploadPayload.descriptors[].mimeType'),
      sizeBytes: z.number().finite().nonnegative(),
      inline: z.record(z.string(), z.unknown()).optional(),
      reference: z.unknown().optional(),
      preparation: z.unknown().optional(),
      policy: z.object({
        forwardToSubagents: z.boolean(),
      }).passthrough(),
    }).passthrough().refine((descriptor) => inlinePayloadWithinLimit(descriptor.inline), {
      path: ['inline'],
      message: `uploadPayload.descriptors[].inline must serialize to at most ${MAX_INLINE_BASE64_CHARS} characters`,
    }).refine((descriptor) => descriptorMetadataWithinLimit(descriptor), {
      message: `uploadPayload.descriptors[] metadata must serialize to at most ${MAX_UPLOAD_DESCRIPTOR_METADATA_CHARS} characters`,
    })),
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

      // Invariant: `connected` is already false if the client aborted during
      // hydrateSession (single-threaded JS, the check at line above catches
      // it). This second guard is belt-and-suspenders so that any future
      // refactor that introduces a real async step between the hydration
      // await and the subscribe call (e.g. an awaited pre-subscribe RPC)
      // cannot silently attach a listener that disconnect() already tore down.
      if (!connected) return;
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
  const uploadPayload = sanitizeRuntimeUploadPayload(parsed.data.uploadPayload);
  const uploadAttachments = uploadPayload?.descriptors;
  const gatewayMessage = applyVoiceTTSHint(appendUploadManifest(parsed.data.text, uploadPayload));
  const optimisticInput = {
    sessionKey,
    text: parsed.data.text,
    idempotencyKey: parsed.data.idempotencyKey,
    ...(images.length > 0 ? { images } : {}),
    ...(uploadAttachments?.length ? { uploadAttachments } : {}),
  };
  // Apply the optimistic user bubble, then bind to the real runId when chat.send returns
  // (see `bindRunIdToOptimisticUserMessage` below). The store dedupes by idempotencyKey,
  // so the bind step updates the existing message in place. The alternate "call
  // applyOptimisticUserMessage twice with the same idempotencyKey" path is pinned by
  // server/lib/chat-runtime/store.test.ts 'dedupes a second applyOptimisticUserMessage'.
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
      ? runtime.bindRunIdToOptimisticUserMessage({
        sessionKey,
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

type ParsedImage = NonNullable<z.infer<typeof sendMessageSchema>['images']>[number];

function normalizeMessageImages(images: ParsedImage[] | undefined) {
  return (images ?? []).map((image) => ({
    mimeType: image.mimeType,
    content: image.content,
    preview: normalizeImagePreview(image),
    name: normalizeImageName(image),
  }));
}

function normalizeImagePreview(image: ParsedImage): string {
  const fallback = `data:${image.mimeType};base64,${image.content}`;
  if (!image.preview) return fallback;
  return isTrustedImagePreview(image.preview, image.mimeType) ? image.preview.trim() : fallback;
}

function normalizeImageName(image: ParsedImage): string {
  if (!image.name) return 'image';
  return image.name.length <= MAX_IMAGE_NAME_CHARS ? image.name : image.name.slice(0, MAX_IMAGE_NAME_CHARS);
}

type ParsedUploadPayload = NonNullable<z.infer<typeof sendMessageSchema>['uploadPayload']>;

function sanitizeRuntimeUploadPayload(uploadPayload: ParsedUploadPayload | undefined): ParsedUploadPayload | undefined {
  if (!uploadPayload?.descriptors.length) return undefined;

  return {
    ...uploadPayload,
    descriptors: uploadPayload.descriptors.map((descriptor) =>
      sanitizeUploadDescriptor(descriptor, uploadPayload.manifest.exposeInlineBase64ToAgent),
    ),
  };
}

function isTrustedImagePreview(preview: string, mimeType: string): boolean {
  const trimmed = preview.trim();
  const prefix = `data:${mimeType};base64,`;
  return trimmed.startsWith(prefix) && trimmed.length > prefix.length;
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

export function isPatchCoveredByBaseline(patch: TimelinePatch, coveredCursor: string | undefined): boolean {
  return coveredCursor !== undefined && compareCursor(patch.cursor, coveredCursor) <= 0;
}

export function compareCursor(left: string, right: string): number {
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

  // Non-numeric or out-of-safe-int cursors are treated as "covered" (0).
  // The cursor contract is stringified safe-integer monotonic — anything
  // else is treated conservatively: drop the patch rather than risk
  // re-delivering a stale one. Throwing here would tear down the SSE
  // handler, which is worse than dropping a single patch.
  return 0;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default app;
