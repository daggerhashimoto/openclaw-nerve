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

/**
 * How long an acknowledged prompt stays protected from an older history read.
 * The gateway accepts a send before it records the row, so a read that started
 * before the acceptance can answer without it; a short grace window keeps the
 * prompt on screen until a later read records it.
 */
const LOCAL_PROMPT_GRACE_MS = 2 * 60_000;

/** A prompt still sending, or one whose send failed: so far it exists only in this browser. */
export function isUnsentPrompt(msg: ChatMsg): boolean {
  return isLocalPrompt(msg) && Boolean(msg.pending || msg.failed);
}

/**
 * A prompt an older read may not hold yet: still sending, failed, or accepted so
 * recently that the read's snapshot can predate its row. A merge keeps it until
 * history records it; the rest of the view treats only pending/failed prompts as
 * not in the transcript, so a just-sent prompt still starts its own turn.
 */
function isUnrecordedPrompt(msg: ChatMsg): boolean {
  if (!isLocalPrompt(msg)) return false;
  if (msg.pending || msg.failed) return true;
  return Date.now() - msg.timestamp.getTime() < LOCAL_PROMPT_GRACE_MS;
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

/** Whether the merge already shows this recovered row. */
function isRowOnScreen(merged: ChatMsg[], row: ChatMsg): boolean {
  const id = transcriptRowId(row);
  if (id && merged.some((msg) => transcriptRowId(msg) === id)) return true;
  // A live reply (a chat final) has no id yet; history's copy is the same row when
  // their content and time agree. Rows that both carry ids are compared by id only,
  // so two identical replies from different turns stay apart.
  if (id && row.role === 'assistant') {
    const signature = messageSignature(row);
    if (merged.some((msg) => transcriptRowId(msg) === null && messageSignature(msg) === signature)) return true;
  }
  // A recovered tool group cut by the window's start repeats calls already shown;
  // match the calls' transcript ids, not their text, so a later identical group
  // is still a distinct row.
  if (row.toolGroup?.length) {
    const entryIds = row.toolGroup.map((entry) => entry.entryId).filter(Boolean);
    if (entryIds.length === 0) return false;
    return merged.some((msg) => msg.toolGroup?.some((shown) => (
      Boolean(shown.entryId) && entryIds.includes(shown.entryId!)
    )));
  }
  return false;
}

/**
 * Insert recovered rows the merge did not place anywhere. An anchor walks back
 * by matching rows that exist on screen, so a row only in history (committed to
 * the gateway while the connection was down, say) matches nothing and would be
 * skipped; history is authoritative for its own rows, so put each one where its
 * time says it belongs.
 */
function insertMissingRecoveredRows(merged: ChatMsg[], recovered: ChatMsg[]): ChatMsg[] {
  let result = merged;
  for (const row of recovered) {
    if (!transcriptRowId(row) || isRowOnScreen(result, row)) continue;
    const at = result.findIndex((msg) => msg.timestamp.getTime() > row.timestamp.getTime());
    const index = at < 0 ? result.length : at;
    result = [...result.slice(0, index), row, ...result.slice(index)];
  }
  return result;
}

/**
 * A local prompt history records is the same message; drop the browser's copy
 * (it may still say sending or failed) and the send-error notice that followed
 * a prompt that in fact reached the gateway.
 */
function collapseRecordedPrompts(merged: ChatMsg[]): ChatMsg[] {
  const recorded = merged.filter((row) => row.role === 'user' && transcriptRowId(row) !== null);
  if (recorded.length === 0) return merged;
  const dropped = new Set<ChatMsg>();
  for (const msg of merged) {
    const localUser = msg.role === 'user' && transcriptRowId(msg) === null;
    if (!localUser) continue;
    if (recorded.some((row) => recordsPrompt(row, msg)
      || (!msg.pending && !msg.failed && samePromptRow(row, msg)))) {
      dropped.add(msg);
    }
  }
  if (dropped.size === 0) return merged;
  const droppedKeys = new Set([...dropped].map((msg) => msg.tempId).filter(Boolean));
  const droppedText = new Set([...dropped].map((msg) => (msg.rawText || '').trim()).filter(Boolean));
  const isCollapsedPromptCopy = (msg: ChatMsg) => msg.role === 'user' && (
    (msg.tempId !== undefined && droppedKeys.has(msg.tempId))
    || droppedText.has((msg.rawText || '').trim())
  );
  return merged.filter((msg, i) => {
    if (dropped.has(msg)) return false;
    if (msg.role !== 'system' || !msg.rawText.startsWith('Send error')) return true;
    // Drop the notice too when it belongs to a collapsed prompt, even with the
    // recorded copy now sitting between them.
    for (let j = i - 1; j >= 0; j--) {
      const before = merged[j];
      if (before.role === 'system') continue;
      return !isCollapsedPromptCopy(before);
    }
    return true;
  });
}

/**
 * A transcript entry shows once. Rows kept from the existing transcript drop any
 * entry that also comes back in the recovered rows, whose copy sits where history
 * puts it. The two can overlap when the screen had rows in another order, for
 * example a live final appended after a row that history records after it.
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
  // A history row records one prompt only: with two prompts of the same text and
  // no send keys, the row must collapse the first and let the second stay.
  const claimable = new Set(merged.filter((row) => row.role === 'user'));
  const lost: ChatMsg[] = [];
  for (const msg of replaced) {
    if (!isUnrecordedPrompt(msg) || kept.has(msg)) continue;
    const recorded = merged.find((row) => claimable.has(row) && (
      recordsPrompt(row, msg)
      || (!msg.pending && !msg.failed && samePromptRow(row, msg))
    ));
    if (recorded) {
      claimable.delete(recorded);
      continue;
    }
    lost.push(msg);
  }
  if (lost.length === 0) return merged;

  const result = [...merged];
  for (const msg of lost) {
    if (!msg.failed) continue;
    const later = result.findIndex((row, i) => i >= regionStart && row.timestamp.getTime() > msg.timestamp.getTime());
    result.splice(later < 0 ? result.length : later, 0, msg);
  }
  return [...result, ...lost.filter((msg) => !msg.failed)];
}

/** A row histories the same prompt even when it carries no idempotency key. */
function samePromptRow(row: ChatMsg, prompt: ChatMsg): boolean {
  if (row.role !== 'user' || row.idempotencyKey) return false;
  const rowText = (row.rawText || '').trim();
  const promptText = (prompt.rawText || '').trim();
  if (!rowText || rowText !== promptText) return false;
  return Math.abs(row.timestamp.getTime() - prompt.timestamp.getTime()) < LOCAL_PROMPT_GRACE_MS;
}

/**
 * Keep the rows the previous transcript gained after the history window ends.
 * Reads are answered out of order, so a full read handled before a row was
 * committed can land after a newer read put that row on screen; history only
 * grows, so dropping such a row is wrong. The previous rows strictly newer than
 * the last history row were necessarily committed after this read's snapshot.
 */
function restoreRowsAfterWindow(merged: ChatMsg[], previous: ChatMsg[], history: ChatMsg[]): ChatMsg[] {
  if (history.length === 0) return merged;
  const lastAt = history[history.length - 1].timestamp.getTime();
  const firstNewer = previous.findIndex((msg) => msg.timestamp.getTime() > lastAt);
  if (firstNewer < 0) return merged;

  const present = new Set(merged);
  const ids = new Set(merged.map(transcriptRowId).filter(Boolean));
  // A live reply with no transcript id and history's copy are one row; keep the
  // copy that carries the id. The two clocks can differ by a few seconds (and a
  // 30-second content bucket would miss a boundary), so compare the text and a
  // short window rather than the bucket. Rows that both carry ids are compared
  // by id only, so two identical replies from different turns stay apart.
  const recordedReplies = merged
    .filter((msg) => msg.role === 'assistant' && transcriptRowId(msg) !== null)
    .map((msg) => ({ text: (msg.rawText || '').trim(), at: msg.timestamp.getTime() }));
  const isRecordedReply = (msg: ChatMsg) => {
    const text = (msg.rawText || '').trim();
    if (!text) return false;
    return recordedReplies.some((row) => row.text === text && Math.abs(row.at - msg.timestamp.getTime()) < 10_000);
  };
  const result = [...merged];
  for (const msg of previous.slice(firstNewer)) {
    // Prompts are restored separately, with the send-key and grace checks; a
    // recorded later in this same suffix collapses its local copy there. Local
    // notices (a send error) belong to that prompt and a reload drops them too.
    if (isLocalPrompt(msg)) continue;
    if (msg.role === 'system' && transcriptRowId(msg) === null) continue;
    if (present.has(msg)) continue;
    const id = transcriptRowId(msg);
    if (id && ids.has(id)) continue;
    if (!id && msg.role === 'assistant' && isRecordedReply(msg)) continue;
    result.push(msg);
    present.add(msg);
    if (id) {
      ids.add(id);
      if (msg.role === 'assistant') recordedReplies.push({ text: (msg.rawText || '').trim(), at: msg.timestamp.getTime() });
    }
  }
  return result;
}

/**
 * A transcript rebuilt from a full history read, keeping the prompts from the
 * previous transcript that are still sending, failed, or too recently accepted
 * for the read to hold their row yet, and any rows on screen that are newer
 * than the read's window.
 */
export function keepUnsentMessages(previous: ChatMsg[], history: ChatMsg[]): ChatMsg[] {
  return restoreUnsentPrompts(restoreRowsAfterWindow(history, previous, history), previous, 0);
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
    const merged = collapseRecordedPrompts([...prefix, ...overlapped, ...recovered.slice(overlap)]);
    return restoreUnsentPrompts(merged, existing.slice(start), Math.min(prefix.length, merged.length));
  }

  // Anchor path: find a matching point in the existing tail and replace only suffix.
  const anchor = findTailAnchor(existing.length, recovered.length, same);
  if (anchor) {
    const patchedTail = recovered.slice(anchor.recoveredIdx);
    const preservedPrefix = withoutRecoveredEntries(existing.slice(0, anchor.existingIdx), patchedTail);
    const combined = insertMissingRecoveredRows([...preservedPrefix, ...patchedTail], recovered);
    const merged = collapseRecordedPrompts(combined);
    return restoreUnsentPrompts(merged, existing.slice(anchor.existingIdx), Math.min(preservedPrefix.length, merged.length));
  }

  // Last resort: no overlap or anchor, so the recovered window replaces the
  // transcript (an older prefix outside it is lost, as before). Only prompts not
  // sent yet carry over; any other local row could be a copy of a recovered row
  // that no longer matches, so keeping it could show it twice.
  return restoreUnsentPrompts(recovered, existing, 0);
}
