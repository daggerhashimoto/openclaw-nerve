import { useState, useRef, useCallback, useEffect, useLayoutEffect, type ReactNode } from 'react';

/** Props for {@link ResizablePanels}. */
interface ResizablePanelsProps {
  /** Content rendered in the left pane. */
  left: ReactNode;
  /** Content rendered in the right pane. */
  right: ReactNode;
  /** Current width of the left pane as a percentage (0–100). */
  leftPercent: number;
  /** Callback fired on drag-end with the new left-pane percentage. */
  onResize: (leftPercent: number) => void;
  /** Minimum left-pane width percentage. @default 30 */
  minLeftPercent?: number;
  /** Maximum left-pane width percentage. @default 85 */
  maxLeftPercent?: number;
  /** Additional class names for the left pane wrapper. */
  leftClassName?: string;
  /** Additional class names for the right pane wrapper. */
  rightClassName?: string;
  /** Fixed pixel width for the right pane. When set, the left pane absorbs remaining width. */
  rightWidthPx?: number | null;
  /** Reports the computed right pane width while ratio mode is active. */
  onRightWidthChange?: (width: number) => void;
}

/**
 * Horizontally resizable two-pane layout with a draggable divider.
 *
 * Supports drag resizing, clamped min/max constraints, and double-click
 * to reset to the 55 % default split. Used as the main layout container
 * in the Nerve cockpit (sessions list + chat area).
 */
export function ResizablePanels({
  left,
  right,
  leftPercent,
  onResize,
  minLeftPercent = 30,
  maxLeftPercent = 85,
  leftClassName = '',
  rightClassName = '',
  rightWidthPx = null,
  onRightWidthChange,
}: ResizablePanelsProps) {
  const [localPercent, setLocalPercent] = useState(leftPercent);
  const [localRightWidth, setLocalRightWidth] = useState<number | null>(rightWidthPx);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  // Sync local state when prop changes (e.g., from localStorage load)
  useEffect(() => {
    if (!isDragging.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional sync from controlled prop
      setLocalPercent(leftPercent);
    }
  }, [leftPercent]);

  useEffect(() => {
    if (!isDragging.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional sync from controlled prop in fixed-width mode
      setLocalRightWidth(rightWidthPx);
    }
  }, [rightWidthPx]);

  useLayoutEffect(() => {
    if (!containerRef.current || rightWidthPx !== null || !onRightWidthChange) return;

    const reportWidth = () => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.getBoundingClientRect().width;
      const width = containerWidth * ((100 - localPercent) / 100);
      onRightWidthChange(width);
    };

    reportWidth();

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => reportWidth());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [localPercent, onRightWidthChange, rightWidthPx]);

  const clampPercent = useCallback((percent: number) => (
    Math.max(minLeftPercent, Math.min(maxLeftPercent, percent))
  ), [minLeftPercent, maxLeftPercent]);

  const applyPointerPosition = useCallback((clientX: number) => {
    if (!containerRef.current) return null;

    const rect = containerRef.current.getBoundingClientRect();
    const rawPercent = ((clientX - rect.left) / rect.width) * 100;
    const clampedPercent = clampPercent(rawPercent);

    setLocalPercent(clampedPercent);

    if (rightWidthPx !== null) {
      const nextRightWidth = rect.width * ((100 - clampedPercent) / 100);
      setLocalRightWidth(nextRightWidth);
      onRightWidthChange?.(nextRightWidth);
    }

    return clampedPercent;
  }, [clampPercent, onRightWidthChange, rightWidthPx]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    applyPointerPosition(e.clientX);
  }, [applyPointerPosition]);

  const handleMouseUp = useCallback(() => {
    if (isDragging.current) {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onResize(localPercent);
    }
  }, [localPercent, onResize]);

  // Double-click to reset to default (55%)
  const handleDoubleClick = useCallback(() => {
    const defaultPercent = 55;
    setLocalPercent(defaultPercent);

    if (containerRef.current && rightWidthPx !== null) {
      const containerWidth = containerRef.current.getBoundingClientRect().width;
      const nextRightWidth = containerWidth * ((100 - defaultPercent) / 100);
      setLocalRightWidth(nextRightWidth);
      onRightWidthChange?.(nextRightWidth);
    }

    onResize(defaultPercent);
  }, [onResize, onRightWidthChange, rightWidthPx]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const effectiveRightWidth = rightWidthPx !== null ? Math.max(0, localRightWidth ?? rightWidthPx) : null;

  return (
    <div ref={containerRef} className="flex-1 flex overflow-hidden">
      {/* Left panel */}
      <div
        className={`min-h-0 overflow-hidden ${leftClassName}`}
        style={effectiveRightWidth !== null ? { flex: '1 1 auto', minWidth: 0 } : { flex: `${localPercent} 1 0%`, minWidth: 0 }}
      >
        {left}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        className="group relative flex w-3 cursor-col-resize shrink-0 items-stretch justify-center"
        title="Drag to resize. Double click to reset"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panels"
      >
        <div className="pointer-events-none my-3 w-px rounded-full bg-border transition-colors group-hover:bg-primary/55 group-hover:shadow-[0_0_16px_rgba(0,0,0,0.22)] group-active:bg-primary/70" />
      </div>

      {/* Right panel */}
      <div
        className={`min-h-0 overflow-hidden ${rightClassName}`}
        style={effectiveRightWidth !== null ? { flex: '0 0 auto', width: `${effectiveRightWidth}px`, minWidth: 0 } : { flex: `${100 - localPercent} 1 0%`, minWidth: 0 }}
      >
        {right}
      </div>
    </div>
  );
}
