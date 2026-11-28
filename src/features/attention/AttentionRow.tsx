import { ChevronRight } from 'lucide-react';
import { Pane } from '@/components/ui/Pane';
import { nameHueStyle } from '@/lib/agentColors';
import { timeAgo } from '@/lib/formatting';
import { cn } from '@/lib/utils';
import { kindWord } from './briefCopy';
import { freshnessNote, openLabel, paneFor, type ItemView } from './itemPresentation';
import { ActionButton, ActionError, ActionStrip, StopConfirm } from './AttentionActions';
import { CommandBlock, Evidence, ItemDetail, WhatHappened } from './AttentionCard';
import { variantClass } from './actionStyles';
import type { ReplyConfig } from './AttentionReply';
import { useItemReply } from './useItemReply';
import { useItemActions, type AttentionActionsConfig } from './useAttentionActions';
import { Clocked, NewTag } from './textBits';
import type { AttentionItem, OpenTarget } from './types';
import type { ThreadSummary } from './useAttentionSummaries';

export { Clocked, NewTag, ReasonText } from './textBits';

/**
 * Marks one item seen. It is its own button beside the item's toggle, never inside it, and it
 * only records the key on this device: nothing at the source changes. `reveal` keeps it out of
 * sight until the row is hovered or has focus (desk rows); it stays reachable by keyboard.
 */
export function MarkItemSeenButton({
  item,
  compact,
  onMarkSeen,
  reveal = false,
  className,
}: {
  item: AttentionItem;
  compact: boolean;
  onMarkSeen: (item: AttentionItem) => void;
  reveal?: boolean;
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
      className={cn(
        variantClass('text', compact),
        'shrink-0 text-[0.8rem]',
        compact && 'inline-flex min-h-[44px] items-center',
        reveal && 'opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
        className,
      )}
    >
      Mark seen
    </button>
  );
}

/** The line under a row's title: the failure in one line, or agent, age and kind. */
function MetaLine({ item, view, now, open }: { item: AttentionItem; view: ItemView; now: number; open: boolean }) {
  const stale = freshnessNote(item);
  // An open row shows the whole error below, so the line under the title says when instead.
  if (!open && (item.kind === 'task-failed' || item.kind === 'cron-failed' || item.kind === 'session-failed')) {
    if (item.detail.error) return <ItemDetail item={item} />;
  }
  const age = timeAgo(item.updatedAt, now);
  const reasonFirst = item.kind === 'cron-recovered' || item.kind === 'cron-failed' || item.kind === 'session-failed' || item.kind === 'task-failed';
  const parts = reasonFirst ? [view.reason] : [age === 'now' ? 'just now' : age, kindWord(item)];
  return (
    <span className="min-w-0 truncate text-[0.8rem] text-muted-foreground">
      {view.ownerName && (
        <>
          <span className={cn('font-medium', view.hue ? 'name-hued' : 'text-foreground')} style={nameHueStyle(view.hue)}>
            {view.ownerName}
          </span>
          {' · '}
        </>
      )}
      <Clocked text={parts.join(' · ')} />
      {stale && <span className="text-foreground">{` · ${stale}`}</span>}
    </span>
  );
}

export interface AttentionRowProps {
  item: AttentionItem;
  view: ItemView;
  now: number;
  /** Phone layout: 60px rows and 44px controls. */
  compact: boolean;
  /** The row is open in place. */
  open: boolean;
  onToggle: (item: AttentionItem) => void;
  onOpen: (target: OpenTarget) => void;
  /** Failures and finishes: adds Mark seen. */
  onMarkSeen?: (item: AttentionItem) => void;
  /** Where Mark seen sits: on the row, shown on hover or focus (desk), or in the open row (phone). */
  markSeenPlacement?: 'row' | 'detail';
  /** Turns on the item's actions. Without it the row only opens. */
  actions?: AttentionActionsConfig;
  replies?: ReplyConfig;
  summary?: ThreadSummary;
  /** Finished history: the pane stays dark and the hue sits on the name. */
  history?: boolean;
}

/**
 * One item as a two-line row: title, then agent, age and kind (or the failure in one line), with
 * its main action as an outline button. Clicking the row opens it in place (what happened, the
 * evidence, every action, Reply and an explicit Open); only Open navigates away.
 */
