import { memo, useState, useCallback, useMemo, useRef } from 'react';
import { LayoutGrid } from 'lucide-react';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { Button } from '@/components/ui/button';
import type { KanbanTask, TaskStatus } from './types';
import { COLUMNS } from './types';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { useKanbanDragDrop } from './hooks/useKanbanDragDrop';

interface KanbanBoardProps {
  tasksByStatus: (status: TaskStatus) => KanbanTask[];
  onCardClick: (task: KanbanTask) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  hasAnyTasks: boolean;
  onCreateTask: () => void;
  reorderTask: (id: string, version: number, targetStatus: TaskStatus, targetIndex: number) => Promise<KanbanTask>;
}

/* ── Loading skeleton ── */
function SkeletonColumn() {
  return (
    <div className="flex flex-col min-w-[280px] w-[320px] max-w-[360px] h-full shrink-0 bg-background/50 rounded-lg border border-border/40">
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
  reorderTask,
}: KanbanBoardProps) {
  /* ── Build flat task list from the tasksByStatus prop ── */
  const propTasks = useMemo(() => {
    const all: KanbanTask[] = [];
    for (const col of COLUMNS) {
      all.push(...tasksByStatus(col));
    }
    return all;
  }, [tasksByStatus]);

  /* ── Drag override: non-null only during an active drag ── */
  const [dragOverride, setDragOverride] = useState<KanbanTask[] | null>(null);
  const isDraggingRef = useRef(false);

  // During drag use optimistic state; otherwise use server data directly
  const localTasks = dragOverride ?? propTasks;

  /* Wrap setTasks for drag hook — operates on the override */
  const setTasksWithDragTracking = useCallback(
    (updater: (prev: KanbanTask[]) => KanbanTask[]) => {
      setDragOverride(prev => updater(prev ?? propTasks));
    },
    [propTasks],
  );

  /* ── DnD hook ── */
  const { sensors, collisionDetection, activeTask, onDragStart, onDragOver, onDragEnd, onDragCancel } = useKanbanDragDrop({
    tasks: localTasks,
    setTasksOptimistic: setTasksWithDragTracking,
    reorderTask,
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

  /* ── Derived tasksByStatus from local state ── */
  const localTasksByStatus = useCallback(
    (status: TaskStatus): KanbanTask[] =>
      localTasks.filter(t => t.status === status).sort((a, b) => a.columnOrder - b.columnOrder),
    [localTasks],
  );

  /* ── Error state ── */
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="max-w-[420px] text-center">
          <p className="text-sm text-destructive font-semibold mb-2">Couldn't load tasks</p>
          <p className="text-xs text-muted-foreground mb-4">{error}</p>
          <Button size="sm" onClick={onRetry} className="text-[0.733rem] uppercase tracking-[0.16em]">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  /* ── Loading skeleton ── */
  if (loading) {
    return (
      <div className="h-full overflow-x-auto">
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
          <h3 className="text-[1.067rem] font-bold text-foreground mb-1.5">No tasks yet</h3>
          <p className="text-[0.867rem] text-muted-foreground mb-5">
            Create your first task or ask an agent to propose one.
          </p>
          <Button size="sm" onClick={onCreateTask} className="min-w-[132px] text-[0.733rem] uppercase tracking-[0.16em]">
            Create Task
          </Button>
        </div>
      </div>
    );
  }

  /* ── Board with columns ── */
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
        <div className="flex gap-3 p-0 min-w-min h-full">
          {COLUMNS.map(status => (
            <KanbanColumn
              key={status}
              status={status}
              tasks={localTasksByStatus(status)}
              onCardClick={onCardClick}
            />
          ))}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="w-[320px] opacity-90 rotate-[2deg]">
            <KanbanCard task={activeTask} onClick={() => {}} isDragOverlay />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
});
