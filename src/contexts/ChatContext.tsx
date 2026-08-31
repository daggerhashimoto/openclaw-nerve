/**
 * ChatContext — Thin orchestrator that composes chat hooks
 *
 * Business logic is distributed across composable hooks:
 * - useChatMessages: message CRUD, dedup, history, infinite scroll
 * - useChatStreaming: stream rendering, processing stage, activity log
 * - useChatRecovery: recovery/retry, gap detection, generation guards
 * - useChatTTS: TTS playback, voice fallback, sound feedback
 *
 * This file handles:
 * - React context creation and provider
 * - Session-level state (isGenerating, showResetConfirm)
 * - Run state management (runsRef, activeRunIdRef, sequence tracking)
 * - Gateway event subscription (delegating to hook methods)
 * - Wiring hook outputs into the context value
 */
import { createContext, useContext, useCallback, useRef, useEffect, useState, useMemo, type ReactNode } from 'react';
import { useGateway } from './GatewayContext';
import { useSessionContext } from './SessionContext';
import { useSettings } from './SettingsContext';
import { getSessionKey, type GatewayEvent } from '@/types';
import {
  getRootAgentSessionKey,
  isRootChildSession,
  isSubagentSessionKey,
  isTopLevelAgentSessionKey,
} from '@/features/sessions/sessionKeys';
import {
  loadChatHistory,
  processChatMessages,
  buildUserMessage,
  sendChatMessage,
  classifyStreamEvent,
  extractStreamDelta,
  extractFinalMessage,
  extractFinalMessages,
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
import type { ImageAttachment, ChatMsg, OutgoingUploadPayload } from '@/features/chat/types';
import type { RecoveryReason, RunState } from '@/features/chat/operations';

import { useChatMessages, mergeFinalMessages, patchThinkingDuration } from '@/hooks/useChatMessages';
import { useChatStreaming } from '@/hooks/useChatStreaming';
import { useChatRecovery } from '@/hooks/useChatRecovery';
import { useChatTTS } from '@/hooks/useChatTTS';

// ─── Exported types (consumed by features/chat components) ──────────────────────

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

export function ChatProvider({ children }: { children: ReactNode }) {
  const { connectionState, rpc, subscribe } = useGateway();
  const { currentSession, sessions } = useSessionContext();
  const { soundEnabled: ttsEnabled, speak } = useSettings();

  // ─── Shared state ─────────────────────────────────────────────────────────
  const [isGenerating, setIsGenerating] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // ─── Refs for stable callback references ──────────────────────────────────
  const currentSessionRef = useRef(currentSession);
  const isGeneratingRef = useRef(isGenerating);
  const ttsEnabledRef = useRef(ttsEnabled);
  const speakRef = useRef(speak);

  useEffect(() => {
    currentSessionRef.current = currentSession;
    isGeneratingRef.current = isGenerating;
    ttsEnabledRef.current = ttsEnabled;
    speakRef.current = speak;
  }, [currentSession, isGenerating, ttsEnabled, speak]);

  // ─── Run state management ─────────────────────────────────────────────────
  const runsRef = useRef<Map<string, RunState>>(new Map());
  const activeRunIdRef = useRef<string | null>(null);
  const lastGatewaySeqRef = useRef<number | null>(null);
  const lastChatSeqRef = useRef<number | null>(null);
  const toolResultRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Compose hooks ────────────────────────────────────────────────────────
  const msgHook = useChatMessages({ rpc, currentSessionRef });
  const streamHook = useChatStreaming();
  const ttsHook = useChatTTS({ ttsEnabled: ttsEnabledRef, speak: speakRef });

  const recoveryHook = useChatRecovery({
    rpc,
    currentSessionRef,
    isGeneratingRef,
    activeRunIdRef,
    runsRef,
    getAllMessages: msgHook.getAllMessages,
    applyMessageWindow: msgHook.applyMessageWindow,
    setStream: streamHook.setStream,
  });

  const {
    loadHistory,
    getAllMessages,
    applyMessageWindow,
  } = msgHook;
  const {
    triggerRecovery,
    clearDisconnectState,
    captureDisconnectState,
    wasGeneratingOnDisconnect,
    isRecoveryInFlight,
    isRecoveryPending,
    incrementGeneration,
    getGeneration,
  } = recoveryHook;
  const {
    lastEventTimestamp,
    setProcessingStage,
    setLastEventTimestamp,
    setActivityLog,
    addActivityEntry,
    completeActivityEntry,
    startThinking,
    captureThinkingDuration,
    scheduleStreamingUpdate,
    clearStreamBuffer,
    getThinkingDuration,
    resetThinking,
  } = streamHook;
  const {
    playCompletionPing,
    resetPlayedSounds,
    handleFinalTTS,
  } = ttsHook;

  // ─── Reset transient state on session switch ──────────────────────────────
  useEffect(() => {
    setIsGenerating(false);
    msgHook.resetMessageState();
    streamHook.resetStreamState();
    recoveryHook.resetRecoveryState();
    runsRef.current.clear();
    activeRunIdRef.current = null;
    lastGatewaySeqRef.current = null;
    lastChatSeqRef.current = null;
    if (toolResultRefreshRef.current) {
      clearTimeout(toolResultRefreshRef.current);
      toolResultRefreshRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSession]);

  // ─── Load history on connect / recover on reconnect ───────────────────────
  const previousConnectionStateRef = useRef(connectionState);
  useEffect(() => {
    const prevConnection = previousConnectionStateRef.current;

    if (connectionState === 'connected') {
      if (prevConnection === 'reconnecting' && wasGeneratingOnDisconnect()) {
        triggerRecovery('reconnect');
      }
      clearDisconnectState();
    }

    if (connectionState === 'reconnecting' && prevConnection === 'connected') {
      captureDisconnectState();
    }

    previousConnectionStateRef.current = connectionState;
  }, [
    connectionState,
    wasGeneratingOnDisconnect,
    triggerRecovery,
    clearDisconnectState,
    captureDisconnectState,
  ]);

  useEffect(() => {
    if (connectionState !== 'connected' || !currentSession) return;
    loadHistory(currentSession);
  }, [connectionState, currentSession, loadHistory]);

  // ─── Periodic history poll for sub-agent sessions ─────────────────────────
  const isSubagentSession = currentSession ? isSubagentSessionKey(currentSession) : false;
  const subagentSessionState = isSubagentSession
    ? sessions.find(s => getSessionKey(s) === currentSession)?.state?.toLowerCase()
    : undefined;
  const DONE_STATES = new Set(['idle', 'done', 'completed', 'error', 'aborted', 'timeout', 'stopped', 'finished', 'ended', 'cancelled']);
  const isSubagentActive = isSubagentSession && !(subagentSessionState && DONE_STATES.has(subagentSessionState));
  const subagentPollInFlightRef = useRef(false);

  useEffect(() => {
    if (!isSubagentActive || connectionState !== 'connected') return;

    const pollInterval = setInterval(async () => {
      if (subagentPollInFlightRef.current) return;
      subagentPollInFlightRef.current = true;
      try {
        const sk = currentSessionRef.current;
        const result = await loadChatHistory({ rpc, sessionKey: sk, limit: 500 });
        if (sk !== currentSessionRef.current) return;
        const prev = getAllMessages();
        if (
          result.length === prev.length &&
          result.length > 0 &&
          result[result.length - 1]?.rawText === prev[prev.length - 1]?.rawText &&
          result[result.length - 1]?.role === prev[prev.length - 1]?.role
        ) return;
        applyMessageWindow(result, false);
      } catch { /* best-effort */ } finally {
        subagentPollInFlightRef.current = false;
      }
    }, 3000);

    return () => {
      clearInterval(pollInterval);
      subagentPollInFlightRef.current = false;
    };
  }, [isSubagentActive, connectionState, currentSession, rpc, applyMessageWindow, getAllMessages]);

  // ─── Watchdog: if stream stalls, recover once ─────────────────────────────
  useEffect(() => {
    if (!isGenerating || !lastEventTimestamp) return;

    const timer = setTimeout(() => {
      const elapsed = Date.now() - lastEventTimestamp;
      if (elapsed >= 12_000 && !isRecoveryInFlight() && !isRecoveryPending()) {
        triggerRecovery('chat-gap');
      }
    }, 12_000);

    return () => clearTimeout(timer);
  }, [
    isGenerating,
    lastEventTimestamp,
    isRecoveryInFlight,
    isRecoveryPending,
    triggerRecovery,
  ]);

  // ─── Subscribe to streaming events ────────────────────────────────────────
  useEffect(() => {
    return subscribe((msg: GatewayEvent) => {
      let recoveryTriggeredThisEvent = false;
      const triggerRecoveryOnce = (reason: RecoveryReason) => {
        if (recoveryTriggeredThisEvent) return;
        recoveryTriggeredThisEvent = true;
        triggerRecovery(reason);
      };

      const classified = classifyStreamEvent(msg);
      if (!classified) return;

      const currentSk = currentSessionRef.current;
      if (classified.sessionKey !== currentSk) {
        if (
          isTopLevelAgentSessionKey(currentSk) &&
          classified.sessionKey &&
          isSubagentSessionKey(classified.sessionKey) &&
          isRootChildSession(classified.sessionKey, getRootAgentSessionKey(currentSk) || currentSk) &&
          (classified.type === 'chat_final' || classified.type === 'lifecycle_end')
        ) {
          triggerRecovery('subagent-complete');
        }
        return;
      }

      // Track gateway frame sequence
      if (typeof msg.seq === 'number') {
        if (hasSeqGap(lastGatewaySeqRef.current, msg.seq) && (isGeneratingRef.current || Boolean(activeRunIdRef.current))) {
          triggerRecoveryOnce('frame-gap');
        }
        lastGatewaySeqRef.current = updateHighestSeq(lastGatewaySeqRef.current, msg.seq);
      }

      const { type } = classified;

      // ── Agent events ────────────────────────────────────────────────────
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
          playCompletionPing();

          incrementGeneration();

          const activeRun = activeRunIdRef.current;
          const runFinalized = activeRun ? runsRef.current.get(activeRun)?.finalized : false;
          if (!runFinalized) {
            triggerRecovery('reconnect');
          }
          activeRunIdRef.current = null;
          return;
        }

        if (type === 'assistant_stream') {
          setProcessingStage('streaming');
          setLastEventTimestamp(Date.now());
          return;
        }

        const agentState = ap.state || ap.agentState;
        if (!isGeneratingRef.current && agentState && isActiveAgentState(agentState)) {
          setIsGenerating(true);
        }

        setLastEventTimestamp(Date.now());

        if (type === 'agent_tool_start') {
          setProcessingStage('tool_use');
          addActivityEntry(ap);
          return;
        }

        if (type === 'agent_tool_result') {
          const completedId = ap.data?.toolCallId;
          if (completedId) completeActivityEntry(completedId);

          if (toolResultRefreshRef.current) clearTimeout(toolResultRefreshRef.current);
          const capturedSession = currentSessionRef.current;
          const capturedGeneration = getGeneration();
          toolResultRefreshRef.current = setTimeout(async () => {
            toolResultRefreshRef.current = null;
            try {
              const recovered = await loadChatHistory({ rpc, sessionKey: capturedSession, limit: 100 });
              if (capturedSession !== currentSessionRef.current) return;
              if (capturedGeneration !== getGeneration()) return;
              if (recovered.length > 0) {
                const merged = mergeRecoveredTail(getAllMessages(), recovered);
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

      // ── Chat events ─────────────────────────────────────────────────────
      const cp = classified.chatPayload!;
      const activeRunBefore = activeRunIdRef.current;
      const runId = resolveRunId(classified.runId, activeRunBefore)
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
        resetPlayedSounds();
        setProcessingStage('thinking');
        setActivityLog([]);
        startThinking(runId);
        return;
      }

      if (type === 'chat_delta') {
        if (run.finalized) return;
        if (typeof classified.chatSeq === 'number' && prevRunSeq !== null && classified.chatSeq <= prevRunSeq) return;

        if (!isGeneratingRef.current) setIsGenerating(true);
        if (!activeRunIdRef.current) activeRunIdRef.current = runId;

        captureThinkingDuration();

        const delta = extractStreamDelta(cp);
        if (delta) {
          run.bufferRaw = delta.text;
          run.bufferText = delta.cleaned;
          scheduleStreamingUpdate(runId, run.bufferText);
          setProcessingStage('streaming');
        }
        return;
      }

      if (type === 'chat_final') {
        const isActiveRun = activeRunBefore !== null
          ? activeRunBefore === runId
          : isGeneratingRef.current;

        run.finalized = true;
        run.status = 'ok';
        run.stopReason = cp.stopReason;
        run.bufferRaw = '';
        run.bufferText = '';

        if (activeRunIdRef.current === runId) activeRunIdRef.current = null;
        incrementGeneration();

        if (isActiveRun) {
          setIsGenerating(false);
          setProcessingStage(null);
          setActivityLog([]);
          setLastEventTimestamp(0);
          clearStreamBuffer();
        }

        const finalData = extractFinalMessage(cp);
        const finalMessages = processChatMessages(extractFinalMessages(cp));

        if (finalMessages.length > 0) {
          const merged = mergeFinalMessages(getAllMessages(), finalMessages);
          const thinkingDuration = getThinkingDuration(runId);
          const withDuration = thinkingDuration
            ? patchThinkingDuration(merged, thinkingDuration)
            : merged;
          applyMessageWindow(withDuration, false);
        } else {
          triggerRecovery('unrenderable-final');
        }

        handleFinalTTS(finalData, isActiveRun);
        resetThinking();
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

        if (activeRunIdRef.current === runId) activeRunIdRef.current = null;
        incrementGeneration();

        const partialMessagesRaw = extractFinalMessages(cp);
        if (partialMessagesRaw.length > 0) {
          const partialMessages = processChatMessages(partialMessagesRaw);
          if (partialMessages.length > 0) {
            const merged = mergeFinalMessages(getAllMessages(), partialMessages);
            applyMessageWindow(merged, false);
          }
        }

        if (isActiveRun) {
          setIsGenerating(false);
          setProcessingStage(null);
          setActivityLog([]);
          setLastEventTimestamp(0);
          clearStreamBuffer();
          playCompletionPing();
        }

        resetThinking();
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

        if (activeRunIdRef.current === runId) activeRunIdRef.current = null;
        incrementGeneration();

        if (isActiveRun) {
          setIsGenerating(false);
          setProcessingStage(null);
          setActivityLog([]);
          setLastEventTimestamp(0);
          clearStreamBuffer();
        }

        if (isActiveRun) {
          triggerRecovery('unrenderable-final');
        }

        resetThinking();
        pruneRunRegistry(runsRef.current, activeRunIdRef.current);
      }
    });
  }, [
    getAllMessages,
    applyMessageWindow,
    setProcessingStage,
    setLastEventTimestamp,
    setActivityLog,
    addActivityEntry,
    completeActivityEntry,
    startThinking,
    captureThinkingDuration,
    scheduleStreamingUpdate,
    clearStreamBuffer,
    getThinkingDuration,
    resetThinking,
    triggerRecovery,
    incrementGeneration,
    getGeneration,
    playCompletionPing,
    resetPlayedSounds,
    handleFinalTTS,
    subscribe,
    rpc,
  ]);

  // ─── Send message ─────────────────────────────────────────────────────────
  const handleSend = useCallback(async (text: string, images?: ImageAttachment[], uploadPayload?: OutgoingUploadPayload) => {
    ttsHook.trackVoiceMessage(text);

    const { msg: userMsg, tempId } = buildUserMessage({ text, images, uploadPayload });

    incrementGeneration();

    // Optimistic insert (functional updater to avoid read-then-write race)
    msgHook.setAllMessages(prev => [...prev, userMsg]);
    msgHook.setMessages((prev: ChatMsg[]) => [...prev, userMsg]);
    setIsGenerating(true);
    streamHook.setStream((prev: ChatStreamState) => ({ ...prev, html: '', runId: undefined }));
    setProcessingStage('thinking');

    const idempotencyKey = crypto.randomUUID ? crypto.randomUUID() : 'ik-' + Date.now();
    try {
      const ack = await sendChatMessage({
        rpc,
        sessionKey: currentSessionRef.current,
        text,
        images,
        uploadPayload,
        idempotencyKey,
      });

      if (ack.runId) {
        const run = getOrCreateRunState(runsRef.current, ack.runId, currentSessionRef.current);
        run.status = ack.status;
        run.finalized = false;
        activeRunIdRef.current = ack.runId;
        startThinking(ack.runId);
      }

      // Confirm the message (functional updater to avoid race after await)
      const confirmMsg = (m: ChatMsg) => m.tempId === tempId ? { ...m, pending: false } : m;
      msgHook.setAllMessages(prev => prev.map(confirmMsg));
      msgHook.setMessages((prev: ChatMsg[]) => prev.map(confirmMsg));
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);

      const failMsg = (m: ChatMsg) => m.tempId === tempId ? { ...m, pending: false, failed: true } : m;
      msgHook.setAllMessages(prev => prev.map(failMsg));
      msgHook.setMessages((prev: ChatMsg[]) => prev.map(failMsg));

      const errMsgBubble: ChatMsg = {
        msgId: generateMsgId(),
        role: 'system',
        html: 'Send error: ' + errMsg,
        rawText: '',
        timestamp: new Date(),
      };
      msgHook.setAllMessages(prev => [...prev, errMsgBubble]);
      msgHook.setMessages((prev: ChatMsg[]) => [...prev, errMsgBubble]);
      setIsGenerating(false);
    }
  }, [rpc, msgHook, streamHook, ttsHook, incrementGeneration, setProcessingStage, startThinking]);

  // ─── Abort / Reset ────────────────────────────────────────────────────────
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
      msgHook.setAllMessages([msg]);
      msgHook.applyMessageWindow([msg], true);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const msg: ChatMsg = {
        msgId: generateMsgId(),
        role: 'system',
        html: `⚙️ Reset failed: ${errMsg}`,
        rawText: '',
        timestamp: new Date(),
      };
      msgHook.setAllMessages(prev => [...prev, msg]);
      msgHook.setMessages((prev: ChatMsg[]) => [...prev, msg]);
    }
  }, [msgHook, rpc]);

  const cancelReset = useCallback(() => {
    setShowResetConfirm(false);
  }, []);

  // ─── Context value ────────────────────────────────────────────────────────
  const value = useMemo<ChatContextValue>(() => ({
    messages: msgHook.messages,
    isGenerating,
    stream: streamHook.stream,
    processingStage: streamHook.processingStage,
    lastEventTimestamp: lastEventTimestamp,
    activityLog: streamHook.activityLog,
    currentToolDescription: streamHook.currentToolDescription,
    handleSend,
    handleAbort,
    handleReset,
    loadHistory: loadHistory,
    loadMore: msgHook.loadMore,
    hasMore: msgHook.hasMore,
    showResetConfirm,
    confirmReset,
    cancelReset,
  }), [
    msgHook.messages,
    isGenerating,
    streamHook.stream,
    streamHook.processingStage,
    lastEventTimestamp,
    streamHook.activityLog,
    streamHook.currentToolDescription,
    handleSend,
    handleAbort,
    handleReset,
    loadHistory,
    msgHook.loadMore,
    msgHook.hasMore,
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
