import { describe, expect, it } from 'vitest';
import type { KanbanTask } from '../types';
import { applyTaskMove, computeColumnInsertIndex, resolveDropIndex } from './useKanbanDragDrop';
import type { ColumnDropIntent } from './useKanbanDragDrop';

const COLUMNS = ['todo', 'in-progress', 'review', 'done'];

function task(id: string, status: string, columnOrder: number, version = 1): KanbanTask {
  return {
    id,
    title: id,
    status,
    priority: 'normal',
    createdBy: 'operator',
    createdAt: 0,
    updatedAt: 0,
    version,
    labels: [],
    columnOrder,
    feedback: [],
  };
}

function rect(top: number, height = 20) {
  return { top, height };
}

function ids(tasks: KanbanTask[], status: string) {
  return tasks
    .filter((t) => t.status === status)
    .sort((a, b) => a.columnOrder - b.columnOrder)
    .map((t) => t.id);
}

describe('computeColumnInsertIndex', () => {
  it('keeps a drop in the gap between two cards between them', () => {
    const tasks = [task('a', 'review', 0), task('b', 'review', 1)];
    const rects = new Map([
      ['a', rect(0)],
      ['b', rect(30)],
    ]);

    expect(computeColumnInsertIndex(tasks, 'review', rects, 24, 'other')).toBe(1);
  });

  it('keeps a drop above the first card at the top', () => {
    const tasks = [task('a', 'review', 0), task('b', 'review', 1)];
    const rects = new Map([
      ['a', rect(100)],
      ['b', rect(130)],
    ]);

    expect(computeColumnInsertIndex(tasks, 'review', rects, 90, 'other')).toBe(0);
  });

  it('appends a drop below the last card', () => {
    const tasks = [task('a', 'review', 0), task('b', 'review', 1)];
    const rects = new Map([
      ['a', rect(0)],
      ['b', rect(30)],
    ]);

    expect(computeColumnInsertIndex(tasks, 'review', rects, 200, 'other')).toBe(2);
  });

  it('returns 0 for an empty column', () => {
    expect(computeColumnInsertIndex([task('x', 'done', 0)], 'review', new Map(), 100, 'x')).toBe(0);
  });

  it('counts a card that is partly scrolled out above the lane', () => {
    const tasks = [task('a', 'review', 0), task('b', 'review', 1)];
    const rects = new Map([
      ['a', rect(-40)],
      ['b', rect(0)],
    ]);

    expect(computeColumnInsertIndex(tasks, 'review', rects, 5, 'other')).toBe(1);
  });

  it('ignores cards from other columns', () => {
    const tasks = [task('a', 'review', 0), task('x', 'done', 0)];
    const rects = new Map([
      ['a', rect(0)],
      ['x', rect(25)],
    ]);

    expect(computeColumnInsertIndex(tasks, 'review', rects, 100, 'other')).toBe(1);
  });

  it('excludes the dragged card from its own column', () => {
    const tasks = [task('a', 'review', 0), task('b', 'review', 1), task('c', 'review', 2)];
    const rects = new Map([
      ['a', rect(0)],
      ['b', rect(30)],
      ['c', rect(60)],
    ]);

    expect(computeColumnInsertIndex(tasks, 'review', rects, 100, 'a')).toBe(2);
  });
});

