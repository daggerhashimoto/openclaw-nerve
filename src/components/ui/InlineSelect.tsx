import { useState, useEffect, useId, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A single option in an {@link InlineSelect} dropdown. */
export interface InlineSelectOption {
  value: string;
  label: string;
}

/** Props for {@link InlineSelect}. */
interface InlineSelectProps {
  value: string;
  onChange: (next: string) => void;
  options: InlineSelectOption[];
  ariaLabel: string;
  disabled?: boolean;
  title?: string;
  triggerClassName?: string;
  menuClassName?: string;
  dropUp?: boolean;
  /** Optional label override for the closed trigger button. */
  displayLabel?: string;
  /**
   * @deprecated Menus are always portaled and viewport-positioned now, so the
   * dialog's overflow cannot clip them. Kept for backwards compatibility.
   */
  inline?: boolean;
}

/** Distance the pointer may travel and still count as a tap. */
const TAP_SLOP = 8;
const VIEWPORT_PADDING = 8;
const MENU_MAX_HEIGHT = 320;
/** Window during which the compatibility click after a touch tap is swallowed. */
const GHOST_CLICK_WINDOW_MS = 500;

interface TouchPress {
  pointerId: number;
  /** Captured at press time: the option list can be replaced before release. */
  value: string;
  startX: number;
  startY: number;
  moved: boolean;
}

const HIDDEN_MENU_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  maxWidth: 'calc(100vw - 16px)',
  visibility: 'hidden',
  pointerEvents: 'none',
  zIndex: 9999,
};

/**
 * Compact inline dropdown select with full keyboard navigation.
 *
 * The menu is portaled to `document.body` and positioned with `position: fixed`
 * against the viewport, so an ancestor's `overflow` (for example a scrollable
 * Radix dialog) can never clip it. Placement flips above the trigger when there
 * is not enough room below, and the listbox height is clamped to the viewport.
 *
 * Selection is tap-safe on touch: a press only starts tracking, vertical drags
 * scroll the menu, and the value is committed on `pointerup` only when the
 * pointer stayed within the tap slop. Mouse presses still select immediately,
 * and keyboard navigation is unchanged.
 */
