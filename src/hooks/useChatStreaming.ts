/**
 * useChatStreaming — Stream rendering, processing stage, activity log, thinking duration
 *
 * Manages the streaming HTML buffer, rAF-based flush scheduling,
 * processing stage indicators, activity log, and thinking duration tracking.
 */
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { renderMarkdown, renderToolResults } from '@/utils/helpers';
import {
  buildActivityLogEntry,
  markToolCompleted,
  appendActivityEntry,
} from '@/features/chat/operations';
import type { AgentEventPayload } from '@/types';
import type { ProcessingStage, ActivityLogEntry, ChatStreamState } from '@/contexts/ChatContext';

// ─── Internal types ─────────────────────────────────────────────────────────────

interface StreamFlushState {
  runId: string | null;
  text: string;
  rafId: number | null;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

// ─── Hook ───────────────────────────────────────────────────────────────────────

export function useChatStreaming() {
  const [stream, setStream] = useState<ChatStreamState>({ html: '', isRecovering: false, recoveryReason: null });
  const [processingStage, setProcessingStage] = useState<ProcessingStage>(null);
  const [lastEventTimestamp, setLastEventTimestamp] = useState<number>(0);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);

  // Thinking duration tracking (gateway doesn't stream thinking content)
  const thinkingStartRef = useRef<number | null>(null);
  const thinkingDurationRef = useRef<number | null>(null);
  const thinkingRunIdRef = useRef<string | null>(null);

  // Stream flush scheduling
  const streamFlushRef = useRef<StreamFlushState>({ runId: null, text: '', rafId: null, timeoutId: null });

  // Derive currentToolDescription from activityLog — no separate state needed
  const currentToolDescription = useMemo(() => {
    const lastRunning = [...activityLog].reverse().find(e => e.phase === 'running');
    return lastRunning ? lastRunning.description : null;
  }, [activityLog]);

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

    const html = renderToolResults(renderMarkdown(flush.text));
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

  // ─── Activity log helpers ─────────────────────────────────────────────────────

  /** Add a tool-start entry to the activity log. */
  const addActivityEntry = useCallback((agentPayload: AgentEventPayload) => {
    const entry = buildActivityLogEntry(agentPayload);
    if (entry) {
      setActivityLog(prev => appendActivityEntry(prev, entry));
    }
  }, []);

  /** Mark a tool as completed in the activity log. */
  const completeActivityEntry = useCallback((toolCallId: string) => {
    setActivityLog(prev => markToolCompleted(prev, toolCallId));
  }, []);

  // ─── Thinking duration tracking ───────────────────────────────────────────────

  const startThinking = useCallback((runId: string) => {
    thinkingStartRef.current = Date.now();
    thinkingDurationRef.current = null;
    thinkingRunIdRef.current = runId;
  }, []);

  /** Capture thinking duration on first delta. Returns the duration if captured. */
  const captureThinkingDuration = useCallback(() => {
    if (thinkingStartRef.current) {
      thinkingDurationRef.current = Date.now() - thinkingStartRef.current;
      thinkingStartRef.current = null;
    }
  }, []);

  /** Get thinking duration for a specific run. Returns null if not matching. */
  const getThinkingDuration = useCallback((runId: string): number | null => {
    if (thinkingRunIdRef.current === runId && thinkingDurationRef.current && thinkingDurationRef.current > 0) {
      return thinkingDurationRef.current;
    }
    return null;
  }, []);

  const resetThinking = useCallback(() => {
    thinkingStartRef.current = null;
    thinkingDurationRef.current = null;
    thinkingRunIdRef.current = null;
  }, []);

  /** Clear the stream HTML buffer. */
  const clearStreamBuffer = useCallback(() => {
    clearScheduledStreamFlush();
    setStream(prev => ({ ...prev, html: '', runId: undefined }));
  }, [clearScheduledStreamFlush]);

  /** Reset all streaming state (for session switch). */
  const resetStreamState = useCallback(() => {
    setStream({ html: '', isRecovering: false, recoveryReason: null });
    setProcessingStage(null);
    setActivityLog([]);
    setLastEventTimestamp(0);
    clearScheduledStreamFlush();
    thinkingStartRef.current = null;
    thinkingDurationRef.current = null;
    thinkingRunIdRef.current = null;
  }, [clearScheduledStreamFlush]);

  // Cleanup stream flush timers on unmount
  useEffect(() => {
    return () => clearScheduledStreamFlush();
  }, [clearScheduledStreamFlush]);

  return useMemo(() => ({
    // State
    stream,
    setStream,
    processingStage,
    setProcessingStage,
    lastEventTimestamp,
    setLastEventTimestamp,
    activityLog,
    setActivityLog,
    currentToolDescription,

    // Stream flush
    scheduleStreamingUpdate,
    clearScheduledStreamFlush,
    clearStreamBuffer,

    // Activity log
    addActivityEntry,
    completeActivityEntry,

    // Thinking
    startThinking,
    captureThinkingDuration,
    getThinkingDuration,
    resetThinking,

    // Reset
    resetStreamState,
  }), [
    stream,
    processingStage,
    lastEventTimestamp,
    activityLog,
    currentToolDescription,
    setStream,
    setProcessingStage,
    setLastEventTimestamp,
    setActivityLog,
    scheduleStreamingUpdate,
    clearScheduledStreamFlush,
    clearStreamBuffer,
    addActivityEntry,
    completeActivityEntry,
    startThinking,
    captureThinkingDuration,
    getThinkingDuration,
    resetThinking,
    resetStreamState,
  ]);
}
