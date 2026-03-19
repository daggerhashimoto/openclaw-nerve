/**
 * useMemories — Custom hook for memory CRUD operations with optimistic updates.
 *
 * Features:
 * - Optimistic add: Shows new memory immediately, confirms on response
 * - Optimistic delete: Fades out immediately, rolls back on error
 * - Pending/failed states for visual feedback
 * - Auto-rollback on errors
 */

import { useState, useCallback, useRef, useEffect } from 'react';
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
  
  // AbortController for in-flight refresh requests
  const refreshAbortRef = useRef<AbortController | null>(null);
  const timeoutsRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const scheduleTimeout = useCallback((callback: () => void, delayMs: number) => {
    const timeout = setTimeout(() => {
      timeoutsRef.current = timeoutsRef.current.filter(activeTimeout => activeTimeout !== timeout);
      callback();
    }, delayMs);

    timeoutsRef.current.push(timeout);
    return timeout;
  }, []);
  
  // Sync with parent's memories when they change (from SSE updates)
  // but preserve any pending/deleting states.
  // Uses useEffect to avoid setState during render.
  const prevInitialRef = useRef(initialMemories);
  useEffect(() => {
    if (prevInitialRef.current === initialMemories) return;
    prevInitialRef.current = initialMemories;

    setMemories(prev => {
      const pendingItems = prev.filter(m => m.pending || m.deleting || m.failed);
      if (pendingItems.length === 0) return initialMemories;

      // Merge pending items with new data
      const newData = [...initialMemories];
      for (const pending of pendingItems) {
        if (pending.pending && !pending.deleting) {
          const exists = initialMemories.some(m => m.text === pending.text);
          if (!exists) newData.push(pending);
        }
      }
      return newData;
    });
  }, [initialMemories]);

  // Abort in-flight refresh and background sync on unmount or agent change
  useEffect(() => {
    return () => {
      refreshAbortRef.current?.abort();
      for (const timeout of timeoutsRef.current) {
        clearTimeout(timeout);
      }
      timeoutsRef.current = [];
    };
  }, [agentId]);

  const refresh = useCallback(async () => {
    // Cancel any in-flight refresh to prevent stale data overwriting fresh data
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;

    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(getMemoriesUrl(agentId), { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Failed to fetch memories: ${res.status}`);
      }
      const data: Memory[] = await res.json();
      
      // Merge with pending optimistic updates
      setMemories(prev => {
        const pendingItems = prev.filter(m => m.pending || m.deleting);
        if (pendingItems.length === 0) return data;
        
        // Keep pending items that aren't in the new data
        const newData = [...data];
        for (const pending of pendingItems) {
          if (pending.pending && !pending.deleting) {
            // Add pending adds if they're not already in the data
            const exists = data.some(m => m.tempId === pending.tempId || m.text === pending.text);
            if (!exists) {
              newData.push(pending);
            }
          }
        }
        return newData;
      });
    } catch (err) {
      // Ignore aborted requests (superseded by a newer refresh)
      if ((err as Error).name === 'AbortError') return;
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  const addMemory = useCallback(async (text: string, section?: string, category: MemoryCategory = 'other'): Promise<boolean> => {
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
        body: JSON.stringify({ text, section, category, agentId }),
      });

      const data: MemoryApiResponse = await res.json();

      if (!data.ok) {
        // Mark as failed, then remove after brief display
        setMemories(prev => prev.map(m => 
          m.tempId === tempId ? { ...m, pending: false, failed: true } : m
        ));
        scheduleTimeout(() => {
          setMemories(prev => prev.filter(m => m.tempId !== tempId));
        }, 2000);
        setError(data.error || 'Failed to add memory');
        return false;
      }

      // Success: remove pending state
      setMemories(prev => prev.map(m => 
        m.tempId === tempId ? { ...m, pending: false, tempId: undefined } : m
      ));
      
      // SSE will trigger a refresh, but do a background sync just in case
      scheduleTimeout(() => {
        void refresh();
      }, 1000);
      return true;
    } catch (err) {
      // Network error: mark as failed, then remove
      setMemories(prev => prev.map(m => 
        m.tempId === tempId ? { ...m, pending: false, failed: true } : m
      ));
      scheduleTimeout(() => {
        setMemories(prev => prev.filter(m => m.tempId !== tempId));
      }, 2000);
      setError((err as Error).message);
      return false;
    } finally {
      pendingOpsRef.current.delete(tempId);
    }
  }, [agentId, refresh, scheduleTimeout]);

  const deleteMemory = useCallback(async (query: string, type?: Memory['type'], date?: string): Promise<boolean> => {
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
        body: JSON.stringify({ query, type, date, agentId }),
      });

      const data: MemoryApiResponse = await res.json();

      if (!data.ok) {
        // Rollback: remove deleting state
        clearTimeout(removeTimeout);
        timeoutsRef.current = timeoutsRef.current.filter(activeTimeout => activeTimeout !== removeTimeout);
        setMemories(prev => prev.map(m => 
          m.deleting ? { ...m, deleting: false, failed: true } : m
        ));
        // Clear failed state after brief display
        scheduleTimeout(() => {
          setMemories(prev => prev.map(m => 
            m.failed ? { ...m, failed: false } : m
          ));
        }, 2000);
        setError(data.error || 'Failed to delete memory');
        return false;
      }

      // Success - SSE will trigger refresh
      return true;
    } catch (err) {
      // Rollback: remove deleting state
      clearTimeout(removeTimeout);
      timeoutsRef.current = timeoutsRef.current.filter(activeTimeout => activeTimeout !== removeTimeout);
      setMemories(prev => prev.map(m => 
        m.deleting ? { ...m, deleting: false, failed: true } : m
      ));
      scheduleTimeout(() => {
        setMemories(prev => prev.map(m => 
          m.failed ? { ...m, failed: false } : m
        ));
      }, 2000);
      setError((err as Error).message);
      return false;
    }
  }, [agentId, scheduleTimeout]);

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
