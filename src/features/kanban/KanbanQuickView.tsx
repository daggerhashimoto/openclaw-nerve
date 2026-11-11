/**
 * KanbanQuickView: compact read-only overview of active Kanban tasks.
 * Shows To do, In progress and Review as short lists inside the workspace column,
 * in the column's own row idiom: a pane leads each task, the assignee closes the row.
 * Self-contained: manages its own data via the useKanban hook.
 */

import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { Pane } from '@/components/ui/Pane';
import { paneStateLabel } from '@/lib/paneState';
import { nameHueStyle, useAgentHues } from '@/lib/agentColors';
import type { KanbanTask, TaskStatus } from './types';
import { useKanban } from './hooks/useKanban';
import { assigneeAgentId, assigneeName, boardWords, columnTitle, taskPaneState } from './tone';

/* Statuses shown in quick view */
const QUICK_STATUSES: TaskStatus[] = ['todo', 'in-progress', 'review'];
const MAX_ROWS = 5;
const NO_IDS: readonly string[] = [];

interface KanbanQuickViewProps {
  onOpenBoard: () => void;
  onOpenTask: (task: KanbanTask) => void;
}

function TaskRow({ task, hue, onClick }: { task: KanbanTask; hue?: string; onClick: () => void }) {
  const paneState = taskPaneState(task);
  const name = assigneeName(task.assignee);
  const agentId = assigneeAgentId(task.assignee);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[var(--row-unit)] w-full cursor-pointer items-center gap-2 border-0 bg-transparent pl-3 pr-3 text-left text-[0.867rem] transition-colors duration-[120ms] hover:bg-raised"
    >
      <Pane state={paneState} hue={hue} label={paneStateLabel(paneState)} />
      <span className="min-w-0 flex-1 truncate text-foreground">{task.title}</span>
      {name && (
        <span
          className={`max-w-[6rem] shrink-0 truncate text-[0.8rem] text-muted-foreground ${agentId && hue ? 'name-hued' : ''}`}
          style={agentId ? nameHueStyle(hue) : undefined}
        >
          {name}
        </span>
      )}
    </button>
  );
}

function StatusSection({
  status,
  tasks,
  hueFor,
  onOpenTask,
}: {
  status: TaskStatus;
  tasks: KanbanTask[];
  hueFor: (task: KanbanTask) => string | undefined;
  onOpenTask: (task: KanbanTask) => void;
}) {
  const visible = tasks.slice(0, MAX_ROWS);
  const overflow = tasks.length - MAX_ROWS;

  return (
    <div>
      <div className="flex min-h-[var(--row-unit)] items-center gap-2 pl-3 pr-3">
        <span className="min-w-0 flex-1 truncate text-[0.867rem] font-medium text-foreground">{columnTitle(status)}</span>
        <span className="shrink-0 font-mono text-[0.8rem] text-muted-foreground tabular">{tasks.length}</span>
      </div>
      {visible.map(task => (
        <TaskRow key={task.id} task={task} hue={hueFor(task)} onClick={() => onOpenTask(task)} />
      ))}
      {overflow > 0 && (
        <div className="flex min-h-[var(--row-unit)] items-center pl-[1.917rem] text-[0.8rem] text-muted-foreground">
          +{overflow} more
        </div>
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

  const assigneeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const section of sections) {
      for (const task of section.tasks) {
        const id = assigneeAgentId(task.assignee);
        if (id) ids.add(id);
      }
    }
    return ids.size ? Array.from(ids).sort() : NO_IDS;
  }, [sections]);
  const { hueFor } = useAgentHues(assigneeIds);
  const hueForTask = (task: KanbanTask) => {
    const id = assigneeAgentId(task.assignee);
    return id ? hueFor(id) : undefined;
  };

  const activeCounts = {
    todo: statusCounts.todo || 0,
    'in-progress': statusCounts['in-progress'] || 0,
    review: statusCounts.review || 0,
  };
  const totalActive = activeCounts.todo + activeCounts['in-progress'] + activeCounts.review;
  const allEmpty = totalActive === 0;
  const words = boardWords(activeCounts).replace(/^\d+ tasks?/, (m) => `${m.split(' ')[0]} active`);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header row: the active board in words, and the way to the full board */}
      <div className="flex min-h-[var(--row-unit)] items-center gap-2 border-b border-border pl-3 pr-1">
        <span className="min-w-0 flex-1 truncate text-[0.8rem] text-muted-foreground">{words}</span>
        <button type="button" onClick={onOpenBoard} className="shell-chip shrink-0">
          <span>Open board</span>
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <p className="px-3 py-2 text-[0.8rem] text-destructive">{error}</p>
        )}
        {loading && !error && (
          <p className="flex min-h-[var(--row-unit)] items-center px-3 text-[0.8rem] text-muted-foreground">Loading tasks</p>
        )}
        {!loading && allEmpty && !error && (
          <div className="px-3 py-4 text-center text-[0.8rem] text-muted-foreground">
            No active tasks.
          </div>
        )}
        {!loading && !allEmpty && sections.map(({ status, tasks }) =>
          tasks.length > 0 ? (
            <StatusSection
              key={status}
              status={status}
              tasks={tasks}
              hueFor={hueForTask}
              onOpenTask={onOpenTask}
            />
          ) : null
        )}
      </div>
    </div>
  );
}
