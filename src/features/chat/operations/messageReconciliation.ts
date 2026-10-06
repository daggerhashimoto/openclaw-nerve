import { generateMsgId } from '@/features/chat/types';
import type { ChatMsg } from '@/features/chat/types';

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function getMessageSourceIds(msg: ChatMsg): string[] {
  return [msg.sourceId, ...(msg.alternateSourceIds || [])].filter(isString);
}

export function isSameMessageIdentity(a: ChatMsg, b: ChatMsg): boolean {
  const aIds = getMessageSourceIds(a);
  const bIds = getMessageSourceIds(b);
  if (aIds.length > 0 && bIds.length > 0) {
    return aIds.some((id) => bIds.includes(id));
  }
  if (a.tempId && b.tempId) return a.tempId === b.tempId;
  return false;
}

export function mergeMessageState(existing: ChatMsg, incoming: ChatMsg): ChatMsg {
  const alternateSourceIds = [...new Set([
    ...(existing.alternateSourceIds || []),
    ...(incoming.alternateSourceIds || []),
    ...(existing.sourceId && existing.sourceId !== incoming.sourceId ? [existing.sourceId] : []),
  ])];

  return {
    ...incoming,
    msgId: existing.msgId || incoming.msgId || generateMsgId(),
    sourceId: incoming.sourceId || existing.sourceId,
    ...(alternateSourceIds.length > 0 ? { alternateSourceIds } : {}),
    collapsed: existing.collapsed ?? incoming.collapsed,
    pending: incoming.pending ?? false,
    failed: incoming.failed ?? false,
    tempId: existing.tempId,
  };
}

export function normalizeComparableText(text: string | undefined): string {
  return (text || '').trim().replace(/\s+/g, ' ');
}

export function hasOpenClawDurableIdentity(msg: ChatMsg): boolean {
  return getMessageSourceIds(msg).some((id) => id.startsWith('openclaw:mirror:') || id.startsWith('openclaw:id:'));
}

function hasRichAssistantPayload(msg: ChatMsg): boolean {
  return Boolean(
    msg.isThinking ||
    msg.intermediate ||
    msg.toolGroup?.length ||
    msg.images?.length ||
    msg.extractedImages?.length ||
    msg.charts?.length ||
    msg.uploadAttachments?.length ||
    msg.isSystemNotification
  );
}

export function isSameAssistantFinalDelivery(a: ChatMsg, b: ChatMsg): boolean {
  if (a.role !== 'assistant' || b.role !== 'assistant') return false;
  if (a.streaming || b.streaming || a.pending || b.pending || a.failed || b.failed) return false;
  if (hasRichAssistantPayload(a) || hasRichAssistantPayload(b)) return false;

  const aHasOpenClawIdentity = hasOpenClawDurableIdentity(a);
  const bHasOpenClawIdentity = hasOpenClawDurableIdentity(b);
  if (aHasOpenClawIdentity === bHasOpenClawIdentity) return false;

  const aText = normalizeComparableText(a.rawText);
  const bText = normalizeComparableText(b.rawText);
  if (!aText || aText !== bText) return false;

  const timeDiffMs = Math.abs(a.timestamp.getTime() - b.timestamp.getTime());
  return Number.isFinite(timeDiffMs) && timeDiffMs <= 180_000;
}
