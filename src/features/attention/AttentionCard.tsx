/**
 * The Start here plate (the one warm surface on the board, for the top decision) and the parts
 * an item shows when it opens in full: what happened in its thread, and the evidence its own
 * data carries.
 */

import { Pane } from '@/components/ui/Pane';
import { nameHueStyle } from '@/lib/agentColors';
import { cn } from '@/lib/utils';
import { formatClock, kindWord } from './briefCopy';
import { freshnessNote, openLabel, paneFor, type ItemView } from './itemPresentation';
import { Clocked, NewTag } from './textBits';
import { ActionButton, ActionError, ChangesNote, StopConfirm } from './AttentionActions';
import { PRIMARY_BUTTON, TEXT_BUTTON, variantClass } from './actionStyles';
import type { ReplyConfig } from './AttentionReply';
import { useItemReply } from './useItemReply';
import { useItemActions, type AttentionActionsConfig } from './useAttentionActions';
import { runItemCommand } from './itemCommands';
import { useHints, useItemCommands } from './triage';
import { KeyHint } from './KeyHint';
import type { AttentionItem, OpenTarget } from './types';
import type { ThreadSummary } from './useAttentionSummaries';

/** Long unbroken tokens (ids, paths) wrap instead of pushing the plate wider than the screen. */
const WRAP = '[overflow-wrap:anywhere]';

