import { memo } from 'react';
import { LayoutGrid } from 'lucide-react';
import type { KanbanTask, TaskStatus } from './types';
import { COLUMNS } from './types';
import { KanbanColumn } from './KanbanColumn';

interface KanbanBoardProps {
  tasksByStatus: (status: TaskStatus) => KanbanTask[];
  onCardClick: (task: KanbanTask) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  hasAnyTasks: boolean;
  onCreateTask: () => void;
}

/* ── Loading skeleton ── */
function SkeletonColumn() {
  return (
    <div className="flex flex-col min-w-[280px] w-[320px] max-w-[360px] shrink-0 bg-background/50 rounded-lg border border-border/40">
      <div className="h-10 px-3 flex items-center border-b border-border/40">
        <div className="h-3 w-16 bg-muted rounded animate-pulse" />
      </div>
      <div className="p-2 flex flex-col gap-2">
        {[86, 62, 110].map((h, i) => (
          <div
            key={i}
            className="rounded-[10px] bg-muted/50 animate-pulse"
            style={{ height: `${h}px` }}
          />
        ))}
      </div>
    </div>
  );
}

export const KanbanBoard = memo(function KanbanBoard({
  tasksByStatus,
  onCardClick,
  loading,
  error,
  onRetry,
  hasAnyTasks,
  onCreateTask,
}: KanbanBoardProps) {
  /* ── Error state ── */
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="max-w-[420px] text-center">
          <p className="text-sm text-destructive font-semibold mb-2">Couldn't load tasks</p>
          <p className="text-xs text-muted-foreground mb-4">{error}</p>
          <button
            onClick={onRetry}
            className="h-[30px] px-4 text-xs font-semibold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  /* ── Loading skeleton ── */
  if (loading) {
    return (
      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-3 p-0 min-w-min h-full">
          {COLUMNS.map(s => <SkeletonColumn key={s} />)}
        </div>
      </div>
    );
  }

  /* ── Empty board (§18.1) ── */
  if (!hasAnyTasks) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="max-w-[420px] text-center select-none">
          <LayoutGrid size={28} className="mx-auto mb-3 text-primary opacity-60" />
          <h3 className="text-[16px] font-bold text-foreground mb-1.5">No tasks yet</h3>
          <p className="text-[13px] text-muted-foreground mb-5">
            Create your first task or ask an agent to propose one.
          </p>
          <button
            onClick={onCreateTask}
            className="h-8 min-w-[120px] px-5 text-xs font-semibold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Create Task
          </button>
        </div>
      </div>
    );
  }

  /* ── Board with columns ── */
  return (
    <div className="flex-1 overflow-x-auto">
      <div className="flex gap-3 p-0 min-w-min h-full">
        {COLUMNS.map(status => (
          <KanbanColumn
            key={status}
            status={status}
            tasks={tasksByStatus(status)}
            onCardClick={onCardClick}
          />
        ))}
      </div>
    </div>
  );
});
