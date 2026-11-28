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

/** A column drop resolved from the pointer, kept alongside the collision result. */
export interface ColumnDropIntent {
  column: string;
  index: number;
}

/**
 * Where the pointer sits among a column's cards, as an insertion index from
 * `0` to `cards.length`. A column target carries no card id, so derive the
 * index from the pointer: count the cards whose midpoint is above it and stop
 * at the first card below. That keeps a drop in the `gap-1.5` between two
 * cards between them, a drop below the last card at the end, and a drop on the
 * header at the top.
 */
export function computeColumnInsertIndex(
  tasks: KanbanTask[],
  column: string,
  droppableRects: ReadonlyMap<string | number, { top: number; height: number }>,
  pointerY: number,
  activeId: string,
): number {
  let index = 0;
  const cards = tasks
    .filter((t) => t.status === column && t.id !== activeId)
    .sort((a, b) => a.columnOrder - b.columnOrder);

  for (const card of cards) {
    const rect = droppableRects.get(card.id);
    if (!rect) continue;
    if (pointerY <= rect.top + rect.height / 2) break;
    index += 1;
  }

  return index;
}

/**
 * True when the pointer is inside the fixed column header. Cards scrolled
 * under the header keep unclipped rects, so without this a header drop can
 * target a hidden card or count it into the insertion index.
 */
export function isHeaderHit(columnNode: HTMLElement | null, pointerY: number): boolean {
  const header = columnNode?.querySelector<HTMLElement>('[data-kanban-column-header]');
  if (!header) return false;
  return pointerY <= header.getBoundingClientRect().bottom;
}

/** The card in `column` closest to the pointer, excluding the dragged card. */
export function nearestCardInColumn(
  tasks: KanbanTask[],
  column: string,
  droppableRects: ReadonlyMap<string | number, { top: number; bottom: number; left: number; right: number }>,
  pointer: { x: number; y: number },
  activeId: string,
): string | null {
  let bestId: string | null = null;
  let bestDistance = Infinity;

  for (const card of tasks) {
    if (card.status !== column || card.id === activeId) continue;
    const rect = droppableRects.get(card.id);
    if (!rect) continue;

    const dx = pointer.x < rect.left ? rect.left - pointer.x : pointer.x > rect.right ? pointer.x - rect.right : 0;
    const dy = pointer.y < rect.top ? rect.top - pointer.y : pointer.y > rect.bottom ? pointer.y - rect.bottom : 0;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = card.id;
    }
  }

  return bestId;
}

/**
 * Resolve a bare column collision to a pointer intent and, when the lane has
 * cards, put the nearest card first so dnd-kit's `over` node sits inside the
 * scrolling list — the list is then one of its scroll ancestors and keeps
 * auto-scrolling while the pointer is over a gap or the side padding. The
 * intent, not the card id, decides the insertion index.
 *
 * A card under the pointer stays a plain card collision. Keyboard drags have
 * no pointer and keep the closestCorners fallback.
 */
export function resolveColumnIntent(
  collisions: Collision[],
  args: Parameters<CollisionDetection>[0],
  tasks: KanbanTask[],
  columns: readonly string[],
): ColumnDropIntent | null {
  if (collisions.length === 0) return null;
  const firstId = String(collisions[0].id);
  const pointer = args.pointerCoordinates;
  if (!pointer || !columns.includes(firstId)) return null;

  return {
    column: firstId,
    index: computeColumnInsertIndex(
      tasks,
      firstId,
      args.droppableRects,
      pointer.y,
      String(args.active.id),
    ),
  };
}

export function resolvePointerCollisions(
  collisions: Collision[],
  args: Parameters<CollisionDetection>[0],
  tasks: KanbanTask[],
  columns: readonly string[],
): { collisions: Collision[]; intent: ColumnDropIntent | null } {
  const intent = resolveColumnIntent(collisions, args, tasks, columns);
  const pointer = args.pointerCoordinates;
  if (!intent || !pointer) return { collisions, intent };

  const cardId = nearestCardInColumn(
    tasks,
    intent.column,
    args.droppableRects,
    pointer,
    String(args.active.id),
  );
  if (!cardId) return { collisions, intent };

  return { collisions: [{ id: cardId }, ...collisions], intent };
}

/** Move a task to `targetIndex` within `targetColumn` and renumber that column. */
export function applyTaskMove(
  tasks: KanbanTask[],
  activeId: string,
  targetColumn: TaskStatus,
  targetIndex: number,
): KanbanTask[] {
  const moved = tasks.find((t) => t.id === activeId);
  if (!moved) return tasks;

  const ordered = tasks
    .filter((t) => t.status === targetColumn && t.id !== activeId)
    .sort((a, b) => a.columnOrder - b.columnOrder);
  const clamped = Math.max(0, Math.min(targetIndex, ordered.length));
  ordered.splice(clamped, 0, moved);

  const orderMap = new Map<string, number>();
  ordered.forEach((t, i) => orderMap.set(t.id, i));

  return tasks.map((t) => {
    if (t.id === activeId) {
      return { ...t, status: targetColumn, columnOrder: clamped };
    }
    if (t.status === targetColumn && orderMap.has(t.id)) {
      return { ...t, columnOrder: orderMap.get(t.id)! };
    }
    return t;
  });
}

