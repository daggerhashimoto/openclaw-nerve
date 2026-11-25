/**
 * useChatMessages — Message CRUD, deduplication, normalization, and history
 *
 * Manages the full message buffer, visible window for infinite scroll,
 * history loading, and message merge/dedup utilities.
 */
import { useState, useRef, useCallback, useMemo } from 'react';
import { isUnsentPrompt, keepUnsentMessages, loadChatHistory, transcriptRowId } from '@/features/chat/operations';
import { generateMsgId, systemNotice } from '@/features/chat/types';
import type { ChatMsg } from '@/features/chat/types';

// ─── Constants ──────────────────────────────────────────────────────────────────

export const DEFAULT_VISIBLE_COUNT = 50;
const LOAD_MORE_BATCH = 30;

// ─── Pure helpers (exported for testing / reuse) ────────────────────────────────

export function normalizeComparableText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function isLikelyDuplicateMessage(a: ChatMsg, b: ChatMsg): boolean {
  // Require timestamps within 60s to avoid suppressing legitimately repeated messages.
  const timeDiffMs = Math.abs(a.timestamp.getTime() - b.timestamp.getTime());
  if (timeDiffMs > 60_000) return false;

  // Compare extracted image URLs — same text with different images is NOT a duplicate.
  const aImgs = (a.extractedImages || []).map(i => i.url).sort().join('|');
  const bImgs = (b.extractedImages || []).map(i => i.url).sort().join('|');

  return (
    a.role === b.role &&
    normalizeComparableText(a.rawText) === normalizeComparableText(b.rawText) &&
    Boolean(a.isThinking) === Boolean(b.isThinking) &&
    (a.toolGroup?.length || 0) === (b.toolGroup?.length || 0) &&
    (a.images?.length || 0) === (b.images?.length || 0) &&
    aImgs === bImgs
  );
}

/**
 * Index of the first row of the turn a live final belongs to: the row after the
 * latest prompt. A prompt still sending or not sent is not in the transcript yet,
 * so it does not start a turn.
 */
function currentTurnStart(msgs: ChatMsg[]): number {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user' && !isUnsentPrompt(msgs[i])) return i + 1;
  }
  return 0;
}

/**
 * Index of the reply history recorded as the last one of run `runId` when its text
 * is the live final's, or -1. The gateway marks one such reply per run, so it is
 * this final wherever it sits and however far apart their times are: a compaction
 * can hold the final back for minutes, and a prompt sent meanwhile starts a new
 * turn. The history copy can also carry an attachment the final lacks.
 */
function runTerminalCopy(msgs: ChatMsg[], live: ChatMsg, runId: string | undefined, claimed: Set<ChatMsg>): number {
  if (!runId || live.role !== 'assistant' || live.isThinking) return -1;
  const text = normalizeComparableText(live.rawText);
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].terminalRunId === runId && !claimed.has(msgs[i]) && normalizeComparableText(msgs[i].rawText) === text) return i;
  }
  return -1;
}

/**
 * Merge the rows of a live final into the transcript. `runId` is the run the final
 * frame names, when it names one.
 */
export function mergeFinalMessages(existing: ChatMsg[], incoming: ChatMsg[], runId?: string): ChatMsg[] {
  if (incoming.length === 0) return existing;
  const merged = [...existing];
  // Rows that already took an incoming row's place, so one row never stands in for two.
  const claimed = new Set<ChatMsg>();

  for (const msg of incoming) {
    let match = runTerminalCopy(merged, msg, runId, claimed);
    // Otherwise a history read can show the reply before its live final arrives, and
    // by then other rows can follow it (a tool result, a system line), so the whole
    // turn is searched, not just the last row. A live final carries no transcript id,
    // so the match is by content and time (isLikelyDuplicateMessage).
    const turnStart = currentTurnStart(merged);
    for (let i = merged.length - 1; match < 0 && i >= turnStart; i--) {
      if (!claimed.has(merged[i]) && isLikelyDuplicateMessage(merged[i], msg)) match = i;
    }
    if (match >= 0) {
      // The history copy stays: it has the transcript id and whatever history adds to it.
      if (transcriptRowId(merged[match])) {
        claimed.add(merged[match]);
      } else {
        merged[match] = msg;
        claimed.add(msg);
      }
      continue;
    }

    // Avoid duplicating optimistic user bubbles if final payload repeats them.
    if (msg.role === 'user') {
      const recent = merged.slice(-6);
      const msgImgs = (msg.extractedImages || []).map(i => i.url).sort().join('|');
      const duplicateRecentUser = recent.some(
        (m) => {
          if (m.role !== 'user') return false;
          if (normalizeComparableText(m.rawText) !== normalizeComparableText(msg.rawText)) return false;
          const mImgs = (m.extractedImages || []).map(i => i.url).sort().join('|');
          return mImgs === msgImgs;
        },
      );
      if (duplicateRecentUser) continue;
    }

    merged.push(msg.msgId ? msg : { ...msg, msgId: generateMsgId() });
  }

  return merged;
}

