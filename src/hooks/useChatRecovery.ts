/**
 * useChatRecovery — Recovery/retry logic extracted from ChatContext
 *
 * Manages stream recovery on disconnect, gap detection recovery,
 * generation-based stale-guard, and reconnect state tracking.
 */
import { useRef, useCallback, useEffect, useMemo } from 'react';
import { loadChatHistory, mergeRecoveredTail } from '@/features/chat/operations';
import type { RecoveryReason } from '@/features/chat/operations';
import type { RunState } from '@/features/chat/operations';
import type { ChatMsg } from '@/features/chat/types';
import type { ChatStreamState } from '@/contexts/ChatContext';

// ─── Constants ──────────────────────────────────────────────────────────────────

export const RECOVERY_LIMITS: Record<RecoveryReason, number> = {
  'unrenderable-final': 40,
  'frame-gap': 80,
  'chat-gap': 80,
  reconnect: 120,
  'subagent-complete': 500,
};

// ─── Internal types ─────────────────────────────────────────────────────────────

interface RecoveryState {
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
  reason: RecoveryReason | null;
}

// ─── Hook ───────────────────────────────────────────────────────────────────────

interface UseChatRecoveryDeps {
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  currentSessionRef: React.RefObject<string>;
  isGeneratingRef: React.RefObject<boolean>;
  activeRunIdRef: React.RefObject<string | null>;
  runsRef: React.RefObject<Map<string, RunState>>;
  getAllMessages: () => ChatMsg[];
  applyMessageWindow: (all: ChatMsg[], resetVisibleWindow?: boolean) => void;
  setStream: React.Dispatch<React.SetStateAction<ChatStreamState>>;
  onLatestHeartbeat?: (at: number | null) => void;
  /** Counts run frames and sends on the open session; a read speaks only for the time before them. */
  getRunEpoch: () => number;
  /** Take the run on screen down: the gateway reports none going. */
  onRunOver: () => void;
}

