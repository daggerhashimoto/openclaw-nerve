/**
 * useServerEvents - React hook for Server-Sent Events (SSE).
 * 
 * Connects to /api/events and receives real-time updates from the server.
 * Automatically reconnects on disconnect with exponential backoff.
 * 
 * Event types:
 * - connected: Initial connection confirmation
 * - ping: Keep-alive (every 30s)
 * - memory.changed: Memory file was modified
 * - tokens.updated: Token usage changed
 * - status.changed: Gateway status changed
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useInstancesOptional } from '@/contexts/InstanceContext';

export interface ServerEvent {
  event: string;
  data: unknown;
  ts: number;
}

export type EventHandler = (event: ServerEvent) => void;

interface UseServerEventsOptions {
  /** Whether to connect (default: true) */
  enabled?: boolean;
  /** Base delay for reconnection in ms (default: 1000) */
  reconnectBaseDelay?: number;
  /** Maximum reconnection delay in ms (default: 30000) */
  reconnectMaxDelay?: number;
}

interface UseServerEventsReturn {
  /** Current connection state */
  connected: boolean;
  /** Number of reconnection attempts */
  reconnectAttempts: number;
  /** Last received event (for debugging) */
  lastEvent: ServerEvent | null;
}

/**
 * Subscribe to server-sent events.
 * 
 * @param onEvent - Callback for each received event
 * @param options - Connection options
 * 
 * @example
 * ```tsx
 * useServerEvents((event) => {
 *   if (event.event === 'memory.changed') {
 *     refreshMemories();
 *   }
 * });
 * ```
 */
export function useServerEvents(
  onEvent: EventHandler,
  options: UseServerEventsOptions = {}
): UseServerEventsReturn {
  const instances = useInstancesOptional();
  const {
    enabled = true,
    reconnectBaseDelay = 1000,
    reconnectMaxDelay = 30000,
  } = options;
  const eventsPath = instances?.routeApiPath('/api/events') ?? '/api/events';

  const [connected, setConnected] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [lastEvent, setLastEvent] = useState<ServerEvent | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const onEventRef = useRef(onEvent);
  const connectRef = useRef<() => void>(null);

  // Keep onEvent ref updated to avoid stale closures
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const connect = useCallback(function connectToSSE() {
    // Don't connect if disabled or already connected
    if (!enabled || eventSourceRef.current) return;

    const es = new EventSource(eventsPath);
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
      setReconnectAttempts(0);
    };

    // Handle named events
    const handleEvent = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as ServerEvent;
        
        // Skip ping events for the callback (but update connection state)
        if (data.event !== 'ping') {
          setLastEvent(data);
          onEventRef.current(data);
        }
      } catch {
        // Invalid JSON, ignore
      }
    };

    // Listen for specific event types
    es.addEventListener('connected', handleEvent);
    es.addEventListener('ping', handleEvent);
    es.addEventListener('memory.changed', handleEvent);
    es.addEventListener('tokens.updated', handleEvent);
    es.addEventListener('status.changed', handleEvent);
    es.addEventListener('file.changed', handleEvent);

    // Also handle generic message events (fallback)
    es.onmessage = handleEvent;

    es.onerror = () => {
      // Connection failed or closed
      es.close();
      eventSourceRef.current = null;
      setConnected(false);

      // Reconnect with exponential backoff
      setReconnectAttempts(prev => {
        const attempt = prev + 1;
        const delay = Math.min(
          reconnectBaseDelay * Math.pow(1.5, attempt - 1),
          reconnectMaxDelay
        );

        console.debug(`[SSE] Reconnecting in ${Math.round(delay)}ms (attempt ${attempt})`);

        reconnectTimeoutRef.current = window.setTimeout(() => {
          connectRef.current?.();
        }, delay);

        return attempt;
      });
    };
  }, [enabled, reconnectBaseDelay, reconnectMaxDelay, eventsPath]);

  // Keep connectRef in sync so stale setTimeout closures call the latest version
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // Connect on mount (when enabled), disconnect on unmount or when deps change
  useEffect(() => {
    if (enabled) {
      connect();
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      setConnected(false);
    };
  }, [connect, enabled]);

  return { connected, reconnectAttempts, lastEvent };
}
