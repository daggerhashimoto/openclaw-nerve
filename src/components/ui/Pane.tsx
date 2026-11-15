import { cn } from '@/lib/utils';
import type { PaneState } from '@/lib/paneState';

/**
 * A lit pane: Nerve's state marker. Panes switch on and off (see
 * --switch-duration in index.css); they never pulse or glow.
 * Colour is never the only signal: pass `label` when no adjacent text names
 * the state, and it is exposed to assistive tech.
 */
interface PaneProps {
  state: PaneState;
  /** 10x14 by default; sm is 8x11 for text lines. */
  size?: 'default' | 'sm';
  /** Accessible name for the state when no visible text says it. */
  label?: string;
  /** Identity hue of the agent family; shows in the glass while the pane is off. */
  hue?: string;
  className?: string;
}

export function Pane({ state, size = 'default', label, hue, className }: PaneProps) {
  return (
    <span
      className={cn('pane', size === 'sm' && 'pane-sm', hue && 'pane-hued', className)}
      style={hue ? ({ '--pane-hue': hue } as React.CSSProperties) : undefined}
      data-state={state}
      {...(label
        ? { role: 'img', 'aria-label': label, title: label }
        : { 'aria-hidden': true })}
    />
  );
}
