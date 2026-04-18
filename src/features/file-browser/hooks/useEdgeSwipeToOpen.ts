import type React from 'react';
import { useCallback, useMemo, useRef } from 'react';

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

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled || event.pointerType !== 'touch' || event.clientX > EDGE_SWIPE_ZONE_PX) return;
    if (pointerIdRef.current !== null) return;

    reset();

    pointerIdRef.current = event.pointerId;
    startRef.current = { x: event.clientX, y: event.clientY };

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is unavailable in some test environments.
    }
  }, [enabled, reset]);

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
