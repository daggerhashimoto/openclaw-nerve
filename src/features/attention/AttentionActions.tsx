/**
 * The controls behind an item's actions, in the board's tiers: the warm button (Start here
 * only), the outline button (a row's main action) and muted underlined text (the rest).
 */

import { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { variantClass, type Variant } from './actionStyles';
import { InlineUndo } from './Receipts';
import { focusNavItem, useEscapeWithin, useHints, useTriage } from './triage';
import { KeyHint } from './KeyHint';
import { KEY_FOR_ACTION, type ActionId, type ItemActionsState } from './useAttentionActions';

/** One action as a button. The label follows the request: "Approve", "Approving...", "Approved". */
export function ActionButton({
  state,
  action,
  variant,
  compact,
  className,
}: {
  state: ItemActionsState;
  action: ActionId;
  variant: Variant;
  compact: boolean;
  className?: string;
}) {
  const hints = useHints(state.itemKey);
  const triage = useTriage();
  // Where the item stays in place during its undo window (Today), the button gives way to Undo.
  if (state.pending?.action === action && triage) {
    return <InlineUndo entry={state.pending} compact={compact} onUndo={triage.undo} />;
  }
  return (
    <button
      type="button"
      disabled={state.isLocked(action)}
      aria-expanded={action === 'request-changes' ? state.noteOpen : undefined}
      onClick={(event) => {
        event.stopPropagation();
        // Request changes toggles its note, as Reply toggles its field.
        if (action === 'request-changes' && state.noteOpen) state.setNoteOpen(false);
        else state.begin(action);
      }}
      className={cn(variantClass(variant, compact), className)}
    >
      {state.labelOf(action)}
      <KeyHint show={hints && !compact} k={KEY_FOR_ACTION[action]} />
    </button>
  );
}

/** Stop's second step, in place of the Stop button. */
export function StopConfirm({ state, compact }: { state: ItemActionsState; compact: boolean }) {
  const hints = useHints(state.itemKey);
  return (
    <span className="relative z-10 inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-[0.867rem] text-foreground">Stop run?</span>
      <button
        type="button"
        disabled={state.locked}
        // Stop is replaced by its confirm, so the confirm takes the focus Stop had.
        autoFocus
        onClick={(event) => {
          event.stopPropagation();
          void state.run('stop');
        }}
        className={variantClass('outline', compact)}
      >
        {state.busy === 'stop' ? state.labelOf('stop') : 'Confirm'}
        <KeyHint show={hints && !compact} k="s" />
      </button>
      <button
        type="button"
        disabled={state.locked}
        onClick={(event) => {
          event.stopPropagation();
          state.setConfirming(false);
          focusNavItem(document, state.itemKey);
        }}
        className={variantClass('text', compact)}
      >
        Cancel
      </button>
    </span>
  );
}

/**
 * The Request changes note. The route needs a note, so Send waits for one. Cancel and Escape
 * close it and give focus back to what opened it; Send turns the item into its receipt.
 */
export function ChangesNote({
  state,
  submitVariant,
  compact,
}: {
  state: ItemActionsState;
  submitVariant: 'primary' | 'outline';
  compact: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const close = () => {
    state.setNote('');
    state.setNoteOpen(false);
  };
  useEscapeWithin(formRef, close);
  const ready = state.note.trim().length > 0;
  return (
    <form
      ref={formRef}
      className="relative z-10 flex w-full flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) void state.run('request-changes');
      }}
    >
      <Input
        aria-label="What needs to change"
        placeholder="What needs to change"
        value={state.note}
        disabled={state.locked}
        maxLength={5000}
        autoFocus
        onChange={(event) => state.setNote(event.target.value)}
        className={cn('cockpit-input', compact ? 'h-11' : 'h-[2.133rem]')}
      />
      <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', compact && submitVariant === 'primary' && 'flex-col items-stretch')}>
        <button
          type="submit"
          disabled={state.locked || !ready}
          className={variantClass(submitVariant, compact)}
        >
          {state.busy === 'request-changes' ? state.labelOf('request-changes') : 'Send'}
        </button>
        <button type="button" disabled={state.locked} onClick={close} className={variantClass('text', compact)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ActionError({ message, className }: { message: string; className?: string }) {
  return (
    <p role="alert" className={cn('m-0 break-words font-mono text-[0.8rem] text-destructive', className)}>
      {message}
    </p>
  );
}

/**
 * An item's full action set where it opens in full: the main action as an outline button, the
 * second and any further ones as text, `extra` (Reply, Open) after them and `trailing` (Mark
 * seen) at the right. Stop's confirm takes the strip's place; the Request changes note and
 * `field` (an open Reply) sit under it, so the item's actions stay in sight while writing.
 */
export function ActionStrip({
  state,
  compact,
  extra,
  trailing,
  field,
}: {
  state: ItemActionsState;
  compact: boolean;
  extra?: React.ReactNode;
  trailing?: React.ReactNode;
  field?: React.ReactNode;
}) {
  const { primary, secondary, more = [] } = state.actions;
  const confirmingStop = primary === 'stop' && state.confirming;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {confirmingStop && <StopConfirm state={state} compact={compact} />}
        {!confirmingStop && (
          <>
            {primary && <ActionButton state={state} action={primary} variant="outline" compact={compact} />}
            {secondary && <ActionButton state={state} action={secondary} variant="text" compact={compact} />}
            {more.map((action) => <ActionButton key={action} state={state} action={action} variant="text" compact={compact} />)}
            {extra}
          </>
        )}
        {trailing && <span className="flex-1" />}
        {trailing}
      </div>
      {state.noteOpen && <ChangesNote state={state} submitVariant="outline" compact={compact} />}
      {!state.noteOpen && field}
      {state.error && <ActionError message={state.error} />}
    </div>
  );
}