export function AttentionRow({
  item,
  view,
  now,
  compact,
  open,
  onToggle,
  onOpen,
  onMarkSeen,
  markSeenPlacement = 'row',
  actions,
  replies,
  summary,
  history = false,
}: AttentionRowProps) {
  const pane = paneFor(item.kind);
  const state = useItemActions(item, actions);
  const primary = state.actions.primary;
  const confirmingStop = primary === 'stop' && state.confirming;
  const reply = useItemReply(item, view, replies, onOpen);
  const failing = pane.state === 'error';
  // Allow waits until the operator can see the whole command: a row title is only its first line or preview.
  const hidePrimary = item.kind === 'approval' && item.detail.command !== item.title;
  const target = item.open;
  const detailId = `attention-row-${item.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  const openButton = target && (
    <button type="button" onClick={() => onOpen(target)} className={variantClass('text', compact)}>
      {openLabel(item)}
    </button>
  );

  return (
    <div data-testid="attention-item" className={cn('group flex min-w-0 flex-col', compact && 'border-b border-border')}>
      <div className={cn('flex min-w-0 items-center gap-2', compact ? 'pr-3' : 'pr-1')}>
        <button
          type="button"
          data-testid="attention-row"
          aria-expanded={open}
          aria-controls={open ? detailId : undefined}
          onClick={() => onToggle(item)}
          className={cn(
            'flex min-w-0 flex-1 cursor-pointer items-center text-left transition-colors duration-[120ms] hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
            compact ? 'min-h-[60px] gap-3 py-2 pl-4' : 'min-h-[44px] gap-2.5 rounded-[3px] py-1.5 pl-1 pr-1',
          )}
        >
          <Pane state={pane.state} hue={pane.state === 'off' && !history ? view.hue : undefined} label={pane.label} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span
                data-testid="attention-row-title"
                // Phones give the title two lines; the desk keeps one.
                className={cn('min-w-0 flex-1 text-foreground', compact ? 'line-clamp-2 text-[1rem] leading-snug' : 'truncate text-[0.867rem]', item.kind === 'approval' && 'font-mono text-[0.8rem]')}
              >
                {item.title}
              </span>
              {view.isNew && <NewTag />}
            </span>
            <MetaLine item={item} view={view} now={now} open={open} />
          </span>
          {/* The whole row opens on a phone, so the chevron gives its width back to the title. */}
          {!compact && (
            <ChevronRight
              size={16}
              aria-hidden="true"
              className={cn('shrink-0 text-muted-foreground transition-transform duration-[120ms]', open && 'rotate-90')}
            />
          )}
        </button>
        {primary && !confirmingStop && !open && !hidePrimary && (
          <ActionButton state={state} action={primary} variant="outline" compact={compact} />
        )}
        {failing && !open && !compact && openButton}
        {onMarkSeen && markSeenPlacement === 'row' && !open && (
          <MarkItemSeenButton item={item} compact={compact} onMarkSeen={onMarkSeen} reveal={!compact} />
        )}
      </div>

      {open && (
        <div
          id={detailId}
          data-testid="attention-row-detail"
          className={cn('flex min-w-0 flex-col gap-2.5 pb-3 pt-1 [overflow-wrap:anywhere]', compact ? 'px-4' : 'pl-[2.1rem] pr-1')}
        >
          {item.kind === 'approval' && <CommandBlock item={item} />}
          <ItemDetail item={item} full />
          <WhatHappened summary={summary} />
          <Evidence item={item} compact={compact} onOpen={onOpen} />
          {reply.fieldOpen ? reply.field(compact) : (
            <ActionStrip
              state={state}
              compact={compact}
              extra={(
                <>
                  {reply.button(compact)}
                  {openButton}
                </>
              )}
              trailing={onMarkSeen && (
                <MarkItemSeenButton item={item} compact={compact} onMarkSeen={onMarkSeen} />
              )}
            />
          )}
        </div>
      )}

      {!open && (confirmingStop || state.error) && (
        <div className={cn('flex flex-col gap-1 pb-2', compact ? 'px-4' : 'pl-[2.1rem] pr-1')}>
          {confirmingStop && <StopConfirm state={state} compact={compact} />}
          {state.error && <ActionError message={state.error} />}
        </div>
      )}
      {reply.panel(compact, compact ? 'mx-4 mb-2' : 'mb-2 ml-[2.1rem]')}
    </div>
  );
}
