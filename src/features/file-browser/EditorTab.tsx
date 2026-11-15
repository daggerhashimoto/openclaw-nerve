import { X, MessageSquare, LockKeyhole, Circle } from 'lucide-react';

interface EditorTabProps {
  id: string;
  label: string;
  active: boolean;
  pinned?: boolean;
  dirty?: boolean;
  locked?: boolean;
  tooltip?: string;
  onSelect: () => void;
  onClose?: () => void;
  onMiddleClick?: () => void;
}

/**
 * One tab in the editor strip. The active tab sits on the transcript ground
 * with neutral 1px top and side rules and paints over the strip's bottom rule,
 * so it joins the content below. Inactive tabs are muted text.
 */
export function EditorTab({
  id,
  label,
  active,
  pinned,
  dirty,
  locked,
  tooltip,
  onSelect,
  onClose,
  onMiddleClick,
}: EditorTabProps) {
  const isChat = id === 'chat';

  const handleMouseDown = (e: React.MouseEvent) => {
    // Middle-click to close
    if (e.button === 1 && !pinned && onMiddleClick) {
      e.preventDefault();
      onMiddleClick();
    }
  };

  return (
    <button
      role="tab"
      aria-selected={active}
      aria-controls={`tabpanel-${id}`}
      id={`tab-${id}`}
      className={`group relative flex h-full shrink-0 items-center gap-1.5 whitespace-nowrap border-x border-t px-3 text-[0.867rem] transition-colors duration-[120ms] ${
        active
          ? 'border-border bg-background font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-raised hover:text-foreground'
      }`}
      onClick={onSelect}
      onMouseDown={handleMouseDown}
      title={tooltip || label}
    >
      {/* Icon */}
      {isChat && <MessageSquare size={14} className="shrink-0" aria-hidden="true" />}
      {locked && <LockKeyhole size={12} className="shrink-0 text-muted-foreground" role="img" aria-label="Locked" />}

      {/* Dirty indicator */}
      {dirty && !locked && (
        <Circle size={8} className="shrink-0 fill-current text-muted-foreground" role="img" aria-label="Unsaved changes" />
      )}

      {/* Label */}
      <span className="max-w-[120px] truncate">{label}</span>

      {/* Close button: shown on hover or focus, and always on the active tab */}
      {!pinned && onClose && (
        <button
          className={`-mr-1.5 ml-0.5 flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-[opacity,color,background-color] duration-[120ms] hover:bg-raised hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100 ${active ? 'opacity-100' : 'opacity-0'}`}
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          aria-label={`Close ${label}`}
          tabIndex={-1}
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </button>
  );
}
