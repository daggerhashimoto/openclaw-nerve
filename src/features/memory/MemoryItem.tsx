/**
 * MemoryItem: single memory row with edit and delete actions.
 *
 * Displays a memory item with type-specific styling. Sections are
 * collapsible (click to toggle). Daily entries and sections have
 * an edit button on hover. Delete button appears on hover for all items.
 *
 * Supports optimistic update states:
 * - pending: Shows spinner, muted styling
 * - failed: Red highlight, shows error state
 * - deleting: Dimmed while the delete settles
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, Pencil, Loader2, AlertCircle, ChevronRight, EllipsisVertical } from 'lucide-react';
import type { Memory } from '@/types';

interface MemoryItemProps {
  memory: Memory;
  onDelete: (text: string, type: Memory['type'], date?: string) => void;
  onEdit?: (text: string, type: Memory['type'], date?: string) => void;
  /** For sections: whether the section is expanded */
  isExpanded?: boolean;
  /** For sections: callback to toggle expand/collapse */
  onToggleExpand?: () => void;
  /** For sections: number of items under this section */
  itemCount?: number;
  /** Compact mode for mobile/topbar dropdown; uses kebab actions instead of hover actions. */
  compact?: boolean;
}

function MemoryItemInner({ memory, onDelete, onEdit, isExpanded, onToggleExpand, itemCount, compact = false }: MemoryItemProps) {
  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (memory.pending || memory.deleting) return;
    onDelete(memory.text, memory.type, memory.date);
  }, [memory.pending, memory.deleting, memory.text, memory.type, memory.date, onDelete]);

  // Sections and daily files open their own editor; an item opens the section that holds it
  // (the list hands items an onEdit that already points at the parent section).
  const handleEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (memory.pending || memory.deleting) return;
    if (onEdit) {
      onEdit(memory.text, memory.type, memory.date);
    }
  }, [memory.pending, memory.deleting, memory.text, memory.type, memory.date, onEdit]);

  const handleClick = useCallback(() => {
    if (memory.pending || memory.deleting) return;
    // Sections toggle collapse on click
    if (memory.type === 'section' && onToggleExpand) {
      onToggleExpand();
      return;
    }
    // Daily entries open editor on click
    if (memory.type === 'daily' && onEdit) {
      onEdit(memory.text, memory.type, memory.date);
    }
  }, [memory.pending, memory.deleting, memory.type, memory.text, memory.date, onToggleExpand, onEdit]);

  const isClickable =
    (memory.type === 'section' && onToggleExpand) ||
    (memory.type === 'daily' && onEdit);

  const isEditable = Boolean(onEdit);
  const editTitle = memory.type === 'item' ? 'Edit in section' : memory.type === 'daily' ? 'Edit entry' : 'Edit section';

  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!compact || !actionsOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (actionsRef.current?.contains(target)) return;
      setActionsOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [compact, actionsOpen]);

  const handleKebabToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setActionsOpen(prev => !prev);
  }, []);

  const handleEditFromMenu = useCallback((e: React.MouseEvent) => {
    handleEdit(e);
    setActionsOpen(false);
  }, [handleEdit]);

  const handleDeleteFromMenu = useCallback((e: React.MouseEvent) => {
    handleDelete(e);
    setActionsOpen(false);
  }, [handleDelete]);

  // Optimistic state styling
  const stateClasses = memory.deleting
    ? 'opacity-50'
    : memory.failed
      ? 'bg-destructive/10'
      : memory.pending
        ? 'opacity-70'
        : '';

  const ghostAction =
    'grid size-6 shrink-0 place-items-center rounded-[3px] text-muted-foreground transition-colors duration-[120ms] hover:bg-raised';

  return (
    <div
      className={`group relative flex min-h-[var(--row-unit)] items-center gap-2 pl-3 pr-1.5 text-[0.867rem] transition-colors duration-[120ms] hover:bg-raised focus-visible:bg-raised ${
        isClickable && !memory.pending && !memory.deleting ? 'cursor-pointer' : ''
      } ${stateClasses}`}
      onClick={handleClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-expanded={memory.type === 'section' ? isExpanded : undefined}
      onKeyDown={isClickable ? (e) => e.key === 'Enter' && handleClick() : undefined}
    >
      {memory.type === 'section' ? (
        <>
          <ChevronRight
            size={14}
            aria-hidden="true"
            className={`shrink-0 text-muted-foreground ${isExpanded ? 'rotate-90' : ''}`}
          />
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
            {memory.text}
          </span>
          {typeof itemCount === 'number' && itemCount > 0 && (
            <span className="shrink-0 font-mono text-[0.8rem] text-muted-foreground tabular">
              {itemCount}
            </span>
          )}
        </>
      ) : memory.type === 'daily' ? (
        <>
          {/* A dated note: the date is a column, the title reads in foreground */}
          <span className="shrink-0 pl-[22px] font-mono text-[0.8rem] text-muted-foreground tabular">{memory.date}</span>
          <span className="min-w-0 flex-1 truncate text-foreground">
            {memory.text}
          </span>
        </>
      ) : (
        /* The item is the content: it reads in foreground and wraps to two lines before clipping */
        <span className="line-clamp-2 min-w-0 flex-1 py-1 pl-[22px] leading-5 text-foreground">
          {memory.text}
        </span>
      )}

      {/* Status indicators for optimistic updates */}
      {memory.pending && (
        <span className="shrink-0 text-muted-foreground animate-spin">
          <Loader2 size={14} />
        </span>
      )}
      {memory.failed && (
        <span className="shrink-0 text-destructive" title="Operation failed">
          <AlertCircle size={14} />
        </span>
      )}

      {!memory.pending && !memory.deleting && (
        compact ? (
          <div ref={actionsRef} className="relative shrink-0">
            <button
              onClick={handleKebabToggle}
              className={`${ghostAction} hover:text-foreground`}
              title="Memory actions"
              aria-label="Memory actions"
              aria-expanded={actionsOpen}
            >
              <EllipsisVertical size={14} />
            </button>

            {actionsOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 flex items-center gap-0.5 rounded-[3px] border border-border bg-popover p-0.5 shadow-[0_12px_32px_rgba(0,0,0,0.32)]">
                {isEditable && (
                  <button
                    onClick={handleEditFromMenu}
                    className={`${ghostAction} hover:text-foreground`}
                    title={editTitle}
                    aria-label="Edit memory"
                  >
                    <Pencil size={14} />
                  </button>
                )}
                <button
                  onClick={handleDeleteFromMenu}
                  className={`${ghostAction} hover:text-destructive`}
                  title="Delete memory"
                  aria-label="Delete memory"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Edit button: revealed on hover or focus for editable items */}
            {isEditable && (
              <button
                onClick={handleEdit}
                className={`${ghostAction} opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100`}
                title={editTitle}
                aria-label="Edit memory"
              >
                <Pencil size={14} />
              </button>
            )}
            {/* Delete button: revealed on hover or focus (not when pending/deleting) */}
            <button
              onClick={handleDelete}
              className={`${ghostAction} opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100`}
              title="Delete memory"
            >
              <Trash2 size={14} />
            </button>
          </>
        )
      )}
    </div>
  );
}

/** Single memory entry row with expand, edit, and delete controls. */
export const MemoryItem = memo(MemoryItemInner, (prev, next) =>
  prev.memory.text === next.memory.text &&
  prev.memory.type === next.memory.type &&
  prev.memory.pending === next.memory.pending &&
  prev.memory.failed === next.memory.failed &&
  prev.memory.deleting === next.memory.deleting &&
  prev.isExpanded === next.isExpanded &&
  prev.itemCount === next.itemCount &&
  prev.compact === next.compact
);
