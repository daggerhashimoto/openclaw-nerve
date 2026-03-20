import { memo, useMemo } from 'react';
import { Inbox } from 'lucide-react';
import { useDroppable, useDndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { KanbanTask, TaskStatus } from './types';
import { COLUMN_LABELS } from './types';
import { KanbanCard } from './KanbanCard';
import { TASK_STATUS_TONE } from './tone';

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: KanbanTask[];
  onCardClick: (task: KanbanTask) => void;
}

export const KanbanColumn = memo(function KanbanColumn({ status, tasks, onCardClick }: KanbanColumnProps) {
  const accent = TASK_STATUS_TONE[status];

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
      className={`shell-panel flex h-full min-w-[280px] w-[320px] max-w-[360px] shrink-0 flex-col overflow-hidden rounded-[24px] transition-[border-color,background-color,box-shadow] duration-150 ${
        isOverColumn ? 'border-primary/45 bg-primary/[0.06] shadow-[0_18px_38px_rgba(0,0,0,0.22)]' : ''
      }`}
    >
      <div className="sticky top-0 z-10 flex h-11 items-center justify-between border-b border-border/55 bg-card/78 px-3 backdrop-blur-lg">
        <div className="flex items-center gap-2">
          <span className={`text-[0.733rem] font-semibold uppercase tracking-[0.18em] ${accent.textClass}`}>
            {COLUMN_LABELS[status]}
          </span>
        </div>
        <span className={`inline-flex min-w-[28px] items-center justify-center rounded-full border px-2 py-0.5 text-[0.667rem] font-semibold tabular-nums ${accent.badgeClass}`}>
          {tasks.length}
        </span>
      </div>

      {/* Scrollable card list — droppable + sortable context */}
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className="flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto p-2.5"
        >
          {tasks.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-8 text-muted-foreground/60 select-none">
              <Inbox size={18} className="mb-2" />
              <span className="cockpit-badge">No tasks</span>
            </div>
          ) : (
            tasks.map(task => (
              <KanbanCard key={task.id} task={task} onClick={onCardClick} />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
});
