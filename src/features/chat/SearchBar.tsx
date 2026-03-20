/**
 * SearchBar — Inline search input for filtering chat messages
 * 
 * Slides in below COMMS header when search is active.
 * Keyboard shortcuts: Enter (next), Shift+Enter (prev), Escape (close)
 */

import { useRef, useEffect } from 'react';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';

interface SearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  currentMatchIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

/** Inline search bar for filtering chat messages with match navigation. */
export function SearchBar({
  query,
  onQueryChange,
  matchCount,
  currentMatchIndex,
  onNext,
  onPrev,
  onClose,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        onPrev();
      } else {
        onNext();
      }
    }
  };

  const hasResults = matchCount > 0;
  const noResults = query.trim() && matchCount === 0;

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-card border-b border-border/60 shrink-0 animate-slide-down">
      <Search size={14} className="text-muted-foreground shrink-0" />
      
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search messages..."
        spellCheck={false}
        className="flex-1 bg-transparent text-foreground text-[0.867rem] font-mono outline-none placeholder:text-muted-foreground/50"
      />

      {/* Results counter */}
      {query.trim() && (
        <span className={`text-[0.667rem] tabular-nums shrink-0 ${noResults ? 'text-red' : 'text-muted-foreground'}`}>
          {hasResults ? (
            <>{currentMatchIndex + 1} / {matchCount}</>
          ) : (
            <>0 results</>
          )}
        </span>
      )}

      {/* Navigation buttons */}
      {hasResults && (
        <>
          <button
            onClick={onPrev}
            className="p-1 text-muted-foreground hover:text-primary transition-colors"
            title="Previous match (Shift+Enter)"
          >
            <ChevronUp size={14} />
          </button>
          <button
            onClick={onNext}
            className="p-1 text-muted-foreground hover:text-primary transition-colors"
            title="Next match (Enter)"
          >
            <ChevronDown size={14} />
          </button>
        </>
      )}

      {/* Close button */}
      <button
        onClick={onClose}
        className="p-1 text-muted-foreground hover:text-primary transition-colors"
        title="Close (Escape)"
      >
        <X size={14} />
      </button>
    </div>
  );
}
