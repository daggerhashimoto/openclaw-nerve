import type { ChatMsg } from '@/features/chat/types';

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

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
    if (msg.sourceId) recoveredIds.set(msg.sourceId, index);
    for (const alias of msg.alternateSourceIds || []) recoveredIds.set(alias, index);
  });
  if (recoveredIds.size === 0) return null;

  const tailStart = Math.max(0, existing.length - 240);
  for (let existingIdx = existing.length - 1; existingIdx >= tailStart; existingIdx--) {
    const sourceIds = [existing[existingIdx].sourceId, ...(existing[existingIdx].alternateSourceIds || [])].filter(isString);
    for (const sourceId of sourceIds) {
      const recoveredIdx = recoveredIds.get(sourceId);
      if (recoveredIdx !== undefined) return { existingIdx, recoveredIdx };
    }
  }
  return null;
}

function mergeMessageState(existing: ChatMsg, incoming: ChatMsg): ChatMsg {
  const alternateSourceIds = [...new Set([
    ...(existing.alternateSourceIds || []),
    ...(incoming.alternateSourceIds || []),
    ...(existing.sourceId && existing.sourceId !== incoming.sourceId ? [existing.sourceId] : []),
  ])];

  return {
    ...incoming,
    msgId: existing.msgId || incoming.msgId,
    sourceId: incoming.sourceId || existing.sourceId,
    ...(alternateSourceIds.length > 0 ? { alternateSourceIds } : {}),
    collapsed: existing.collapsed ?? incoming.collapsed,
    pending: incoming.pending ?? false,
    failed: incoming.failed ?? false,
    tempId: existing.tempId,
  };
}

function mergeByIdentity(existing: ChatMsg[], recovered: ChatMsg[], anchor: { existingIdx: number; recoveredIdx: number }): ChatMsg[] {
  const prefix = existing.slice(0, anchor.existingIdx);
  const existingById = new Map<string, ChatMsg>();
  for (const msg of existing.slice(anchor.existingIdx)) {
    if (msg.sourceId) existingById.set(msg.sourceId, msg);
    for (const alias of msg.alternateSourceIds || []) existingById.set(alias, msg);
  }

  const mergedRecovered = recovered.slice(anchor.recoveredIdx).map((msg) => {
    const sourceIds = [msg.sourceId, ...(msg.alternateSourceIds || [])].filter(isString);
    const prior = sourceIds.map((sourceId) => existingById.get(sourceId)).find(Boolean);
    return prior ? mergeMessageState(prior, msg) : msg;
  });

  const represented = new Set(mergedRecovered.flatMap((msg) => [msg.sourceId, ...(msg.alternateSourceIds || [])]).filter(isString));
  const newestRecoveredTs = Math.max(...recovered.map((msg) => msg.timestamp.getTime()).filter(Number.isFinite));
  const preserveNewer = existing
    .slice(anchor.existingIdx + 1)
    .filter((msg) => {
      if ([msg.sourceId, ...(msg.alternateSourceIds || [])].filter(isString).some((sourceId) => represented.has(sourceId))) return false;
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
