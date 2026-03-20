/**
 * MemoryItem — Single memory row with edit and delete actions.
 *
 * Displays a memory item with type-specific styling. Sections are
 * collapsible (click to toggle). Daily entries and sections have
 * an edit button on hover. Delete button appears on hover for all items.
 *
 * Supports optimistic update states:
 * - pending: Shows spinner, muted styling
 * - failed: Red highlight, shows error state
 * - deleting: Fade out animation
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Calendar, Trash2, Pencil, Loader2, AlertCircle, ChevronRight, EllipsisVertical } from 'lucide-react';
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

  const handleEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (memory.pending || memory.deleting) return;
    if ((memory.type === 'section' || memory.type === 'daily') && onEdit) {
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

  const isEditable = (memory.type === 'section' || memory.type === 'daily') && onEdit;

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
    ? 'opacity-50 scale-95 transition-all duration-300'
    : memory.failed
      ? 'bg-red/10 border-l-2 border-l-red'
      : memory.pending
        ? 'opacity-70'
        : '';

  return (
    <div
      className={`group relative flex items-center gap-2 px-3 py-1.5 border-b border-border/40 text-[0.733rem] hover:bg-foreground/[0.02] transition-colors ${
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
          <span
            className={`shrink-0 text-primary/60 transition-transform duration-150 ${
              isExpanded ? 'rotate-90' : ''
            }`}
          >
            <ChevronRight size={12} />
          </span>
          <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-primary font-bold">
            {memory.text}
          </span>
          {!isExpanded && typeof itemCount === 'number' && itemCount > 0 && (
            <span className="text-[0.6rem] text-muted-foreground/50 shrink-0">
              {itemCount}
            </span>
          )}
        </>
      ) : memory.type === 'daily' ? (
        <>
          <span className="text-muted-foreground shrink-0 text-[0.667rem] flex items-center">
            <Calendar size={10} />
          </span>
          <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
            <span className="text-muted-foreground">{memory.date}</span> {memory.text}
          </span>
        </>
      ) : (
        <>
          <span className="text-primary shrink-0 text-[0.667rem]">›</span>
          <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-foreground">
            {memory.text}
          </span>
        </>
      )}

      {/* Status indicators for optimistic updates */}
      {memory.pending && (
        <span className="shrink-0 text-primary animate-spin">
          <Loader2 size={12} />
        </span>
      )}
      {memory.failed && (
        <span className="shrink-0 text-red" title="Operation failed">
          <AlertCircle size={12} />
        </span>
      )}

      {!memory.pending && !memory.deleting && (
        compact ? (
          <div ref={actionsRef} className="relative shrink-0">
            <button
              onClick={handleKebabToggle}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Memory actions"
              aria-label="Memory actions"
              aria-expanded={actionsOpen}
            >
              <EllipsisVertical size={13} />
            </button>

            {actionsOpen && (
              <div className="absolute right-0 top-full mt-1 flex items-center gap-0.5 bg-card border border-border/70 shadow-lg p-0.5 z-20">
                {isEditable && (
                  <button
                    onClick={handleEditFromMenu}
                    className="p-1 text-muted-foreground hover:text-purple transition-colors"
                    title="Edit section"
                    aria-label="Edit memory"
                  >
                    <Pencil size={12} />
                  </button>
                )}
                <button
                  onClick={handleDeleteFromMenu}
                  className="p-1 text-muted-foreground hover:text-red transition-colors"
                  title="Delete memory"
                  aria-label="Delete memory"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Edit button — visible on hover for editable items */}
            {isEditable && (
              <button
                onClick={handleEdit}
                className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-purple transition-all shrink-0"
                title="Edit section"
              >
                <Pencil size={12} />
              </button>
            )}
            {/* Delete button — visible on hover (not when pending/deleting) */}
            <button
              onClick={handleDelete}
              className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-red transition-all shrink-0"
              title="Delete memory"
            >
              <Trash2 size={12} />
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
