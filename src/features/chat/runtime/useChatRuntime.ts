import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatStreamState } from '@/contexts/ChatContext';
import { DEFAULT_VISIBLE_COUNT } from '@/hooks/useChatMessages';
import {
  applyTimelinePatch,
  applyTimelineSnapshot,
  createEmptyRuntimeTimelineState,
} from './reducer';
import { projectTimeline } from './projection';
import type {
  RuntimeTimelineState,
  TimelinePatch,
  TimelineSnapshot,
} from './types';

const LOAD_MORE_BATCH = 30;

interface UseChatRuntimeOptions {
  sessionKey: string;
  enabled?: boolean;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
}

interface UseChatRuntimeResult {
  messages: ReturnType<typeof projectTimeline>['messages'];
  isGenerating: ReturnType<typeof projectTimeline>['isGenerating'];
  processingStage: ReturnType<typeof projectTimeline>['processingStage'];
  lastEventTimestamp: number;
  activityLog: ReturnType<typeof projectTimeline>['activityLog'];
  currentToolDescription: string | null;
  stream: ChatStreamState;
  connected: boolean;
  error: string | null;
  cursor: string;
  hasMore: boolean;
  loadMore: () => boolean;
  reload: () => void;
  reset: () => void;
  markUserMessageFailed: (idempotencyKey: string) => void;
  clearUserMessageFailure: (idempotencyKey: string) => void;
}

