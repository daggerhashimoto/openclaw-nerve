interface ScrollToBottomButtonProps {
  onClick: () => void;
  unreadCount: number;
}

/**
 * Floating button to scroll to bottom with unread badge
 */
export function ScrollToBottomButton({ onClick, unreadCount }: ScrollToBottomButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label={unreadCount > 0 ? `Scroll to bottom, ${unreadCount} unread messages` : "Scroll to bottom"}
      title="Scroll to bottom"
      className="absolute bottom-[148px] right-3 z-10 flex size-11 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground shadow-lg transition-colors hover:bg-primary/90 sm:bottom-[120px] sm:right-4 sm:size-9"
    >
      <span aria-hidden="true">↓</span>
      {unreadCount > 0 && (
        <span className="absolute -top-1.5 -right-1.5 bg-red text-white text-[9px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1" aria-hidden="true">
          {unreadCount}
        </span>
      )}
    </button>
  );
}
