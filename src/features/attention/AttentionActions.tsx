/**
 * The controls behind an item's actions, in the brief's existing styles: the warm Send button
 * (Start here only), the quiet chip (cards and rows) and the underlined text button.
 * Every control is `relative z-10` so it sits above a card's full-card open hit area.
 */

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ActionId, ItemActionsState } from './useAttentionActions';

export const PRIMARY_BUTTON = 'send-btn relative z-10 inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[3px] border-none bg-primary px-3.5 text-[0.867rem] font-semibold text-primary-foreground transition-[filter] duration-[120ms] hover:brightness-110 disabled:cursor-default disabled:opacity-50 disabled:hover:brightness-100';
export const TEXT_BUTTON = 'relative z-10 cursor-pointer text-[0.867rem] text-foreground underline decoration-border underline-offset-4 hover:decoration-operator disabled:cursor-default disabled:opacity-50';
const CHIP_BUTTON = 'shell-chip relative z-10 shrink-0 cursor-pointer text-[0.8rem] disabled:cursor-default disabled:opacity-50';

type Variant = 'primary' | 'chip' | 'text';

function variantClass(variant: Variant, compact: boolean): string {
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
  return (
    <button
      type="button"
      disabled={state.isLocked(action)}
      onClick={(event) => {
        event.stopPropagation();
        state.begin(action);
      }}
      className={cn(variantClass(variant, compact), className)}
    >
      {state.labelOf(action)}
    </button>
  );
}

/** Stop's second step, in place of the Stop button. */
export function StopConfirm({ state, compact }: { state: ItemActionsState; compact: boolean }) {
  return (
    <span className="relative z-10 inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-[0.867rem] text-foreground">Stop run?</span>
      <button
        type="button"
        disabled={state.locked}
        onClick={(event) => {
          event.stopPropagation();
          void state.run('stop');
        }}
        className={variantClass('chip', compact)}
      >
        {state.busy === 'stop' ? state.labelOf('stop') : 'Confirm'}
      </button>
      <button
        type="button"
        disabled={state.locked}
        onClick={(event) => {
          event.stopPropagation();
          state.setConfirming(false);
        }}
        className={variantClass('text', compact)}
      >
        Cancel
      </button>
    </span>
  );
}

/** The Request changes note. The route needs a note, so Send waits for one. */
export function ChangesNote({
  state,
  submitVariant,
  compact,
}: {
  state: ItemActionsState;
  submitVariant: 'primary' | 'chip';
  compact: boolean;
}) {
  const close = () => {
    state.setNoteOpen(false);
    state.setNote('');
  };
  const ready = state.note.trim().length > 0;
  return (
    <form
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
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
        }}
        className={cn('cockpit-input', compact ? 'h-11' : 'h-[2.133rem]')}
      />
      <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', compact && submitVariant === 'primary' && 'flex-col items-stretch')}>
        <button
          type="submit"
          disabled={state.locked || !ready}
          className={variantClass(submitVariant, compact)}
        >
          {state.labelOf('request-changes')}
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
 * A card's action strip: the main action as a chip, a second one as text, and `trailing`
 * (Mark seen) at the right. Renders nothing when the item has neither.
 */
export function CardActions({
  state,
  trailing,
}: {
  state: ItemActionsState;
  trailing?: React.ReactNode;
}) {
  const { primary, secondary } = state.actions;
  if (!primary && !trailing) return null;

  if (state.noteOpen) {
    return (
      <div className="flex flex-col gap-2">
        <ChangesNote state={state} submitVariant="chip" compact={false} />
        {state.error && <ActionError message={state.error} />}
      </div>
    );
  }

  const confirmingStop = primary === 'stop' && state.confirming;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {confirmingStop && <StopConfirm state={state} compact={false} />}
        {primary && !confirmingStop && <ActionButton state={state} action={primary} variant="chip" compact={false} />}
        {secondary && !confirmingStop && <ActionButton state={state} action={secondary} variant="text" compact={false} />}
        <span className="flex-1" />
        {trailing}
      </div>
      {state.error && <ActionError message={state.error} />}
    </div>
  );
}