export function useChatRecovery({
  rpc,
  currentSessionRef,
  isGeneratingRef,
  activeRunIdRef,
  runsRef,
  getAllMessages,
  applyMessageWindow,
  setStream,
  onLatestHeartbeat,
  getRunEpoch,
  onRunOver,
}: UseChatRecoveryDeps) {
  const recoveryRef = useRef<RecoveryState>({ timer: null, inFlight: false, reason: null });
  // Generation counter: incremented on session switch and chat_final apply.
  // Recovery callbacks compare their captured generation to discard stale results.
  const recoveryGenerationRef = useRef(0);
  // Track whether we were generating at disconnect, for conditional reconnect recovery.
  const wasGeneratingOnDisconnectRef = useRef(false);
  // A read reported the run over but did not hold its reply: the next read settles it.
  // Bound to the run id and run epoch that produced it, so a retry after a newer run
  // starts cannot settle that newer run without its reply.
  const confirmRunOverRef = useRef<{ runId: string | null; epoch: number } | null>(null);
  const triggerRecoveryRef = useRef<(reason: RecoveryReason) => void>(() => {});

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
      let confirmAgain = false;
      try {
        const runEpoch = getRunEpoch();
        let runActive: boolean | null = null;
        const recovered = await loadChatHistory({
          rpc,
          sessionKey: currentSessionRef.current,
          limit: RECOVERY_LIMITS[reason],
          onLatestHeartbeat: (at) => {
            if (capturedGeneration === recoveryGenerationRef.current) onLatestHeartbeat?.(at);
          },
          onRunActive: (active) => {
            runActive = active;
          },
        });

        // Check generation again after async fetch — another session switch or
        // chat_final may have occurred while we were loading.
        if (capturedGeneration !== recoveryGenerationRef.current) return;

        // A run frame or send after this read went out moved the transcript past
        // what its snapshot can speak for; applying it could put the older view
        // back, and the live frames (or the next read) hold the newer rows.
        const runEpochStale = getRunEpoch() !== runEpoch;

        // A run on screen whose end and final were lost (the connection dropped
        // as it finished) would otherwise stay on screen for good. The gateway's
        // word counts only if no run frame or send came after this read went out.
        let runOver = runActive === false
          && getRunEpoch() === runEpoch
          && (isGeneratingRef.current || activeRunIdRef.current !== null);
        // The gateway reads the transcript before it samples the run state, so a
        // run that finished in between is reported over while its reply is not in
        // this window yet. Settle now only when the window holds the run's final
        // reply; otherwise read once more (that read sees everything written
        // before the run state was sampled) and settle on it.
        const runId = activeRunIdRef.current;
        const confirmation = confirmRunOverRef.current;
        const confirmedRunOver = confirmation !== null
          && confirmation.runId === runId
          && confirmation.epoch === runEpoch;
        if (runOver && !confirmedRunOver) {
          const hasReply = runId !== null && recovered.some((msg) => msg.terminalRunId === runId);
          if (!hasReply) {
            runOver = false;
            confirmAgain = true;
          }
        }
        confirmRunOverRef.current = confirmAgain ? { runId, epoch: runEpoch } : null;

        // When streaming is active, the recovered transcript may include the
        // partial assistant text that the streaming bubble is already showing.
        // Filter it out to avoid duplication, but keep thinking blocks so the
        // user can see reasoning in real time.
        const activeRun = activeRunIdRef.current;
        const activeBuffer = activeRun && !runOver
          ? runsRef.current.get(activeRun)?.bufferText || ''
          : '';
        const existingMessages = getAllMessages();
        const filtered = activeBuffer.length > 0
          ? recovered.filter(msg => {
            // Always keep non-assistant messages (user, system, etc.)
            if (msg.role !== 'assistant') return true;
            // Always keep thinking blocks
            if (msg.isThinking) return true;
            // Always keep tool groups / intermediate tool messages
            if (msg.toolGroup || msg.intermediate) return true;
            const text = (msg.rawText || '').trim();
            // A reply already in the transcript is not a duplicate of the stream
            // bubble: the merge replaces the same row, while dropping it would
            // remove it from the screen.
            if (text && existingMessages.some((row) => row.role === 'assistant'
              && (row.rawText || '').trim() === text)) return true;
            // Drop assistant text that duplicates the active stream buffer.
            // Require minimum length to avoid suppressing short legitimate messages
            // like "Yes." or "Done" that could be common substrings.
            if (text.length >= 20 && activeBuffer.includes(text)) return false;
            // For short texts, require exact match with the buffer (normalized).
            if (text && text.length < 20 && activeBuffer.trim() === text) return false;
            return true;
          })
          : recovered;

        if (!runEpochStale) {
          const merged = mergeRecoveredTail(existingMessages, filtered);
          applyMessageWindow(merged, false);
        }
        if (runOver) onRunOver();
      } catch (err) {
        console.debug('[ChatContext] Recovery failed:', err);
      } finally {
        recoveryRef.current.inFlight = false;
        recoveryRef.current.reason = null;
        setStream(prev => ({ ...prev, isRecovering: false, recoveryReason: null }));
      }
      if (confirmAgain) triggerRecoveryRef.current(reason);
    }, 180);
  }, [applyMessageWindow, clearRecoveryTimer, rpc, currentSessionRef, isGeneratingRef, activeRunIdRef, runsRef, getAllMessages, setStream, onLatestHeartbeat, getRunEpoch, onRunOver]);

  useEffect(() => {
    triggerRecoveryRef.current = triggerRecovery;
  }, [triggerRecovery]);

  /** Increment the recovery generation counter (invalidates in-flight recoveries). */
  const incrementGeneration = useCallback(() => {
    recoveryGenerationRef.current += 1;
  }, []);

  /** Get the current generation value for stale-guard comparisons. */
  const getGeneration = useCallback(() => recoveryGenerationRef.current, []);

  /** Capture generating state at disconnect time. */
  const captureDisconnectState = useCallback(() => {
    wasGeneratingOnDisconnectRef.current =
      isGeneratingRef.current || Boolean(activeRunIdRef.current);
  }, [isGeneratingRef, activeRunIdRef]);

  /** Check if we were generating at last disconnect. */
  const wasGeneratingOnDisconnect = useCallback(() => wasGeneratingOnDisconnectRef.current, []);

  /** Clear the disconnect-was-generating flag. */
  const clearDisconnectState = useCallback(() => {
    wasGeneratingOnDisconnectRef.current = false;
  }, []);

  /** Whether recovery is currently in flight. */
  const isRecoveryInFlight = useCallback(() => recoveryRef.current.inFlight, []);

  /** Whether a recovery timer is pending. */
  const isRecoveryPending = useCallback(() => recoveryRef.current.timer !== null, []);

  /** Reset all recovery state (for session switch). */
  const resetRecoveryState = useCallback(() => {
    clearRecoveryTimer();
    recoveryRef.current.inFlight = false;
    recoveryRef.current.reason = null;
    recoveryGenerationRef.current += 1;
    wasGeneratingOnDisconnectRef.current = false;
    confirmRunOverRef.current = null;
  }, [clearRecoveryTimer]);

  // Cleanup recovery timer on unmount
  useEffect(() => {
    return () => clearRecoveryTimer();
  }, [clearRecoveryTimer]);

  return useMemo(() => ({
    triggerRecovery,
    clearRecoveryTimer,
    incrementGeneration,
    getGeneration,
    captureDisconnectState,
    wasGeneratingOnDisconnect,
    clearDisconnectState,
    isRecoveryInFlight,
    isRecoveryPending,
    resetRecoveryState,
  }), [
    triggerRecovery,
    clearRecoveryTimer,
    incrementGeneration,
    getGeneration,
    captureDisconnectState,
    wasGeneratingOnDisconnect,
    clearDisconnectState,
    isRecoveryInFlight,
    isRecoveryPending,
    resetRecoveryState,
  ]);
}
