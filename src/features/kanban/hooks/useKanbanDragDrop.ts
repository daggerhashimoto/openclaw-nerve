import { useCallback, useRef, useState } from 'react';
import {
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  defaultKeyboardCoordinateGetter,
  closestCorners,
  pointerWithin,
} from '@dnd-kit/core';
import type { Collision, CollisionDetection, DragStartEvent, DragOverEvent, DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import type { KanbanTask, TaskStatus } from '../types';
import { COLUMNS } from '../types';


/**
 * `pointerWithin` reports the column when the pointer sits in a gap between
 * two cards, and a column drop appends. Resolve that case to the nearest card
 * inside the same column so a gap keeps its insertion position instead of
 * jumping the card to the end.
 */
export function refineColumnCollisions(
  collisions: Collision[],
  args: Parameters<CollisionDetection>[0],
  columns: readonly string[],
): Collision[] {
  const columnIds = new Set(columns);
  const pointer = args.pointerCoordinates;
  if (!pointer) return collisions;

  return collisions.map((collision) => {
    const id = String(collision.id);
    if (!columnIds.has(id)) return collision;

    const columnRect = args.droppableRects.get(collision.id);
    if (!columnRect) return collision;

    let best: { container: (typeof args.droppableContainers)[number]; distance: number } | null = null;
    for (const container of args.droppableContainers) {
      if (columnIds.has(String(container.id))) continue;
      const rect = args.droppableRects.get(container.id);
      if (!rect) continue;
      // Only cards that belong to this column: their rect sits inside it.
      if (rect.top < columnRect.top || rect.bottom > columnRect.bottom) continue;
      if (rect.left < columnRect.left - 1 || rect.right > columnRect.right + 1) continue;

      const dx = Math.max(rect.left - pointer.x, 0, pointer.x - rect.right);
      const dy = Math.max(rect.top - pointer.y, 0, pointer.y - rect.bottom);
      const distance = dx * dx + dy * dy;
      if (!best || distance < best.distance) best = { container, distance };
    }

    if (!best) return collision;
    return {
      id: best.container.id,
      data: { droppableContainer: best.container, value: best.distance },
    };
  });
}

interface UseKanbanDragDropOptions {
  tasks: KanbanTask[];
  setTasksOptimistic: (updater: (prev: KanbanTask[]) => KanbanTask[]) => void;
  reorderTask: (id: string, version: number, targetStatus: TaskStatus, targetIndex: number) => Promise<KanbanTask>;
  onError?: (msg: string) => void;
  /** Active column keys — used to distinguish column drop targets from card IDs. Defaults to COLUMNS. */
  activeColumns?: TaskStatus[];
}

/**
 * Encapsulates all dnd-kit drag-and-drop logic for the Kanban board.
 * Provides sensors, event handlers, active task state, and collision strategy.
 */
export function useKanbanDragDrop({
  tasks,
  setTasksOptimistic,
  reorderTask,
  onError,
  activeColumns: activeColumnsProp,
}: UseKanbanDragDropOptions) {
  const activeColumns = activeColumnsProp ?? COLUMNS;
  const [activeTask, setActiveTask] = useState<KanbanTask | null>(null);

  // Snapshot of tasks before a drag starts — used for rollback on error
  const snapshotRef = useRef<KanbanTask[] | null>(null);

  /* ── Collision detection ──
   * Pointer-first: a drop belongs to the column under the cursor. Corner
   * distance is only a fallback (keyboard drags, or a pointer outside every
   * column), where it used to let a tall neighbouring lane win the drop — an
   * empty Review column lost to the Done lane beside it. */
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length === 0) return closestCorners(args);
    return refineColumnCollisions(pointerCollisions, args, activeColumns);
  }, [activeColumns]);

  /* ── Sensors ── */
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 5 },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: defaultKeyboardCoordinateGetter,
  });
  const sensors = useSensors(pointerSensor, keyboardSensor);

  /* ── Helpers ── */
  /** Determine which column a droppable id belongs to. */
  const findColumnForId = useCallback(
    (id: string): TaskStatus | null => {
      // Is it a column id directly?
      if (activeColumns.includes(id)) return id as TaskStatus;
      // Otherwise it's a task id — find its column
      const task = tasks.find((t) => t.id === id);
      return task?.status ?? null;
    },
    [tasks, activeColumns],
  );

  /* ── Drag Start ── */
  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = tasks.find((t) => t.id === event.active.id);
      if (!task) return;
      setActiveTask(task);
      snapshotRef.current = tasks.map((t) => ({ ...t })); // deep-ish clone
    },
    [tasks],
  );

  /* ── Drag Over (live column transfer for visual feedback) ── */
  const onDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      const fromColumn = findColumnForId(activeId);
      const toColumn = findColumnForId(overId);
      if (!fromColumn || !toColumn || fromColumn === toColumn) return;

      // Move card to the new column optimistically
      setTasksOptimistic((prev) => {
        const activeTask = prev.find((t) => t.id === activeId);
        if (!activeTask) return prev;

        const destTasks = prev
          .filter((t) => t.status === toColumn && t.id !== activeId)
          .sort((a, b) => a.columnOrder - b.columnOrder);

        // Find index to insert at: if over is a task, insert at its index; else append
        let newIndex = destTasks.length;
        if (!activeColumns.includes(overId)) {
          const overIndex = destTasks.findIndex((t) => t.id === overId);
          if (overIndex >= 0) newIndex = overIndex;
        }

        // Recompute columnOrder for the destination column
        const updatedTasks = prev.map((t) => {
          if (t.id === activeId) {
            return { ...t, status: toColumn, columnOrder: newIndex };
          }
          return t;
        });

        // Reassign sequential columnOrder for all tasks in destination column
        const destAll = updatedTasks
          .filter((t) => t.status === toColumn)
          .sort((a, b) => {
            if (a.id === activeId) return newIndex - b.columnOrder + 0.5;
            if (b.id === activeId) return a.columnOrder - newIndex - 0.5;
            return a.columnOrder - b.columnOrder;
          });

        // Ensure moved card is at newIndex
        const withoutActive = destAll.filter((t) => t.id !== activeId);
        const activeItem = destAll.find((t) => t.id === activeId);
        if (!activeItem) return prev; // task deleted concurrently, bail out
        withoutActive.splice(newIndex, 0, activeItem);

        const orderMap = new Map<string, number>();
        withoutActive.forEach((t, i) => orderMap.set(t.id, i));

        return updatedTasks.map((t) => {
          if (t.status === toColumn && orderMap.has(t.id)) {
            return { ...t, columnOrder: orderMap.get(t.id)! };
          }
          return t;
        });
      });
    },
    [findColumnForId, setTasksOptimistic, activeColumns],
  );

  /* ── Drag End (commit to API) ── */
  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveTask(null);

      if (!over) {
        // Dropped outside — rollback
        if (snapshotRef.current) {
          setTasksOptimistic(() => snapshotRef.current!);
          snapshotRef.current = null;
        }
        return;
      }

      const activeId = active.id as string;
      const overId = over.id as string;

      // Find the task from snapshot (has correct original version)
      const originalTask = snapshotRef.current?.find((t) => t.id === activeId);
      if (!originalTask) {
        snapshotRef.current = null;
        return;
      }

      // Determine target column
      const targetColumn = findColumnForId(overId) ?? originalTask.status;

      // Compute final order: get current tasks in the target column after optimistic updates
      // Use the live tasks state (already optimistically updated in onDragOver)
      const columnTasks = tasks
        .filter((t) => t.status === targetColumn)
        .sort((a, b) => a.columnOrder - b.columnOrder);

      let targetIndex: number;

      if (activeId === overId) {
        // Dropped on itself — find its current index in column
        targetIndex = columnTasks.findIndex((t) => t.id === activeId);
        if (targetIndex < 0) targetIndex = 0;
      } else if (activeColumns.includes(overId)) {
        // Dropped on empty column — append
        targetIndex = columnTasks.filter((t) => t.id !== activeId).length;
      } else {
        // Dropped on another card — use that card's position
        const overIndex = columnTasks.findIndex((t) => t.id === overId);
        const activeIndex = columnTasks.findIndex((t) => t.id === activeId);

        if (originalTask.status === targetColumn && activeIndex >= 0 && overIndex >= 0) {
          // Same column reorder: use arrayMove index logic
          const reordered = arrayMove(
            columnTasks.map((t) => t.id),
            activeIndex,
            overIndex,
          );
          targetIndex = reordered.indexOf(activeId);
        } else {
          // Cross-column: insert at over position
          targetIndex = overIndex >= 0 ? overIndex : columnTasks.length;
        }
      }

      // If nothing actually changed, skip API call
      if (
        originalTask.status === targetColumn &&
        targetIndex === columnTasks.findIndex((t) => t.id === activeId)
      ) {
        snapshotRef.current = null;
        return;
      }

      // Optimistic state is already applied from onDragOver / implicit ordering.
      // Now apply the final correct ordering in local state.
      setTasksOptimistic((prev) => {
        const colTasks = prev
          .filter((t) => t.status === targetColumn && t.id !== activeId)
          .sort((a, b) => a.columnOrder - b.columnOrder);

        const clamped = Math.max(0, Math.min(targetIndex, colTasks.length));
        const ordered = [...colTasks];
        const moved = prev.find((t) => t.id === activeId);
        if (!moved) return prev;
        ordered.splice(clamped, 0, moved);

        const orderMap = new Map<string, number>();
        ordered.forEach((t, i) => orderMap.set(t.id, i));

        return prev.map((t) => {
          if (t.id === activeId) {
            return { ...t, status: targetColumn, columnOrder: clamped };
          }
          if (t.status === targetColumn && orderMap.has(t.id)) {
            return { ...t, columnOrder: orderMap.get(t.id)! };
          }
          return t;
        });
      });

      // Call API — rollback on failure
      try {
        await reorderTask(activeId, originalTask.version, targetColumn, targetIndex);
      } catch (err: unknown) {
        // Rollback
        if (snapshotRef.current) {
          setTasksOptimistic(() => snapshotRef.current!);
        }
        const msg =
          err instanceof Error && err.message === 'version_conflict'
            ? 'Task was modified by someone else — board refreshed'
            : 'Failed to move task — reverted';
        onError?.(msg);
      } finally {
        snapshotRef.current = null;
      }
    },
    [tasks, findColumnForId, setTasksOptimistic, reorderTask, onError, activeColumns],
  );

  const onDragCancel = useCallback(() => {
    if (snapshotRef.current) {
      setTasksOptimistic(() => snapshotRef.current!);
    }
    snapshotRef.current = null;
    setActiveTask(null);
  }, [setTasksOptimistic]);

  return {
    sensors,
    collisionDetection,
    activeTask,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel,
  };
}
