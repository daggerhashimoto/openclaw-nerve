/**
 * The board's action tiers. The warm filled button is the Start here plate's decision and
 * nothing else; a row's or a card's main action is an outline button (the field edge, primary
 * text, 28px at the desk and 44px on phones); every second action is muted underlined text.
 * A chip is never an item's main action; it stays for quiet controls like Refresh.
 */

import { cn } from '@/lib/utils';

export const PRIMARY_BUTTON = 'send-btn relative z-10 inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[3px] border-none bg-primary px-3.5 text-[0.867rem] font-semibold text-primary-foreground transition-[filter] duration-[120ms] hover:brightness-110 disabled:cursor-default disabled:opacity-50 disabled:hover:brightness-100';
export const OUTLINE_BUTTON = 'relative z-10 inline-flex shrink-0 cursor-pointer items-center justify-center rounded-[3px] border border-input bg-transparent px-3 text-[0.867rem] font-medium text-foreground transition-colors duration-[120ms] hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent';
export const TEXT_BUTTON = 'relative z-10 cursor-pointer text-[0.867rem] text-muted-foreground underline decoration-border underline-offset-4 transition-colors duration-[120ms] hover:text-foreground hover:decoration-operator disabled:cursor-default disabled:opacity-50';
const CHIP_BUTTON = 'shell-chip relative z-10 shrink-0 cursor-pointer text-[0.8rem] disabled:cursor-default disabled:opacity-50';

export type Variant = 'primary' | 'outline' | 'chip' | 'text';

export function variantClass(variant: Variant, compact: boolean): string {
  switch (variant) {
    case 'primary':
      return cn(PRIMARY_BUTTON, compact ? 'min-h-11 w-full' : 'min-h-8');
    case 'outline':
      return cn(OUTLINE_BUTTON, compact ? 'min-h-[44px]' : 'min-h-7');
    case 'chip':
      // `.shell-chip` sits outside the Tailwind layers, so the phone height needs `!` to win.
      return cn(CHIP_BUTTON, compact && 'min-h-[44px]!');
    case 'text':
      return cn(TEXT_BUTTON, compact && 'min-h-11');
  }
}
