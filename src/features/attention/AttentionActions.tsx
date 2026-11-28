/**
 * The controls behind an item's actions, in the board's tiers: the warm button (Start here
 * only), the outline button (a row's main action) and muted underlined text (the rest).
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
        className={variantClass('outline', compact)}
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
  submitVariant: 'primary' | 'outline';
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
 * An item's full action set where it opens in full: the main action as an outline button, the
 * second and any further ones as text, `extra` (Reply, Open) after them and `trailing` (Mark
 * seen) at the right. Stop's confirm and Request changes' note take the strip's place.
 */
export function ActionStrip({
  state,
  compact,
  extra,
  trailing,
}: {
  state: ItemActionsState;
  compact: boolean;
  extra?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const { primary, secondary, more = [] } = state.actions;

  if (state.noteOpen) {
    return (
      <div className="flex flex-col gap-2">
        <ChangesNote state={state} submitVariant="outline" compact={compact} />
        {state.error && <ActionError message={state.error} />}
      </div>
    );
  }

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
      {state.error && <ActionError message={state.error} />}
    </div>
  );
}
