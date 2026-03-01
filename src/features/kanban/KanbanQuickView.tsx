/**
 * KanbanQuickView — Compact read-only overview of active Kanban tasks.
 * Shows To Do, In Progress, and Review columns as mini-lists inside the workspace panel.
 * Self-contained: manages its own data via useKanban hook.
 */

import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import type { KanbanTask, TaskStatus, TaskPriority } from './types';
import { COLUMN_LABELS } from './types';
import { useKanban } from './hooks/useKanban';

/* ── Priority colors ── */
const PRIORITY_DOT: Record<TaskPriority, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-400',
  normal: 'bg-blue-400',
  low: 'bg-zinc-400',
};

/* ── Statuses shown in quick view ── */
const QUICK_STATUSES: TaskStatus[] = ['todo', 'in-progress', 'review'];
const MAX_ROWS = 5;

interface KanbanQuickViewProps {
  onOpenBoard: () => void;
  onOpenTask: (task: KanbanTask) => void;
}

function TaskRow({ task, onClick }: { task: KanbanTask; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-left text-xs hover:bg-muted/60 transition-colors group cursor-pointer"
    >
      <span
        className={`shrink-0 w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[task.priority]}`}
        title={task.priority}
      />
      <span className="truncate flex-1 text-foreground/80 group-hover:text-foreground">
        {task.title}
      </span>
      {task.assignee && (
        <span className="shrink-0 text-[10px] text-muted-foreground truncate max-w-[60px]">
          {task.assignee.replace(/^agent:/, '')}
        </span>
      )}
    </button>
  );
}

function StatusSection({
  status,
  tasks,
  onOpenTask,
}: {
  status: TaskStatus;
  tasks: KanbanTask[];
  onOpenTask: (task: KanbanTask) => void;
}) {
  const visible = tasks.slice(0, MAX_ROWS);
  const overflow = tasks.length - MAX_ROWS;

  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-center gap-1.5 px-1.5 mb-0.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {COLUMN_LABELS[status]}
        </span>
        <span className="text-[10px] text-muted-foreground/60">{tasks.length}</span>
      </div>
      {visible.map(task => (
        <TaskRow key={task.id} task={task} onClick={() => onOpenTask(task)} />
      ))}
      {overflow > 0 && (
        <span className="block px-1.5 text-[10px] text-muted-foreground/50">
          +{overflow} more
        </span>
      )}
    </div>
  );
}

export function KanbanQuickView({ onOpenBoard, onOpenTask }: KanbanQuickViewProps) {
  const { tasksByStatus, statusCounts, loading, error } = useKanban();

  const sections = useMemo(() => {
    return QUICK_STATUSES.map(s => ({
      status: s,
      tasks: tasksByStatus(s),
    }));
  }, [tasksByStatus]);

  const totalActive = (statusCounts.todo || 0) + (statusCounts['in-progress'] || 0) + (statusCounts.review || 0);
  const allEmpty = totalActive === 0;

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-foreground/90">Kanban</span>
          {totalActive > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple/15 text-purple font-medium">
              {totalActive}
            </span>
          )}
        </div>
        <button
          onClick={onOpenBoard}
          className="flex items-center gap-1 text-[11px] text-purple hover:text-purple/80 transition-colors cursor-pointer"
        >
          Open Board
          <ArrowRight size={11} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
        {error && (
          <p className="text-[11px] text-destructive px-1.5">{error}</p>
        )}
        {loading && !error && (
          <p className="text-[11px] text-muted-foreground/50 px-1.5 animate-pulse">Loading…</p>
        )}
        {!loading && allEmpty && !error && (
          <p className="text-[11px] text-muted-foreground/40 px-1.5 py-4 text-center">
            No active tasks
          </p>
        )}
        {!loading && !allEmpty && sections.map(({ status, tasks }) =>
          tasks.length > 0 ? (
            <StatusSection
              key={status}
              status={status}
              tasks={tasks}
              onOpenTask={onOpenTask}
            />
          ) : null
        )}
      </div>
    </div>
  );
}
