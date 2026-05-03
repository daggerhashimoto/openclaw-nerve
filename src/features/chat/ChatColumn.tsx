import { useCallback, type ReactNode } from 'react';
import { X, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ChatColumnProps {
  columnId: string;
  sessionKey: string;
  label: string;
  agentName?: string;
  isActive: boolean;
  children: ReactNode;
  onClose: () => void;
  onClick: () => void;
  onDragStart?: () => void;
  className?: string;
}

export function ChatColumn({
  label,
  agentName,
  isActive,
  children,
  onClose,
  onClick,
  onDragStart,
  className,
}: ChatColumnProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    },
    [onClick],
  );

  return (
    <div
      className={cn(
        'flex flex-col h-full min-h-0 border-r border-border last:border-r-0 transition-colors',
        isActive ? 'bg-background' : 'bg-muted/30 hover:bg-muted/50 cursor-pointer',
        className,
      )}
      onClick={isActive ? undefined : onClick}
      onKeyDown={isActive ? undefined : handleKeyDown}
      role="tab"
      tabIndex={isActive ? -1 : 0}
      aria-selected={isActive}
      aria-label={`Chat column: ${label}`}
    >
      {/* Column header — fixed height, never scrolls */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border bg-card/50 shrink-0 select-none">
        {onDragStart && (
          <button
            className="p-0.5 rounded hover:bg-accent text-muted-foreground cursor-grab"
            onMouseDown={onDragStart}
            aria-label="Drag to reorder"
            tabIndex={-1}
          >
            <GripVertical className="w-3.5 h-3.5" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">{label}</div>
          {agentName && (
            <div className="text-[10px] text-muted-foreground truncate">{agentName}</div>
          )}
        </div>
        <button
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground shrink-0"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          aria-label={`Close ${label}`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Column body — fills remaining height, scrolls internally */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}