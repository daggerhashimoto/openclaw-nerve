import { memo, useMemo } from 'react';
import { useDroppable, useDndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { KanbanTask, TaskStatus } from './types';
import { KanbanCard } from './KanbanCard';
import { columnTitle } from './tone';

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: KanbanTask[];
  onCardClick: (task: KanbanTask) => void;
  /** Display label for the column. Falls back to COLUMN_LABELS or a title-cased version of the key. */
  label?: string;
  /** Family hue for a task's assignee, shown in the glass of its off pane. */
  hueFor?: (task: KanbanTask) => string | undefined;
}

/**
 * A lane on the room plate: a row-unit header (title and count), a hairline on its left
 * edge, and the cards as rows beneath. A lane under a dragged card lifts to Raised.
 */
export const KanbanColumn = memo(function KanbanColumn({ status, tasks, onCardClick, label, hueFor }: KanbanColumnProps) {
  const displayLabel = columnTitle(status, label);
  const quiet = status === 'done' || status === 'cancelled';

  // Make the column itself a drop target (for dropping into empty columns)
  const { setNodeRef, isOver: isDirectlyOver } = useDroppable({ id: status });
  const { active, over } = useDndContext();

  // Stable list of sortable ids for this column
  const taskIds = useMemo(() => tasks.map((t) => t.id), [tasks]);

  // Highlight when dragging over this column OR over any card in this column
  const isOverColumn = isDirectlyOver || (
    active !== null && over !== null && over.id !== status && taskIds.includes(over.id as string)
  );

  return (
    <div
      className={`nerve-board-column flex h-full min-w-[16rem] max-w-[26rem] flex-1 basis-[18rem] flex-col transition-colors duration-[120ms] ${
        isOverColumn ? 'is-over' : ''
      }`}
      data-status={status}
    >
      <div className="flex min-h-[var(--row-unit)] shrink-0 items-center gap-2 border-b border-border px-3">
        <span className={`min-w-0 flex-1 truncate text-[0.867rem] font-semibold ${quiet ? 'text-muted-foreground' : 'text-foreground'}`}>
          {displayLabel}
        </span>
        <span className="shrink-0 font-mono text-[0.8rem] text-muted-foreground tabular">{tasks.length}</span>
      </div>

      {/* Scrollable card list: droppable and sortable context */}
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className="flex min-h-[120px] flex-1 flex-col gap-1.5 overflow-y-auto p-2"
        >
          {tasks.length === 0 ? (
            <div className="flex flex-1 select-none items-center justify-center py-8 text-[0.8rem] text-muted-foreground">
              No tasks
            </div>
          ) : (
            tasks.map(task => (
              <KanbanCard key={task.id} task={task} onClick={onCardClick} hue={hueFor?.(task)} />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
});
