import { memo } from 'react';
import { Inbox } from 'lucide-react';
import type { KanbanTask, TaskStatus } from './types';
import { KanbanCard } from './KanbanCard';

/* ── Column display config ── */
const COLUMN_META: Record<TaskStatus, { title: string; accent: string }> = {
  backlog: { title: 'Backlog', accent: 'text-slate-400' },
  todo: { title: 'To Do', accent: 'text-blue-400' },
  'in-progress': { title: 'In Progress', accent: 'text-cyan-400' },
  review: { title: 'Review', accent: 'text-amber-400' },
  done: { title: 'Done', accent: 'text-green-400' },
  cancelled: { title: 'Cancelled', accent: 'text-gray-500' },
};

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: KanbanTask[];
  onCardClick: (task: KanbanTask) => void;
}

export const KanbanColumn = memo(function KanbanColumn({ status, tasks, onCardClick }: KanbanColumnProps) {
  const meta = COLUMN_META[status];

  return (
    <div className="flex flex-col min-w-[280px] w-[320px] max-w-[360px] shrink-0 bg-background/50 rounded-lg border border-border/40">
      {/* Sticky column header (§19.2: 40px) */}
      <div className="sticky top-0 z-10 flex items-center justify-between h-10 px-3 bg-background/80 backdrop-blur-sm border-b border-border/40 rounded-t-lg">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold uppercase tracking-wider ${meta.accent}`}>
            {meta.title}
          </span>
        </div>
        <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded-sm tabular-nums">
          {tasks.length}
        </span>
      </div>

      {/* Scrollable card list */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2 min-h-[120px]">
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
    </div>
  );
});
