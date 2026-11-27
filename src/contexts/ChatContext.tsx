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
import { getSessionKey, type ChatEventPayload, type GatewayEvent } from '@/types';
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
  classifyCommittedRow,
  classifyStreamEvent,
  extractStreamDelta,
  extractFinalMessage,
  extractFinalMessages,
  deriveProcessingStage,
  describeToolResult,
  isActiveAgentState,
  mergeRecoveredTail,
  isUnsentPrompt,
  keepUnsentMessages,
  getOrCreateRunState,
  hasSeqGap,
  pruneRunRegistry,
  resolveRunId,
  createFallbackRunId,
  updateHighestSeq,
  HeartbeatRuns,
} from '@/features/chat/operations';
import { systemNotice } from '@/features/chat/types';
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
  lastHeartbeatAt: number | null;
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
  /** True once the current room's history has been fetched, so an empty room can say so */
  historyLoaded: boolean;
  /** Reset confirmation dialog state — rendered by the consumer, not the provider */
  showResetConfirm: boolean;
  confirmReset: () => Promise<void>;
  cancelReset: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

const TERMINAL_STREAM_EVENTS = new Set(['ignore', 'lifecycle_end', 'chat_final', 'chat_aborted', 'chat_error']);

/** Whether a frame on the open session shows a run going on it. */
function showsRunGoing(classified: NonNullable<ReturnType<typeof classifyStreamEvent>>): boolean {
  if (TERMINAL_STREAM_EVENTS.has(classified.type)) return false;
  if (classified.type === 'agent_state') {
    const state = classified.agentPayload?.state || classified.agentPayload?.agentState;
    return Boolean(state && isActiveAgentState(state));
  }
  return true;
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const { connectionState, rpc, subscribe } = useGateway();
  const { currentSession, sessions } = useSessionContext();
  const { soundEnabled, speak } = useSettings();

  // ─── Shared state ─────────────────────────────────────────────────────────
  const [isGenerating, setIsGenerating] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // ─── Refs for stable callback references ──────────────────────────────────
  const currentSessionRef = useRef(currentSession);
  const isGeneratingRef = useRef(isGenerating);
  const soundEnabledRef = useRef(soundEnabled);
  const speakRef = useRef(speak);

  useEffect(() => {
    currentSessionRef.current = currentSession;
    isGeneratingRef.current = isGenerating;
    soundEnabledRef.current = soundEnabled;
    speakRef.current = speak;
  }, [currentSession, isGenerating, soundEnabled, speak]);

  // ─── Run state management ─────────────────────────────────────────────────
  const runsRef = useRef<Map<string, RunState>>(new Map());
  const activeRunIdRef = useRef<string | null>(null);
  // The run whose lifecycle end arrived while it was on screen and not yet finalized.
  // A 2026.9 gateway sends that end just before the chat final, so the final has to
  // be recognised as this run's own even though no run is active any more.
  const endedRunIdRef = useRef<string | null>(null);
  // Bumped by every run frame on the open session and by every send: a history
  // read can report the run on screen over only if nothing ran after it went out.
  const runEpochRef = useRef(0);
  const getRunEpoch = useCallback(() => runEpochRef.current, []);
  const runOverRef = useRef<() => void>(() => {});
  const onRunOver = useCallback(() => runOverRef.current(), []);
  const voiceSendSeqRef = useRef(0);
  const voiceRunRef = useRef<{ runId: string } | null>(null);
  const lastGatewaySeqRef = useRef<number | null>(null);
  const historyRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Heartbeats on the open session never show as a run; rows one commits wait until it is over.
  const [heartbeatRuns] = useState(() => new HeartbeatRuns());
  const heartbeatRowsPendingRef = useRef(false);
  // Newest heartbeat seen on the open session: from history or a live frame.
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState<number | null>(null);

  /** Keep the newest heartbeat time; an older read or frame never lowers it. */
  const recordHeartbeat = useCallback((at: number) => {
    setLastHeartbeatAt(prev => (prev == null || at > prev ? at : prev));
  }, []);

  const recordHistoryHeartbeat = useCallback((at: number | null) => {
    // A history window without a heartbeat is not evidence the session has none;
    // keep the last known value instead of clearing it.
    if (at == null) return;
    recordHeartbeat(at);
  }, [recordHeartbeat]);

  // ─── Compose hooks ────────────────────────────────────────────────────────
  const msgHook = useChatMessages({
    rpc,
    currentSessionRef,
    onLatestHeartbeat: recordHistoryHeartbeat,
  });
  const streamHook = useChatStreaming();
  const ttsHook = useChatTTS({ soundEnabled: soundEnabledRef, speak: speakRef });

  const recoveryHook = useChatRecovery({
    rpc,
    currentSessionRef,
    isGeneratingRef,
    activeRunIdRef,
    runsRef,
    getAllMessages: msgHook.getAllMessages,
    applyMessageWindow: msgHook.applyMessageWindow,
    setStream: streamHook.setStream,
    onLatestHeartbeat: recordHistoryHeartbeat,
    getRunEpoch,
    onRunOver,
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
    handleCommittedTTS,
    clearVoiceMessage,
  } = ttsHook;

  // A run whose end and final never arrived (lost with a dropped connection)
  // comes down once a history read reports no run going on the session.
  const settleLostRun = useCallback(() => {
    const runId = activeRunIdRef.current;
    const run = runId ? runsRef.current.get(runId) : undefined;
    if (run) {
      run.finalized = true;
      run.bufferRaw = '';
      run.bufferText = '';
    }
    activeRunIdRef.current = null;
    endedRunIdRef.current = null;
    setIsGenerating(false);
    setProcessingStage(null);
    setActivityLog([]);
    setLastEventTimestamp(0);
    clearStreamBuffer();
    resetThinking();
    pruneRunRegistry(runsRef.current, null);
    // A history refresh that snapshotted before this run's terminal reply must not
    // land after settlement and put the pre-final transcript back on screen.
    runEpochRef.current += 1;
    incrementGeneration();
  }, [setProcessingStage, setActivityLog, setLastEventTimestamp, clearStreamBuffer, resetThinking, incrementGeneration]);
  useEffect(() => {
    runOverRef.current = settleLostRun;
  }, [settleLostRun]);

  // ─── Reset transient state on session switch ──────────────────────────────
  useEffect(() => {
    setIsGenerating(false);
    voiceSendSeqRef.current += 1;
    voiceRunRef.current = null;
    setLastHeartbeatAt(null);
    ttsHook.trackVoiceMessage('');
    msgHook.resetMessageState();
    streamHook.resetStreamState();
    recoveryHook.resetRecoveryState();
    runsRef.current.clear();
    activeRunIdRef.current = null;
    endedRunIdRef.current = null;
    lastGatewaySeqRef.current = null;
    heartbeatRuns.settle();
    heartbeatRowsPendingRef.current = false;
    if (historyRefreshRef.current) {
      clearTimeout(historyRefreshRef.current);
      historyRefreshRef.current = null;
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
      // A heartbeat's end may have been missed while away; history is read again on connect.
      heartbeatRuns.settle();
      heartbeatRowsPendingRef.current = false;
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
    heartbeatRuns,
  ]);

  // ─── History refresh ──────────────────────────────────────────────────────
  // Reconcile the transcript from history shortly after entries may have been
  // committed (tool results, interim replies, rows the gateway reports). Bursts
  // collapse into one read. A read waits for a full history load still out, and
  // only the latest read started may apply: an older answer that comes back
  // last would otherwise replace a newer transcript and drop committed rows.
  const historyLoadRef = useRef<Promise<void> | null>(null);
  const historyRefreshSeqRef = useRef(0);
  const scheduleHistoryRefresh = useCallback(() => {
    if (historyRefreshRef.current) clearTimeout(historyRefreshRef.current);
    const capturedSession = currentSessionRef.current;
    const capturedGeneration = getGeneration();
    historyRefreshRef.current = setTimeout(async () => {
      historyRefreshRef.current = null;
      try {
        await historyLoadRef.current;
        // The read happens now, so its snapshot can speak for every run frame up
        // to now; a frame during the request still invalidates the answer.
        const capturedRunEpoch = getRunEpoch();
        const seq = ++historyRefreshSeqRef.current;
        const recovered = await loadChatHistory({
          rpc,
          sessionKey: capturedSession,
          limit: 100,
          onLatestHeartbeat: (at) => {
            if (capturedSession === currentSessionRef.current) recordHistoryHeartbeat(at);
          },
        });
        if (seq !== historyRefreshSeqRef.current) return;
        if (capturedSession !== currentSessionRef.current) return;
        if (capturedGeneration !== getGeneration()) return;
        if (capturedRunEpoch !== getRunEpoch()) return;
        if (recovered.length > 0) {
          const merged = mergeRecoveredTail(getAllMessages(), recovered);
          applyMessageWindow(merged, false);
        }
      } catch { /* best-effort */ }
    }, 300);
  }, [rpc, getGeneration, getRunEpoch, getAllMessages, applyMessageWindow, recordHistoryHeartbeat]);

  useEffect(() => {
    if (connectionState !== 'connected' || !currentSession) return;
    historyLoadRef.current = loadHistory(currentSession);
  }, [connectionState, currentSession, loadHistory]);

  // ─── Subscribe to the open session ────────────────────────────────────────
  // The gateway sends a run started outside the Control UI (a Telegram or
  // Discord message, a heartbeat) only to connections subscribed to its
  // session, along with the rows it commits (`session.message`). A new
  // connection starts with no subscriptions, so subscribe on every connect.
  useEffect(() => {
    if (connectionState !== 'connected' || !currentSession) return;
    const key = currentSession;
    let current = true;
    rpc('sessions.messages.subscribe', { key })
      .then((res) => {
        // A row committed after the first history read took its snapshot but
        // before the subscription took effect arrives by neither path; read
        // history once more now that later rows will be reported.
        if (current && (res as { subscribed?: unknown } | null)?.subscribed !== false) scheduleHistoryRefresh();
      })
      .catch((err) => {
        console.debug('[ChatContext] sessions.messages.subscribe failed:', err);
      });
    return () => {
      current = false;
      rpc('sessions.messages.unsubscribe', { key }).catch(() => { /* gone with the connection */ });
    };
  }, [connectionState, currentSession, rpc, scheduleHistoryRefresh]);

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
        const result = await loadChatHistory({
          rpc,
          sessionKey: sk,
          limit: 500,
          onLatestHeartbeat: (at) => {
            if (sk === currentSessionRef.current) recordHistoryHeartbeat(at);
          },
        });
        if (sk !== currentSessionRef.current) return;
        const prev = getAllMessages();
        // Compare against the rows history gave; prompts not sent yet are kept apart.
        const shown = prev.filter((m) => !isUnsentPrompt(m));
        if (
          result.length === shown.length &&
          result.length > 0 &&
          result[result.length - 1]?.rawText === shown[shown.length - 1]?.rawText &&
          result[result.length - 1]?.role === shown[shown.length - 1]?.role
        ) return;
        applyMessageWindow(keepUnsentMessages(prev, result), false);
      } catch { /* best-effort */ } finally {
        subagentPollInFlightRef.current = false;
      }
    }, 3000);

    return () => {
      clearInterval(pollInterval);
      subagentPollInFlightRef.current = false;
    };
  }, [isSubagentActive, connectionState, currentSession, rpc, applyMessageWindow, getAllMessages, recordHistoryHeartbeat]);

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
    const flushHeartbeatRows = () => {
      if (!heartbeatRowsPendingRef.current) return;
      heartbeatRowsPendingRef.current = false;
      scheduleHistoryRefresh();
    };

    return subscribe((msg: GatewayEvent) => {
      let recoveryTriggeredThisEvent = false;
      const triggerRecoveryOnce = (reason: RecoveryReason) => {
        if (recoveryTriggeredThisEvent) return;
        recoveryTriggeredThisEvent = true;
        triggerRecovery(reason);
      };

      // Track gateway frame sequence. The counter is per connection and covers
      // every event frame, so it must advance before filtering by type or session.
      if (typeof msg.seq === 'number') {
        const gap = hasSeqGap(lastGatewaySeqRef.current, msg.seq);
        if (gap && (isGeneratingRef.current || Boolean(activeRunIdRef.current))) {
          triggerRecoveryOnce('frame-gap');
        }
        // The lost frames may hold a heartbeat's end; stop holding its rows back.
        if (gap && heartbeatRuns.running(currentSessionRef.current)) {
          heartbeatRuns.settle();
          flushHeartbeatRows();
        }
        lastGatewaySeqRef.current = updateHighestSeq(lastGatewaySeqRef.current, msg.seq);
      }

      const committed = classifyCommittedRow(msg);
      if (committed) {
        if (committed.sessionKey !== currentSessionRef.current) return;
        if (heartbeatRuns.running(committed.sessionKey)) {
          heartbeatRowsPendingRef.current = true;
          return;
        }
        if (committed.role === 'assistant' && msg.event === 'session.message') {
          const row = (msg.payload as { message?: ChatEventPayload['message'] } | undefined)?.message;
          if (row) {
            const finalData = extractFinalMessage({ state: 'final', message: row });
            if (finalData) handleCommittedTTS(finalData.text);
          }
        }
        // Rows of a run on screen are reconciled by its final; a new prompt
        // (an inbound channel message) shows as soon as it is committed.
        const runOnScreen = isGeneratingRef.current || activeRunIdRef.current !== null;
        if (!runOnScreen || committed.role === 'user') scheduleHistoryRefresh();
        return;
      }

      // Heartbeats stay quiet: no run on screen, indicator, ping, speech or recovery.
      // A reply one commits is brought in from history once it is over.
      const heartbeat = heartbeatRuns.observe(msg);
      if (heartbeat) {
        const sk = currentSessionRef.current;
        if (heartbeat.sessionKey === sk) {
          recordHeartbeat(Date.now());
        }
        if (heartbeat.ended && heartbeat.sessionKey === sk && !heartbeatRuns.running(sk)) {
          const cp = (msg.payload || {}) as ChatEventPayload;
          if (msg.event === 'chat' && cp.state === 'final' && extractFinalMessages(cp).length > 0) {
            heartbeatRowsPendingRef.current = true;
          }
          flushHeartbeatRows();
        }
        return;
      }

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

      const { type } = classified;
      // A frame of a run still going means something is running now, whatever an
      // earlier read said. Ignored frames, idle agent states and terminal frames
      // (which settle their run themselves) say nothing about that.
      if (showsRunGoing(classified)) runEpochRef.current += 1;

      // ── Agent events ────────────────────────────────────────────────────
      if (classified.source === 'agent') {
        const ap = classified.agentPayload!;

        if (type === 'lifecycle_start') {
          // A newer run has begun, so a late final of the run that ended is obsolete.
          endedRunIdRef.current = null;
          // A lifecycle-only turn has no chat_started to begin it; clear the
          // speech dedup set here so it can repeat the previous run's tts text.
          resetPlayedSounds();
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
          // A run with no chat frame before its end (a final-only reply) is not
          // active, but the lifecycle frame names the run that just ended.
          const endedRun = activeRun ?? classified.runId ?? null;
          const runFinalized = endedRun ? runsRef.current.get(endedRun)?.finalized : false;
          if (!runFinalized) {
            triggerRecovery('reconnect');
            endedRunIdRef.current = endedRun;
          } else {
            // The run already settled; do not carry an older ended run across it.
            endedRunIdRef.current = null;
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
          if (completedId) completeActivityEntry(completedId, describeToolResult(ap.data));
          scheduleHistoryRefresh();
          return;
        }

        if (type === 'tool_item_end') {
          scheduleHistoryRefresh();
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

      // Chat seq is a run-level counter that protocol v4 shares with agent
      // events, so jumps between chat frames are normal and not a gap signal.
      // Dropped frames are caught by the connection-level frame seq check.
      const prevRunSeq = run.lastChatSeq;
      run.lastChatSeq = updateHighestSeq(run.lastChatSeq, classified.chatSeq);

      setLastEventTimestamp(Date.now());

      const beginTurn = () => {
        activeRunIdRef.current = runId;
        // Once a newer turn has begun, a late final of the run that ended is not this turn's.
        endedRunIdRef.current = null;
        run.startedAt = Date.now();
        run.finalized = false;
        run.turnStarted = true;
        run.status = 'started';
        run.stopReason = undefined;
        run.bufferRaw = '';
        run.bufferText = '';

        setIsGenerating(true);
        resetPlayedSounds();
        setProcessingStage('thinking');
        setActivityLog([]);
        startThinking(runId);
      };

      if (type === 'chat_started') {
        beginTurn();
        return;
      }

      if (type === 'chat_status') {
        // A run emits several status frames; only one that arrives before any
        // text starts the turn, so a late one cannot wipe a live buffer.
        if (!run.finalized && !run.turnStarted) beginTurn();
        return;
      }

      if (type === 'chat_delta') {
        if (run.finalized) return;
        if (typeof classified.chatSeq === 'number' && prevRunSeq !== null && classified.chatSeq <= prevRunSeq) return;

        if (!isGeneratingRef.current) setIsGenerating(true);
        if (!activeRunIdRef.current) {
          activeRunIdRef.current = runId;
          endedRunIdRef.current = null;
        }
        run.turnStarted = true;

        captureThinkingDuration();

        const delta = extractStreamDelta(cp, run.bufferRaw);
        if (delta) {
          run.bufferRaw = delta.text;
          run.bufferText = delta.cleaned;
          scheduleStreamingUpdate(runId, run.bufferText);
          setProcessingStage('streaming');
        }
        return;
      }

      if (type === 'chat_final') {
        if (run.finalized) {
          // A second final for a settled run delivers an interim reply (for
          // example from the message tool) after the answer is on screen.
          // Appending it would misorder the transcript, so reconcile instead.
          scheduleHistoryRefresh();
          return;
        }

        const endedJustBefore = endedRunIdRef.current === runId;
        if (endedJustBefore) endedRunIdRef.current = null;
        const isActiveRun = activeRunBefore !== null
          ? activeRunBefore === runId
          : isGeneratingRef.current || endedJustBefore;

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
          // The run id from the frame itself, not a fallback: history records the reply under it.
          const merged = mergeFinalMessages(getAllMessages(), finalMessages, classified.runId);
          const thinkingDuration = getThinkingDuration(runId);
          const withDuration = thinkingDuration
            ? patchThinkingDuration(merged, thinkingDuration)
            : merged;
          applyMessageWindow(withDuration, false);
          // The final event carries the reply text only; attachments the agent delivered with it
          // (generated images) are written to the transcript, so reconcile with history once.
          scheduleHistoryRefresh();
        } else {
          triggerRecovery('unrenderable-final');
        }

        // Only the run started by the voice send may consume its fallback;
        // an earlier run that finalizes while a newer send is pending must not.
        const voiceOwner = voiceRunRef.current?.runId === runId;
        handleFinalTTS(finalData, isActiveRun, voiceOwner);
        if (voiceOwner) {
          voiceRunRef.current = null;
        }
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

        if (isActiveRun && voiceRunRef.current?.runId === runId) {
          clearVoiceMessage();
          voiceRunRef.current = null;
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

        if (isActiveRun && voiceRunRef.current?.runId === runId) {
          clearVoiceMessage();
          voiceRunRef.current = null;
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
    handleCommittedTTS,
    clearVoiceMessage,
    subscribe,
    heartbeatRuns,
    scheduleHistoryRefresh,
    recordHeartbeat,
  ]);

  // ─── Send message ─────────────────────────────────────────────────────────
  const handleSend = useCallback(async (text: string, images?: ImageAttachment[], uploadPayload?: OutgoingUploadPayload) => {
    const sendSeq = ++voiceSendSeqRef.current;
    const isVoice = text.startsWith('[voice] ');
    // A newer send owns the pending voice flag; the previous run can no longer clear it.
    voiceRunRef.current = null;
    ttsHook.trackVoiceMessage(text);

    const { msg: userMsg, tempId } = buildUserMessage({ text, images, uploadPayload });

    incrementGeneration();
    runEpochRef.current += 1;

    // Optimistic insert (functional updater to avoid read-then-write race)
    msgHook.setAllMessages(prev => [...prev, userMsg]);
    msgHook.setMessages((prev: ChatMsg[]) => [...prev, userMsg]);
    setIsGenerating(true);
    streamHook.setStream((prev: ChatStreamState) => ({ ...prev, html: '', runId: undefined }));
    setProcessingStage('thinking');

    // The bubble's tempId is the send key: the gateway records the prompt under it, so a
    // history read can tell its recorded copy apart from another prompt with the same text.
    const idempotencyKey = tempId;
    try {
      const ack = await sendChatMessage({
        rpc,
        sessionKey: currentSessionRef.current,
        text,
        images,
        uploadPayload,
        idempotencyKey,
      });

      // A read the gateway took before it accepted this send cannot speak for its run.
      runEpochRef.current += 1;
      if (ack.runId) {
        const run = getOrCreateRunState(runsRef.current, ack.runId, currentSessionRef.current);
        run.status = ack.status;
        run.finalized = false;
        activeRunIdRef.current = ack.runId;
        endedRunIdRef.current = null;
        if (isVoice && voiceSendSeqRef.current === sendSeq) {
          voiceRunRef.current = { runId: ack.runId };
        }
        startThinking(ack.runId);
      }

      // Confirm the message (functional updater to avoid race after await)
      const confirmMsg = (m: ChatMsg) => m.tempId === tempId ? { ...m, pending: false } : m;
      msgHook.setAllMessages(prev => prev.map(confirmMsg));
      msgHook.setMessages((prev: ChatMsg[]) => prev.map(confirmMsg));
    } catch (e) {
      if (voiceSendSeqRef.current === sendSeq) {
        clearVoiceMessage();
        voiceRunRef.current = null;
      }
      const errMsg = e instanceof Error ? e.message : String(e);

      const failMsg = (m: ChatMsg) => m.tempId === tempId ? { ...m, pending: false, failed: true } : m;
      msgHook.setAllMessages(prev => prev.map(failMsg));
      msgHook.setMessages((prev: ChatMsg[]) => prev.map(failMsg));

      const errMsgBubble = systemNotice(`Send error: ${errMsg}`);
      msgHook.setAllMessages(prev => [...prev, errMsgBubble]);
      msgHook.setMessages((prev: ChatMsg[]) => [...prev, errMsgBubble]);
      setIsGenerating(false);
    }
  }, [rpc, msgHook, streamHook, ttsHook, clearVoiceMessage, incrementGeneration, setProcessingStage, startThinking]);

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
      const msg = systemNotice('Session reset. Starting fresh.');
      msgHook.setAllMessages([msg]);
      msgHook.applyMessageWindow([msg], true);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const msg = systemNotice(`Reset failed: ${errMsg}`);
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
    lastHeartbeatAt,
    activityLog: streamHook.activityLog,
    currentToolDescription: streamHook.currentToolDescription,
    handleSend,
    handleAbort,
    handleReset,
    loadHistory: loadHistory,
    loadMore: msgHook.loadMore,
    hasMore: msgHook.hasMore,
    historyLoaded: msgHook.historyLoaded,
    showResetConfirm,
    confirmReset,
    cancelReset,
  }), [
    msgHook.messages,
    isGenerating,
    streamHook.stream,
    streamHook.processingStage,
    lastEventTimestamp,
    lastHeartbeatAt,
    streamHook.activityLog,
    streamHook.currentToolDescription,
    handleSend,
    handleAbort,
    handleReset,
    loadHistory,
    msgHook.loadMore,
    msgHook.hasMore,
    msgHook.historyLoaded,
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