export function InlineSelect({
  value,
  onChange,
  options,
  ariaLabel,
  disabled = false,
  title,
  triggerClassName,
  menuClassName,
  dropUp = false,
  displayLabel,
}: InlineSelectProps) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listboxRef = useRef<HTMLUListElement | null>(null);
  const listboxCleanupRef = useRef<(() => void) | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>(HIDDEN_MENU_STYLE);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom');
  const touchPressRef = useRef<TouchPress | null>(null);
  /** Set when a touch gesture turned into a scroll; blocks the trailing click. */
  const dragEndedRef = useRef(false);
  const ghostClickCleanupRef = useRef<(() => void) | null>(null);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const menuEl = listboxRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const availableWidth = Math.max(0, viewportWidth - VIEWPORT_PADDING * 2);

    // The menu may be wider than the trigger (long model ids), but never wider
    // than the viewport.
    const menuWidth = Math.min(
      Math.max(rect.width, menuEl?.offsetWidth ?? 0),
      availableWidth,
    );
    const maxLeft = Math.max(VIEWPORT_PADDING, viewportWidth - menuWidth - VIEWPORT_PADDING);
    const left = Math.min(Math.max(rect.left, VIEWPORT_PADDING), maxLeft);

    // Prefer the natural menu height so we only flip when the menu would not
    // fit. `visibility: hidden` keeps it measurable before the first paint.
    const measuredHeight = Math.max(menuEl?.offsetHeight ?? 0, menuEl?.scrollHeight ?? 0);
    const naturalHeight = Math.min(
      MENU_MAX_HEIGHT,
      measuredHeight > 0 ? measuredHeight : MENU_MAX_HEIGHT,
    );

    const spaceBelow = viewportHeight - rect.bottom - VIEWPORT_PADDING - 4;
    const spaceAbove = rect.top - VIEWPORT_PADDING - 4;
    const preferredUp = dropUp || (naturalHeight > spaceBelow && spaceAbove > spaceBelow);
    // A forced drop-up with no room above would render an invisible menu; flip to
    // the roomier side. Auto placement already does this, but `dropUp` bypasses it.
    const shouldDropUp = preferredUp && spaceAbove >= 48
      ? true
      : !preferredUp && spaceBelow >= 48
        ? false
        : spaceAbove > spaceBelow;
    const availableHeight = shouldDropUp ? spaceAbove : spaceBelow;
    // Never floor past the space the viewport actually offers: on a short
    // landscape viewport that would push the last options off-screen.
    const maxHeight = Math.max(0, Math.min(MENU_MAX_HEIGHT, availableHeight));

    setPlacement(shouldDropUp ? 'top' : 'bottom');
    setMenuStyle({
      position: 'fixed',
      left,
      ...(shouldDropUp
        ? { bottom: viewportHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
      minWidth: Math.min(rect.width, availableWidth),
      maxWidth: availableWidth,
      maxHeight,
      visibility: 'visible',
      // Radix dialogs set `pointer-events: none` on <body>; the portal must opt
      // back in or the menu would be visible but unclickable.
      pointerEvents: 'auto',
      zIndex: 9999,
    });
  }, [dropUp]);

  const openWithHighlight = useCallback(() => {
    const currentIndex = options.findIndex((o) => o.value === value);
    setHighlightedIndex(currentIndex >= 0 ? currentIndex : 0);
    setOpen(true);
  }, [options, value]);

  const close = useCallback(() => {
    touchPressRef.current = null;
    setHighlightedIndex(-1);
    setOpen(false);
  }, []);

  const selectOption = useCallback((next: string) => {
    onChange(next);
    close();
  }, [onChange, close]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // Check both the container (trigger) and the portaled listbox.
      if (!containerRef.current?.contains(target) && !listboxRef.current?.contains(target)) {
        close();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [close]);

  // Position the menu during commit, before the browser paints, so it never
  // flashes at the hidden placeholder position. Kept out of a layout effect to
  // avoid a synchronous setState cascade there.
  //
  // The menu is portaled outside Radix DialogContent, so Radix's RemoveScroll
  // treats a touchmove/wheel over it as an outside scroll and preventDefaults
  // it. Stopping propagation at the listbox lets the menu's own overflow
  // scroll natively while the dialog stays scroll-locked.
  const attachListbox = useCallback((node: HTMLUListElement | null) => {
    if (listboxCleanupRef.current) {
      listboxCleanupRef.current();
      listboxCleanupRef.current = null;
    }
    listboxRef.current = node;
    if (!node) return;

    const stopScrollLock = (event: Event) => {
      event.stopPropagation();
    };
    node.addEventListener('touchmove', stopScrollLock, { passive: true });
    node.addEventListener('wheel', stopScrollLock, { passive: true });
    listboxCleanupRef.current = () => {
      node.removeEventListener('touchmove', stopScrollLock);
      node.removeEventListener('wheel', stopScrollLock);
    };

    updateMenuPosition();
  }, [updateMenuPosition]);

  // Keep the fixed menu anchored while the page or the dialog content scrolls
  // or resizes.
  useEffect(() => {
    if (!open) return;
    const onReflow = (event: Event) => {
      // The menu's own scrolling must not re-run positioning.
      if (event.target instanceof Node && listboxRef.current?.contains(event.target)) return;
      updateMenuPosition();
    };
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (open && highlightedIndex >= 0 && listboxRef.current) {
      const item = listboxRef.current.children[highlightedIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [open, highlightedIndex]);

  /**
   * Close the menu on tap and swallow the compatibility click the browser
   * synthesizes afterwards so it cannot activate whatever sits under the menu.
   */
  const suppressGhostClick = useCallback(() => {
    ghostClickCleanupRef.current?.();

    const onClickCapture = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      cleanup();
    };
    // Any new gesture or key activation means the guard has done its job; a
    // real tap/keyboard action that follows the selection must not be swallowed.
    const disarm = () => cleanup();
    const cleanup = () => {
      document.removeEventListener('click', onClickCapture, true);
      document.removeEventListener('pointerdown', disarm, true);
      document.removeEventListener('keydown', disarm, true);
      window.clearTimeout(timer);
      if (ghostClickCleanupRef.current === cleanup) {
        ghostClickCleanupRef.current = null;
      }
    };
    const timer = window.setTimeout(cleanup, GHOST_CLICK_WINDOW_MS);

    ghostClickCleanupRef.current = cleanup;
    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('pointerdown', disarm, true);
    document.addEventListener('keydown', disarm, true);
  }, []);

  useEffect(() => () => ghostClickCleanupRef.current?.(), []);

  const selected = options.find((o) => o.value === value) ?? options[0];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openWithHighlight();
        return;
      }
      if (e.key === 'Escape') {
        close();
        return;
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % options.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 + options.length) % options.length);
        break;
      case 'Home':
        e.preventDefault();
        setHighlightedIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setHighlightedIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < options.length) {
          selectOption(options[highlightedIndex].value);
        }
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
      case 'Tab':
        close();
        break;
    }
  };

  const handleOptionPointerDown = (
    event: React.PointerEvent<HTMLLIElement>,
    index: number,
  ) => {
    if (disabled) return;

    dragEndedRef.current = false;

    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      // Do NOT preventDefault here: the browser must stay in charge of the
      // gesture so a drag can scroll the list. We only track the press and
      // decide on pointerup whether it was a tap.
      touchPressRef.current = {
        pointerId: event.pointerId,
        value: options[index].value,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
      return;
    }

    // Mouse keeps the immediate press-to-select behavior.
    event.preventDefault();
    event.stopPropagation();
    selectOption(options[index].value);
  };

  const handleOptionPointerMove = (event: React.PointerEvent<HTMLLIElement>) => {
    const press = touchPressRef.current;
    if (!press || press.pointerId !== event.pointerId || press.moved) return;
    const dx = event.clientX - press.startX;
    const dy = event.clientY - press.startY;
    if (Math.hypot(dx, dy) > TAP_SLOP) {
      press.moved = true;
      dragEndedRef.current = true;
    }
  };

  const handleOptionPointerUp = (event: React.PointerEvent<HTMLLIElement>) => {
    const press = touchPressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    touchPressRef.current = null;

    // A drag was a scroll, not a selection.
    if (press.moved) return;

    // Pointer capture keeps events on the original option, so also verify the
    // release point is still within it.
    const rect = event.currentTarget.getBoundingClientRect();
    const withinOption = rect.width === 0 || rect.height === 0
      || (event.clientX >= rect.left
        && event.clientX <= rect.right
        && event.clientY >= rect.top
        && event.clientY <= rect.bottom);
    if (!withinOption) return;

    event.preventDefault();
    suppressGhostClick();
    selectOption(press.value);
  };

  const handleOptionPointerCancel = (event: React.PointerEvent<HTMLLIElement>) => {
    const press = touchPressRef.current;
    if (press && press.pointerId === event.pointerId) {
      touchPressRef.current = null;
    }
  };

  const activeDescendantId = open && highlightedIndex >= 0
    ? `inline-select-option-${options[highlightedIndex]?.value}`
    : undefined;

  const menuContent = open && !disabled ? (
    <ul
      ref={attachListbox}
      id={listboxId}
      role="listbox"
      aria-label={ariaLabel}
      data-placement={placement}
      style={{
        ...menuStyle,
        // Let vertical pans scroll the list natively on touch devices, and stop
        // scroll chaining at the menu edges.
        touchAction: 'pan-y',
        overscrollBehavior: 'contain',
      }}
      className={cn(
        'overflow-auto rounded-[3px] border border-border bg-popover text-foreground nerve-menu-shadow',
        menuClassName,
      )}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        const highlighted = index === highlightedIndex;
        return (
          <li
            key={option.value}
            id={`inline-select-option-${option.value}`}
            role="option"
            aria-selected={active}
            className={cn(
              'w-full text-left px-2 py-1 text-[0.733rem] font-mono cursor-pointer sm:text-[0.667rem]',
              highlighted ? 'bg-secondary/80 text-foreground' : active ? 'bg-secondary text-foreground' : 'text-foreground/80',
              'hover:bg-secondary/80 hover:text-foreground'
            )}
            onPointerDown={(e) => handleOptionPointerDown(e, index)}
            onPointerMove={handleOptionPointerMove}
            onPointerUp={handleOptionPointerUp}
            onPointerCancel={handleOptionPointerCancel}
            onPointerEnter={() => setHighlightedIndex(index)}
            onClick={() => {
              // Fallback for programmatic/assistive clicks. Mouse presses have
              // already closed the menu by now, and touch taps are handled on
              // pointerup with the ghost click suppressed.
              if (dragEndedRef.current) {
                // A scroll gesture that the browser still turned into a click.
                dragEndedRef.current = false;
                return;
              }
              selectOption(option.value);
            }}
          >
            {option.label}
          </li>
        );
      })}
    </ul>
  ) : null;

  const menu = menuContent && typeof document !== 'undefined'
    ? createPortal(menuContent, document.body)
    : menuContent;

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={activeDescendantId}
        disabled={disabled}
        title={title}
        onClick={() => open ? close() : openWithHighlight()}
        onKeyDown={handleKeyDown}
        className={cn('text-[0.867rem] bg-transparent text-foreground border border-input rounded-[3px] px-2 py-1.5 outline-none transition-colors duration-[120ms] hover:bg-raised disabled:opacity-50 disabled:cursor-not-allowed inline-flex min-h-11 items-center gap-1 min-w-0 sm:min-h-7 sm:py-0 sm:text-[0.8rem]', triggerClassName)}
      >
        <span className="truncate">{displayLabel ?? selected?.label ?? value}</span>
        <ChevronDown size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>

      {menu}
    </div>
  );
}
