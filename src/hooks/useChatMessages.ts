/**
 * useChatMessages — Message CRUD, deduplication, normalization, and history
 *
 * Manages the full message buffer, visible window for infinite scroll,
 * history loading, and message merge/dedup utilities.
 */
import { useState, useRef, useCallback, useMemo } from 'react';
import { loadChatHistory } from '@/features/chat/operations';
import { generateMsgId } from '@/features/chat/types';
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

export function mergeFinalMessages(existing: ChatMsg[], incoming: ChatMsg[]): ChatMsg[] {
  if (incoming.length === 0) return existing;
  const merged = [...existing];

  for (const msg of incoming) {
    const last = merged[merged.length - 1];

    if (last && isLikelyDuplicateMessage(last, msg)) {
      merged[merged.length - 1] = msg;
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
}

export function useChatMessages({ rpc, currentSessionRef }: UseChatMessagesDeps) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [, setVisibleCount] = useState(DEFAULT_VISIBLE_COUNT);
  const [hasMore, setHasMore] = useState(false);

  // Full history buffer + visible window for infinite scroll
  const allMessagesRef = useRef<ChatMsg[]>([]);
  const visibleCountRef = useRef(DEFAULT_VISIBLE_COUNT);

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
    try {
      const result = await loadChatHistory({ rpc, sessionKey: sk, limit: 500 });
      applyMessageWindow(result, true);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      allMessagesRef.current = [];
      setHasMore(false);
      setMessages(prev => [...prev, {
        msgId: generateMsgId(), role: 'system' as const, html: 'Failed to load history: ' + errMsg, rawText: '', timestamp: new Date(),
      }]);
    }
  }, [applyMessageWindow, currentSessionRef, rpc]);

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
    allMessagesRef.current = [];
  }, []);

  return useMemo(() => ({
    messages,
    setMessages,
    hasMore,
    applyMessageWindow,
    loadHistory,
    loadMore,
    getAllMessages,
    setAllMessages,
    resetMessageState,
  }), [
    messages,
    hasMore,
    setMessages,
    applyMessageWindow,
    loadHistory,
    loadMore,
    getAllMessages,
    setAllMessages,
    resetMessageState,
  ]);
}
