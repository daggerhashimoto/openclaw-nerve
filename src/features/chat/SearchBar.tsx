/**
 * SearchBar: inline search input for filtering chat messages.
 *
 * Sits below the session header when search is active.
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
    <div className="flex min-h-[var(--row-unit)] shrink-0 items-center gap-2 border-b border-border bg-card pl-3 pr-0.5">
      <Search size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />

      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search messages"
        aria-label="Search messages"
        spellCheck={false}
        className="h-[1.467rem] min-w-0 flex-1 rounded-[3px] border border-input bg-background px-2 text-[0.867rem] text-foreground outline-none transition-colors duration-[120ms] placeholder:text-muted-foreground focus-visible:border-ring max-sm:h-9 max-sm:text-base"
      />

      {/* Results counter */}
      {query.trim() && (
        <span className={`shrink-0 font-mono text-[0.8rem] tabular ${noResults ? 'text-destructive' : 'text-muted-foreground'}`}>
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
            type="button"
            onClick={onPrev}
            className="shell-icon-button shrink-0"
            title="Previous match (Shift+Enter)"
            aria-label="Previous match"
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            onClick={onNext}
            className="shell-icon-button shrink-0"
            title="Next match (Enter)"
            aria-label="Next match"
          >
            <ChevronDown size={14} />
          </button>
        </>
      )}

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="shell-icon-button shrink-0"
        title="Close (Escape)"
        aria-label="Close search"
      >
        <X size={14} />
      </button>
    </div>
  );
}
