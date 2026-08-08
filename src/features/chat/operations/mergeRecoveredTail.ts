import type { ChatMsg } from '@/features/chat/types';
import {
  getMessageSourceIds,
  isSameAssistantFinalDelivery,
  mergeMessageState,
} from './messageReconciliation';

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return hash;
}

function messageSignature(msg: ChatMsg): string {
  const normalizedText = (msg.rawText || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 4000);
  const textHash = hashString(normalizedText).toString(16);
  const tsBucket = Math.floor(msg.timestamp.getTime() / 30_000);
  const flags = [
    msg.isThinking ? 'thinking' : '',
    msg.intermediate ? 'intermediate' : '',
    msg.toolGroup ? `toolGroup:${msg.toolGroup.length}` : '',
    msg.images?.length ? `images:${msg.images.length}` : '',
  ].filter(Boolean).join(',');

  return `${msg.role}|${textHash}|${tsBucket}|${flags}`;
}

function findSuffixPrefixOverlap(existingSigs: string[], recoveredSigs: string[]): number {
  const max = Math.min(existingSigs.length, recoveredSigs.length, 120);
  for (let len = max; len >= 1; len--) {
    let match = true;
    for (let i = 0; i < len; i++) {
      if (existingSigs[existingSigs.length - len + i] !== recoveredSigs[i]) {
        match = false;
        break;
      }
    }
    if (match) return len;
  }
  return 0;
}

/**
 * Find a single-message anchor between existing tail and recovered messages.
 * Searches from the END of the existing array to find the latest match,
 * reducing the risk of hash collisions on short/common messages anchoring
 * at the wrong position.
 */
function findTailAnchor(existingSigs: string[], recoveredSigs: string[]) {
  const tailStart = Math.max(0, existingSigs.length - 160);

  for (let existingIdx = existingSigs.length - 1; existingIdx >= tailStart; existingIdx--) {
    const sig = existingSigs[existingIdx];
    for (let recoveredIdx = 0; recoveredIdx < recoveredSigs.length; recoveredIdx++) {
      if (recoveredSigs[recoveredIdx] === sig) {
        return { existingIdx, recoveredIdx };
      }
    }
  }

  return null;
}

function findIdentityAnchor(existing: ChatMsg[], recovered: ChatMsg[]) {
  const recoveredIds = new Map<string, number>();
  recovered.forEach((msg, index) => {
    for (const sourceId of getMessageSourceIds(msg)) recoveredIds.set(sourceId, index);
  });
  if (recoveredIds.size === 0) return null;

  const tailStart = Math.max(0, existing.length - 240);
  for (let existingIdx = existing.length - 1; existingIdx >= tailStart; existingIdx--) {
    const sourceIds = getMessageSourceIds(existing[existingIdx]);
    for (const sourceId of sourceIds) {
      const recoveredIdx = recoveredIds.get(sourceId);
      if (recoveredIdx !== undefined) return { existingIdx, recoveredIdx };
    }
  }
  return null;
}

function findAssistantFinalDeliveryAnchor(existing: ChatMsg[], recovered: ChatMsg[]) {
  const tailStart = Math.max(0, existing.length - 240);
  for (let existingIdx = existing.length - 1; existingIdx >= tailStart; existingIdx--) {
    for (let recoveredIdx = 0; recoveredIdx < recovered.length; recoveredIdx++) {
      if (isSameAssistantFinalDelivery(existing[existingIdx], recovered[recoveredIdx])) {
        return { existingIdx, recoveredIdx };
      }
    }
  }
  return null;
}

function mergeByIdentity(existing: ChatMsg[], recovered: ChatMsg[], anchor: { existingIdx: number; recoveredIdx: number }): ChatMsg[] {
  const prefix = existing.slice(0, anchor.existingIdx);
  const existingTail = existing.slice(anchor.existingIdx);
  const existingById = new Map<string, ChatMsg>();
  for (const msg of existingTail) {
    for (const sourceId of getMessageSourceIds(msg)) existingById.set(sourceId, msg);
  }

  const claimed = new Set<ChatMsg>();
  const mergedRecovered = recovered.slice(anchor.recoveredIdx).map((msg) => {
    const sourceIds = getMessageSourceIds(msg);
    const prior = sourceIds.map((sourceId) => existingById.get(sourceId)).find((candidate) => candidate && !claimed.has(candidate));
    const assistantFinalPrior = prior || existingTail.find((candidate) => !claimed.has(candidate) && isSameAssistantFinalDelivery(candidate, msg));
    if (!assistantFinalPrior) return msg;
    claimed.add(assistantFinalPrior);
    return mergeMessageState(assistantFinalPrior, msg);
  });

  const represented = new Set(mergedRecovered.flatMap(getMessageSourceIds));
  const newestRecoveredTs = Math.max(...recovered.map((msg) => msg.timestamp.getTime()).filter(Number.isFinite));
  const preserveNewer = existing
    .slice(anchor.existingIdx + 1)
    .filter((msg) => {
      if (getMessageSourceIds(msg).some((sourceId) => represented.has(sourceId))) return false;
      if (mergedRecovered.some((candidate) => isSameAssistantFinalDelivery(msg, candidate))) return false;
      if (msg.pending || msg.failed || msg.streaming) return true;
      return Number.isFinite(newestRecoveredTs) && msg.timestamp.getTime() > newestRecoveredTs;
    });

  return [...prefix, ...mergedRecovered, ...preserveNewer];
}

/**
 * Merge a recovered history tail into the current transcript without replacing
 * unaffected prefix messages.
 */
export function mergeRecoveredTail(existing: ChatMsg[], recovered: ChatMsg[]): ChatMsg[] {
  if (recovered.length === 0) return existing;
  if (existing.length === 0) return recovered;

  const identityAnchor = findIdentityAnchor(existing, recovered);
  if (identityAnchor) {
    return mergeByIdentity(existing, recovered, identityAnchor);
  }

  const assistantFinalDeliveryAnchor = findAssistantFinalDeliveryAnchor(existing, recovered);
  if (assistantFinalDeliveryAnchor) {
    return mergeByIdentity(existing, recovered, assistantFinalDeliveryAnchor);
  }

  const existingSigs = existing.map(messageSignature);
  const recoveredSigs = recovered.map(messageSignature);

  // Fast path: recovered starts where existing tail ends.
  const overlap = findSuffixPrefixOverlap(existingSigs, recoveredSigs);
  if (overlap > 0) {
    return [...existing, ...recovered.slice(overlap)];
  }

  // Anchor path: find a matching point in the existing tail and replace only suffix.
  const anchor = findTailAnchor(existingSigs, recoveredSigs);
  if (anchor) {
    const preservedPrefix = existing.slice(0, anchor.existingIdx);
    const patchedTail = recovered.slice(anchor.recoveredIdx);
    return [...preservedPrefix, ...patchedTail];
  }

  // Last resort: no overlap/anchor detected, prefer authoritative recovered tail.
  return recovered;
}
