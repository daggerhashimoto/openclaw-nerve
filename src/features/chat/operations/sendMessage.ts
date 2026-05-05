/**
 * sendMessage — Pure functions for building and sending chat messages.
 *
 * Extracted from ChatContext.handleSend. No React hooks, setState, or refs.
 */
import { generateMsgId } from '@/features/chat/types';
import type { ChatMsg, ImageAttachment, OutgoingUploadPayload, UploadAttachmentDescriptor } from '@/features/chat/types';
import { renderMarkdown, renderToolResults } from '@/utils/helpers';

// ─── Voice → TTS prompt hint ───────────────────────────────────────────────────
const VOICE_PREFIX = '[voice] ';
const TTS_HINT = '\n\n[system: User sent a voice message. Always include your full text reply AND a [tts:...] marker so it plays back as audio. Never send only TTS markers — the response must be readable in chat too. TTS marker format: [tts: your spoken text here] — place it at the end of your reply. Example reply:\n\nHere is my text response.\n\n[tts: Here is my text response.]]';
const UPLOAD_MANIFEST_OPEN = '<nerve-upload-manifest>';
const UPLOAD_MANIFEST_CLOSE = '</nerve-upload-manifest>';

/** Detect voice messages and append a TTS prompt hint for the agent. */
export function applyVoiceTTSHint(text: string): string {
  if (!text.startsWith(VOICE_PREFIX)) return text;
  return text + TTS_HINT;
}

function sanitizeUploadDescriptor(
  descriptor: UploadAttachmentDescriptor,
  exposeInlineBase64ToAgent: boolean,
): UploadAttachmentDescriptor {
  if (descriptor.mode !== 'inline' || !descriptor.inline) {
    return descriptor;
  }

  const inline = {
    ...descriptor.inline,
    previewUrl: undefined,
    base64: exposeInlineBase64ToAgent ? descriptor.inline.base64 : '',
  };

  return {
    ...descriptor,
    inline,
  };
}

export function appendUploadManifest(
  text: string,
  uploadPayload?: OutgoingUploadPayload,
): string {
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

// ─── RPC type alias ────────────────────────────────────────────────────────────
type RpcFn = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export type ChatSendStatus = 'started' | 'in_flight' | 'ok';

export interface ChatSendAck {
  runId?: string;
  status?: ChatSendStatus;
}

export interface ChatRuntimeSendAck {
  ok: true;
  sessionKey: string;
  cursor: string;
  runId?: string;
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// ─── Build optimistic user message ─────────────────────────────────────────────

/**
 * Build the optimistic ChatMsg for a user message, ready for immediate insertion.
 * Returns both the message and a tempId for later confirmation/failure updates.
 */
export function buildUserMessage(params: {
  text: string;
  images?: ImageAttachment[];
  uploadPayload?: OutgoingUploadPayload;
}): { msg: ChatMsg; tempId: string } {
  const { text, images, uploadPayload } = params;
  const tempId = crypto.randomUUID ? crypto.randomUUID() : 'temp-' + Date.now();

  const msg: ChatMsg = {
    msgId: generateMsgId(),
    role: 'user',
    html: renderToolResults(renderMarkdown(text)),
    rawText: text,
    timestamp: new Date(),
    images: images?.map(i => ({
      mimeType: i.mimeType,
      content: i.content,
      preview: i.preview,
      name: i.name,
    })),
    uploadAttachments: uploadPayload?.descriptors,
    pending: true,
    tempId,
  };

  return { msg, tempId };
}

// ─── Send the chat message via RPC ─────────────────────────────────────────────

/**
 * Send a chat message through the gateway RPC. Pure network call — no state management.
 */
export async function sendChatMessage(params: {
  rpc: RpcFn;
  sessionKey: string;
  text: string;
  images?: ImageAttachment[];
  uploadPayload?: OutgoingUploadPayload;
  idempotencyKey: string;
}): Promise<ChatSendAck> {
  const { rpc, sessionKey, text, images, uploadPayload, idempotencyKey } = params;

  const messageWithManifest = appendUploadManifest(text, uploadPayload);

  const rpcParams: Record<string, unknown> = {
    sessionKey,
    message: applyVoiceTTSHint(messageWithManifest),
    deliver: false,
    idempotencyKey,
  };

  if (images?.length) {
    rpcParams.attachments = images.map(i => ({
      mimeType: i.mimeType,
      content: i.content,
    }));
  }

  const ackRaw = await rpc('chat.send', rpcParams);
  const ack = (ackRaw || {}) as { runId?: unknown; status?: unknown };

  const status = typeof ack.status === 'string' && ['started', 'in_flight', 'ok'].includes(ack.status)
    ? (ack.status as ChatSendStatus)
    : undefined;

  return {
    runId: typeof ack.runId === 'string' ? ack.runId : undefined,
    status,
  };
}

export async function sendChatRuntimeMessage(params: {
  sessionKey: string;
  text: string;
  idempotencyKey: string;
  fetchImpl?: FetchFn;
}): Promise<ChatRuntimeSendAck> {
  const { sessionKey, text, idempotencyKey, fetchImpl = fetch } = params;
  const res = await fetchImpl(`/api/chat-runtime/sessions/${encodeURIComponent(sessionKey)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: applyVoiceTTSHint(text), idempotencyKey }),
  });

  const body = await parseJsonBody(res);

  if (!res.ok || !isRuntimeSendAck(body)) {
    const error = isRuntimeSendError(body)
      ? body.error
      : `chat runtime send failed with HTTP ${res.status}`;
    throw new Error(error);
  }

  return body;
}

async function parseJsonBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function isRuntimeSendAck(value: unknown): value is ChatRuntimeSendAck {
  if (!isRecord(value)) return false;
  if (value.ok !== true) return false;
  return typeof value.sessionKey === 'string' && typeof value.cursor === 'string';
}

function isRuntimeSendError(value: unknown): value is { ok: false; error: string } {
  return isRecord(value) && value.ok === false && typeof value.error === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