function excerpt(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}...` : trimmed;
}

/** "Run finished at 06:52", in words that never claim the work was checked. */
function runLine(item: AttentionItem): string | null {
  const { runStatus, runEndedAt } = item.detail;
  if (!runStatus || item.kind === 'task-failed') return null;
  const at = runEndedAt !== undefined ? ` at ${formatClock(runEndedAt)}` : '';
  switch (runStatus) {
    case 'done':
      return `Run finished${at}`;
    case 'error':
      return `Run failed${at}`;
    case 'aborted':
      return `Run aborted${at}`;
    case 'running':
      return 'Run still running';
  }
}

/**
 * What happened in the item's thread, from the summaries endpoint, in full. Nothing shows until
 * the server has answered for the session, and nothing on an error or an empty thread. A summary
 * being refreshed keeps its old text.
 */
export function WhatHappened({ summary }: { summary?: ThreadSummary }) {
  if (!summary) return null;
  if (summary.text) {
    return <p className="m-0 max-w-[72ch] text-[0.933rem] leading-relaxed text-foreground">{summary.text}</p>;
  }
  if (summary.status !== 'pending') return null;
  return (
    <p className="m-0 text-[0.867rem] leading-relaxed text-muted-foreground" aria-busy="true">
      Summarizing...
    </p>
  );
}

/** An exec approval's full command, where it would run, which session asks, and the gateway's warning. */
export function CommandBlock({ item }: { item: AttentionItem }) {
  const { command, cwd, host, warning, sessionName } = item.detail;
  if (!command) return null;
  const where = [cwd ? `in ${cwd}` : '', host ? `on ${host}` : '', sessionName ? `from ${sessionName}` : ''].filter(Boolean).join(' ');
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', WRAP)}>
      <pre className="m-0 whitespace-pre-wrap rounded-[3px] bg-background px-2.5 py-2 font-mono text-[0.8rem] leading-relaxed text-foreground">{command}</pre>
      {where && <p className="m-0 font-mono text-[0.733rem] text-muted-foreground">{where}</p>}
      {warning && <p className="m-0 text-[0.8rem] text-foreground">{warning}</p>}
    </div>
  );
}

/**
 * The item's own evidence: the result text, pull request links in its result and notes, the run
 * line and its run session. Nothing at all when it carries none.
 */
export function Evidence({
  item,
  compact,
  onOpen,
  max = 600,
}: {
  item: AttentionItem;
  compact: boolean;
  onOpen: (target: OpenTarget) => void;
  max?: number;
}) {
  const { detail } = item;
  const run = runLine(item);
  const sessionKey = item.kind !== 'approval' && item.open?.type !== 'session' ? detail.sessionKey : undefined;
  const links = detail.links ?? [];
  const linkClass = cn(TEXT_BUTTON, compact && 'inline-flex min-h-11 items-center');
  if (!detail.result && links.length === 0 && !run && !sessionKey) return null;
  return (
    <div data-testid="attention-evidence" className={cn('flex min-w-0 flex-col gap-1.5', WRAP)}>
      {detail.result && (
        <p className="m-0 max-w-[72ch] whitespace-pre-wrap border-l-2 border-border pl-3 text-[0.867rem] leading-relaxed text-muted-foreground">
          {excerpt(detail.result, max)}
        </p>
      )}
      {(links.length > 0 || run || sessionKey) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {run && <span className="font-mono text-[0.8rem] tabular text-muted-foreground"><Clocked text={run} /></span>}
          {links.map((link) => (
            <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {link.label}
            </a>
          ))}
          {sessionKey && (
            <button type="button" onClick={() => onOpen({ type: 'session', key: sessionKey })} className={linkClass}>
              Run session
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The one line under a failure or proposal title that its source knows. */
export function ItemDetail({ item, full }: { item: AttentionItem; full?: boolean }) {
  const { detail } = item;
  if (detail.error && item.kind !== 'cron-recovered') {
    return (
      // Collapsed, the red pane already says failed; the one-line error stays quiet so a list of failures is not a wall of red.
      <p className={cn('m-0 font-mono text-[0.8rem]', full ? 'whitespace-pre-wrap break-words text-destructive' : 'truncate text-muted-foreground')}>
        {detail.error}
      </p>
    );
  }
  if (item.kind === 'cron-recovered' && detail.error && full) {
    return <p className="m-0 whitespace-pre-wrap break-words font-mono text-[0.8rem] text-muted-foreground">{detail.error}</p>;
  }
  return null;
}

interface StartHereProps {
  item: AttentionItem;
  view: ItemView;
  compact: boolean;
  onOpen: (target: OpenTarget) => void;
  /** Turns on the decision and its second action. Without it the warm button opens the source. */
  actions?: AttentionActionsConfig;
  /** Turns on Reply when the item has a session. */
  replies?: ReplyConfig;
  summary?: ThreadSummary;
}

/**
 * The top decision on a warm plate: the title with its agent, what happened in full, the
 * evidence, and one warm button. The decision is the warm button; Reject, Reply and Open are
 * text beside it, so the screen has exactly one filled control.
 */
export function StartHerePlate({ item, view, compact, onOpen, actions, replies, summary }: StartHereProps) {
  const state = useItemActions(item, actions);
  const { primary, secondary, more = [] } = state.actions;
  const reply = useItemReply(item, view, replies, onOpen);
  const hints = useHints(item.key) && !compact;
  const replyButton = reply.button(compact, hints);
  const open = item.open;
  const stale = freshnessNote(item);
  const pane = paneFor(item.kind);
  const confirmingStop = primary === 'stop' && state.confirming;

  useItemCommands(item.key, (command) => runItemCommand(command, {
    state,
    open: true,
    openSource: open ? () => onOpen(open) : undefined,
    reply,
  }));

  const openButton = open && (
    <button
      type="button"
      onClick={() => onOpen(open)}
      className={primary ? variantClass('text', compact) : cn(PRIMARY_BUTTON, compact ? 'min-h-11 w-full' : 'min-h-8')}
    >
      {openLabel(item)}
      <KeyHint show={hints} k="o" />
    </button>
  );

  return (
    <section
      aria-label="Start here"
      data-nav-key={item.key}
      data-nav-head=""
      tabIndex={-1}
      className={cn(
        'plate plate-operator flex min-w-0 flex-col gap-2.5 px-4 py-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        WRAP,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <Pane state={pane.state} label={pane.label} className="mt-[0.3rem] shrink-0" />
        <h3 className={cn('m-0 min-w-0 flex-1 font-semibold leading-snug text-foreground', compact ? 'text-[1.067rem]' : 'text-[1.133rem]', item.kind === 'approval' && 'font-mono text-[0.933rem]')}>
          {item.title}
        </h3>
        {view.ownerName && (
          <span
            className={cn('shrink-0 font-display font-semibold', view.hue ? 'name-hued' : 'text-foreground')}
            style={nameHueStyle(view.hue)}
          >
            {view.ownerName}
          </span>
        )}
      </div>
      <p className="m-0 flex flex-wrap items-center gap-x-1.5 text-[0.8rem] text-muted-foreground">
        <span>{kindWord(item)}</span>
        <span aria-hidden="true">·</span>
        <Clocked text={view.reason} />
        {stale && <span className="text-foreground">· {stale}</span>}
        {view.isNew && <NewTag />}
      </p>

      {item.kind === 'approval' && <CommandBlock item={item} />}
      <ItemDetail item={item} full />
      <WhatHappened summary={summary} />
      <Evidence item={item} compact={compact} onOpen={onOpen} max={480} />

      <div className="mt-0.5 flex flex-col gap-2">
        {/* The decision stays in sight while a note or reply is written under it. */}
        {confirmingStop ? (
          <StopConfirm state={state} compact={compact} />
        ) : (
          <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', compact && 'flex-col items-stretch')}>
            {primary ? <ActionButton state={state} action={primary} variant="primary" compact={compact} /> : openButton}
            {(secondary || more.length > 0 || replyButton || (primary && openButton)) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {secondary && <ActionButton state={state} action={secondary} variant="text" compact={compact} />}
                {more.map((action) => <ActionButton key={action} state={state} action={action} variant="text" compact={compact} />)}
                {replyButton}
                {primary && openButton}
              </div>
            )}
          </div>
        )}
        {state.noteOpen ? (
          <ChangesNote state={state} submitVariant="outline" compact={compact} />
        ) : reply.fieldOpen ? (
          reply.field(compact)
        ) : null}
        {state.error && <ActionError message={state.error} />}
        {reply.panel(compact)}
      </div>
    </section>
  );
}
