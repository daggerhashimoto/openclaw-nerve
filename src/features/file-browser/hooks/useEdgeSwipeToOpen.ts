import type React from 'react';
import { useCallback, useRef, useState } from 'react';

const EDGE_SWIPE_ZONE_PX = 24;
const OPEN_THRESHOLD_PX = 72;
const MAX_VERTICAL_DRIFT_PX = 36;

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
  swipeOffsetPx: number;
  swipeActive: boolean;
}

export function useEdgeSwipeToOpen({
  enabled,
  onOpen,
}: UseEdgeSwipeToOpenOptions): UseEdgeSwipeToOpenResult {
  const pointerIdRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const openedRef = useRef(false);
  const [swipeOffsetPx, setSwipeOffsetPx] = useState(0);
  const [swipeActive, setSwipeActive] = useState(false);

  const reset = useCallback(() => {
    pointerIdRef.current = null;
    startRef.current = null;
    openedRef.current = false;
    setSwipeOffsetPx(0);
    setSwipeActive(false);
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    reset();
    if (!enabled || event.pointerType !== 'touch' || event.clientX > EDGE_SWIPE_ZONE_PX) return;

    pointerIdRef.current = event.pointerId;
    startRef.current = { x: event.clientX, y: event.clientY };
    setSwipeActive(true);

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is unavailable in some test environments.
    }
  }, [enabled, reset]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled || event.pointerType !== 'touch') return;
    if (pointerIdRef.current !== event.pointerId || !startRef.current || openedRef.current) return;

    const dx = event.clientX - startRef.current.x;
    const dy = event.clientY - startRef.current.y;

    if (Math.abs(dy) > MAX_VERTICAL_DRIFT_PX) {
      reset();
      return;
    }

    const nextOffset = Math.max(0, dx);
    setSwipeOffsetPx(Math.min(nextOffset, OPEN_THRESHOLD_PX));

    if (nextOffset >= OPEN_THRESHOLD_PX) {
      openedRef.current = true;
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

  return {
    bind: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    swipeOffsetPx,
    swipeActive,
  };
}
