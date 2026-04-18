import type React from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useEdgeSwipeToOpen } from './useEdgeSwipeToOpen';

function createPointerEvent(overrides: Partial<React.PointerEvent<HTMLDivElement>> = {}) {
  return {
    pointerType: 'touch',
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    currentTarget: {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    },
    ...overrides,
  } as unknown as React.PointerEvent<HTMLDivElement>;
}

describe('useEdgeSwipeToOpen', () => {
  it('opens after a touch swipe that starts inside the left edge zone and crosses the threshold', () => {
    const onOpen = vi.fn();
    const { result } = renderHook(() => useEdgeSwipeToOpen({ enabled: true, onOpen }));

    act(() => {
      result.current.bind.onPointerDown(createPointerEvent({
        clientX: 12,
        clientY: 40,
      }));
    });

    act(() => {
      result.current.bind.onPointerMove(createPointerEvent({
        clientX: 92,
        clientY: 44,
      }));
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('does not open when the gesture starts away from the left edge', () => {
    const onOpen = vi.fn();
    const { result } = renderHook(() => useEdgeSwipeToOpen({ enabled: true, onOpen }));

    act(() => {
      result.current.bind.onPointerDown(createPointerEvent({
        clientX: 48,
        clientY: 40,
      }));
    });

    act(() => {
      result.current.bind.onPointerMove(createPointerEvent({
        clientX: 140,
        clientY: 44,
      }));
    });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('cancels the gesture when vertical drift exceeds tolerance', () => {
    const onOpen = vi.fn();
    const { result } = renderHook(() => useEdgeSwipeToOpen({ enabled: true, onOpen }));

    act(() => {
      result.current.bind.onPointerDown(createPointerEvent({
        clientX: 10,
        clientY: 20,
      }));
    });

    act(() => {
      result.current.bind.onPointerMove(createPointerEvent({
        clientX: 45,
        clientY: 72,
      }));
    });

    act(() => {
      result.current.bind.onPointerMove(createPointerEvent({
        clientX: 110,
        clientY: 74,
      }));
    });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('ignores non-touch pointers', () => {
    const onOpen = vi.fn();
    const { result } = renderHook(() => useEdgeSwipeToOpen({ enabled: true, onOpen }));

    act(() => {
      result.current.bind.onPointerDown(createPointerEvent({
        pointerType: 'mouse',
        clientX: 8,
        clientY: 30,
      }));
    });

    act(() => {
      result.current.bind.onPointerMove(createPointerEvent({
        pointerType: 'mouse',
        clientX: 120,
        clientY: 30,
      }));
    });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does not cancel an active swipe when a second touch starts', () => {
    const onOpen = vi.fn();
    const { result } = renderHook(() => useEdgeSwipeToOpen({ enabled: true, onOpen }));

    act(() => {
      result.current.bind.onPointerDown(createPointerEvent({
        pointerId: 1,
        clientX: 10,
        clientY: 20,
      }));
    });

    act(() => {
      result.current.bind.onPointerDown(createPointerEvent({
        pointerId: 2,
        clientX: 12,
        clientY: 22,
      }));
    });

    act(() => {
      result.current.bind.onPointerMove(createPointerEvent({
        pointerId: 1,
        clientX: 96,
        clientY: 24,
      }));
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('releases pointer capture and clears gesture state when disabled mid-swipe', () => {
    const onOpen = vi.fn();
    const releasePointerCapture = vi.fn();
    const { result, rerender } = renderHook(
      ({ enabled }) => useEdgeSwipeToOpen({ enabled, onOpen }),
      { initialProps: { enabled: true } },
    );

    act(() => {
      result.current.bind.onPointerDown(createPointerEvent({
        pointerId: 7,
        clientX: 10,
        clientY: 20,
        currentTarget: {
          setPointerCapture: vi.fn(),
          releasePointerCapture,
        },
      }));
    });

    act(() => {
      rerender({ enabled: false });
    });

    act(() => {
      result.current.bind.onPointerMove(createPointerEvent({
        pointerId: 7,
        clientX: 100,
        clientY: 24,
      }));
    });

    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
