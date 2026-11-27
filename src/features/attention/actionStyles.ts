/**
 * The brief's control styles: the warm Send button (Start here only), the quiet chip (cards
 * and rows) and the underlined text button. Every control is `relative z-10` so it sits above
 * a card's full-card open hit area.
 */

import { cn } from '@/lib/utils';

export const PRIMARY_BUTTON = 'send-btn relative z-10 inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[3px] border-none bg-primary px-3.5 text-[0.867rem] font-semibold text-primary-foreground transition-[filter] duration-[120ms] hover:brightness-110 disabled:cursor-default disabled:opacity-50 disabled:hover:brightness-100';
export const TEXT_BUTTON = 'relative z-10 cursor-pointer text-[0.867rem] text-foreground underline decoration-border underline-offset-4 hover:decoration-operator disabled:cursor-default disabled:opacity-50';
const CHIP_BUTTON = 'shell-chip relative z-10 shrink-0 cursor-pointer text-[0.8rem] disabled:cursor-default disabled:opacity-50';

export type Variant = 'primary' | 'chip' | 'text';

export function variantClass(variant: Variant, compact: boolean): string {
  switch (variant) {
    case 'primary':
      return cn(PRIMARY_BUTTON, compact ? 'min-h-11 w-full' : 'min-h-8');
    case 'chip':
      // `.shell-chip` sits outside the Tailwind layers, so the phone height needs `!` to win.
      return cn(CHIP_BUTTON, compact && 'min-h-[44px]!');
    case 'text':
      return cn(TEXT_BUTTON, compact && 'min-h-11');
  }
}

