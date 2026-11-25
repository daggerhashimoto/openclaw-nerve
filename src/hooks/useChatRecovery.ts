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
}: UseChatRecoveryDeps) {
  const recoveryRef = useRef<RecoveryState>({ timer: null, inFlight: false, reason: null });
  // Generation counter: incremented on session switch and chat_final apply.
  // Recovery callbacks compare their captured generation to discard stale results.
  const recoveryGenerationRef = useRef(0);
  // Track whether we were generating at disconnect, for conditional reconnect recovery.
  const wasGeneratingOnDisconnectRef = useRef(false);

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
          onLatestHeartbeat: (at) => {
            if (capturedGeneration === recoveryGenerationRef.current) onLatestHeartbeat?.(at);
          },
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

        const merged = mergeRecoveredTail(getAllMessages(), filtered);
        applyMessageWindow(merged, false);
      } catch (err) {
        console.debug('[ChatContext] Recovery failed:', err);
      } finally {
        recoveryRef.current.inFlight = false;
        recoveryRef.current.reason = null;
        setStream(prev => ({ ...prev, isRecovering: false, recoveryReason: null }));
      }
    }, 180);
  }, [applyMessageWindow, clearRecoveryTimer, rpc, currentSessionRef, activeRunIdRef, runsRef, getAllMessages, setStream, onLatestHeartbeat]);

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
