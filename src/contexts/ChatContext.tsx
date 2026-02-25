/**
 * ChatContext - Manages chat state, messaging, and streaming
 *
 * This context is a thin wrapper that wires pure operation functions
 * (from @/features/chat/operations/) to React state.
 *
 * Business logic lives in the operations layer; this file handles only:
 * - React state declarations
 * - Ref management for stable callback references
 * - Wiring operations → setState
 * - Subscribing to gateway events
 */
import { createContext, useContext, useCallback, useRef, useEffect, useState, useMemo, type ReactNode } from 'react';
import { useGateway } from './GatewayContext';
import { useSessionContext } from './SessionContext';
import { useSettings } from './SettingsContext';
import { getSessionKey, type GatewayEvent } from '@/types';
import { renderMarkdown, renderToolResults } from '@/utils/helpers';
import { playPing } from '@/features/voice/audio-feedback';
import {
  loadChatHistory,
  processChatMessages,
  buildUserMessage,
  sendChatMessage,
  classifyStreamEvent,
  extractStreamDelta,
  extractFinalMessage,
  extractFinalMessages,
  buildActivityLogEntry,
  markToolCompleted,
  appendActivityEntry,
  deriveProcessingStage,
  isActiveAgentState,
  mergeRecoveredTail,
  getOrCreateRunState,
  hasSeqGap,
  pruneRunRegistry,
  resolveRunId,
  createFallbackRunId,
  updateHighestSeq,
} from '@/features/chat/operations';
import { generateMsgId } from '@/features/chat/types';
import type { ImageAttachment, ChatMsg } from '@/features/chat/types';
import type { RecoveryReason, RunState } from '@/features/chat/operations';

// ─── Voice TTS fallback helper ─────────────────────────────────────────────────

const FALLBACK_MAX_CHARS = 300;
const DEFAULT_VISIBLE_COUNT = 50;

const RECOVERY_LIMITS: Record<RecoveryReason, number> = {
  'unrenderable-final': 40,
  'frame-gap': 80,
  'chat-gap': 80,
  reconnect: 120,
  'subagent-complete': 500,
};

