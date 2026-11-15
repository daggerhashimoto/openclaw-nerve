import type React from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

const EDGE_SWIPE_ZONE_PX = 24;
const OPEN_THRESHOLD_PX = 72;
const MAX_VERTICAL_DRIFT_PX = 36;

// Modal surfaces render inside the app shell, so their touches reach the shell's
// handlers too. The command palette has no dialog role and is gated by its owner.
const OPEN_MODAL_SELECTOR = '[role="dialog"], [role="alertdialog"], dialog[open]';

function isModalOpen(): boolean {
  return typeof document !== 'undefined' && document.querySelector(OPEN_MODAL_SELECTOR) !== null;
}

interface EdgeSwipeBindings {
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
}

interface UseEdgeSwipeToOpenOptions {
  enabled: boolean;
  onOpen: () => void;
}

interface UseEdgeSwipeToOpenResult {
  bind: EdgeSwipeBindings;
}

export function useEdgeSwipeToOpen({
  enabled,
  onOpen,
}: UseEdgeSwipeToOpenOptions): UseEdgeSwipeToOpenResult {
  const pointerIdRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const reset = useCallback(() => {
    pointerIdRef.current = null;
    startRef.current = null;
  }, []);

  useEffect(() => {
    if (!enabled) {
      reset();
    }
  }, [enabled, reset]);

  // No pointer capture on purpose. A touch is already delivered to the element it started on,
  // so the shell sees the whole gesture, and capturing here would redirect the click that ends
  // a tap in the edge strip away from the control under the finger.
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled || event.pointerType !== 'touch' || event.clientX > EDGE_SWIPE_ZONE_PX) return;
    if (pointerIdRef.current !== null) return;
    if (isModalOpen()) return;

    pointerIdRef.current = event.pointerId;
    startRef.current = { x: event.clientX, y: event.clientY };
  }, [enabled]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled || event.pointerType !== 'touch') return;
    if (pointerIdRef.current !== event.pointerId || !startRef.current) return;

    const dx = event.clientX - startRef.current.x;
    const dy = event.clientY - startRef.current.y;

    if (Math.abs(dy) > MAX_VERTICAL_DRIFT_PX) {
      reset();
      return;
    }

    if (dx >= OPEN_THRESHOLD_PX) {
      onOpen();
      reset();
    }
  }, [enabled, onOpen, reset]);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current === event.pointerId) {
      reset();
    }
  }, [reset]);

  const onPointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current === event.pointerId) {
      reset();
    }
  }, [reset]);

  const bind = useMemo<EdgeSwipeBindings>(() => ({
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  }), [onPointerCancel, onPointerDown, onPointerMove, onPointerUp]);

  return {
    bind,
  };
}
