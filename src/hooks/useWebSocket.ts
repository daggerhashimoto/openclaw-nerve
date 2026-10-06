import { useRef, useCallback, useState, useEffect } from 'react';
import type { GatewayMessage, GatewayEvent, GatewayResponse } from '@/types';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface PendingReq {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

interface UseWebSocketReturn {
  connectionState: ConnectionState;
  connect: (url: string, token: string) => Promise<void>;
  disconnect: () => void;
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  onEvent: React.MutableRefObject<((msg: GatewayEvent) => void) | null>;
  connectError: string;
  reconnectAttempt: number;
}

const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const CONNECT_TIMEOUT_MS = 10000;
const INSTANCE_ID_STORAGE_KEY = 'oc-webchat-instance-id';

function generateInstanceId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `inst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getOrCreateInstanceId(): string {
  const fallback = generateInstanceId();
  if (typeof window === 'undefined') return fallback;

  try {
    const existing = window.sessionStorage.getItem(INSTANCE_ID_STORAGE_KEY);
    if (existing) return existing;

    window.sessionStorage.setItem(INSTANCE_ID_STORAGE_KEY, fallback);
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Low-level WebSocket hook for the OpenClaw gateway protocol.
 *
 * Handles connection (with challenge/auth handshake), JSON-RPC requests
 * with timeouts, event dispatch, and automatic reconnection with
 * exponential backoff + jitter.
 *
 * WebSocket traffic is proxied through Nerve's `/ws` endpoint so the
 * client works behind reverse proxies and HTTPS termination.
 */
export function useWebSocket(): UseWebSocketReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [connectError, setConnectError] = useState('');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reqIdRef = useRef(0);
  const pendingRef = useRef<Record<string, PendingReq>>({});
  const timeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const connectReqIdRef = useRef<string | null>(null);
  const connectResolveRef = useRef<(() => void) | null>(null);
  const connectRejectRef = useRef<((e: Error) => void) | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEvent = useRef<((msg: GatewayEvent) => void) | null>(null);
  
  // Auto-reconnect state
  const credentialsRef = useRef<{ url: string; token: string } | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const intentionalDisconnectRef = useRef(false);
  const hasConnectedRef = useRef(false);
  const doConnectRef = useRef<((url: string, token: string, isReconnect: boolean) => Promise<void>) | null>(null);
  const instanceIdRef = useRef(getOrCreateInstanceId());
  const connectionGenRef = useRef(0);

  const rejectPending = useCallback((reason: Error) => {
    const pending = pendingRef.current;
    for (const id of Object.keys(pending)) {
      pending[id].reject(reason);
      delete pending[id];
    }
    const timeouts = timeoutsRef.current;
    for (const id of Object.keys(timeouts)) {
      clearTimeout(timeouts[id]);
      delete timeouts[id];
    }
  }, []);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const clearConnectTimeout = useCallback(() => {
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
  }, []);

  const settleConnectFailure = useCallback((err: Error) => {
    clearConnectTimeout();
    connectReqIdRef.current = null;
    const reject = connectRejectRef.current;
    connectResolveRef.current = null;
    connectRejectRef.current = null;
    reject?.(err);
  }, [clearConnectTimeout]);

  const settleConnectSuccess = useCallback(() => {
    clearConnectTimeout();
    connectReqIdRef.current = null;
    const resolve = connectResolveRef.current;
    connectResolveRef.current = null;
    connectRejectRef.current = null;
    resolve?.();
  }, [clearConnectTimeout]);

  const rpc = useCallback((method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1) return reject(new Error('Not connected'));
      const id = String(++reqIdRef.current);
      pendingRef.current[id] = { resolve, reject };
      ws.send(JSON.stringify({ type: 'req', id, method, params }));
      const timeoutId = setTimeout(() => {
        if (pendingRef.current[id]) {
          delete pendingRef.current[id];
          if (timeoutsRef.current[id]) delete timeoutsRef.current[id];
          reject(new Error('Timeout'));
        }
      }, 30000);
      timeoutsRef.current[id] = timeoutId;
    });
  }, []);

  const doConnect = useCallback((url: string, token: string, isReconnect: boolean): Promise<void> => {
    return new Promise((resolve, reject) => {
      const gen = ++connectionGenRef.current;
      if (!isReconnect) {
        setConnectError('');
      }
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      rejectPending(new Error('Disconnected'));
      // Settle any in-flight previous connect before installing new callbacks.
      // Without this the previous promise leaks: the prior socket's onclose
      // now hits the stale-generation guard below and returns early, so the
      // pending resolve/reject would never be called.
      if (connectRejectRef.current) {
        settleConnectFailure(new Error('Superseded by a new connection attempt'));
      } else {
        clearConnectTimeout();
        connectReqIdRef.current = null;
      }
      connectResolveRef.current = resolve;
      connectRejectRef.current = reject;

      setConnectionState(isReconnect ? 'reconnecting' : 'connecting');

      let ws: WebSocket;
      try {
        // Always proxy WebSocket through Nerve's /ws endpoint.
        // This ensures the connection works regardless of how the user
        // accesses Nerve (direct, SSH tunnel, reverse proxy, HTTPS).
        // The server-side proxy handles Origin headers and auth.
        let wsUrl = url;
        const proxyProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const proxyBase = `${proxyProtocol}//${window.location.host}/ws`;
        wsUrl = `${proxyBase}?target=${encodeURIComponent(url)}`;
        ws = new WebSocket(wsUrl);
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        setConnectError('Invalid URL: ' + errMsg);
        setConnectionState('disconnected');
        reject(e);
        return;
      }
      wsRef.current = ws;

      connectTimeoutRef.current = setTimeout(() => {
        if (gen !== connectionGenRef.current) return;
        const err = new Error('Connection timed out');
        if (!isReconnect) {
          setConnectError('Connection timed out — retry');
        }
        settleConnectFailure(err);
        setConnectionState(hasConnectedRef.current ? 'reconnecting' : 'disconnected');
        ws.close();
      }, CONNECT_TIMEOUT_MS);

      // Same stale-generation guard as onclose: a late event from a
      // superseded socket must not mutate the current attempt's state/refs.
      ws.onopen = () => {
        if (gen !== connectionGenRef.current) return;
        setConnectionState(isReconnect ? 'reconnecting' : 'connecting');
      };

      ws.onmessage = (ev) => {
        if (gen !== connectionGenRef.current) return;
        let msg: GatewayMessage;
        try { msg = JSON.parse(ev.data) as GatewayMessage; } catch { return; }

        if (msg.type === 'event' && msg.event === 'connect.challenge') {
          const id = String(++reqIdRef.current);
          connectReqIdRef.current = id;
          ws.send(JSON.stringify({
            type: 'req', id, method: 'connect',
            params: {
              minProtocol: 4, maxProtocol: 4,
              client: {
                id: 'openclaw-control-ui',
                version: '0.1.0',
                platform: 'web',
                mode: 'webchat',
                instanceId: instanceIdRef.current,
              },
              role: 'operator',
              scopes: ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing'],
              auth: { token },
              caps: ['tool-events']
            }
          }));
          onEvent.current?.(msg);
          return;
        }

        if (msg.type === 'res') {
          const response = msg as GatewayResponse;
          if (response.id === connectReqIdRef.current) {
            if (response.ok) {
              // Success! Reset reconnect counter
              reconnectAttemptRef.current = 0;
              hasConnectedRef.current = true;
              setReconnectAttempt(0);
              setConnectError('');
              setConnectionState('connected');
              settleConnectSuccess();
            } else {
              const errMsg = 'Auth failed: ' + (response.error?.message || 'unknown');
              setConnectError(errMsg);
              setConnectionState('disconnected');
              // Treat auth failures during reconnect like transient failures so the
              // socket keeps retrying instead of getting stuck until a manual reload.
              settleConnectFailure(new Error(errMsg));
              ws.close();
            }
            return;
          }
          const p = pendingRef.current[response.id];
          if (p) {
            delete pendingRef.current[response.id];
            const timeoutId = timeoutsRef.current[response.id];
            if (timeoutId) {
              clearTimeout(timeoutId);
              delete timeoutsRef.current[response.id];
            }
            if (response.ok) p.resolve(response.payload);
            else p.reject(new Error(response.error?.message || 'request failed'));
          }
          return;
        }

        if (msg.type === 'event') {
          onEvent.current?.(msg as GatewayEvent);
        }
      };

      ws.onerror = () => {
        if (gen !== connectionGenRef.current) return;
        // Don't set error message during reconnect attempts (too noisy)
        if (!isReconnect) {
          setConnectError('WebSocket error — check URL');
        }
      };

      ws.onclose = () => {
        // Stale connection: a newer doConnect has already superseded this one.
        // Guard BEFORE touching shared refs - otherwise a late close from the
        // previous socket clobbers the current attempt's timeout and pending
        // RPCs, reintroducing the hang/drop race during overlapping reconnects.
        if (gen !== connectionGenRef.current) return;

        clearConnectTimeout();
        rejectPending(new Error('WebSocket disconnected'));

        if (connectRejectRef.current) {
          settleConnectFailure(new Error('WebSocket disconnected before connect completed'));
        }

        // Don't reconnect if intentionally disconnected, no credentials, or never connected
        if (intentionalDisconnectRef.current || !credentialsRef.current || !hasConnectedRef.current) {
          setConnectionState('disconnected');
          return;
        }

        // Attempt auto-reconnect
        const attempt = ++reconnectAttemptRef.current;
        setReconnectAttempt(attempt);

        // Exponential backoff with jitter
        const delay = Math.min(
          RECONNECT_BASE_DELAY * Math.pow(1.5, attempt - 1) + Math.random() * 500,
          RECONNECT_MAX_DELAY
        );

        console.debug(`[WS] Reconnecting in ${Math.round(delay)}ms (attempt ${attempt})`);
        setConnectionState('reconnecting');

        reconnectTimeoutRef.current = setTimeout(() => {
          const creds = credentialsRef.current;
          if (creds && !intentionalDisconnectRef.current && doConnectRef.current) {
            doConnectRef.current(creds.url, creds.token, true).catch(() => {
              // Error handling is done in onclose/onerror
            });
          }
        }, delay);
      };
    });
  }, [clearConnectTimeout, rejectPending, settleConnectFailure, settleConnectSuccess]);
  
  // Store doConnect in ref so it can reference itself for reconnection
  useEffect(() => {
    doConnectRef.current = doConnect;
  }, [doConnect]);

  // Cleanup reconnect timeout and WebSocket on unmount
  useEffect(() => {
    return () => {
      clearReconnectTimeout();
      clearConnectTimeout();
      if (wsRef.current) {
        intentionalDisconnectRef.current = true; // prevent reconnect on cleanup close
        wsRef.current.close();
        wsRef.current = null;
      }
      rejectPending(new Error('Component unmounted'));
    };
  }, [clearConnectTimeout, clearReconnectTimeout, rejectPending]);

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    clearReconnectTimeout();
    clearConnectTimeout();
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    credentialsRef.current = null;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    rejectPending(new Error('Disconnected'));
    settleConnectFailure(new Error('Disconnected'));
    setConnectionState('disconnected');
  }, [clearConnectTimeout, clearReconnectTimeout, rejectPending, settleConnectFailure]);

  const connect = useCallback((url: string, token: string): Promise<void> => {
    // Store credentials for reconnection
    credentialsRef.current = { url, token };
    intentionalDisconnectRef.current = false;
    clearReconnectTimeout();
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    return doConnect(url, token, false);
  }, [doConnect, clearReconnectTimeout]);

  return { connectionState, connect, disconnect, rpc, onEvent, connectError, reconnectAttempt };
}