describe('applyTaskMove', () => {
  it('inserts a card into an inter-card gap without moving past it', () => {
    // The CodeRabbit case: A,B,C,D with C dragged into the gap between A and B.
    const tasks = [
      task('a', 'review', 0),
      task('b', 'review', 1),
      task('c', 'review', 2),
      task('d', 'review', 3),
    ];
    const rects = new Map([
      ['a', rect(0)],
      ['b', rect(30)],
    ]);
    const index = computeColumnInsertIndex(tasks, 'review', rects, 24, 'c');

    const result = applyTaskMove(tasks, 'c', 'review', index);

    expect(index).toBe(1);
    expect(ids(result, 'review')).toEqual(['a', 'c', 'b', 'd']);
    expect(result.find((t) => t.id === 'c')!.columnOrder).toBe(1);
  });

  it('inserts into an empty lane at index 0', () => {
    const tasks = [task('c', 'todo', 0)];
    const index = computeColumnInsertIndex(tasks, 'review', new Map(), 100, 'c');

    const result = applyTaskMove(tasks, 'c', 'review', index);

    expect(ids(result, 'review')).toEqual(['c']);
    expect(result.find((t) => t.id === 'c')!.status).toBe('review');
  });

  it('appends to the end of a cross-column lane', () => {
    const tasks = [task('a', 'review', 0), task('b', 'review', 1), task('c', 'todo', 0)];
    const rects = new Map([
      ['a', rect(0)],
      ['b', rect(30)],
    ]);
    const index = computeColumnInsertIndex(tasks, 'review', rects, 200, 'c');

    expect(ids(applyTaskMove(tasks, 'c', 'review', index), 'review')).toEqual(['a', 'b', 'c']);
  });

  it('inserts at the top when dropped on the column header', () => {
    const tasks = [task('a', 'review', 0), task('b', 'review', 1), task('c', 'todo', 0)];
    const rects = new Map([
      ['a', rect(100)],
      ['b', rect(130)],
    ]);
    const index = computeColumnInsertIndex(tasks, 'review', rects, 90, 'c');

    expect(ids(applyTaskMove(tasks, 'c', 'review', index), 'review')).toEqual(['c', 'a', 'b']);
  });

  it('moves an upward gap drop before the lower card', () => {
    const tasks = [
      task('a', 'review', 0),
      task('b', 'review', 1),
      task('c', 'review', 2),
      task('d', 'review', 3),
    ];
    const rects = new Map([
      ['a', rect(0)],
      ['b', rect(30)],
    ]);
    const index = computeColumnInsertIndex(tasks, 'review', rects, 24, 'd');

    expect(ids(applyTaskMove(tasks, 'd', 'review', index), 'review')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves a downward gap drop after the upper card', () => {
    const tasks = [
      task('a', 'review', 0),
      task('b', 'review', 1),
      task('c', 'review', 2),
      task('d', 'review', 3),
    ];
    const rects = new Map([
      ['b', rect(30)],
      ['c', rect(60)],
    ]);
    const index = computeColumnInsertIndex(tasks, 'review', rects, 54, 'a');

    expect(ids(applyTaskMove(tasks, 'a', 'review', index), 'review')).toEqual(['b', 'a', 'c', 'd']);
  });
});

describe('resolveDropIndex', () => {
  const originalC = task('c', 'todo', 0);

  it('uses the pointer intent for a column target', () => {
    const columnTasks = [task('a', 'review', 0), task('b', 'review', 1), task('c', 'review', 2)];

    expect(
      resolveDropIndex({
        activeId: 'c',
        overId: 'review',
        targetColumn: 'review',
        columnTasks,
        originalTask: originalC,
        activeColumns: COLUMNS,
        intent: { column: 'review', index: 1 },
      }),
    ).toBe(1);
  });

  it('clamps the intent to the number of other cards', () => {
    const columnTasks = [task('a', 'review', 0), task('c', 'review', 1)];

    expect(
      resolveDropIndex({
        activeId: 'c',
        overId: 'review',
        targetColumn: 'review',
        columnTasks,
        originalTask: originalC,
        activeColumns: COLUMNS,
        intent: { column: 'review', index: 9 },
      }),
    ).toBe(1);
  });

  it('appends for a column target without a pointer intent (keyboard)', () => {
    const columnTasks = [task('a', 'review', 0), task('b', 'review', 1), task('c', 'review', 2)];

    expect(
      resolveDropIndex({
        activeId: 'c',
        overId: 'review',
        targetColumn: 'review',
        columnTasks,
        originalTask: originalC,
        activeColumns: COLUMNS,
        intent: null,
      }),
    ).toBe(2);
  });

  it('ignores an intent for a different column', () => {
    const columnTasks = [task('a', 'review', 0), task('c', 'review', 1)];

    expect(
      resolveDropIndex({
        activeId: 'c',
        overId: 'review',
        targetColumn: 'review',
        columnTasks,
        originalTask: originalC,
        activeColumns: COLUMNS,
        intent: { column: 'done', index: 0 },
      }),
    ).toBe(1);
  });

  it('keeps arrayMove semantics for a same-column card target', () => {
    const columnTasks = [
      task('a', 'review', 0),
      task('b', 'review', 1),
      task('c', 'review', 2),
      task('d', 'review', 3),
    ];

    expect(
      resolveDropIndex({
        activeId: 'c',
        overId: 'b',
        targetColumn: 'review',
        columnTasks,
        originalTask: task('c', 'review', 2),
        activeColumns: COLUMNS,
        intent: null,
      }),
    ).toBe(1);
  });

  it('is idempotent across the drag-over transfer and the drop', () => {
    const tasks = [task('a', 'review', 0), task('b', 'review', 1), task('c', 'todo', 0)];
    const intent: ColumnDropIntent = { column: 'review', index: 1 };

    const afterOver = applyTaskMove(tasks, 'c', 'review', intent.index);
    const columnTasks = afterOver
      .filter((t) => t.status === 'review')
      .sort((a, b) => a.columnOrder - b.columnOrder);
    const index = resolveDropIndex({
      activeId: 'c',
      overId: 'review',
      targetColumn: 'review',
      columnTasks,
      originalTask: task('c', 'todo', 0),
      activeColumns: COLUMNS,
      intent,
    });

    expect(index).toBe(1);
    expect(ids(applyTaskMove(afterOver, 'c', 'review', index), 'review')).toEqual(['a', 'c', 'b']);
  });
});