export function useChatRuntime({
  sessionKey,
  enabled = true,
  reconnectBaseDelayMs = 1000,
  reconnectMaxDelayMs = 30_000,
}: UseChatRuntimeOptions): UseChatRuntimeResult {
  const [timelineState, setTimelineState] = useState<RuntimeTimelineState>(() =>
    createEmptyRuntimeTimelineState(sessionKey),
  );
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE_COUNT);
  const [failedIdempotencyKeys, setFailedIdempotencyKeys] = useState<ReadonlySet<string>>(() => new Set());

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const cursorRef = useRef('0');
  const connectionIdRef = useRef(0);
  const connectRef = useRef<() => void>(() => undefined);

  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback((delayMs?: number) => {
    clearReconnectTimer();
    closeEventSource();
    setConnected(false);

    const previous = reconnectAttemptsRef.current;
    const nextAttempt = delayMs === 0 ? previous : previous + 1;
    const computedDelay = delayMs ?? Math.min(
      reconnectBaseDelayMs * Math.pow(1.5, previous),
      reconnectMaxDelayMs,
    );

    reconnectAttemptsRef.current = nextAttempt;
    setReconnectAttempts(nextAttempt);
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectTimeoutRef.current = null;
      connectRef.current();
    }, computedDelay);
  }, [
    clearReconnectTimer,
    closeEventSource,
    reconnectBaseDelayMs,
    reconnectMaxDelayMs,
  ]);

  const applyPatch = useCallback((patch: TimelinePatch) => {
    setTimelineState((previous) => {
      const next = applyTimelinePatch(previous, patch);
      cursorRef.current = next.cursor;
      return next;
    });
  }, []);

  const applySnapshot = useCallback((snapshot: TimelineSnapshot) => {
    setTimelineState((previous) => {
      const next = applyTimelineSnapshot(previous, snapshot);
      cursorRef.current = next.cursor;
      return next;
    });
  }, []);

  const connect = useCallback(() => {
    if (!enabled || !sessionKey || eventSourceRef.current) return;

    if (typeof EventSource === 'undefined') {
      setError('EventSource is not available in this browser.');
      return;
    }

    const connectionId = ++connectionIdRef.current;
    const url = `/api/chat-runtime/stream?sessionKey=${encodeURIComponent(sessionKey)}&cursor=${encodeURIComponent(cursorRef.current)}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    const isCurrentConnection = () =>
      connectionIdRef.current === connectionId && eventSourceRef.current === eventSource;

    const parseEvent = <T,>(event: MessageEvent): T | null => {
      try {
        return JSON.parse(event.data) as T;
      } catch {
        setError('Received invalid chat runtime event.');
        return null;
      }
    };

    eventSource.onopen = () => {
      if (!isCurrentConnection()) return;
      setConnected(true);
      setError(null);
      reconnectAttemptsRef.current = 0;
      setReconnectAttempts(0);
    };

    eventSource.onerror = () => {
      if (!isCurrentConnection()) return;
      setError('Chat runtime stream disconnected.');
      scheduleReconnect();
    };

    eventSource.addEventListener('connected', () => {
      if (!isCurrentConnection()) return;
      setConnected(true);
      setError(null);
    });

    eventSource.addEventListener('patch', (event) => {
      if (!isCurrentConnection()) return;
      const patch = parseEvent<TimelinePatch>(event);
      if (patch) applyPatch(patch);
    });

    eventSource.addEventListener('snapshot', (event) => {
      if (!isCurrentConnection()) return;
      const snapshot = parseEvent<TimelineSnapshot>(event);
      if (snapshot) applySnapshot(snapshot);
    });

    eventSource.addEventListener('snapshot_required', () => {
      if (!isCurrentConnection()) return;
      cursorRef.current = '0';
      setTimelineState(createEmptyRuntimeTimelineState(sessionKey));
      scheduleReconnect(0);
    });

    eventSource.addEventListener('error', (event: Event) => {
      if (!isCurrentConnection()) return;
      if (!('data' in event)) return;
      const payload = parseEvent<{ error?: string }>(event as MessageEvent);
      setError(payload?.error ?? 'Chat runtime stream error.');
    });
  }, [
    applyPatch,
    applySnapshot,
    enabled,
    scheduleReconnect,
    sessionKey,
  ]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  /* eslint-disable react-hooks/set-state-in-effect -- Session switches must synchronously clear stale transcript and cursor state before opening the next replay stream. */
  useEffect(() => {
    cursorRef.current = '0';
    connectionIdRef.current += 1;
    closeEventSource();
    clearReconnectTimer();
    setConnected(false);
    setError(null);
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);
    setVisibleCount(DEFAULT_VISIBLE_COUNT);
    setFailedIdempotencyKeys(new Set());
    setTimelineState(createEmptyRuntimeTimelineState(sessionKey));

    if (enabled && sessionKey) {
      connectRef.current();
    }

    return () => {
      connectionIdRef.current += 1;
      closeEventSource();
      clearReconnectTimer();
      setConnected(false);
    };
  }, [clearReconnectTimer, closeEventSource, enabled, sessionKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const currentVisible = timelineState.timeline.orderedItems?.length === 0
    ? 0
    : Math.max(DEFAULT_VISIBLE_COUNT, visibleCount);
  const projection = useMemo(() => projectTimeline(timelineState.timeline, {
    failedIdempotencyKeys,
    visibleCount: currentVisible,
  }), [currentVisible, failedIdempotencyKeys, timelineState.timeline]);

  const hasMore = projection.totalMessages > projection.messages.length;

  const loadMore = useCallback(() => {
    if (projection.totalMessages <= visibleCount) return false;
    const nextVisible = Math.min(projection.totalMessages, visibleCount + LOAD_MORE_BATCH);
    setVisibleCount(nextVisible);
    return nextVisible < projection.totalMessages;
  }, [projection.totalMessages, visibleCount]);

  const reload = useCallback(() => {
    scheduleReconnect(0);
  }, [scheduleReconnect]);

  const reset = useCallback(() => {
    cursorRef.current = '0';
    setVisibleCount(DEFAULT_VISIBLE_COUNT);
    setFailedIdempotencyKeys(new Set());
    setTimelineState(createEmptyRuntimeTimelineState(sessionKey));
    scheduleReconnect(0);
  }, [scheduleReconnect, sessionKey]);

  const markUserMessageFailed = useCallback((idempotencyKey: string) => {
    setFailedIdempotencyKeys((previous) => new Set([...previous, idempotencyKey]));
  }, []);

  const clearUserMessageFailure = useCallback((idempotencyKey: string) => {
    setFailedIdempotencyKeys((previous) => {
      const next = new Set(previous);
      next.delete(idempotencyKey);
      return next;
    });
  }, []);

  return {
    messages: projection.messages,
    isGenerating: projection.isGenerating,
    processingStage: projection.processingStage,
    lastEventTimestamp: projection.lastEventTimestamp,
    activityLog: projection.activityLog,
    currentToolDescription: projection.currentToolDescription,
    stream: {
      html: '',
      isRecovering: reconnectAttempts > 0 && !connected,
      recoveryReason: reconnectAttempts > 0 && !connected ? 'reconnect' : null,
    },
    connected,
    error,
    cursor: timelineState.cursor,
    hasMore,
    loadMore,
    reload,
    reset,
    markUserMessageFailed,
    clearUserMessageFailure,
  };
}
