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

/** A prompt typed in this browser: its tempId is the idempotency key chat.send carried. */
function isLocalPrompt(msg: ChatMsg): boolean {
  return msg.role === 'user' && Boolean(msg.tempId);
}

/** A prompt still sending, or one whose send failed: so far it exists only in this browser. */
export function isUnsentPrompt(msg: ChatMsg): boolean {
  return isLocalPrompt(msg) && Boolean(msg.pending || msg.failed);
}

/**
 * Whether a history row is the gateway's record of a prompt sent from here. A
 * 2026.9 gateway records a chat.send prompt under `<idempotency key>:user`
 * (its buildRunUserTurnIdempotencyKey); the bare key is accepted as well.
 */
function recordsPrompt(row: ChatMsg, prompt: ChatMsg): boolean {
  if (row.role !== 'user' || !row.idempotencyKey || !prompt.tempId) return false;
  return row.idempotencyKey === `${prompt.tempId}:user` || row.idempotencyKey === prompt.tempId;
}

/** Matched by transcript id or by send key rather than by content. */
function isExactMatch(existingRow: ChatMsg, recoveredRow: ChatMsg): boolean {
  const id = transcriptRowId(recoveredRow);
  return (id !== null && id === transcriptRowId(existingRow)) || recordsPrompt(recoveredRow, existingRow);
}

/** Whether existing[existingIdx] and recovered[recoveredIdx] are the same message. */
type RowMatcher = (existingIdx: number, recoveredIdx: number) => boolean;

/**
 * Rows that both carry a transcript id are the same message exactly when the ids
 * are equal; text and time do not matter, so a copy history has since revised or
 * re-timed still lines up. A prompt sent from here and a recorded prompt that
 * carries a send key are the same exactly when the keys agree. Any other row
 * without an id (a live final, a row from a gateway that sends no ids) falls back
 * to its content signature, but never onto a row whose id appears on the other
 * side too: that row already has its own counterpart, so a look-alike is a
 * different message.
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
    if (isLocalPrompt(existing[existingIdx]) && recovered[recoveredIdx].idempotencyKey) {
      return recordsPrompt(recovered[recoveredIdx], existing[existingIdx]);
    }
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
 * A transcript entry shows once. Rows kept from the existing transcript drop any
 * entry that also comes back in the recovered rows, whose copy sits where history
 * puts it. The two can overlap when the screen had rows in another order, for
 * example a live final appended after a compaction row that history records after it.
 */
function withoutRecoveredEntries(kept: ChatMsg[], recoveredRows: ChatMsg[]): ChatMsg[] {
  const ids = new Set(recoveredRows.map(transcriptRowId).filter(Boolean));
  if (ids.size === 0) return kept;
  return kept.filter((row) => {
    const id = transcriptRowId(row);
    return !id || !ids.has(id);
  });
}

/**
 * Put back the prompts a merge replaced that history does not hold yet. One still
 * sending goes at the end, where the gateway will record it; a failed one goes
 * where it falls in time among the rows that replaced it (from regionStart on).
 * A prompt is never put back once a row in the result records it, so on a
 * gateway that records send keys it cannot show twice.
 */
function restoreUnsentPrompts(merged: ChatMsg[], replaced: ChatMsg[], regionStart: number): ChatMsg[] {
  const kept = new Set(merged);
  const lost = replaced.filter(
    (msg) => isUnsentPrompt(msg) && !kept.has(msg) && !merged.some((row) => recordsPrompt(row, msg)),
  );
  if (lost.length === 0) return merged;

  const result = [...merged];
  for (const msg of lost) {
    if (!msg.failed) continue;
    const later = result.findIndex((row, i) => i >= regionStart && row.timestamp.getTime() > msg.timestamp.getTime());
    result.splice(later < 0 ? result.length : later, 0, msg);
  }
  return [...result, ...lost.filter((msg) => !msg.failed)];
}

/**
 * A transcript rebuilt from a full history read, keeping the prompts from the
 * previous transcript that are still sending or failed to send until history
 * records them.
 */
export function keepUnsentMessages(previous: ChatMsg[], history: ChatMsg[]): ChatMsg[] {
  return restoreUnsentPrompts(history, previous, 0);
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
    // A row matched by transcript id or send key takes the recovered copy, which
    // history may have revised since; a row matched by content alone stays as displayed.
    const overlapped = recovered
      .slice(0, overlap)
      .map((row, i) => (isExactMatch(existing[start + i], row) ? row : existing[start + i]));
    // A recovered row paired with an existing row by content has an id the existing
    // transcript lacks (see createRowMatcher), so checking all of recovered is safe.
    const prefix = withoutRecoveredEntries(existing.slice(0, start), recovered);
    const merged = [...prefix, ...overlapped, ...recovered.slice(overlap)];
    return restoreUnsentPrompts(merged, existing.slice(start), prefix.length);
  }

  // Anchor path: find a matching point in the existing tail and replace only suffix.
  const anchor = findTailAnchor(existing.length, recovered.length, same);
  if (anchor) {
    const patchedTail = recovered.slice(anchor.recoveredIdx);
    const preservedPrefix = withoutRecoveredEntries(existing.slice(0, anchor.existingIdx), patchedTail);
    return restoreUnsentPrompts([...preservedPrefix, ...patchedTail], existing.slice(anchor.existingIdx), preservedPrefix.length);
  }

  // Last resort: no overlap or anchor, so the recovered window replaces the
  // transcript (an older prefix outside it is lost, as before). Only prompts not
  // sent yet carry over; any other local row could be a copy of a recovered row
  // that no longer matches, so keeping it could show it twice.
  return restoreUnsentPrompts(recovered, existing, 0);
}
