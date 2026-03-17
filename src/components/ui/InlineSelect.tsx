import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
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
  /** When true, render dropdown inline (absolute) instead of via portal.
   *  Use inside Radix Dialog or other portal-based overlays where
   *  a sibling portal's clicks get intercepted. */
  inline?: boolean;
}

/**
 * Compact inline dropdown select with full keyboard navigation.
 *
 * Styled as a tiny mono-font trigger that opens an absolutely-positioned
 * listbox. Supports arrow keys, Home/End, Escape, and optional drop-up
 * positioning. Used in the Nerve status bar and panel headers.
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
  inline = false,
}: InlineSelectProps) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listboxRef = useRef<HTMLUListElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const getHiddenMenuStyle = useCallback((): React.CSSProperties => {
    const rect = triggerRef.current?.getBoundingClientRect();
    const viewportPadding = 8;

    return {
      position: 'fixed',
      left: rect?.left ?? viewportPadding,
      top: (rect?.bottom ?? viewportPadding) + 4,
      minWidth: rect?.width,
      maxWidth: window.innerWidth - viewportPadding * 2,
      maxHeight: 320,
      visibility: 'hidden',
      zIndex: 9999,
    };
  }, []);

  const openWithHighlight = useCallback(() => {
    const currentIndex = options.findIndex((o) => o.value === value);
    setHighlightedIndex(currentIndex >= 0 ? currentIndex : 0);

    if (!inline) {
      setMenuStyle(getHiddenMenuStyle());
    }

    setOpen(true);
  }, [getHiddenMenuStyle, inline, options, value]);

  const close = useCallback(() => {
    setHighlightedIndex(-1);
    setOpen(false);
    if (!inline) {
      setMenuStyle({});
    }
  }, [inline]);

  const onPointerDown = useCallback((event: PointerEvent) => {
    const target = event.target as Node;
    // Check both the container (trigger) and the portal listbox
    if (!containerRef.current?.contains(target) && !listboxRef.current?.contains(target)) {
      close();
    }
  }, [close]);

  useEffect(() => {
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [onPointerDown]);

  useEffect(() => {
    if (open && highlightedIndex >= 0 && listboxRef.current) {
      const item = listboxRef.current.children[highlightedIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [open, highlightedIndex]);

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
          onChange(options[highlightedIndex].value);
          close();
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

  const activeDescendantId = open && highlightedIndex >= 0
    ? `inline-select-option-${options[highlightedIndex]?.value}`
    : undefined;

  useLayoutEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const menuEl = listboxRef.current;
      const viewportPadding = 8;

      const menuWidth = Math.max(rect.width, menuEl?.offsetWidth ?? 0);
      const maxLeft = Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding);
      const left = Math.min(Math.max(rect.left, viewportPadding), maxLeft);
      const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
      const spaceAbove = rect.top - viewportPadding;
      const shouldDropUp = dropUp || (spaceBelow < 220 && spaceAbove > spaceBelow);
      const availableHeight = Math.max(
        120,
        Math.min(320, shouldDropUp ? spaceAbove - 4 : spaceBelow - 4),
      );

      if (shouldDropUp) {
        setMenuStyle({
          position: 'fixed',
          left,
          bottom: window.innerHeight - rect.top + 4,
          minWidth: rect.width,
          maxWidth: window.innerWidth - viewportPadding * 2,
          maxHeight: availableHeight,
          visibility: 'visible',
          zIndex: 9999,
        });
      } else {
        setMenuStyle({
          position: 'fixed',
          left,
          top: rect.bottom + 4,
          minWidth: rect.width,
          maxWidth: window.innerWidth - viewportPadding * 2,
          maxHeight: availableHeight,
          visibility: 'visible',
          zIndex: 9999,
        });
      }
    }
  }, [open, dropUp, inline, options.length, value]);

  const menuContent = open && !disabled ? (
    <ul
      ref={listboxRef}
      role="listbox"
      aria-label={ariaLabel}
      style={inline ? undefined : menuStyle}
      className={cn(
        'max-h-48 overflow-auto border border-border/80 bg-background text-foreground shadow-lg',
        inline && 'absolute left-0 min-w-full z-50',
        inline && dropUp ? 'bottom-full mb-1' : inline ? 'top-full mt-1' : '',
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
              'w-full text-left px-2 py-1 text-[11px] font-mono cursor-pointer sm:text-[10px]',
              highlighted ? 'bg-secondary/80 text-foreground' : active ? 'bg-secondary text-foreground' : 'text-foreground/80',
              'hover:bg-secondary/80 hover:text-foreground'
            )}
            onPointerDown={(e) => {
              e.stopPropagation();
              onChange(option.value);
              close();
            }}
            onPointerEnter={() => setHighlightedIndex(index)}
          >
            {option.label}
          </li>
        );
      })}
    </ul>
  ) : null;

  const menu = menuContent && !inline ? createPortal(menuContent, document.body) : menuContent;

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-activedescendant={activeDescendantId}
        disabled={disabled}
        title={title}
        onClick={() => open ? close() : openWithHighlight()}
        onKeyDown={handleKeyDown}
        className={cn('font-mono text-[12px] bg-background/40 text-foreground/80 border border-border/60 px-2 py-1.5 outline-none disabled:opacity-50 disabled:cursor-not-allowed inline-flex min-h-11 items-center gap-1 min-w-0 sm:min-h-8 sm:px-1.5 sm:py-0.5 sm:text-[10px]', triggerClassName)}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <span className="text-muted-foreground">▾</span>
      </button>

      {menu}
    </div>
  );
}
