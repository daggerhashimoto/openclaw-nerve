/* eslint-disable react-refresh/only-export-components -- hooks and helpers intentionally co-located with provider */
import { createContext, useContext, useCallback, useRef, useEffect, useState, useMemo, type ReactNode } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useInstancesOptional } from './InstanceContext';
import type { GatewayEvent } from '@/types';

type EventHandler = (msg: GatewayEvent) => void;

interface GatewayContextValue {
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  connect: (url: string, token: string) => Promise<void>;
  disconnect: () => void;
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  connectError: string;
  reconnectAttempt: number;
  model: string;
  thinking: string;
  sparkline: string;
  isVisibleRef: React.MutableRefObject<boolean>;
  /** Subscribe to all gateway events. Returns unsubscribe function. */
  subscribe: (handler: EventHandler) => () => void;
}

const GatewayContext = createContext<GatewayContextValue | null>(null);

/**
 * Normalize a model ref to a consistent string, but preserve the full
 * provider/model format.  Previous versions stripped the provider prefix,
 * which broke model selection when the gateway reported models under
 * providers not in the strip list (e.g. "openai-codex/gpt-5.2-codex").
 */
const normalizeModel = (m: string) => m.trim() || '--';

// Security: Use sessionStorage instead of localStorage for auth credentials.
// sessionStorage is cleared when the browser tab closes, reducing exposure if
// the device is shared or left unattended. localStorage persists indefinitely.
function loadConfig() {
  try { return JSON.parse(localStorage.getItem('oc-config') || '{}'); } catch { return {}; }
}
function saveConfig(url: string, token: string) {
  localStorage.setItem('oc-config', JSON.stringify({ url, token }));
}

export function GatewayProvider({ children }: { children: ReactNode }) {
  const instances = useInstancesOptional();
  const activeInstanceId = instances?.activeInstanceId ?? null;
  const { connectionState, connect: wsConnect, disconnect, rpc, onEvent, connectError, reconnectAttempt } = useWebSocket(activeInstanceId);
  const [model, setModel] = useState('--');
  const [thinking, setThinking] = useState('--');
  const [sparkline, setSparkline] = useState('▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁');
  const activityBuckets = useRef<number[]>(new Array(30).fill(0));
  const currentBucketEvents = useRef(0);
  const isVisibleRef = useRef(true);
  const subscribersRef = useRef<Set<EventHandler>>(new Set());
  const lastConnectRef = useRef<{ url: string; token: string } | null>(null);
  const previousInstanceIdRef = useRef<string | null>(activeInstanceId);

  // Track page visibility
  useEffect(() => {
    const handleVisibility = () => { isVisibleRef.current = document.visibilityState === 'visible'; };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Subscribe/unsubscribe pattern for event listeners
  const subscribe = useCallback((handler: EventHandler) => {
    subscribersRef.current.add(handler);
    return () => { subscribersRef.current.delete(handler); };
  }, []);

  // Wire up the single onEvent ref to fan out to all subscribers
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- onEvent is a ref from useWebSocket, intentionally mutable
    onEvent.current = (msg: GatewayEvent) => {
      currentBucketEvents.current++;
      for (const handler of subscribersRef.current) {
        try { handler(msg); } catch (e) { console.error('[GatewayContext] event handler error:', e); }
      }
    };
    return () => { onEvent.current = null; };
  }, [onEvent]);

  const rpcRef = useRef(rpc);
  useEffect(() => { rpcRef.current = rpc; }, [rpc]);

  const updateStatus = useCallback(async () => {
    const currentRpc = rpcRef.current;
    try {
      const h = await currentRpc('status', {}) as Record<string, unknown>;
      const agent = h?.agent as Record<string, unknown> | undefined;
      const config = h?.config as Record<string, unknown> | undefined;
      let clean = normalizeModel(String(agent?.model || h?.model || config?.model || h?.defaultModel || '--'));

      // Extract thinking/effort level from status response
      const rawThinking = String(
        agent?.thinking || config?.thinking || h?.thinking || ''
      ).trim().toLowerCase();
      const hasThinking = rawThinking && rawThinking !== 'undefined' && rawThinking !== 'null';

      // Fallback to sessions.list for model and/or thinking (single RPC call for both)
      if (clean === '--' || !hasThinking) {
        try {
          const sr = await currentRpc('sessions.list', { activeMinutes: 120, limit: 50 }) as Record<string, unknown>;
          const list = (sr?.sessions as Array<{ sessionKey?: string; key?: string; model?: string; thinking?: string }>) || [];
          const main = list.find(s => (s.sessionKey || s.key) === 'agent:main:main');
          if (clean === '--' && main?.model) clean = normalizeModel(main.model);
          if (!hasThinking && main?.thinking) {
            setThinking(main.thinking.toLowerCase());
          }
        } catch { /* fallback to '--' */ }
      }

      setModel(clean);
      if (hasThinking) setThinking(rawThinking);
    } catch (err) {
      console.debug('[GatewayContext] Failed to poll status:', err);
    }

    // Update activity sparkline
    activityBuckets.current.push(currentBucketEvents.current);
    currentBucketEvents.current = 0;
    if (activityBuckets.current.length > 30) activityBuckets.current.shift();
    const blocks = '▁▂▃▄▅▆▇█';
    const max = Math.max(1, ...activityBuckets.current);
    setSparkline(activityBuckets.current.slice(-15).map(v => blocks[Math.min(7, Math.floor((v / max) * 7))]).join(''));
  }, []);

  // Poll status when connected
  useEffect(() => {
    if (connectionState !== 'connected') return;
    updateStatus();
    const iv = setInterval(() => {
      if (isVisibleRef.current) updateStatus();
    }, 10000);
    return () => clearInterval(iv);
  }, [connectionState, updateStatus]);

  // Wrap connect to save config
  const connect = useCallback(async (url: string, token: string) => {
    saveConfig(url, token);
    lastConnectRef.current = { url, token };
    await wsConnect(url, token);
  }, [wsConnect]);

  // Keep the gateway stream aligned to the selected instance.
  useEffect(() => {
    const prev = previousInstanceIdRef.current;
    if (prev === activeInstanceId) return;
    previousInstanceIdRef.current = activeInstanceId;

    const saved = lastConnectRef.current || (() => {
      const loaded = loadConfig();
      if (loaded.url && loaded.token) return { url: loaded.url as string, token: loaded.token as string };
      return null;
    })();
    if (!saved) return;

    if (connectionState === 'connected' || connectionState === 'connecting' || connectionState === 'reconnecting') {
      disconnect();
      void wsConnect(saved.url, saved.token).catch(() => {});
    }
  }, [activeInstanceId, connectionState, disconnect, wsConnect]);

  const value = useMemo<GatewayContextValue>(() => ({
    connectionState,
    connect,
    disconnect,
    rpc,
    connectError,
    reconnectAttempt,
    model,
    thinking,
    sparkline,
    isVisibleRef,
    subscribe,
  }), [
    connectionState, connect, disconnect, rpc, connectError,
    reconnectAttempt, model, thinking, sparkline, subscribe,
    // isVisibleRef is a stable ref — no need to track
  ]);

  return <GatewayContext.Provider value={value}>{children}</GatewayContext.Provider>;
}

export function useGateway() {
  const ctx = useContext(GatewayContext);
  if (!ctx) throw new Error('useGateway must be used within GatewayProvider');
  return ctx;
}

export { loadConfig, saveConfig };
