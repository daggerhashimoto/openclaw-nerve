/**
 * useMemories — Custom hook for memory CRUD operations with optimistic updates.
 *
 * Features:
 * - Optimistic add: Shows new memory immediately, confirms on response
 * - Optimistic delete: Fades out immediately, rolls back on error
 * - Pending/failed states for visual feedback
 * - Auto-rollback on errors
 */

import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import type { Memory, MemoryCategory, MemoryApiResponse } from '@/types';

/** Generate a unique temporary ID for optimistic updates */
function generateTempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getMemoriesUrl(agentId: string): string {
  const params = new URLSearchParams({ agentId });
  return `/api/memories?${params.toString()}`;
}

export interface UseMemoriesReturn {
  memories: Memory[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addMemory: (text: string, section?: string, category?: MemoryCategory) => Promise<boolean>;
  deleteMemory: (query: string, type?: Memory['type'], date?: string) => Promise<boolean>;
  clearError: () => void;
}

/** Hook to manage agent memories (CRUD operations via the gateway API). */
export function useMemories(initialMemories: Memory[] = [], agentId = 'main'): UseMemoriesReturn {
  const [memories, setMemories] = useState<Memory[]>(initialMemories);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Track pending operations to avoid race conditions
  const pendingOpsRef = useRef<Set<string>>(new Set());
  const agentIdRef = useRef(agentId);
  const generationRef = useRef(0);
  
  // AbortController for in-flight refresh requests
  const refreshAbortRef = useRef<AbortController | null>(null);
  const timeoutsRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const isCurrentRequest = useCallback((requestAgentId: string, requestGeneration: number) => (
    agentIdRef.current === requestAgentId && generationRef.current === requestGeneration
  ), []);

  const scheduleTimeout = useCallback((callback: () => void, delayMs: number) => {
    const timeout = setTimeout(() => {
      timeoutsRef.current = timeoutsRef.current.filter(activeTimeout => activeTimeout !== timeout);
      callback();
    }, delayMs);

    timeoutsRef.current.push(timeout);
    return timeout;
  }, []);
  
  const clearPendingAsync = useCallback(() => {
    refreshAbortRef.current?.abort();
    refreshAbortRef.current = null;
    for (const timeout of timeoutsRef.current) {
      clearTimeout(timeout);
    }
    timeoutsRef.current = [];
  }, []);

  // Reset state immediately when switching agents so optimistic rows never bleed across workspaces.
  const prevInitialRef = useRef(initialMemories);
  useLayoutEffect(() => {
    if (agentIdRef.current === agentId) return;

    agentIdRef.current = agentId;
    generationRef.current += 1;
    pendingOpsRef.current.clear();
    clearPendingAsync();
    prevInitialRef.current = initialMemories;
    setMemories(initialMemories);
    setIsLoading(false);
    setError(null);
  }, [agentId, clearPendingAsync, initialMemories]);

  // Sync with parent's memories when they change (from SSE updates)
  // but preserve any pending/deleting states for the current agent only.
  useEffect(() => {
    if (prevInitialRef.current === initialMemories) return;
    prevInitialRef.current = initialMemories;

    const requestAgentId = agentIdRef.current;
    const requestGeneration = generationRef.current;
    setMemories(prev => {
      if (!isCurrentRequest(requestAgentId, requestGeneration)) return prev;

      const pendingItems = prev.filter(m => m.pending || m.deleting || m.failed);
      if (pendingItems.length === 0) return initialMemories;

      const newData = [...initialMemories];
      for (const pending of pendingItems) {
        if (pending.pending && !pending.deleting) {
          const exists = initialMemories.some(m => m.text === pending.text);
          if (!exists) newData.push(pending);
        }
      }
      return newData;
    });
  }, [initialMemories, isCurrentRequest]);

  // Abort in-flight refreshes and timers on unmount
  useEffect(() => () => {
    clearPendingAsync();
  }, [clearPendingAsync]);

  const refresh = useCallback(async () => {
    const requestAgentId = agentIdRef.current;
    const requestGeneration = generationRef.current;

    // Cancel any in-flight refresh to prevent stale data overwriting fresh data
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;

    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(getMemoriesUrl(requestAgentId), { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Failed to fetch memories: ${res.status}`);
      }
      const data: Memory[] = await res.json();
      if (!isCurrentRequest(requestAgentId, requestGeneration)) return;
      
      // Merge with pending optimistic updates
      setMemories(prev => {
        if (!isCurrentRequest(requestAgentId, requestGeneration)) return prev;

        const pendingItems = prev.filter(m => m.pending || m.deleting);
        if (pendingItems.length === 0) return data;
        
        const newData = [...data];
        for (const pending of pendingItems) {
          if (pending.pending && !pending.deleting) {
            const exists = data.some(m => m.tempId === pending.tempId || m.text === pending.text);
            if (!exists) {
              newData.push(pending);
            }
          }
        }
        return newData;
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      if (!isCurrentRequest(requestAgentId, requestGeneration)) return;
      setError((err as Error).message);
    } finally {
      if (isCurrentRequest(requestAgentId, requestGeneration)) {
        setIsLoading(false);
      }
    }
  }, [isCurrentRequest]);

  const addMemory = useCallback(async (text: string, section?: string, category: MemoryCategory = 'other'): Promise<boolean> => {
    const requestAgentId = agentIdRef.current;
    const requestGeneration = generationRef.current;
    setError(null);
    
    // Generate temp ID for tracking
    const tempId = generateTempId();
    pendingOpsRef.current.add(tempId);
    
    // Optimistic add: show immediately with pending state
    const optimisticMemory: Memory = {
      type: 'item',
      text,
      tempId,
      pending: true,
    };
    
    // Insert optimistically under the right section (or at end)
    setMemories(prev => {
      if (!section) return [...prev, optimisticMemory];
      
      // Find the section and insert after its last item
      let insertIndex = -1;
      for (let i = 0; i < prev.length; i++) {
        if (prev[i].type === 'section' && prev[i].text === section) {
          insertIndex = i + 1;
          // Find the end of this section's items
          for (let j = i + 1; j < prev.length; j++) {
            if (prev[j].type === 'section' || prev[j].type === 'daily') break;
            insertIndex = j + 1;
          }
          break;
        }
      }
      
      if (insertIndex === -1) {
        // Section not found yet — append section header + item at end
        return [
          ...prev,
          { type: 'section' as const, text: section },
          optimisticMemory,
        ];
      }
      
      const result = [...prev];
      result.splice(insertIndex, 0, optimisticMemory);
      return result;
    });
    
    try {
      const res = await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, section, category, agentId: requestAgentId }),
      });

      const data: MemoryApiResponse = await res.json();
      if (!isCurrentRequest(requestAgentId, requestGeneration)) return false;

      if (!data.ok) {
        setMemories(prev => prev.map(m => 
          m.tempId === tempId ? { ...m, pending: false, failed: true } : m
        ));
        scheduleTimeout(() => {
          if (!isCurrentRequest(requestAgentId, requestGeneration)) return;
          setMemories(prev => prev.filter(m => m.tempId !== tempId));
        }, 2000);
        setError(data.error || 'Failed to add memory');
        return false;
      }

      setMemories(prev => prev.map(m => 
        m.tempId === tempId ? { ...m, pending: false, tempId: undefined } : m
      ));
      
      scheduleTimeout(() => {
        if (!isCurrentRequest(requestAgentId, requestGeneration)) return;
        void refresh();
      }, 1000);
      return true;
    } catch (err) {
      if (!isCurrentRequest(requestAgentId, requestGeneration)) return false;
      setMemories(prev => prev.map(m => 
        m.tempId === tempId ? { ...m, pending: false, failed: true } : m
      ));
      scheduleTimeout(() => {
        if (!isCurrentRequest(requestAgentId, requestGeneration)) return;
        setMemories(prev => prev.filter(m => m.tempId !== tempId));
      }, 2000);
      setError((err as Error).message);
      return false;
    } finally {
      pendingOpsRef.current.delete(tempId);
    }
  }, [isCurrentRequest, refresh, scheduleTimeout]);

  const deleteMemory = useCallback(async (query: string, type?: Memory['type'], date?: string): Promise<boolean> => {
    const requestAgentId = agentIdRef.current;
    const requestGeneration = generationRef.current;
    setError(null);
    
    // Use functional setState to read current memories — avoids stale closure
    let found = false;
    setMemories(prev => {
      const removedIndex = prev.findIndex(m => 
        m.text === query || m.text.includes(query)
      );
      if (removedIndex === -1) return prev;
      found = true;

      let indicesToDelete: number[] = [removedIndex];
      if (type === 'section' || type === 'daily') {
        let endIndex = prev.length;
        for (let i = removedIndex + 1; i < prev.length; i++) {
          if (prev[i].type === 'section' || prev[i].type === 'daily') {
            endIndex = i;
            break;
          }
        }
        indicesToDelete = Array.from({ length: endIndex - removedIndex }, (_, i) => removedIndex + i);
      }

      return prev.map((m, i) => 
        indicesToDelete.includes(i) ? { ...m, deleting: true } : m
      );
    });

    if (!found) {
      setError('Memory not found');
      return false;
    }
    
    // Remove after brief animation delay
    const removeDeleting = () => {
      setMemories(prev => prev.filter(m => !m.deleting));
    };
    const removeTimeout = scheduleTimeout(removeDeleting, 300);
    
    try {
      const res = await fetch('/api/memories', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, type, date, agentId: requestAgentId }),
      });

      const data: MemoryApiResponse = await res.json();
      if (!isCurrentRequest(requestAgentId, requestGeneration)) return false;

      if (!data.ok) {
        clearTimeout(removeTimeout);
        timeoutsRef.current = timeoutsRef.current.filter(activeTimeout => activeTimeout !== removeTimeout);
        setMemories(prev => prev.map(m => 
          m.deleting ? { ...m, deleting: false, failed: true } : m
        ));
        scheduleTimeout(() => {
          if (!isCurrentRequest(requestAgentId, requestGeneration)) return;
          setMemories(prev => prev.map(m => 
            m.failed ? { ...m, failed: false } : m
          ));
        }, 2000);
        setError(data.error || 'Failed to delete memory');
        return false;
      }

      return true;
    } catch (err) {
      if (!isCurrentRequest(requestAgentId, requestGeneration)) return false;
      clearTimeout(removeTimeout);
      timeoutsRef.current = timeoutsRef.current.filter(activeTimeout => activeTimeout !== removeTimeout);
      setMemories(prev => prev.map(m => 
        m.deleting ? { ...m, deleting: false, failed: true } : m
      ));
      scheduleTimeout(() => {
        if (!isCurrentRequest(requestAgentId, requestGeneration)) return;
        setMemories(prev => prev.map(m => 
          m.failed ? { ...m, failed: false } : m
        ));
      }, 2000);
      setError((err as Error).message);
      return false;
    }
  }, [isCurrentRequest, scheduleTimeout]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    memories,
    isLoading,
    error,
    refresh,
    addMemory,
    deleteMemory,
    clearError,
  };
}
