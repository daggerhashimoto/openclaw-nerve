import { memo, useMemo } from 'react';
import { Inbox } from 'lucide-react';
import { useDroppable, useDndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { KanbanTask, TaskStatus } from './types';
import { COLUMN_LABELS } from './types';
import { KanbanCard } from './KanbanCard';

/* ── Column accent colors ── */
const COLUMN_ACCENT: Record<TaskStatus, string> = {
  backlog: 'text-slate-400',
  todo: 'text-blue-400',
  'in-progress': 'text-cyan-400',
  review: 'text-amber-400',
  done: 'text-green-400',
  cancelled: 'text-gray-500',
};

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: KanbanTask[];
  onCardClick: (task: KanbanTask) => void;
}

export const KanbanColumn = memo(function KanbanColumn({ status, tasks, onCardClick }: KanbanColumnProps) {
  const accent = COLUMN_ACCENT[status];

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
      className={`flex flex-col min-w-[280px] w-[320px] max-w-[360px] shrink-0 bg-background/50 rounded-lg border transition-colors duration-150 ${
        isOverColumn ? 'border-primary/50 bg-primary/5' : 'border-border/40'
      }`}
    >
      {/* Sticky column header (§19.2: 40px) */}
      <div className="sticky top-0 z-10 flex items-center justify-between h-10 px-3 bg-background/80 backdrop-blur-sm border-b border-border/40 rounded-t-lg">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold uppercase tracking-wider ${accent}`}>
            {COLUMN_LABELS[status]}
          </span>
        </div>
        <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded-sm tabular-nums">
          {tasks.length}
        </span>
      </div>

      {/* Scrollable card list — droppable + sortable context */}
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className="flex-1 overflow-y-auto p-2 flex flex-col gap-2 min-h-[120px]"
        >
          {tasks.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-8 text-muted-foreground/60 select-none">
              <Inbox size={20} className="mb-1.5" />
              <span className="text-[11px]">No tasks</span>
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
