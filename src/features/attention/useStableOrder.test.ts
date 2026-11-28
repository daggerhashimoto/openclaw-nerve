import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AttentionItem } from './types';
import { useStableOrder } from './useStableOrder';

function item(key: string, overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    key,
    source: 'tasks',
    sourceId: key,
    kind: 'review',
    section: 'decide',
    title: `Title ${key}`,
    updatedAt: 1_000,
    priority: 'normal',
    freshness: 'live',
    open: { type: 'task', id: key },
    detail: {},
    ...overrides,
  };
}

const keysOf = (items: AttentionItem[]) => items.map((i) => i.key);

describe('useStableOrder', () => {
  it('keeps first order when ranks change', () => {
    const { result, rerender } = renderHook(
      ({ items, epoch }) => useStableOrder(items, epoch),
      { initialProps: { items: [item('a'), item('b'), item('c')], epoch: 1 } },
    );
    expect(keysOf(result.current.items)).toEqual(['a', 'b', 'c']);

    rerender({ items: [item('c'), item('a'), item('b')], epoch: 1 });

    expect(keysOf(result.current.items)).toEqual(['a', 'b', 'c']);
    expect(result.current.newKeys.size).toBe(0);
  });

  it('appends new items and marks them new', () => {
    const { result, rerender } = renderHook(
      ({ items, epoch }) => useStableOrder(items, epoch),
      { initialProps: { items: [item('a'), item('b')], epoch: 1 } },
    );

    rerender({ items: [item('x'), item('b'), item('a'), item('y')], epoch: 1 });

    expect(keysOf(result.current.items)).toEqual(['a', 'b', 'x', 'y']);
    expect([...result.current.newKeys].sort()).toEqual(['x', 'y']);

    // A later render keeps the appended items where they landed and still new.
    rerender({ items: [item('y'), item('x'), item('b'), item('a'), item('z')], epoch: 1 });

    expect(keysOf(result.current.items)).toEqual(['a', 'b', 'x', 'y', 'z']);
    expect([...result.current.newKeys].sort()).toEqual(['x', 'y', 'z']);
  });

  it('drops removed items', () => {
    const { result, rerender } = renderHook(
      ({ items, epoch }) => useStableOrder(items, epoch),
      { initialProps: { items: [item('a'), item('b'), item('c')], epoch: 1 } },
    );

    rerender({ items: [item('c'), item('a')], epoch: 1 });

    expect(keysOf(result.current.items)).toEqual(['a', 'c']);
    expect(result.current.newKeys.size).toBe(0);
  });

  it('new epoch re-ranks and clears new marks', () => {
    const { result, rerender } = renderHook(
      ({ items, epoch }) => useStableOrder(items, epoch),
      { initialProps: { items: [item('a'), item('b')], epoch: 1 } },
    );
    rerender({ items: [item('c'), item('b'), item('a')], epoch: 1 });
    expect([...result.current.newKeys]).toEqual(['c']);

    rerender({ items: [item('c'), item('b'), item('a')], epoch: 2 });

    expect(keysOf(result.current.items)).toEqual(['c', 'b', 'a']);
    expect(result.current.newKeys.size).toBe(0);

    // The new epoch becomes the baseline for later arrivals.
    rerender({ items: [item('d'), item('a'), item('b'), item('c')], epoch: 2 });

    expect(keysOf(result.current.items)).toEqual(['c', 'b', 'a', 'd']);
    expect([...result.current.newKeys]).toEqual(['d']);
  });

  it('shows the latest data for an item already shown', () => {
    const { result, rerender } = renderHook(
      ({ items, epoch }) => useStableOrder(items, epoch),
      { initialProps: { items: [item('a'), item('b')], epoch: 1 } },
    );

    rerender({ items: [item('b'), item('a', { title: 'Renamed', priority: 'high' })], epoch: 1 });

    expect(keysOf(result.current.items)).toEqual(['a', 'b']);
    expect(result.current.items[0].title).toBe('Renamed');
    expect(result.current.items[0].priority).toBe('high');
  });
});
