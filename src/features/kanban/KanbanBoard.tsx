import { memo, useState, useCallback, useMemo, useRef } from 'react';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { Button } from '@/components/ui/button';
import { useAgentHues } from '@/lib/agentColors';
import type { KanbanTask, TaskStatus } from './types';
import { COLUMNS } from './types';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { useKanbanDragDrop } from './hooks/useKanbanDragDrop';
import { assigneeAgentId } from './tone';

interface KanbanBoardProps {
  tasksByStatus: (status: TaskStatus) => KanbanTask[];
  onCardClick: (task: KanbanTask) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  hasAnyTasks: boolean;
  onCreateTask: () => void;
  reorderTask: (id: string, version: number, targetStatus: TaskStatus, targetIndex: number) => Promise<KanbanTask>;
  /** Visible columns in display order, derived from board config. Falls back to COLUMNS. */
  boardColumns?: TaskStatus[];
}

const NO_IDS: readonly string[] = [];

/* Loading: the lanes with quiet plates where the rows will be; nothing pulses */
function SkeletonColumn() {
  return (
    <div className="nerve-board-column flex h-full min-w-[16rem] max-w-[26rem] flex-1 basis-[18rem] flex-col" aria-hidden="true">
      <div className="flex min-h-[var(--row-unit)] items-center border-b border-border px-3">
        <div className="h-3 w-16 rounded-[2px] bg-raised" />
      </div>
      <div className="flex flex-col gap-1.5 p-2">
        {[72, 56, 88].map((h, i) => (
          <div key={i} className="nerve-task-card rounded-[4px]" style={{ height: `${h}px` }} />
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
  reorderTask,
  boardColumns: boardColumnsProp,
}: KanbanBoardProps) {
  const activeColumns = boardColumnsProp ?? COLUMNS;

  /* Build flat task list from the tasksByStatus prop */
  const propTasks = useMemo(() => {
    const all: KanbanTask[] = [];
    for (const col of activeColumns) {
      all.push(...tasksByStatus(col));
    }
    return all;
  }, [tasksByStatus, activeColumns]);

  /* Identity: every assignee family keeps its hue in the glass of its tasks' panes */
  const assigneeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const task of propTasks) {
      const id = assigneeAgentId(task.assignee);
      if (id) ids.add(id);
    }
    return ids.size ? Array.from(ids).sort() : NO_IDS;
  }, [propTasks]);
  const { hueFor } = useAgentHues(assigneeIds);
  const hueForTask = useCallback((task: KanbanTask) => {
    const id = assigneeAgentId(task.assignee);
    return id ? hueFor(id) : undefined;
  }, [hueFor]);

  /* Drag override: non-null only during an active drag */
  const [dragOverride, setDragOverride] = useState<KanbanTask[] | null>(null);
  const isDraggingRef = useRef(false);

  // During drag use optimistic state; otherwise use server data directly
  const localTasks = dragOverride ?? propTasks;

  /* Wrap setTasks for drag hook: operates on the override */
  const setTasksWithDragTracking = useCallback(
    (updater: (prev: KanbanTask[]) => KanbanTask[]) => {
      setDragOverride(prev => updater(prev ?? propTasks));
    },
    [propTasks],
  );

  /* DnD hook */
  const { sensors, collisionDetection, activeTask, onDragStart, onDragOver, onDragEnd, onDragCancel } = useKanbanDragDrop({
    tasks: localTasks,
    setTasksOptimistic: setTasksWithDragTracking,
    reorderTask,
    activeColumns,
    onError: (msg) => {
      // Clear override to fall back to prop data
      setDragOverride(null);
      console.warn('[Kanban DnD]', msg);
    },
  });

  /* Track drag state so we don't clobber optimistic updates with prop sync */
  const handleDragStart = useCallback(
    (event: Parameters<typeof onDragStart>[0]) => {
      isDraggingRef.current = true;
      setDragOverride(propTasks); // snapshot current state
      onDragStart(event);
    },
    [onDragStart, propTasks],
  );

  const handleDragEnd = useCallback(
    async (event: Parameters<typeof onDragEnd>[0]) => {
      await onDragEnd(event);
      // Small delay to let API respond before clearing override
      setTimeout(() => {
        isDraggingRef.current = false;
        setDragOverride(null);
      }, 500);
    },
    [onDragEnd],
  );

  const handleDragCancel = useCallback(() => {
    onDragCancel();
    isDraggingRef.current = false;
    setDragOverride(null);
  }, [onDragCancel]);

  /* Derived tasksByStatus from local state */
  const localTasksByStatus = useCallback(
    (status: TaskStatus): KanbanTask[] =>
      localTasks.filter(t => t.status === status).sort((a, b) => a.columnOrder - b.columnOrder),
    [localTasks],
  );

  /* Error state */
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="max-w-[420px] text-center">
          <p className="mb-1 text-[0.933rem] font-semibold text-foreground">Couldn't load tasks</p>
          <p className="mb-4 text-[0.8rem] text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  /* Loading skeleton */
  if (loading) {
    return (
      <div className="h-full overflow-x-auto">
        <div className="flex h-full w-full">
          {activeColumns.map(s => <SkeletonColumn key={s} />)}
        </div>
      </div>
    );
  }

  /* Empty board */
  if (!hasAnyTasks) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="max-w-[420px] select-none text-center">
          <h3 className="mb-1 text-[1.067rem] font-semibold text-foreground">No tasks yet</h3>
          <p className="mb-4 text-[0.867rem] text-muted-foreground">
            Create the first one, or ask an agent to propose it.
          </p>
          <Button size="sm" onClick={onCreateTask}>
            New task
          </Button>
        </div>
      </div>
    );
  }

  /* Board with columns */
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={onDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="h-full overflow-x-auto">
        <div className="flex h-full w-full">
          {activeColumns.map(status => (
            <KanbanColumn
              key={status}
              status={status}
              tasks={localTasksByStatus(status)}
              onCardClick={onCardClick}
              hueFor={hueForTask}
            />
          ))}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="w-[19rem]">
            <KanbanCard task={activeTask} onClick={() => {}} isDragOverlay hue={hueForTask(activeTask)} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
});
