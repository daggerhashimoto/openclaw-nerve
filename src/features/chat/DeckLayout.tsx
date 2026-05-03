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
  const { columns, activeColumnId, setActiveColumn, removeColumn, resizeColumn, minColumnWidth, addColumn } = useDeck();
  const containerRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState<{ colId: string; startX: number; startWidth: number } | null>(null);

  // ── Resize logic ──────────────────────────────────────────────────────

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, colId: string, currentWidth: number) => {
      e.preventDefault();
      setResizing({ colId, startX: e.clientX, startWidth: currentWidth });

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - e.clientX;
        resizeColumn(colId, currentWidth + delta);
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
      <div className={cn('flex-1 flex items-center justify-center bg-background', className)}>
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
      className={cn('flex-1 flex min-h-0 overflow-hidden', className)}
      style={{ '--deck-gap': '2px' } as React.CSSProperties}
    >
      {columns.map((col, idx) => {
        const isActive = col.id === activeColumnId;
        const label = getSessionLabel(col.sessionKey);
        const agentName = getAgentName?.(col.sessionKey);

        return (
          <div
            key={col.id}
            className="flex min-h-0"
            style={{ width: `${col.width}px`, flexShrink: 0 }}
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
                  'w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors flex-shrink-0',
                  resizing?.colId === col.id && 'bg-primary/40',
                )}
                onMouseDown={(e) => handleResizeStart(e, col.id, col.width)}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize column"
              />
            )}
          </div>
        );
      })}

      {/* Add column button (right edge) */}
      {columns.length < 6 && (
        <div className="flex flex-col items-center justify-center w-10 shrink-0 border-l border-border hover:bg-accent/30 transition-colors cursor-pointer"
          onClick={onAddColumn}
          role="button"
          tabIndex={0}
          aria-label="Add column"
          onKeyDown={(e) => { if (e.key === 'Enter') onAddColumn?.(); }}
        >
          <Plus className="w-4 h-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}