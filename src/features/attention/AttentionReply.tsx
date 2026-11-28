/**
 * Prompting from the brief: the board's own box (to the main agent's main session), the Reply
 * field on items that have a session, and the reply shown under either while it streams.
 * Everything here is `relative z-10` so it sits above a card's full-card open hit area.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { Pane } from '@/components/ui/Pane';
import { nameHueStyle } from '@/lib/agentColors';
import { sanitizeHtml } from '@/lib/sanitize';
import { cn } from '@/lib/utils';
import { renderMarkdown } from '@/utils/helpers';
import { formatClock } from './briefCopy';
import { ActionError } from './AttentionActions';
import { TEXT_BUTTON, variantClass } from './actionStyles';
import {
  useInlineReply,
  useReplyBusy,
  type InlineReplies,
  type InlineReply,
  type ReplyOrigin,
} from './useInlineReplies';
import type { OpenTarget } from './types';

/** What the brief hands its surfaces to prompt with. */
export interface ReplyConfig {
  store: InlineReplies;
  connected: boolean;
  /** The socket is on its way up (every page load starts here); not an outage. */
  connecting: boolean;
  /** The display name of the agent a session belongs to, for items with no owner of their own. */
  nameOf?: (sessionKey: string) => string | undefined;
}

/** The board box grows to about eight lines, the Reply field to about five, then scrolls. */
const BOX_MAX_PX = 200;
const FIELD_MAX_PX = 128;

/**
 * A draft that sends on Enter and takes a newline on Shift+Enter, as the Chat input does
 * (Cmd or Ctrl+Enter also sends). The textarea grows with its text up to `maxPx`.
 */
function useComposer(maxPx: number, onSubmit: (text: string) => boolean) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
  }, [draft, maxPx]);

  const submit = () => {
    if (onSubmit(draft)) setDraft('');
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Composition keys belong to the IME; acting on them sends half-typed text.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && (!event.shiftKey || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };

  return { draft, setDraft, inputRef, submit, onKeyDown };
}

/** A send is possible: connected, a target, text, and nothing in flight to that session. */
function canSend(config: ReplyConfig | undefined, sessionKey: string | undefined, busy: boolean, draft: string) {
  return Boolean(config?.connected && sessionKey && !busy && draft.trim());
}

function startSend(config: ReplyConfig | undefined, sessionKey: string | undefined, busy: boolean, text: string, origin: ReplyOrigin) {
  if (!config || !sessionKey || !canSend(config, sessionKey, busy, text)) return false;
  void config.store.send(sessionKey, text, origin);
  return true;
}

export interface AskTarget {
  sessionKey: string;
  /** The agent's display name, when it has one. */
  name?: string;
  hue?: string;
}

/**
 * The board's own input: an operator window at the top of the brief that sends to the main
 * agent's main session, with its reply right under it.
 */
export function AskBox({
  config,
  target,
  loading,
  compact,
  onOpen,
}: {
  config: ReplyConfig;
  target: AskTarget | null;
  /** Sessions have not loaded yet, so there is no target to name. */
  loading: boolean;
  compact: boolean;
  onOpen: (target: OpenTarget) => void;
}) {
  const sessionKey = target?.sessionKey;
  const busy = useReplyBusy(config.store, sessionKey);
  const reply = useInlineReply(config.store, sessionKey, 'board');
  const { draft, setDraft, inputRef, submit, onKeyDown } = useComposer(
    BOX_MAX_PX,
    (text) => startSend(config, sessionKey, busy, text, 'board'),
  );
  const ready = canSend(config, sessionKey, busy, draft);

  const name = target?.name;
  const placeholder = name ? `Ask ${name}...` : 'Ask the agent...';
  let status: string;
  if (!target) status = loading ? 'Loading agents' : 'No agent to ask yet';
  else if (!config.connected) status = config.connecting ? 'Connecting' : 'Not connected';
  else if (busy) status = name ? `Waiting for ${name}` : 'Waiting for the reply';
  else status = name ? `${name}, main session` : 'Main session';

  return (
    <section aria-label="Ask the agent" className={cn('flex max-w-[90ch] flex-col gap-2', compact && 'px-3')}>
      <form
        className="nerve-window-frame"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="nerve-window rounded-[3px]">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            placeholder={placeholder}
            aria-label={placeholder.slice(0, -3)}
            maxLength={20000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            className={cn(
              'block w-full resize-none border-0 bg-transparent px-3 pb-1 pt-2.5 leading-[1.55] text-foreground outline-none placeholder:text-muted-foreground',
              // Phones get 16px so focusing the box does not zoom the page.
              compact ? 'text-[16px]' : 'text-[0.867rem]',
            )}
          />
          <div className="flex items-center gap-3 px-3 pb-2 pt-1">
            <span className="flex min-w-0 items-center gap-2 text-[0.8rem] text-muted-foreground">
              <Pane state="off" size="sm" className="nerve-window-pane" />
              <span className="truncate" role="status">{status}</span>
            </span>
            <span className="flex-1" />
            {!compact && (
              <span className="flex shrink-0 items-center gap-1.5 text-[0.8rem] text-muted-foreground">
                <kbd className="cockpit-kbd">Enter</kbd>
                <span>send</span>
              </span>
            )}
            <button type="submit" disabled={!ready} className={variantClass('chip', compact)}>
              Send
            </button>
          </div>
        </div>
      </form>
      {reply && (
        <ReplyPanel
          reply={reply}
          name={name}
          hue={target?.hue}
          compact={compact}
          onOpen={onOpen}
          onDismiss={() => config.store.dismiss(reply.sessionKey)}
        />
      )}
    </section>
  );
}

/** The collapsed Reply on an item; it opens the field, as Request changes opens its note. */
export function ReplyButton({
  config,
  sessionKey,
  compact,
  onClick,
  label = 'Reply',
}: {
  config: ReplyConfig;
  sessionKey: string;
  compact: boolean;
  onClick: () => void;
  /** The Today digest says Nudge, or Ask <parent> for a finished subagent. */
  label?: string;
}) {
  const busy = useReplyBusy(config.store, sessionKey);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={variantClass('text', compact)}
    >
      {label}
    </button>
  );
}

