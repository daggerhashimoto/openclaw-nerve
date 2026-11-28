/**
 * What an action leaves behind. While its undo window is open the item is one line in its own
 * place ("Approved 'Rotate the API keys' · Undo 5s"); once sent it moves to the Handled list at
 * the bottom of Now, with the time and how it went.
 */

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatClock } from './briefCopy';
import { variantClass } from './actionStyles';
import { KeyHint } from './KeyHint';
import { ACTION_COPY } from './useAttentionActions';
import { receiptText, type HandledReceipt, type PendingAction } from './deferredActions';

/** Whole seconds left in the window, ticking down while it is open. */
function Countdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <span data-testid="receipt-countdown" className="shrink-0 font-mono text-[0.8rem] tabular text-muted-foreground">
      {`${left}s`}
    </span>
  );
}

/** An item in its undo window, as one line in the item's place. */
export function ReceiptLine({
  entry,
  compact,
  onUndo,
  hints = false,
  className,
}: {
  entry: PendingAction;
  compact: boolean;
  onUndo: (key: string) => void;
  /** Shows the u keycap (desk keyboard use). */
  hints?: boolean;
  className?: string;
}) {
  const sending = entry.status === 'sending';
  return (
    <div
      data-testid="attention-receipt"
      data-receipt-key={entry.key}
      className={cn(
        'flex min-w-0 items-center gap-x-2 text-[0.867rem]',
        compact ? 'min-h-11 border-b border-border px-4' : 'min-h-7 pl-1 pr-1',
        className,
      )}
    >
      <span className={cn('min-w-0 truncate', sending ? 'text-muted-foreground' : 'text-foreground')}>
        {sending ? `${ACTION_COPY[entry.action].pending.replace(/\.\.\.$/, '')} ‘${entry.item.title}’...` : receiptText(entry.action, entry.item.title)}
      </span>
      {!sending && (
        <>
          <span aria-hidden="true" className="text-muted-foreground">·</span>
          <button
            type="button"
            onClick={() => onUndo(entry.key)}
            className={cn(variantClass('text', compact), 'shrink-0')}
          >
            Undo
            <KeyHint show={hints && !compact} k="u" />
          </button>
          <Countdown deadline={entry.deadline} />
        </>
      )}
    </div>
  );
}

/** What was handled this visit, newest first, collapsed to its count until opened. */
export function HandledList({ receipts, compact }: { receipts: HandledReceipt[]; compact: boolean }) {
  const [open, setOpen] = useState(false);
  if (receipts.length === 0) return null;
  return (
    <section aria-labelledby="attention-handled" className="flex min-w-0 flex-col gap-1">
      <div className={cn('flex items-center border-b border-border', compact ? 'min-h-11 px-4' : 'min-h-7')}>
        <h2 id="attention-handled" className="m-0 text-[0.867rem] font-semibold text-foreground">
          <button
            type="button"
            aria-expanded={open}
            aria-controls="attention-handled-list"
            onClick={() => setOpen((value) => !value)}
            className={cn('inline-flex cursor-pointer items-center gap-1 text-foreground', compact && 'min-h-11')}
          >
            {'Handled this visit '}
            <span className="font-mono font-normal tabular text-muted-foreground">{`(${receipts.length})`}</span>
            <span aria-hidden="true" className={cn('inline-block font-normal text-muted-foreground transition-transform duration-[120ms]', open && 'rotate-90')}>›</span>
          </button>
        </h2>
      </div>
      {open && (
        <ul id="attention-handled-list" className={cn('m-0 flex list-none flex-col p-0', compact && 'px-4')}>
          {receipts.map((receipt) => (
            <li key={receipt.id} data-testid="handled-receipt" className="flex min-h-7 min-w-0 items-baseline gap-x-2.5 py-0.5 text-[0.867rem]">
              <span className="shrink-0 font-mono text-[0.8rem] tabular text-muted-foreground">{formatClock(receipt.at)}</span>
              {receipt.outcome === 'done' ? (
                <span className="min-w-0 truncate text-foreground">{receiptText(receipt.action, receipt.title)}</span>
              ) : (
                <span className="flex min-w-0 flex-col">
                  <span className="text-destructive">{`Could not ${ACTION_COPY[receipt.action].verb} ‘${receipt.title}’`}</span>
                  {receipt.error && <span className="font-mono text-[0.8rem] text-muted-foreground">{receipt.error.replace(/^Could not [^:]+: /, '')}</span>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * An action waiting in its window where the item stays in place (Today's rows): the done word,
 * Undo and the seconds left, in place of the button.
 */
export function InlineUndo({ entry, compact, onUndo }: { entry: PendingAction; compact: boolean; onUndo: (key: string) => void }) {
  return (
    <span data-testid="inline-undo" className="relative z-10 inline-flex shrink-0 items-center gap-x-2 text-[0.867rem]">
      <span className="text-foreground">{ACTION_COPY[entry.action].done}</span>
      {entry.status === 'waiting' && (
        <>
          <button type="button" onClick={(event) => { event.stopPropagation(); onUndo(entry.key); }} className={variantClass('text', compact)}>
            Undo
          </button>
          <Countdown deadline={entry.deadline} />
        </>
      )}
    </span>
  );
}
