import { describe, expect, it } from 'vitest';
import type { Collision, CollisionDetection } from '@dnd-kit/core';
import { refineColumnCollisions } from './useKanbanDragDrop';

type Args = Parameters<CollisionDetection>[0];

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 200, width: 200, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

function args(pointer: { x: number; y: number }, rects: Record<string, DOMRect>): Args {
  return {
    active: { id: 'c' } as Args['active'],
    collisionRect: rect(0, 40),
    droppableRects: new Map(Object.entries(rects)),
    droppableContainers: Object.keys(rects).map((id) => ({ id })) as Args['droppableContainers'],
    pointerCoordinates: pointer,
  };
}

const columns = ['todo', 'in-progress', 'review', 'done'];

describe('refineColumnCollisions', () => {
  it('resolves a gap between two cards to the nearer card, not the column', () => {
    // A ends at 20, B starts at 30; the pointer sits at 24, closer to A's edge.
    const collisions: Collision[] = [{ id: 'todo' }];
    const result = refineColumnCollisions(
      collisions,
      args({ x: 100, y: 24 }, { todo: rect(0, 400), a: rect(0, 20), b: rect(30, 50) }),
      columns,
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('picks the card on the other side of the gap when it is nearer', () => {
    const result = refineColumnCollisions(
      [{ id: 'todo' }],
      args({ x: 100, y: 28 }, { todo: rect(0, 400), a: rect(0, 20), b: rect(30, 50) }),
      columns,
    );

    expect(result[0].id).toBe('b');
  });

  it('leaves a card collision untouched', () => {
    const result = refineColumnCollisions(
      [{ id: 'b' }],
      args({ x: 100, y: 35 }, { todo: rect(0, 400), a: rect(0, 20), b: rect(30, 50) }),
      columns,
    );

    expect(result[0].id).toBe('b');
  });

  it('keeps the column when it has no cards', () => {
    const result = refineColumnCollisions(
      [{ id: 'review' }],
      args({ x: 100, y: 100 }, { todo: rect(0, 400), review: rect(0, 400) }),
      columns,
    );

    expect(result[0].id).toBe('review');
  });

  it('ignores cards from a neighbouring column', () => {
    const result = refineColumnCollisions(
      [{ id: 'review' }],
      args({ x: 100, y: 100 }, { review: rect(0, 200), done: rect(220, 400), other: rect(220, 260) }),
      columns,
    );

    expect(result[0].id).toBe('review');
  });
});
