/**
 * useMessageSearch: Filter and navigate through chat messages
 * 
 * Usage:
 *   const search = useMessageSearch(messages);
 *   
 *   // In render:
 *   {search.isActive && <SearchBar {...search} />}
 *   
 *   // Pass to MessageBubble:
 *   <MessageBubble searchQuery={search.query} ... />
 */

import { useState, useMemo, useCallback } from 'react';
import type { ChatMsg } from './types';

export interface MessageMatch {
  messageIndex: number;
  message: ChatMsg;
}

export interface UseMessageSearchReturn {
  // State
  query: string;
  isActive: boolean;
  
  // Results
  matches: MessageMatch[];
  matchCount: number;
  currentMatchIndex: number;
  currentMatch: MessageMatch | null;
  
  // Actions
  setQuery: (q: string) => void;
  nextMatch: () => void;
  prevMatch: () => void;
  goToMatch: (index: number) => void;
  open: () => void;
  close: () => void;
  clear: () => void;
}

/** Hook providing full-text search across chat messages with match navigation. */
export function useMessageSearch(messages: ChatMsg[]): UseMessageSearchReturn {
  const [query, setQueryState] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // Find all matching messages
  const matches = useMemo<MessageMatch[]>(() => {
    if (!query.trim()) return [];
    
    const q = query.toLowerCase();
    const results: MessageMatch[] = [];
    
    messages.forEach((msg, index) => {
      if (msg.rawText.toLowerCase().includes(q)) {
        results.push({ messageIndex: index, message: msg });
      }
    });
    
    return results;
  }, [messages, query]);

  const matchCount = matches.length;

  // Derive a safe index without useEffect: avoids setState-in-effect for bounds checking.
  // The raw state may temporarily exceed matchCount after matches shrink,
  // but safeMatchIndex always stays within bounds for display and navigation.
  const safeMatchIndex = matchCount > 0 ? Math.min(currentMatchIndex, matchCount - 1) : 0;

  // Current match (null if no matches)
  const currentMatch = matchCount > 0 ? matches[safeMatchIndex] : null;

  const setQuery = useCallback((q: string) => {
    setQueryState(q);
    setCurrentMatchIndex(0);
  }, []);

  const nextMatch = useCallback(() => {
    if (matchCount === 0) return;
    setCurrentMatchIndex(prev => (prev + 1) % matchCount);
  }, [matchCount]);

  const prevMatch = useCallback(() => {
    if (matchCount === 0) return;
    setCurrentMatchIndex(prev => (prev - 1 + matchCount) % matchCount);
  }, [matchCount]);

  const goToMatch = useCallback((index: number) => {
    if (index >= 0 && index < matchCount) {
      setCurrentMatchIndex(index);
    }
  }, [matchCount]);

  const open = useCallback(() => {
    setIsActive(true);
  }, []);

  const close = useCallback(() => {
    setIsActive(false);
    setQueryState('');
    setCurrentMatchIndex(0);
  }, []);

  const clear = useCallback(() => {
    setQueryState('');
    setCurrentMatchIndex(0);
  }, []);

  return {
    query,
    isActive,
    matches,
    matchCount,
    currentMatchIndex: safeMatchIndex,
    currentMatch,
    setQuery,
    nextMatch,
    prevMatch,
    goToMatch,
    open,
    close,
    clear,
  };
}