/**
 * Turn the live drop target into the index the API expects. A column target
 * uses the pointer-derived intent, so gaps and empty lanes keep their place;
 * a card target keeps the sortable semantics. Without a pointer (keyboard
 * drag) a column target appends.
 */
export function resolveDropIndex(params: {
  activeId: string;
  overId: string;
  targetColumn: TaskStatus;
  columnTasks: KanbanTask[];
  originalTask: KanbanTask;
  activeColumns: readonly string[];
  intent: ColumnDropIntent | null;
}): number {
  const { activeId, overId, targetColumn, columnTasks, originalTask, activeColumns, intent } = params;

  if (intent && intent.column === targetColumn) {
    const otherCount = columnTasks.filter((t) => t.id !== activeId).length;
    return Math.max(0, Math.min(intent.index, otherCount));
  }

  if (activeId === overId) {
    const current = columnTasks.findIndex((t) => t.id === activeId);
    return current < 0 ? 0 : current;
  }

  if (activeColumns.includes(overId)) {
    return columnTasks.filter((t) => t.id !== activeId).length;
  }

  const overIndex = columnTasks.findIndex((t) => t.id === overId);
  const activeIndex = columnTasks.findIndex((t) => t.id === activeId);

  if (originalTask.status === targetColumn && activeIndex >= 0 && overIndex >= 0) {
    const reordered = arrayMove(
      columnTasks.map((t) => t.id),
      activeIndex,
      overIndex,
    );
    return reordered.indexOf(activeId);
  }

  return overIndex >= 0 ? overIndex : columnTasks.length;
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

  // Exact insertion slot when the pointer is over a column rather than a card
  const dropIntentRef = useRef<ColumnDropIntent | null>(null);

  /* ── Collision detection ──
   * Pointer-first: a drop belongs to the column under the cursor. Corner
   * distance is only a fallback (keyboard drags, or a pointer outside every
   * column), where it used to let a tall neighbouring lane win the drop — an
   * empty Review column lost to the Done lane beside it. */
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointer = args.pointerCoordinates;
    if (pointer) {
      // A header drop belongs to the column and goes to its top, even when a
      // card scrolled under the header still has a rect around the pointer.
      for (const column of activeColumns) {
        const rect = args.droppableRects.get(column);
        if (!rect) continue;
        if (pointer.x < rect.left || pointer.x > rect.right || pointer.y < rect.top || pointer.y > rect.bottom) continue;
        const container = args.droppableContainers.find((c) => String(c.id) === column);
        if (isHeaderHit(container?.node.current ?? null, pointer.y)) {
          dropIntentRef.current = { column, index: 0 };
          return [{ id: column }];
        }
        break;
      }
    }

    const pointerCollisions = pointerWithin(args);
    const resolved = resolvePointerCollisions(pointerCollisions, args, tasks, activeColumns);
    dropIntentRef.current = resolved.intent;
    if (resolved.collisions.length === 0) return closestCorners(args);
    return resolved.collisions;
  }, [activeColumns, tasks]);

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
      dropIntentRef.current = null;
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

        // Find index to insert at: a pointer-resolved slot (over may be the
        // nearest card or the column itself), or the over card's index; append
        // when only the column is known (keyboard).
        let newIndex = destTasks.length;
        const intent = dropIntentRef.current;
        if (intent && intent.column === toColumn) {
          newIndex = Math.max(0, Math.min(intent.index, destTasks.length));
        } else if (!activeColumns.includes(overId)) {
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
        dropIntentRef.current = null;
        if (snapshotRef.current) {
          setTasksOptimistic(() => snapshotRef.current!);
          snapshotRef.current = null;
        }
        return;
      }

      const activeId = active.id as string;
      const overId = over.id as string;
      const intent = dropIntentRef.current;
      dropIntentRef.current = null;

      // Find the task from snapshot (has correct original version)
      const originalTask = snapshotRef.current?.find((t) => t.id === activeId);
      if (!originalTask) {
        snapshotRef.current = null;
        return;
      }

      // Determine target column
      const targetColumn = findColumnForId(overId) ?? originalTask.status;

      // Live order in the target column, after any optimistic transfer from onDragOver
      const columnTasks = tasks
        .filter((t) => t.status === targetColumn)
        .sort((a, b) => a.columnOrder - b.columnOrder);

      const targetIndex = resolveDropIndex({
        activeId,
        overId,
        targetColumn,
        columnTasks,
        originalTask,
        activeColumns,
        intent,
      });

      // Apply the final order first: a cross-column preview can leave the card
      // in a different local slot even when the resolved index matches the snapshot.
      setTasksOptimistic((prev) => applyTaskMove(prev, activeId, targetColumn, targetIndex));

      // Compare against the snapshot, not the optimistic state: a column drop
      // may already have moved the card during onDragOver and still need an API call.
      const originalIndex = (snapshotRef.current ?? [])
        .filter((t) => t.status === originalTask.status)
        .sort((a, b) => a.columnOrder - b.columnOrder)
        .findIndex((t) => t.id === activeId);
      if (originalTask.status === targetColumn && targetIndex === originalIndex) {
        snapshotRef.current = null;
        return;
      }

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
    dropIntentRef.current = null;
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
