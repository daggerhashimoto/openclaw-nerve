import type { ChatMsg } from '@/features/chat/types';
import { transcriptRowId } from './loadHistory';

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
    // A reply whose attachment (a generated image) only arrives with history must not match its
    // image-less live copy, or the recovered version is dropped as a duplicate.
    msg.extractedImages?.length ? `extracted:${msg.extractedImages.length}` : '',
  ].filter(Boolean).join(',');

  return `${msg.role}|${textHash}|${tsBucket}|${flags}`;
}

/** Whether existing[existingIdx] and recovered[recoveredIdx] are the same message. */
type RowMatcher = (existingIdx: number, recoveredIdx: number) => boolean;

/**
 * Rows that both carry a transcript id are the same message exactly when the ids
 * are equal; text and time do not matter, so a copy history has since revised or
 * re-timed still lines up. A row without an id (a live final, an optimistic
 * prompt, a row from a gateway that sends no ids) falls back to its content
 * signature, but never onto a row whose id appears on the other side too: that
 * row already has its own counterpart, so a look-alike is a different message.
 */
function createRowMatcher(existing: ChatMsg[], recovered: ChatMsg[]): RowMatcher {
  const existingIds = existing.map(transcriptRowId);
  const recoveredIds = recovered.map(transcriptRowId);
  const existingIdSet = new Set(existingIds.filter(Boolean));
  const recoveredIdSet = new Set(recoveredIds.filter(Boolean));
  const existingSigs = existing.map(messageSignature);
  const recoveredSigs = recovered.map(messageSignature);

  return (existingIdx, recoveredIdx) => {
    const existingId = existingIds[existingIdx];
    const recoveredId = recoveredIds[recoveredIdx];
    if (existingId && recoveredId) return existingId === recoveredId;
    if (existingId && recoveredIdSet.has(existingId)) return false;
    if (recoveredId && existingIdSet.has(recoveredId)) return false;
    return existingSigs[existingIdx] === recoveredSigs[recoveredIdx];
  };
}

function findSuffixPrefixOverlap(existingLength: number, recoveredLength: number, same: RowMatcher): number {
  const max = Math.min(existingLength, recoveredLength, 120);
  for (let len = max; len >= 1; len--) {
    let match = true;
    for (let i = 0; i < len; i++) {
      if (!same(existingLength - len + i, i)) {
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
function findTailAnchor(existingLength: number, recoveredLength: number, same: RowMatcher) {
  const tailStart = Math.max(0, existingLength - 160);

  for (let existingIdx = existingLength - 1; existingIdx >= tailStart; existingIdx--) {
    for (let recoveredIdx = 0; recoveredIdx < recoveredLength; recoveredIdx++) {
      if (same(existingIdx, recoveredIdx)) {
        return extendAnchorBackwards(same, existingIdx, recoveredIdx, tailStart);
      }
    }
  }

  return null;
}

/**
 * Walk an anchor back while the preceding existing messages also appear, in
 * order, earlier in the recovered tail. Anchoring only on the latest match
 * would drop recovered messages that belong before an already displayed one,
 * such as an interim reply committed before the run's final answer.
 */
function extendAnchorBackwards(
  same: RowMatcher,
  existingIdx: number,
  recoveredIdx: number,
  tailStart: number,
) {
  while (existingIdx > tailStart && recoveredIdx > 0) {
    let match = -1;
    for (let i = recoveredIdx - 1; i >= 0; i--) {
      if (same(existingIdx - 1, i)) {
        match = i;
        break;
      }
    }
    if (match < 0) break;
    existingIdx -= 1;
    recoveredIdx = match;
  }

  return { existingIdx, recoveredIdx };
}

/**
 * Merge a recovered history tail into the current transcript without replacing
 * unaffected prefix messages.
 */
export function mergeRecoveredTail(existing: ChatMsg[], recovered: ChatMsg[]): ChatMsg[] {
  if (recovered.length === 0) return existing;
  if (existing.length === 0) return recovered;

  const same = createRowMatcher(existing, recovered);

  // Fast path: recovered starts where existing tail ends.
  const overlap = findSuffixPrefixOverlap(existing.length, recovered.length, same);
  if (overlap > 0) {
    const start = existing.length - overlap;
    // A row matched by its transcript id takes the recovered copy, which history may
    // have revised since; a row matched by content alone stays as displayed.
    const overlapped = recovered
      .slice(0, overlap)
      .map((row, i) => (transcriptRowId(row) && transcriptRowId(existing[start + i]) ? row : existing[start + i]));
    return [...existing.slice(0, start), ...overlapped, ...recovered.slice(overlap)];
  }

  // Anchor path: find a matching point in the existing tail and replace only suffix.
  const anchor = findTailAnchor(existing.length, recovered.length, same);
  if (anchor) {
    const preservedPrefix = existing.slice(0, anchor.existingIdx);
    const patchedTail = recovered.slice(anchor.recoveredIdx);
    return [...preservedPrefix, ...patchedTail];
  }

  // Last resort: no overlap/anchor detected, prefer authoritative recovered tail.
  return recovered;
}
