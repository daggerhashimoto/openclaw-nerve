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

  it('forgets an in-flight swipe when disabled, even if it is enabled again before the finger moves', () => {
    const onOpen = vi.fn();
    const { result, rerender } = renderHook(
      ({ enabled }) => useEdgeSwipeToOpen({ enabled, onOpen }),
      { initialProps: { enabled: true } },
    );

    act(() => {
      result.current.bind.onPointerDown(createPointerEvent({
        pointerId: 7,
        clientX: 10,
        clientY: 20,
      }));
    });

    rerender({ enabled: false });
    rerender({ enabled: true });

    act(() => {
      result.current.bind.onPointerMove(createPointerEvent({
        pointerId: 7,
        clientX: 100,
        clientY: 24,
      }));
    });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('never starts a swipe while disabled', () => {
    const onOpen = vi.fn();
    const { result } = renderHook(() => useEdgeSwipeToOpen({ enabled: false, onOpen }));

    act(() => {
      result.current.bind.onPointerDown(createPointerEvent({ clientX: 10, clientY: 20 }));
    });

    act(() => {
      result.current.bind.onPointerMove(createPointerEvent({ clientX: 120, clientY: 22 }));
    });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('forgets the swipe when the browser cancels the pointer, as it does when a scroll takes over', () => {
    const onOpen = vi.fn();
    const { result } = renderHook(() => useEdgeSwipeToOpen({ enabled: true, onOpen }));

    act(() => {
      result.current.bind.onPointerDown(createPointerEvent({ clientX: 10, clientY: 20 }));
    });

    act(() => {
      result.current.bind.onPointerCancel(createPointerEvent({ clientX: 30, clientY: 40 }));
    });

    act(() => {
      result.current.bind.onPointerMove(createPointerEvent({ clientX: 120, clientY: 42 }));
    });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does not open for a plain tap inside the edge strip', () => {
    const onOpen = vi.fn();
    const { result } = renderHook(() => useEdgeSwipeToOpen({ enabled: true, onOpen }));

    act(() => {
      result.current.bind.onPointerDown(createPointerEvent({ clientX: 8, clientY: 200 }));
    });

    act(() => {
      result.current.bind.onPointerUp(createPointerEvent({ clientX: 8, clientY: 200 }));
    });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('never takes pointer capture, so the click after a tap in the edge strip still reaches the control under the finger', () => {
    const onOpen = vi.fn();
    const target = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    };
    const { result } = renderHook(() => useEdgeSwipeToOpen({ enabled: true, onOpen }));

    // A tap, then a full swipe: neither may capture the pointer.
    act(() => {
      result.current.bind.onPointerDown(createPointerEvent({ pointerId: 1, clientX: 8, clientY: 200, currentTarget: target as never }));
    });
    act(() => {
      result.current.bind.onPointerUp(createPointerEvent({ pointerId: 1, clientX: 8, clientY: 200, currentTarget: target as never }));
    });
    act(() => {
      result.current.bind.onPointerDown(createPointerEvent({ pointerId: 2, clientX: 8, clientY: 200, currentTarget: target as never }));
    });
    act(() => {
      result.current.bind.onPointerMove(createPointerEvent({ pointerId: 2, clientX: 100, clientY: 204, currentTarget: target as never }));
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(target.setPointerCapture).not.toHaveBeenCalled();
    expect(target.releasePointerCapture).not.toHaveBeenCalled();
  });

  describe('while a modal is open over the app', () => {
    const modals: Array<[string, () => HTMLElement]> = [
      ['a dialog (settings drawer, image viewer, Radix dialogs)', () => {
        const el = document.createElement('div');
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        return el;
      }],
      ['an alert dialog (confirm dialogs)', () => {
        const el = document.createElement('div');
        el.setAttribute('role', 'alertdialog');
        return el;
      }],
      ['a native open dialog element', () => {
        const el = document.createElement('dialog');
        el.setAttribute('open', '');
        return el;
      }],
    ];

    it.each(modals)('does not start a swipe over %s', (_label, createModal) => {
      const modal = createModal();
      document.body.appendChild(modal);

      try {
        const onOpen = vi.fn();
        const { result } = renderHook(() => useEdgeSwipeToOpen({ enabled: true, onOpen }));

        act(() => {
          result.current.bind.onPointerDown(createPointerEvent({ clientX: 8, clientY: 200 }));
        });
        act(() => {
          result.current.bind.onPointerMove(createPointerEvent({ clientX: 120, clientY: 204 }));
        });

        expect(onOpen).not.toHaveBeenCalled();
      } finally {
        modal.remove();
      }
    });

    it('swipes again as soon as the modal is gone', () => {
      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      document.body.appendChild(modal);
      modal.remove();

      const onOpen = vi.fn();
      const { result } = renderHook(() => useEdgeSwipeToOpen({ enabled: true, onOpen }));

      act(() => {
        result.current.bind.onPointerDown(createPointerEvent({ clientX: 8, clientY: 200 }));
      });
      act(() => {
        result.current.bind.onPointerMove(createPointerEvent({ clientX: 120, clientY: 204 }));
      });

      expect(onOpen).toHaveBeenCalledTimes(1);
    });
  });
});