/** Strip code blocks, markdown noise, and validate text is speakable for TTS fallback. */
function buildVoiceFallbackText(raw: string): string | null {
  // Strip fenced code blocks
  let text = raw.replace(/```[\s\S]*?```/g, '');
  // Strip inline code
  text = text.replace(/`[^`]+`/g, '');
  // Strip markdown images/links
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Strip markdown formatting (bold, italic, headers, hr)
  text = text.replace(/#{1,6}\s+/g, '');
  text = text.replace(/[*_~]{1,3}/g, '');
  text = text.replace(/^---+$/gm, '');
  // Collapse whitespace
  text = text.replace(/\n{2,}/g, '. ').replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
  // Must have at least 3 word-like characters to be speakable
  if (!/[a-zA-Z]{3,}/.test(text)) return null;
  // Cap length
  if (text.length > FALLBACK_MAX_CHARS) {
    text = text.slice(0, FALLBACK_MAX_CHARS).replace(/\s\S*$/, '') + '…';
  }
  return text;
}

function normalizeComparableText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function isLikelyDuplicateMessage(a: ChatMsg, b: ChatMsg): boolean {
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

function mergeFinalMessages(existing: ChatMsg[], incoming: ChatMsg[]): ChatMsg[] {
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

    if (!msg.msgId) msg.msgId = generateMsgId();
    merged.push(msg);
  }

  return merged;
}

function patchThinkingDuration(messages: ChatMsg[], durationMs: number): ChatMsg[] {
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

/** Processing stages for enhanced thinking indicator */
export type ProcessingStage = 'thinking' | 'tool_use' | 'streaming' | null;

/** A single entry in the activity log */
export interface ActivityLogEntry {
  id: string;           // toolCallId or generated unique id
  toolName: string;     // raw tool name (e.g., 'read', 'exec')
  description: string;  // human-friendly from describeToolUse()
  startedAt: number;    // Date.now() when tool started
  completedAt?: number; // Date.now() when result received
  phase: 'running' | 'completed';
}

export interface ChatStreamState {
  html: string;
  runId?: string;
  isRecovering?: boolean;
  recoveryReason?: RecoveryReason | null;
}

interface ChatContextValue {
  messages: ChatMsg[];
  isGenerating: boolean;
  stream: ChatStreamState;
  processingStage: ProcessingStage;
  lastEventTimestamp: number;
  activityLog: ActivityLogEntry[];
  currentToolDescription: string | null;
  handleSend: (text: string, images?: ImageAttachment[]) => Promise<void>;
  handleAbort: () => Promise<void>;
  handleReset: () => void;
  loadHistory: (session?: string) => Promise<void>;
  /** Load more (older) messages — returns true if there are still more to show */
  loadMore: () => boolean;
  /** Whether there are older messages available to load */
  hasMore: boolean;
  /** Reset confirmation dialog state — rendered by the consumer, not the provider */
  showResetConfirm: boolean;
  confirmReset: () => Promise<void>;
  cancelReset: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

interface StreamFlushState {
  runId: string | null;
  text: string;
  rafId: number | null;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

interface RecoveryState {
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
  reason: RecoveryReason | null;
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const { connectionState, rpc, subscribe } = useGateway();
  const { currentSession, sessions } = useSessionContext();
  const { soundEnabled, speak } = useSettings();

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE_COUNT);
  const [hasMore, setHasMore] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [stream, setStream] = useState<ChatStreamState>({ html: '', isRecovering: false, recoveryReason: null });
  const [processingStage, setProcessingStage] = useState<ProcessingStage>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [lastEventTimestamp, setLastEventTimestamp] = useState<number>(0);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);

  // Full history buffer + visible window for infinite scroll
  const allMessagesRef = useRef<ChatMsg[]>([]);
  const visibleCountRef = useRef(DEFAULT_VISIBLE_COUNT);
  const LOAD_MORE_BATCH = 30;

  const runsRef = useRef<Map<string, RunState>>(new Map());
  const activeRunIdRef = useRef<string | null>(null);
  const lastGatewaySeqRef = useRef<number | null>(null);
  const toolResultRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastChatSeqRef = useRef<number | null>(null);

  const streamFlushRef = useRef<StreamFlushState>({ runId: null, text: '', rafId: null, timeoutId: null });
  const recoveryRef = useRef<RecoveryState>({ timer: null, inFlight: false, reason: null });
  // Generation counter: incremented on session switch and chat_final apply.
  // Recovery callbacks compare their captured generation to discard stale results.
  const recoveryGenerationRef = useRef(0);

  const playedSoundsRef = useRef<Set<string>>(new Set());
  // Track whether we were generating at disconnect, for conditional reconnect recovery.
  const wasGeneratingOnDisconnectRef = useRef(false);

  // Voice message tracking for TTS fallback
  const lastMessageWasVoiceRef = useRef(false);

  // Thinking duration tracking (gateway doesn't stream thinking content)
  const thinkingStartRef = useRef<number | null>(null);
  const thinkingDurationRef = useRef<number | null>(null);
  const thinkingRunIdRef = useRef<string | null>(null);

  // Refs for stable callback references — synced in a single effect
  const currentSessionRef = useRef(currentSession);
  const isGeneratingRef = useRef(isGenerating);
  const soundEnabledRef = useRef(soundEnabled);
  const speakRef = useRef(speak);

  useEffect(() => {
    currentSessionRef.current = currentSession;
    isGeneratingRef.current = isGenerating;
    soundEnabledRef.current = soundEnabled;
    speakRef.current = speak;
    visibleCountRef.current = visibleCount;
  }, [currentSession, isGenerating, soundEnabled, speak, visibleCount]);

  // Derive currentToolDescription from activityLog — no separate state needed
  const currentToolDescription = useMemo(() => {
    const lastRunning = [...activityLog].reverse().find(e => e.phase === 'running');
    return lastRunning ? lastRunning.description : null;
  }, [activityLog]);

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

  const clearScheduledStreamFlush = useCallback(() => {
    const flush = streamFlushRef.current;
    if (flush.rafId !== null) {
      cancelAnimationFrame(flush.rafId);
      flush.rafId = null;
    }
    if (flush.timeoutId) {
      clearTimeout(flush.timeoutId);
      flush.timeoutId = null;
    }
  }, []);

  const flushStreamingUpdate = useCallback(() => {
    const flush = streamFlushRef.current;
    clearScheduledStreamFlush();

    const html = renderToolResults(renderMarkdown(flush.text, { highlight: false }));
    setStream(prev => ({
      ...prev,
      html,
      runId: flush.runId || undefined,
    }));
  }, [clearScheduledStreamFlush]);

  const scheduleStreamingUpdate = useCallback((runId: string, text: string) => {
    const flush = streamFlushRef.current;
    flush.runId = runId;
    flush.text = text;

    if (flush.rafId !== null || flush.timeoutId) return;

    if (document.hidden) {
      flush.timeoutId = setTimeout(() => {
        flush.timeoutId = null;
        flushStreamingUpdate();
      }, 32);
      return;
    }

    flush.rafId = requestAnimationFrame(() => {
      flush.rafId = null;
      // Clear the fallback timeout — rAF already handled it.
      if (flush.timeoutId) {
        clearTimeout(flush.timeoutId);
        flush.timeoutId = null;
      }
      flushStreamingUpdate();
    });

    // Hidden-tab / throttled-rAF fallback — only fires if rAF didn't.
    flush.timeoutId = setTimeout(() => {
      if (flush.rafId !== null) {
        cancelAnimationFrame(flush.rafId);
        flush.rafId = null;
      }
      flush.timeoutId = null;
      flushStreamingUpdate();
    }, 120);
  }, [flushStreamingUpdate]);

  const clearRecoveryTimer = useCallback(() => {
    if (recoveryRef.current.timer) {
      clearTimeout(recoveryRef.current.timer);
      recoveryRef.current.timer = null;
    }
  }, []);

  const triggerRecovery = useCallback((reason: RecoveryReason) => {
    if (recoveryRef.current.inFlight) return;

    clearRecoveryTimer();
    recoveryRef.current.reason = reason;
    setStream(prev => ({ ...prev, isRecovering: true, recoveryReason: reason }));

    const capturedGeneration = recoveryGenerationRef.current;

    recoveryRef.current.timer = setTimeout(async () => {
      recoveryRef.current.timer = null;
      if (recoveryRef.current.inFlight) return;

      // Discard stale recovery if generation changed (session switch or chat_final applied).
      if (capturedGeneration !== recoveryGenerationRef.current) {
        setStream(prev => ({ ...prev, isRecovering: false, recoveryReason: null }));
        return;
      }

      recoveryRef.current.inFlight = true;
      try {
        const recovered = await loadChatHistory({
          rpc,
          sessionKey: currentSessionRef.current,
          limit: RECOVERY_LIMITS[reason],
        });

        // Check generation again after async fetch — another session switch or
        // chat_final may have occurred while we were loading.
        if (capturedGeneration !== recoveryGenerationRef.current) return;

        // When streaming is active, the recovered transcript may include the
        // partial assistant text that the streaming bubble is already showing.
        // Filter it out to avoid duplication, but keep thinking blocks so the
        // user can see reasoning in real time.
        const activeRun = activeRunIdRef.current;
        const activeBuffer = activeRun
          ? runsRef.current.get(activeRun)?.bufferText || ''
          : '';
        const filtered = activeBuffer.length > 0
          ? recovered.filter(msg => {
            // Always keep non-assistant messages (user, system, etc.)
            if (msg.role !== 'assistant') return true;
            // Always keep thinking blocks
            if (msg.isThinking) return true;
            // Always keep tool groups / intermediate tool messages
            if (msg.toolGroup || msg.intermediate) return true;
            // Drop assistant text that duplicates the active stream buffer.
            // Require minimum length to avoid suppressing short legitimate messages
            // like "Yes." or "Done" that could be common substrings.
            const text = (msg.rawText || '').trim();
            if (text.length >= 20 && activeBuffer.includes(text)) return false;
            // For short texts, require exact match with the buffer (normalized).
            if (text && text.length < 20 && activeBuffer.trim() === text) return false;
            return true;
          })
          : recovered;

        const merged = mergeRecoveredTail(allMessagesRef.current, filtered);
        applyMessageWindow(merged, false);
      } catch (err) {
        console.debug('[ChatContext] Recovery failed:', err);
      } finally {
        recoveryRef.current.inFlight = false;
        recoveryRef.current.reason = null;
        setStream(prev => ({ ...prev, isRecovering: false, recoveryReason: null }));
      }
    }, 180);
  }, [applyMessageWindow, clearRecoveryTimer, rpc]);

  // Cleanup stream flush/recovery timers on unmount
  useEffect(() => {
    return () => {
      clearScheduledStreamFlush();
      clearRecoveryTimer();
    };
  }, [clearScheduledStreamFlush, clearRecoveryTimer]);

  // ─── Load history (delegates to pure function) ───────────────────────────────
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
        msgId: generateMsgId(), role: 'system', html: 'Failed to load history: ' + errMsg, rawText: '', timestamp: new Date(),
      }]);
    }
  }, [applyMessageWindow, rpc]);

  // ─── Load more (older) messages for infinite scroll ──────────────────────────
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

  // ─── Reset transient state on session switch ─────────────────────────────────
  useEffect(() => {
    setStream({ html: '', isRecovering: false, recoveryReason: null });
    setIsGenerating(false);
    setProcessingStage(null);
    setActivityLog([]);
    setLastEventTimestamp(0);
    setVisibleCount(DEFAULT_VISIBLE_COUNT);
    visibleCountRef.current = DEFAULT_VISIBLE_COUNT;
    setHasMore(false);
    allMessagesRef.current = [];
    runsRef.current.clear();
    activeRunIdRef.current = null;
    lastGatewaySeqRef.current = null;
    lastChatSeqRef.current = null;
    thinkingStartRef.current = null;
    thinkingDurationRef.current = null;
    thinkingRunIdRef.current = null;
    clearScheduledStreamFlush();
    clearRecoveryTimer();
    if (toolResultRefreshRef.current) {
      clearTimeout(toolResultRefreshRef.current);
      toolResultRefreshRef.current = null;
    }
    recoveryRef.current.inFlight = false;
    recoveryRef.current.reason = null;
    // Invalidate any in-flight recovery so stale results are discarded.
    recoveryGenerationRef.current += 1;
    wasGeneratingOnDisconnectRef.current = false;
  }, [clearRecoveryTimer, clearScheduledStreamFlush, currentSession]);

  // Load history on initial connect/session switch; recover tail on reconnect.
  const previousConnectionStateRef = useRef(connectionState);
  useEffect(() => {
    const prevConnection = previousConnectionStateRef.current;

    if (connectionState === 'connected') {
      if (prevConnection === 'reconnecting' && wasGeneratingOnDisconnectRef.current) {
        // Only trigger tail-merge recovery if we were generating at disconnect time.
        triggerRecovery('reconnect');
      } else {
        // Full history load for initial connect, session switch, or idle reconnect.
        loadHistory(currentSession);
      }
      wasGeneratingOnDisconnectRef.current = false;
    }

    // Capture generating/active-run state when entering reconnecting.
    if (connectionState === 'reconnecting' && prevConnection === 'connected') {
      wasGeneratingOnDisconnectRef.current =
        isGeneratingRef.current || Boolean(activeRunIdRef.current);
    }

    previousConnectionStateRef.current = connectionState;
  }, [connectionState, currentSession, loadHistory, triggerRecovery]);

  // Periodic history poll for sub-agent sessions.
  // The gateway doesn't emit intermediate agent events (thinking, tool use) for
  // sub-agents on the parent WS connection, and intermediate messages may not be
  // committed to history until each tool call completes. Poll every 3s to pick up
  // new content while the sub-agent is active. Stops when session state is idle/done.
  const isSubagentSession = currentSession?.includes(':subagent:') ?? false;
  const subagentSessionState = isSubagentSession
    ? sessions.find(s => getSessionKey(s) === currentSession)?.state?.toLowerCase()
    : undefined;
  const DONE_STATES = new Set(['idle', 'done', 'completed', 'error', 'aborted', 'timeout', 'stopped', 'finished', 'ended', 'cancelled']);
  const isSubagentActive = isSubagentSession && !(subagentSessionState && DONE_STATES.has(subagentSessionState));
  const subagentPollInFlightRef = useRef(false);
  useEffect(() => {
    if (!isSubagentActive || connectionState !== 'connected') return;

    const pollInterval = setInterval(async () => {
      if (subagentPollInFlightRef.current) return; // single-flight guard
      subagentPollInFlightRef.current = true;
      try {
        const sk = currentSessionRef.current;
        const result = await loadChatHistory({ rpc, sessionKey: sk, limit: 500 });
        // Only apply if still viewing the same session (stale guard)
        if (sk !== currentSessionRef.current) return;
        // Skip if nothing changed — prevents unnecessary re-renders/flashes.
        // msgIds are regenerated each parse, so compare by count + last message content.
        const prev = allMessagesRef.current;
        if (
          result.length === prev.length &&
          result.length > 0 &&
          result[result.length - 1]?.rawText === prev[prev.length - 1]?.rawText &&
          result[result.length - 1]?.role === prev[prev.length - 1]?.role
        ) return; // no change
        applyMessageWindow(result, false); // non-reset: preserve scroll position
      } catch { /* best-effort */ } finally {
        subagentPollInFlightRef.current = false;
      }
    }, 3000);

    return () => {
      clearInterval(pollInterval);
      subagentPollInFlightRef.current = false;
    };
  }, [isSubagentActive, connectionState, currentSession, rpc, applyMessageWindow]);

  // One-shot watchdog while generating: if stream stalls, recover once.
  useEffect(() => {
    if (!isGenerating || !lastEventTimestamp) return;

    const timer = setTimeout(() => {
      const elapsed = Date.now() - lastEventTimestamp;
      if (elapsed >= 12_000 && !recoveryRef.current.inFlight && !recoveryRef.current.timer) {
        triggerRecovery('chat-gap');
      }
    }, 12_000);

    return () => clearTimeout(timer);
  }, [isGenerating, lastEventTimestamp, triggerRecovery]);

  // ─── Subscribe to streaming events ───────────────────────────────────────────
  useEffect(() => {
    return subscribe((msg: GatewayEvent) => {
      // ── Per-event recovery deduplication ───────────────────────────────────
      // A single event can trip multiple gap checks (frame-gap + chat-gap + per-run gap).
      // Trigger recovery at most once per event to avoid resetting the debounce timer.
      let recoveryTriggeredThisEvent = false;
      const triggerRecoveryOnce = (reason: RecoveryReason) => {
        if (recoveryTriggeredThisEvent) return;
        recoveryTriggeredThisEvent = true;
        triggerRecovery(reason);
      };

      const classified = classifyStreamEvent(msg);
      if (!classified) return;


      // Sub-agent completion: when a child session finishes, refresh parent history
      // since the gateway doesn't emit events on the parent session.
      const currentSk = currentSessionRef.current;
      if (classified.sessionKey !== currentSk) {
        if (
          classified.sessionKey?.startsWith(currentSk + ':subagent:') &&
          (classified.type === 'chat_final' || classified.type === 'lifecycle_end')
        ) {
          triggerRecovery('subagent-complete');
        }
        return;
      }

      // Track gateway frame sequence — only for current session to avoid
      // false-positive gap recovery from unrelated event traffic.
      if (typeof msg.seq === 'number') {
        if (hasSeqGap(lastGatewaySeqRef.current, msg.seq) && (isGeneratingRef.current || Boolean(activeRunIdRef.current))) {
          triggerRecoveryOnce('frame-gap');
        }
        lastGatewaySeqRef.current = updateHighestSeq(lastGatewaySeqRef.current, msg.seq);
      }

      const { type } = classified;

      // ── Agent events ──────────────────────────────────────────────────────
      if (classified.source === 'agent') {
        const ap = classified.agentPayload!;

        if (type === 'lifecycle_start') {
          setIsGenerating(true);
          setProcessingStage('thinking');
          setLastEventTimestamp(Date.now());
          return;
        }

        if (type === 'lifecycle_end') {
          setIsGenerating(false);
          setProcessingStage(null);
          setActivityLog([]);
          setLastEventTimestamp(0);
          if (soundEnabledRef.current) playPing();

          // Invalidate stale in-flight recovery before scheduling lifecycle recovery.
          recoveryGenerationRef.current += 1;

          // CLI agents (Codex, Claude Code CLI) only emit lifecycle_end, not chat_final.
          // If the active run wasn't finalized via chat_final, trigger recovery to load
          // the final transcript.
          const activeRun = activeRunIdRef.current;
          const runFinalized = activeRun ? runsRef.current.get(activeRun)?.finalized : false;
          if (!runFinalized) {
            triggerRecovery('reconnect');
          }

          // lifecycle_end ends the turn for CLI streams even without chat_final.
          // Clear stale active-run marker to avoid reconnect false positives.
          activeRunIdRef.current = null;
          return;
        }

        if (type === 'assistant_stream') {
          setProcessingStage('streaming');
          setLastEventTimestamp(Date.now());
          return;
        }

        // Mid-stream join detection
        const agentState = ap.state || ap.agentState;
        if (!isGeneratingRef.current && agentState && isActiveAgentState(agentState)) {
          setIsGenerating(true);
        }

        setLastEventTimestamp(Date.now());

        if (type === 'agent_tool_start') {
          setProcessingStage('tool_use');
          const entry = buildActivityLogEntry(ap);
          if (entry) {
            setActivityLog(prev => appendActivityEntry(prev, entry));
          }
          return;
        }


        if (type === 'agent_tool_result') {
          const completedId = ap.data?.toolCallId;
          if (completedId) {
            setActivityLog(prev => markToolCompleted(prev, completedId));
          }
          // Merge new thinking/tool messages from completed steps without resetting.
          // Debounced to coalesce rapid tool completions into one fetch.
          if (toolResultRefreshRef.current) clearTimeout(toolResultRefreshRef.current);
          const capturedSession = currentSessionRef.current;
          const capturedGeneration = recoveryGenerationRef.current;
          toolResultRefreshRef.current = setTimeout(async () => {
            toolResultRefreshRef.current = null;
            try {
              const recovered = await loadChatHistory({
                rpc,
                sessionKey: capturedSession,
                limit: 100,
              });
              // Stale guard: discard if session switched or generation changed
              if (capturedSession !== currentSessionRef.current) return;
              if (capturedGeneration !== recoveryGenerationRef.current) return;
              if (recovered.length > 0) {
                const merged = mergeRecoveredTail(allMessagesRef.current, recovered);
                applyMessageWindow(merged, false);
              }
            } catch { /* best-effort */ }
          }, 300);
          return;
        }

        if (type === 'agent_state' && agentState) {
          const stage = deriveProcessingStage(agentState);
          if (stage) setProcessingStage(stage);
        }
        return;
      }

      // ── Chat events ───────────────────────────────────────────────────────
      const cp = classified.chatPayload!;
      const activeRunBefore = activeRunIdRef.current;
      const runId = resolveRunId(classified.runId, activeRunBefore)
        // Fallback: no runId on event and no active run — create a local run
        // so reconnect/mid-stream-join scenarios aren't silently dropped.
        ?? createFallbackRunId(currentSessionRef.current);

      const run = getOrCreateRunState(runsRef.current, runId, currentSessionRef.current);
      run.lastFrameSeq = updateHighestSeq(run.lastFrameSeq, classified.frameSeq);

      if (hasSeqGap(lastChatSeqRef.current, classified.chatSeq)) {
        triggerRecoveryOnce('chat-gap');
      }
      lastChatSeqRef.current = updateHighestSeq(lastChatSeqRef.current, classified.chatSeq);

      if (hasSeqGap(run.lastChatSeq, classified.chatSeq)) {
        triggerRecoveryOnce('chat-gap');
      }
      const prevRunSeq = run.lastChatSeq;
      run.lastChatSeq = updateHighestSeq(run.lastChatSeq, classified.chatSeq);

      setLastEventTimestamp(Date.now());

      if (type === 'chat_started') {
        activeRunIdRef.current = runId;
        run.startedAt = Date.now();
        run.finalized = false;
        run.status = 'started';
        run.stopReason = undefined;
        run.bufferRaw = '';
        run.bufferText = '';

        setIsGenerating(true);
        playedSoundsRef.current.clear();
        setProcessingStage('thinking');
        setActivityLog([]);
        thinkingStartRef.current = Date.now();
        thinkingDurationRef.current = null;
        thinkingRunIdRef.current = runId;
        return;
      }

      if (type === 'chat_delta') {
        // Ignore stale/out-of-order deltas for an already finalized run.
        if (run.finalized) return;
        if (typeof classified.chatSeq === 'number' && prevRunSeq !== null && classified.chatSeq <= prevRunSeq) return;

        // Mid-stream join detection
        if (!isGeneratingRef.current) setIsGenerating(true);
        if (!activeRunIdRef.current) activeRunIdRef.current = runId;

        // Capture thinking duration on first delta
        if (thinkingStartRef.current) {
          thinkingDurationRef.current = Date.now() - thinkingStartRef.current;
          thinkingStartRef.current = null;
        }

        const delta = extractStreamDelta(cp);
        if (delta) {
          // Gateway deltas are always cumulative — each delta contains the
          // full accumulated text so far (gateway buffers internally and
          // throttles to 1 delta per 150ms). Always replace, never append.
          run.bufferRaw = delta.text;
          run.bufferText = delta.cleaned;
          scheduleStreamingUpdate(runId, run.bufferText);
          setProcessingStage('streaming');
        }
        return;
      }

      if (type === 'chat_final') {
        // Guard: when activeRunBefore is null, only treat as active run if we were
        // in a generating state. This prevents background/stale finals from clearing
        // the UI state for the user's actual active run.
        const isActiveRun = activeRunBefore !== null
          ? activeRunBefore === runId
          : isGeneratingRef.current;

        run.finalized = true;
        run.status = 'ok';
        run.stopReason = cp.stopReason;
        run.bufferRaw = '';
        run.bufferText = '';

        if (activeRunIdRef.current === runId) {
          activeRunIdRef.current = null;
        }

        // Invalidate any in-flight recovery so stale results don't overwrite this final.
        recoveryGenerationRef.current += 1;

        if (isActiveRun) {
          setIsGenerating(false);
          setProcessingStage(null);
          setActivityLog([]);
          setLastEventTimestamp(0);
          clearScheduledStreamFlush();
          setStream(prev => ({ ...prev, html: '', runId: undefined }));
        }

        const finalData = extractFinalMessage(cp);
        const finalMessages = processChatMessages(extractFinalMessages(cp));

        if (finalMessages.length > 0) {
          const merged = mergeFinalMessages(allMessagesRef.current, finalMessages);
          const expectedRunId = thinkingRunIdRef.current;
          const withDuration =
            expectedRunId === runId && thinkingDurationRef.current && thinkingDurationRef.current > 0
              ? patchThinkingDuration(merged, thinkingDurationRef.current)
              : merged;

          applyMessageWindow(withDuration, false);
        } else {
          triggerRecovery('unrenderable-final');
        }

        // Handle TTS from the final message
        if (isActiveRun) {
          if (finalData?.ttsText && !playedSoundsRef.current.has(finalData.ttsText)) {
            playedSoundsRef.current.add(finalData.ttsText);
            speakRef.current(finalData.ttsText);
          } else if (!finalData?.ttsText && lastMessageWasVoiceRef.current && finalData?.text) {
            // Voice fallback: agent forgot [tts:...] marker — auto-speak cleaned response
            const fallback = buildVoiceFallbackText(finalData.text);
            if (fallback) speakRef.current(fallback);
          } else if (soundEnabledRef.current) {
            playPing();
          }
        }

        thinkingDurationRef.current = null;
        thinkingStartRef.current = null;
        thinkingRunIdRef.current = null;
        pruneRunRegistry(runsRef.current, activeRunIdRef.current);
        return;
      }

      if (type === 'chat_aborted') {
        const isActiveRun = activeRunBefore !== null
          ? activeRunBefore === runId
          : isGeneratingRef.current;

        run.finalized = true;
        run.status = undefined;
        run.stopReason = cp.stopReason || 'aborted';
        run.bufferRaw = '';
        run.bufferText = '';

        if (activeRunIdRef.current === runId) {
          activeRunIdRef.current = null;
        }

        // Invalidate any in-flight recovery so stale results don't overwrite abort state.
        recoveryGenerationRef.current += 1;

        // Keep partial text if gateway includes it in aborted payload.
        const partialMessagesRaw = extractFinalMessages(cp);
        if (partialMessagesRaw.length > 0) {
          const partialMessages = processChatMessages(partialMessagesRaw);
          if (partialMessages.length > 0) {
            const merged = mergeFinalMessages(allMessagesRef.current, partialMessages);
            applyMessageWindow(merged, false);
          }
        }

        if (isActiveRun) {
          setIsGenerating(false);
          setProcessingStage(null);
          setActivityLog([]);
          setLastEventTimestamp(0);
          clearScheduledStreamFlush();
          setStream(prev => ({ ...prev, html: '', runId: undefined }));
          if (soundEnabledRef.current) playPing();
        }

        thinkingDurationRef.current = null;
        thinkingStartRef.current = null;
        thinkingRunIdRef.current = null;
        pruneRunRegistry(runsRef.current, activeRunIdRef.current);
        return;
      }

      if (type === 'chat_error') {
        const isActiveRun = activeRunBefore !== null
          ? activeRunBefore === runId
          : isGeneratingRef.current;

        run.finalized = true;
        run.status = undefined;
        run.stopReason = cp.stopReason || cp.errorMessage || cp.error || 'error';
        run.bufferRaw = '';
        run.bufferText = '';

        if (activeRunIdRef.current === runId) {
          activeRunIdRef.current = null;
        }

        // Invalidate any in-flight recovery so stale results don't overwrite error state.
        recoveryGenerationRef.current += 1;

        if (isActiveRun) {
          setIsGenerating(false);
          setProcessingStage(null);
          setActivityLog([]);
          setLastEventTimestamp(0);
          clearScheduledStreamFlush();
          setStream(prev => ({ ...prev, html: '', runId: undefined }));
        }

        // Only recover for the active run — stale errors from background runs
        // should not mutate the visible transcript.
        if (isActiveRun) {
          triggerRecovery('unrenderable-final');
        }

        thinkingStartRef.current = null;
        thinkingDurationRef.current = null;
        thinkingRunIdRef.current = null;
        pruneRunRegistry(runsRef.current, activeRunIdRef.current);
      }
    });
  }, [
    applyMessageWindow,
    clearScheduledStreamFlush,
    scheduleStreamingUpdate,
    subscribe,
    triggerRecovery,
  ]);

  // ─── Send message (delegates to pure functions) ──────────────────────────────
  const handleSend = useCallback(async (text: string, images?: ImageAttachment[]) => {
    // Track voice messages for TTS fallback
    lastMessageWasVoiceRef.current = text.startsWith('[voice] ');

    const { msg: userMsg, tempId } = buildUserMessage({ text, images });

    // Invalidate stale recoveries before adding new-turn optimistic state.
    recoveryGenerationRef.current += 1;

    // Optimistic insert — sync both full buffer and visible slice
    allMessagesRef.current = [...allMessagesRef.current, userMsg];
    setMessages(prev => [...prev, userMsg]);
    setIsGenerating(true);
    setStream(prev => ({ ...prev, html: '', runId: undefined }));
    setProcessingStage('thinking');

    const idempotencyKey = crypto.randomUUID ? crypto.randomUUID() : 'ik-' + Date.now();
    try {
      const ack = await sendChatMessage({
        rpc,
        sessionKey: currentSessionRef.current,
        text,
        images,
        idempotencyKey,
      });

      if (ack.runId) {
        const run = getOrCreateRunState(runsRef.current, ack.runId, currentSessionRef.current);
        run.status = ack.status;
        run.finalized = false;
        activeRunIdRef.current = ack.runId;
        thinkingRunIdRef.current = ack.runId;
      }

      // Confirm the message — remove pending state
      allMessagesRef.current = allMessagesRef.current.map(m =>
        m.tempId === tempId ? { ...m, pending: false } : m,
      );
      setMessages(prev => prev.map(m =>
        m.tempId === tempId ? { ...m, pending: false } : m,
      ));
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);

      // Mark message as failed
      allMessagesRef.current = allMessagesRef.current.map(m =>
        m.tempId === tempId ? { ...m, pending: false, failed: true } : m,
      );
      setMessages(prev => prev.map(m =>
        m.tempId === tempId ? { ...m, pending: false, failed: true } : m,
      ));

      const errMsgBubble: ChatMsg = {
        msgId: generateMsgId(),
        role: 'system',
        html: 'Send error: ' + errMsg,
        rawText: '',
        timestamp: new Date(),
      };
      allMessagesRef.current = [...allMessagesRef.current, errMsgBubble];
      setMessages(prev => [...prev, errMsgBubble]);
      setIsGenerating(false);
    }
  }, [rpc]);

  // ─── Abort / Reset ──────────────────────────────────────────────────────────
  const handleAbort = useCallback(async () => {
    try {
      await rpc('chat.abort', { sessionKey: currentSessionRef.current });
    } catch (err) {
      console.debug('[ChatContext] Abort request failed:', err);
    }
  }, [rpc]);

  const handleReset = useCallback(() => {
    setShowResetConfirm(true);
  }, []);

  const confirmReset = useCallback(async () => {
    setShowResetConfirm(false);
    try {
      await rpc('sessions.reset', { key: currentSessionRef.current });
      const msg: ChatMsg = {
        msgId: generateMsgId(),
        role: 'system',
        html: '⚙️ Session reset. Starting fresh.',
        rawText: '',
        timestamp: new Date(),
      };
      allMessagesRef.current = [msg];
      applyMessageWindow([msg], true);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const msg: ChatMsg = {
        msgId: generateMsgId(),
        role: 'system',
        html: `⚙️ Reset failed: ${errMsg}`,
        rawText: '',
        timestamp: new Date(),
      };
      allMessagesRef.current = [...allMessagesRef.current, msg];
      setMessages(prev => [...prev, msg]);
    }
  }, [applyMessageWindow, rpc]);

  const cancelReset = useCallback(() => {
    setShowResetConfirm(false);
  }, []);

  // ─── Context value ──────────────────────────────────────────────────────────
  const value = useMemo<ChatContextValue>(() => ({
    messages,
    isGenerating,
    stream,
    processingStage,
    lastEventTimestamp,
    activityLog,
    currentToolDescription,
    handleSend,
    handleAbort,
    handleReset,
    loadHistory,
    loadMore,
    hasMore,
    showResetConfirm,
    confirmReset,
    cancelReset,
  }), [
    messages,
    isGenerating,
    stream,
    processingStage,
    lastEventTimestamp,
    activityLog,
    currentToolDescription,
    handleSend,
    handleAbort,
    handleReset,
    loadHistory,
    loadMore,
    hasMore,
    showResetConfirm,
    confirmReset,
    cancelReset,
  ]);

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook export is intentional
export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
