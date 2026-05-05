import { createHash } from 'node:crypto';

const SIMPLE_ID_PART = /^[A-Za-z0-9._-]+$/;

function cleanPart(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function encodeSuffixPart(value: string): string {
  if (SIMPLE_ID_PART.test(value)) return value;
  return `~${Buffer.from(value, 'utf8').toString('base64url')}`;
}

export function turnId(sessionKey: string, runId: string): string {
  return `turn:${sessionKey}:${encodeSuffixPart(runId)}`;
}

export function assistantItemId(sessionKey: string, runId: string): string {
  return `assistant:${sessionKey}:${encodeSuffixPart(runId)}:answer`;
}

export function assistantSegmentItemId(sessionKey: string, runId: string, segmentIndex: number): string {
  return `assistant:${sessionKey}:${encodeSuffixPart(runId)}:segment:${segmentIndex}`;
}

export function toolCallItemId(sessionKey: string, runId: string, toolCallId: string): string {
  return `tool:${sessionKey}:${encodeSuffixPart(runId)}:${encodeSuffixPart(toolCallId)}`;
}

export function toolGroupItemId(sessionKey: string, runId: string, groupIndex: number): string {
  return `tool-group:${sessionKey}:${encodeSuffixPart(runId)}:${groupIndex}`;
}

export function thinkingItemId(sessionKey: string, runId: string, blockIndex: number): string {
  return `thinking:${sessionKey}:${encodeSuffixPart(runId)}:${blockIndex}`;
}

export function fingerprintText(input: string): string {
  const normalized = cleanPart(input);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export function userItemId(params: {
  sessionKey: string;
  messageId?: string;
  idempotencyKey?: string;
  text?: string;
  timestamp?: number;
  fallbackIndex?: number;
}): string {
  if (params.messageId) return `user:${params.sessionKey}:${encodeSuffixPart(params.messageId)}`;
  if (params.idempotencyKey) return `user:${params.sessionKey}:${encodeSuffixPart(params.idempotencyKey)}`;
  const textHash = fingerprintText(params.text || '');
  const timestamp = Number.isFinite(params.timestamp) ? params.timestamp : 0;
  const source = Number.isFinite(params.fallbackIndex) ? `:${params.fallbackIndex}` : '';
  return `user:${params.sessionKey}:fallback:${timestamp}:${textHash}${source}`;
}