export function patchThinkingDuration(messages: ChatMsg[], durationMs: number): ChatMsg[] {
  if (!durationMs || durationMs <= 0) return messages;

  const updated = [...messages];
  const lastUserIdx = updated.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1);

  for (let i = updated.length - 1; i > lastUserIdx; i--) {
    if (updated[i].role === 'assistant' && updated[i].isThinking) {
      updated[i] = { ...updated[i], thinkingDurationMs: durationMs };
      return updated;
    }
  }

  return messages;
}

// ─── Hook ───────────────────────────────────────────────────────────────────────

interface UseChatMessagesDeps {
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  currentSessionRef: React.RefObject<string>;
  onLatestHeartbeat?: (at: number | null) => void;
}

export function useChatMessages({ rpc, currentSessionRef, onLatestHeartbeat }: UseChatMessagesDeps) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [, setVisibleCount] = useState(DEFAULT_VISIBLE_COUNT);
  const [hasMore, setHasMore] = useState(false);
  // True once the current room's history has been fetched (or failed), so an empty room can say so
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // Full history buffer + visible window for infinite scroll
  const allMessagesRef = useRef<ChatMsg[]>([]);
  const visibleCountRef = useRef(DEFAULT_VISIBLE_COUNT);
  // Identity of the latest history request; a reset or a newer load makes earlier completions stale
  const historyRequestRef = useRef(0);

  /** Apply the windowed view of messages to React state. */
  const applyMessageWindow = useCallback((all: ChatMsg[], resetVisibleWindow = false) => {
    allMessagesRef.current = all;

    if (resetVisibleWindow) {
      const nextVisible = all.length <= DEFAULT_VISIBLE_COUNT ? all.length : DEFAULT_VISIBLE_COUNT;
      setVisibleCount(nextVisible);
      visibleCountRef.current = nextVisible;
      setHasMore(all.length > nextVisible);
      setMessages(all.slice(-nextVisible));
      return;
    }

    const currentVisible = all.length === 0
      ? 0
      : Math.max(DEFAULT_VISIBLE_COUNT, Math.min(visibleCountRef.current, all.length));
    setHasMore(all.length > currentVisible);
    setMessages(all.slice(-currentVisible));
  }, []);

  /** Load chat history from the gateway. */
  const loadHistory = useCallback(async (session?: string) => {
    const sk = session || currentSessionRef.current;
    const requestId = ++historyRequestRef.current;
    const isCurrent = () => historyRequestRef.current === requestId;
    try {
      const result = await loadChatHistory({
        rpc,
        sessionKey: sk,
        limit: 500,
        onLatestHeartbeat: (at) => {
          if (isCurrent() && sk === currentSessionRef.current) onLatestHeartbeat?.(at);
        },
      });
      if (!isCurrent()) return;
      // Prompts still sending or that failed to send are not in history; keep them
      // (read now, so one sent while the request was out is kept too).
      const sameRoom = sk === currentSessionRef.current;
      applyMessageWindow(sameRoom ? keepUnsentMessages(allMessagesRef.current, result) : result, true);
    } catch (e) {
      if (!isCurrent()) return;
      const errMsg = e instanceof Error ? e.message : String(e);
      allMessagesRef.current = [];
      setHasMore(false);
      setMessages(prev => [...prev, systemNotice(`Failed to load history: ${errMsg}`)]);
    } finally {
      if (isCurrent()) setHistoryLoaded(true);
    }
  }, [applyMessageWindow, currentSessionRef, onLatestHeartbeat, rpc]);

  /** Load more (older) messages — returns true if there are still more to show. */
  const loadMore = useCallback(() => {
    const all = allMessagesRef.current;
    const currentVisible = visibleCountRef.current;
    if (all.length <= currentVisible) {
      setHasMore(false);
      return false;
    }

    const newCount = Math.min(all.length, currentVisible + LOAD_MORE_BATCH);
    setVisibleCount(newCount);
    visibleCountRef.current = newCount;
    setMessages(all.slice(-newCount));
    const stillMore = newCount < all.length;
    setHasMore(stillMore);
    return stillMore;
  }, []);

  /** Get all messages (full buffer, not just visible window). */
  const getAllMessages = useCallback(() => allMessagesRef.current, []);

  /** Set all messages buffer directly, or via functional updater for atomic read-then-write. */
  const setAllMessages = useCallback((updater: ChatMsg[] | ((prev: ChatMsg[]) => ChatMsg[])) => {
    allMessagesRef.current = typeof updater === 'function' ? updater(allMessagesRef.current) : updater;
  }, []);

  /** Reset message state (for session switch). */
  const resetMessageState = useCallback(() => {
    setMessages([]);
    setVisibleCount(DEFAULT_VISIBLE_COUNT);
    visibleCountRef.current = DEFAULT_VISIBLE_COUNT;
    setHasMore(false);
    setHistoryLoaded(false);
    historyRequestRef.current += 1;
    allMessagesRef.current = [];
  }, []);

  return useMemo(() => ({
    messages,
    setMessages,
    hasMore,
    historyLoaded,
    applyMessageWindow,
    loadHistory,
    loadMore,
    getAllMessages,
    setAllMessages,
    resetMessageState,
  }), [
    messages,
    hasMore,
    historyLoaded,
    setMessages,
    applyMessageWindow,
    loadHistory,
    loadMore,
    getAllMessages,
    setAllMessages,
    resetMessageState,
  ]);
}