/** The open Reply field on an item: sends into the item's own session, then closes. */
export function ReplyField({
  config,
  sessionKey,
  name,
  compact,
  onClose,
  context,
  verb = 'Reply to',
  onSent,
}: {
  config: ReplyConfig;
  sessionKey: string;
  name?: string;
  compact: boolean;
  onClose: () => void;
  /** A line sent ahead of the operator's text, so the agent knows what the message is about. */
  context?: string;
  /** Placeholder verb: "Reply to", "Nudge", "Ask". */
  verb?: string;
  onSent?: () => void;
}) {
  const busy = useReplyBusy(config.store, sessionKey);
  const { draft, setDraft, inputRef, submit, onKeyDown } = useComposer(FIELD_MAX_PX, (text) => {
    const message = context && text.trim() ? `${context}\n\n${text.trim()}` : text;
    const sent = startSend(config, sessionKey, busy, message, 'item');
    if (sent) {
      onSent?.();
      onClose();
    }
    return sent;
  });
  const ready = canSend(config, sessionKey, busy, draft);
  const placeholder = name ? `${verb} ${name}...` : `${verb} the agent...`;

  return (
    <form
      className="relative z-10 flex w-full flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={inputRef}
        rows={1}
        autoFocus
        value={draft}
        placeholder={placeholder}
        aria-label={placeholder.slice(0, -3)}
        maxLength={20000}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onClose();
            return;
          }
          onKeyDown(event);
        }}
        className={cn(
          'cockpit-input block resize-none py-1.5! leading-[1.55]',
          compact ? 'min-h-11!' : 'min-h-[2.133rem]',
        )}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="submit" disabled={!ready} className={variantClass('chip', compact)}>
          Send
        </button>
        <button type="button" onClick={onClose} className={variantClass('text', compact)}>
          Cancel
        </button>
        {!config.connected && (
          <span className="text-[0.8rem] text-muted-foreground">{config.connecting ? 'Connecting' : 'Not connected'}</span>
        )}
      </div>
    </form>
  );
}

/** The reply body: the assistant's markdown, capped in height, following the end while it streams. */
function ReplyBody({ text, working }: { text: string; working: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // Follows the end until the operator scrolls up to read.
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && working && stick.current) el.scrollTop = el.scrollHeight;
  }, [text, working]);

  return (
    <div
      ref={ref}
      onScroll={(event) => {
        const el = event.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className="msg-body max-h-72 overflow-y-auto text-[0.867rem]! leading-relaxed! text-foreground"
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(renderMarkdown(text)) }}
    />
  );
}

/** A reply under the box or an item: who, its state, what was asked, the text, and the way to Chat. */
export function ReplyPanel({
  reply,
  name,
  hue,
  compact,
  onOpen,
  onDismiss,
  className,
}: {
  reply: InlineReply;
  name?: string;
  hue?: string;
  compact: boolean;
  onOpen: (target: OpenTarget) => void;
  onDismiss: () => void;
  className?: string;
}) {
  const working = reply.status === 'working';
  const pane = working ? 'live' : reply.status === 'error' ? 'error' : 'off';
  let stateWord: React.ReactNode = null;
  if (working) stateWord = reply.text ? 'Writing' : 'Working';
  else if (reply.status === 'done' && reply.endedAt !== undefined) {
    stateWord = <>Replied at <span className="font-mono tabular">{formatClock(reply.endedAt)}</span></>;
  }

  const linkClass = cn(TEXT_BUTTON, 'text-[0.8rem]', compact && 'min-h-11');

  return (
    <div
      data-testid="inline-reply"
      className={cn('relative z-10 flex min-w-0 flex-col gap-1.5 border-l-2 border-border pl-3', className)}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.8rem]">
        <Pane state={pane} size="sm" hue={pane === 'off' ? hue : undefined} label={reply.status === 'error' ? 'Failed' : undefined} />
        <span className={cn('font-medium', hue ? 'name-hued' : 'text-foreground')} style={nameHueStyle(hue)}>
          {name ?? 'Agent'}
        </span>
        {stateWord && (
          <span role="status" className={working ? 'text-live-text' : 'text-muted-foreground'}>
            {stateWord}
          </span>
        )}
        <span className="flex-1" />
        <button type="button" onClick={() => onOpen({ type: 'session', key: reply.sessionKey })} className={linkClass}>
          Open in chat
        </button>
        {!working && (
          <button type="button" onClick={onDismiss} className={linkClass}>
            Dismiss
          </button>
        )}
      </div>
      <p className="m-0 truncate text-[0.8rem] text-muted-foreground" title={reply.prompt}>
        {`You: ${reply.prompt}`}
      </p>
      {reply.text && <ReplyBody text={reply.text} working={working} />}
      {reply.status === 'done' && !reply.text && (
        <p className="m-0 text-[0.867rem] text-muted-foreground">No reply text. Open in chat to see the session.</p>
      )}
      {reply.error && <ActionError message={reply.error} />}
    </div>
  );
}

