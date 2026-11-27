import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
import { Pane } from '@/components/ui/Pane';
import { nameHueStyle } from '@/lib/agentColors';
import { cn } from '@/lib/utils';
import { formatClock } from './briefCopy';
import { ownedReason, paneFor, type ItemView } from './itemPresentation';
import type { AttentionItem, OpenTarget } from './types';

const CLOCK = /(\b\d{1,2}:\d{2}\b)/;

/** Running text with every HH:MM set in monospace. */
export function Clocked({ text }: { text: string }) {
  return (
    <>
      {text.split(CLOCK).map((part, index) => (
        index % 2 === 1
          ? <span key={index} className="font-mono tabular">{part}</span>
          : <Fragment key={index}>{part}</Fragment>
      ))}
    </>
  );
}

/** A reason line with the owner's name in its family hue and clock times in monospace. */
export function ReasonText({ text, ownerName, hue }: { text: string; ownerName?: string; hue?: string }) {
  const at = ownerName ? text.indexOf(ownerName) : -1;
  if (!ownerName || at < 0) return <Clocked text={text} />;
  return (
    <>
      <Clocked text={text.slice(0, at)} />
      <span className={cn('font-medium', hue ? 'name-hued' : 'text-foreground')} style={nameHueStyle(hue)}>
        {ownerName}
      </span>
      <Clocked text={text.slice(at + ownerName.length)} />
    </>
  );
}

export function NewTag() {
  return <span className="shrink-0 font-mono text-[0.733rem] text-operator-text">New</span>;
}

/**
 * Marks one item seen. It is its own button beside the item's open control, never inside it,
 * and it only records the key on this device: nothing at the source changes.
 */
export function MarkItemSeenButton({
  item,
  compact,
  onMarkSeen,
  className,
}: {
  item: AttentionItem;
  compact: boolean;
  onMarkSeen: (item: AttentionItem) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Mark ${item.title} seen`}
      onClick={(event) => {
        event.stopPropagation();
        onMarkSeen(item);
      }}
      className={cn('shell-chip shrink-0 cursor-pointer text-[0.8rem]', compact && 'min-h-[44px]', className)}
    >
      Mark seen
    </button>
  );
}

interface AttentionRowProps {
  item: AttentionItem;
  view: ItemView;
  /** Phone layout: a 60 px row with a chevron. Otherwise a compact list row for the side column. */
  compact: boolean;
  onOpen: (target: OpenTarget) => void;
  /** Blocked, failed and finished items only: adds a Mark seen button beside the row. */
  onMarkSeen?: (item: AttentionItem) => void;
}

/** One item as a row that opens its source. */
export function AttentionRow({ item, view, compact, onOpen, onMarkSeen }: AttentionRowProps) {
  const pane = paneFor(item.kind);
  const sub = ownedReason(view.reason, view.ownerName);

  return (
    <div className={cn('flex min-w-0 items-center', compact && 'border-b border-border')}>
      <button
        type="button"
        data-testid="attention-row"
        onClick={() => onOpen(item.open)}
        className={cn(
          'flex min-w-0 flex-1 cursor-pointer items-center text-left transition-colors duration-[120ms] hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
          compact
            ? 'min-h-[60px] gap-3 px-4 py-2'
            : 'min-h-[44px] gap-2.5 rounded-[3px] px-1 py-2',
          item.freshness !== 'live' && 'opacity-80',
        )}
      >
        <Pane state={pane.state} hue={pane.state === 'off' ? view.hue : undefined} label={pane.label} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn('min-w-0 flex-1 truncate text-foreground', compact ? 'text-[1rem]' : 'text-[0.867rem]')}>
              {item.title}
            </span>
            {view.isNew && <NewTag />}
            {!compact && (
              <span
                className={cn(
                  'shrink-0 font-mono text-[0.733rem] tabular',
                  pane.state === 'live' ? 'text-live-text' : 'text-muted-foreground',
                )}
              >
                {formatClock(item.updatedAt)}
              </span>
            )}
          </span>
          <span className={cn('min-w-0 truncate text-muted-foreground', compact ? 'text-[0.867rem]' : 'text-[0.8rem]')}>
            <ReasonText text={sub} ownerName={view.ownerName} hue={view.hue} />
          </span>
        </span>
        {compact && <ChevronRight size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
      </button>
      {onMarkSeen && (
        <MarkItemSeenButton
          item={item}
          compact={compact}
          onMarkSeen={onMarkSeen}
          className={compact ? 'mx-1' : 'ml-1'}
        />
      )}
    </div>
  );
}
