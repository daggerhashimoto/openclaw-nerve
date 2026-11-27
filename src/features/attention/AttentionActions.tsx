/**
 * The controls behind an item's actions, in the brief's existing styles: the warm Send button
 * (Start here only), the quiet chip (cards and rows) and the underlined text button.
 * Every control is `relative z-10` so it sits above a card's full-card open hit area.
 */

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { variantClass, type Variant } from './actionStyles';
import type { ActionId, ItemActionsState } from './useAttentionActions';

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
 * A card's action strip: the main action as a chip, a second one as text, `extra` (Reply)
 * after them, and `trailing` (Mark seen) at the right. Renders nothing when the item has none.
 */
export function CardActions({
  state,
  extra,
  trailing,
}: {
  state: ItemActionsState;
  extra?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const { primary, secondary } = state.actions;
  if (!primary && !extra && !trailing) return null;

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
        {!confirmingStop && extra}
        <span className="flex-1" />
        {trailing}
      </div>
      {state.error && <ActionError message={state.error} />}
    </div>
  );
}
