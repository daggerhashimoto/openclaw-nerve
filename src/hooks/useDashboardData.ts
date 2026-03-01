/**
 * useDashboardData - Handles dashboard data fetching (memories, tokens)
 * 
 * Extracted from App.tsx to separate data fetching concerns from layout.
 * Includes AbortController support for proper cleanup on unmount.
 * 
 * Real-time updates via:
 * 1. SSE (Server-Sent Events) - for local file/API changes
 * 2. WebSocket (Gateway) - for gateway memory/token events
 * 
 * Polling is now much slower, serving only as a safety net.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useGateway } from '@/contexts/GatewayContext';
import { useInstancesOptional } from '@/contexts/InstanceContext';
import { useServerEvents, type ServerEvent } from '@/hooks/useServerEvents';
import type { Memory, TokenData, GatewayEvent } from '@/types';

// Polling intervals - much longer now since SSE/WS provide real-time updates
// These are just safety nets for edge cases
const MEMORY_POLL_INTERVAL = 60000; // 60s fallback (was 10s)
const TOKEN_POLL_INTERVAL = 60000;  // 60s fallback (was 30s)

export type FileChangedHandler = (path: string) => void;

export interface DashboardDataOptions {
  /** Called when a file.changed SSE event arrives */
  onFileChanged?: FileChangedHandler;
}

export interface DashboardDataState {
  memories: Memory[];
  memoriesLoading: boolean;
  tokenData: TokenData | null;
  refreshMemories: (signal?: AbortSignal) => Promise<void>;
  refreshTokens: (signal?: AbortSignal) => Promise<void>;
}

export function useDashboardData(options: DashboardDataOptions = {}): DashboardDataState {
  const { subscribe, connectionState } = useGateway();
  const instances = useInstancesOptional();
  const activeInstanceId = instances?.activeInstanceId ?? null;
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(true);
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  
  // Refs for callbacks (to avoid stale closures in subscriptions)
  const refreshMemoriesRef = useRef<((signal?: AbortSignal) => Promise<void>) | undefined>(undefined);
  const refreshTokensRef = useRef<((signal?: AbortSignal) => Promise<void>) | undefined>(undefined);
  const onFileChangedRef = useRef(options.onFileChanged);

  const refreshMemories = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/memories', { signal });
      if (!signal?.aborted && res.ok) {
        setMemories(await res.json());
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.debug('[DashboardData] Failed to refresh memories:', err.message);
      }
    } finally {
      if (!signal?.aborted) {
        setMemoriesLoading(false);
      }
    }
  }, []);

  const refreshTokens = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/tokens', { signal });
      if (!signal?.aborted && res.ok) {
        setTokenData(await res.json());
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.debug('[DashboardData] Failed to refresh tokens:', err.message);
      }
    }
  }, []);

  // Sync refs in effect to avoid render-time mutations
  useEffect(() => {
    refreshMemoriesRef.current = refreshMemories;
    refreshTokensRef.current = refreshTokens;
    onFileChangedRef.current = options.onFileChanged;
  }, [refreshMemories, refreshTokens, options.onFileChanged]);

  // SSE event handler for real-time updates from backend
  const handleSSEEvent = useCallback((event: ServerEvent) => {
    if (event.event === 'memory.changed') {
      console.debug('[DashboardData] SSE memory.changed, refreshing...');
      refreshMemoriesRef.current?.();
    }
    if (event.event === 'tokens.updated') {
      console.debug('[DashboardData] SSE tokens.updated, refreshing...');
      refreshTokensRef.current?.();
    }
    if (event.event === 'file.changed') {
      const data = event.data as { path?: string };
      if (data?.path) {
        onFileChangedRef.current?.(data.path);
      }
    }
  }, []);

  // Subscribe to SSE events from the backend
  // This catches local file changes and API-triggered updates
  useServerEvents(handleSSEEvent);

  // Subscribe to WebSocket events for real-time memory and token updates
  useEffect(() => {
    if (connectionState !== 'connected') return;
    
    return subscribe((msg: GatewayEvent) => {
      const evt = msg.event;
      
      // Memory events - refresh immediately when memories change
      // Gateway may emit: memory.stored, memory.deleted, memory.changed
      if (evt === 'memory.stored' || evt === 'memory.deleted' || evt === 'memory.changed') {
        refreshMemoriesRef.current?.();
      }
      
      // Token/cost events - refresh when token usage changes
      // Gateway may emit: tokens.update, cost.update
      if (evt === 'tokens.update' || evt === 'cost.update') {
        refreshTokensRef.current?.();
      }
      
      // Also trigger token refresh on chat.final events (response completed = tokens used)
      // This ensures token counts update after each agent response
      const payload = msg.payload as Record<string, unknown> | undefined;
      if (evt === 'chat' && payload?.state === 'final') {
        // Small delay to allow gateway to update token counts
        setTimeout(() => refreshTokensRef.current?.(), 500);
      }
    });
  }, [subscribe, connectionState]);

  // Initial fetch and polling (restarts when active instance changes)
  useEffect(() => {
    const controller = new AbortController();

    // Fetch immediately for current instance context.
    setMemoriesLoading(true);
    refreshMemories(controller.signal);
    refreshTokens(controller.signal);

    // Polling as safety net — SSE/WS provide real-time updates.
    const memIv = setInterval(() => refreshMemories(controller.signal), MEMORY_POLL_INTERVAL);
    const tokIv = setInterval(() => refreshTokens(controller.signal), TOKEN_POLL_INTERVAL);

    return () => {
      controller.abort();
      clearInterval(memIv);
      clearInterval(tokIv);
    };
  }, [refreshMemories, refreshTokens, activeInstanceId]);

  return {
    memories,
    memoriesLoading,
    tokenData,
    refreshMemories,
    refreshTokens,
  };
}
