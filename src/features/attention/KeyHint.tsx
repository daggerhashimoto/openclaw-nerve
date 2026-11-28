import { cn } from '@/lib/utils';

/** A faint keycap after an action's label, while its item has keyboard focus at the desk. */
export function KeyHint({ show, k, className }: { show: boolean; k: string | null | undefined; className?: string }) {
  if (!show || !k) return null;
  return (
    <kbd aria-hidden="true" data-testid="key-hint" className={cn('cockpit-kbd ml-1.5 opacity-60', className)}>
      {k}
    </kbd>
  );
}
