import { useCallback, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useDeck, type DeckColumn } from '@/contexts/DeckContext';
import { ChatColumn } from './ChatColumn';
import { cn } from '@/lib/utils';

interface DeckLayoutProps {
  /** Render the active column's chat content */
  renderActiveChat: (column: DeckColumn) => React.ReactNode;
  /** Render inactive columns (compact preview placeholder) */
  renderInactivePreview: (column: DeckColumn) => React.ReactNode;
  /** Get a display label for a session key */
  getSessionLabel: (sessionKey: string) => string;
  /** Get an agent name for a session key */
  getAgentName?: (sessionKey: string) => string | undefined;
  /** Called when user wants to add a column */
  onAddColumn?: () => void;
  className?: string;
}

export function DeckLayout({
  renderActiveChat,
  renderInactivePreview,
  getSessionLabel,
  getAgentName,
  onAddColumn,
  className,
}: DeckLayoutProps) {
  const { columns, activeColumnId, setActiveColumn, removeColumn, resizeColumn } = useDeck();
  const containerRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState<{ leftId: string; rightId: string } | null>(null);

  // ── Resize logic ──────────────────────────────────────────────────────
  // Incremental delta tracking: each mousemove computes delta from
  // the LAST position, so resizing feels proportional and controlled.

  const SENSITIVITY = 0.002; // flex-ratio change per pixel of mouse movement

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, leftId: string, rightId: string) => {
      e.preventDefault();
      setResizing({ leftId, rightId });

      let lastX = e.clientX;

      const onMouseMove = (ev: MouseEvent) => {
        const deltaX = ev.clientX - lastX;
        lastX = ev.clientX;
        const deltaRatio = deltaX * SENSITIVITY;
        resizeColumn(leftId, rightId, deltaRatio);
      };

      const onMouseUp = () => {
        setResizing(null);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [resizeColumn],
  );

  // ── Render ────────────────────────────────────────────────────────────

  if (columns.length === 0) {
    return (
      <div className={cn('h-full flex items-center justify-center bg-background', className)}>
        <button
          className="flex flex-col items-center gap-2 px-6 py-4 rounded-lg border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
          onClick={onAddColumn ?? (() => { /* noop */ })}
        >
          <Plus className="w-6 h-6" />
          <span className="text-sm">Add a chat column</span>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn('h-full flex min-h-0 overflow-hidden', className)}
    >
      {columns.map((col, idx) => {
        const isActive = col.id === activeColumnId;
        const label = getSessionLabel(col.sessionKey);
        const agentName = getAgentName?.(col.sessionKey);

        return (
          <div
            key={col.id}
            className="min-w-0 overflow-hidden flex flex-col h-full"
            // CSS flex: <grow> <shrink> <basis>
            // grow=col.flex, shrink=1, basis=0% → columns share space
            // proportionally and can shrink below content size (min-w-0)
            style={{ flex: `${col.flex} 1 0%` }}
          >
            <ChatColumn
              columnId={col.id}
              sessionKey={col.sessionKey}
              label={label}
              agentName={agentName}
              isActive={isActive}
              onClose={() => removeColumn(col.id)}
              onClick={() => setActiveColumn(col.id)}
            >
              {isActive ? renderActiveChat(col) : renderInactivePreview(col)}
            </ChatColumn>

            {/* Resize handle between columns */}
            {idx < columns.length - 1 && (
              <div
                className={cn(
                  'w-1.5 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors shrink-0',
                  resizing?.leftId === col.id && 'bg-primary/40',
                )}
                onMouseDown={(e) => handleResizeStart(e, col.id, columns[idx + 1].id)}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize column"
              />
            )}
          </div>
        );
      })}

      {/* Add column button */}
      {columns.length < 6 && (
        <div
          className="flex flex-col items-center justify-center w-6 shrink-0 border-l border-border/50 hover:bg-accent/30 transition-colors cursor-pointer"
          onClick={onAddColumn}
          role="button"
          tabIndex={0}
          aria-label="Add column"
          onKeyDown={(e) => { if (e.key === 'Enter') onAddColumn?.(); }}
        >
          <Plus className="w-3 h-3 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}