import { ArrowDown } from 'lucide-react';

interface ScrollToBottomButtonProps {
  onClick: () => void;
  unreadCount: number;
}

/**
 * Floating button to scroll to bottom, with a count of unread messages.
 * Unread messages wait on the operator, so the count is warm.
 */
export function ScrollToBottomButton({ onClick, unreadCount }: ScrollToBottomButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={unreadCount > 0 ? `Scroll to bottom, ${unreadCount} unread messages` : "Scroll to bottom"}
      title="Scroll to bottom"
      className="absolute bottom-[148px] right-3 z-10 inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-[3px] border border-border bg-card px-1.5 text-muted-foreground shadow-[0_12px_32px_rgba(0,0,0,0.32)] transition-colors duration-[120ms] hover:bg-raised hover:text-foreground sm:bottom-[120px] sm:right-4 sm:min-h-[var(--row-unit)] sm:min-w-[var(--row-unit)]"
    >
      <ArrowDown size={14} aria-hidden="true" />
      {unreadCount > 0 && (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-operator px-1 font-mono text-[0.733rem] font-semibold tabular text-primary-foreground" aria-hidden="true">
          {unreadCount}
        </span>
      )}
    </button>
  );
}
