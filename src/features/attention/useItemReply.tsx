/**
 * Reply on an item with a session, shared by cards, Start here and rows.
 */

import { useState } from 'react';
import { ReplyButton, ReplyField, ReplyPanel, type ReplyConfig } from './AttentionReply';
import { useComposerField } from './triage';
import { KeyHint } from './KeyHint';
import { useInlineReply } from './useInlineReplies';
import type { ItemView } from './itemPresentation';
import type { AttentionItem, OpenTarget } from './types';

/**
 * Reply on an item with a session: the collapsed text button, the field it opens, and the
 * reply under the item. Without `replies` or a session each part renders nothing. Rows use only
 * the panel, so a reply sent from a card still shows after its item turns into a row.
 *
 * On the board the field is one of its composers: opening it closes any other open field, its
 * draft is kept while it is closed, and closing it gives focus back to what opened it.
 */
export function useItemReply(
  item: AttentionItem,
  view: ItemView,
  replies: ReplyConfig | undefined,
  onOpen: (target: OpenTarget) => void,
) {
  const sessionKey = replies ? item.detail.sessionKey : undefined;
  const reply = useInlineReply(replies?.store, sessionKey, 'item');
  const [localOpen, setLocalOpen] = useState(false);
  const managed = useComposerField(item.key, 'reply');
  const open = managed ? managed.open : localOpen;
  const setOpen = (value: boolean) => {
    if (managed) managed.setOpen(value);
    else setLocalOpen(value);
  };
  // A task with no owner still runs as some agent: name the reply after its session's agent
  const name = view.ownerName ?? (sessionKey ? replies?.nameOf?.(sessionKey) : undefined);
  const enabled = Boolean(replies && sessionKey);
  return {
    enabled,
    fieldOpen: enabled && open,
    /** Opens the field (the keyboard's r); focus comes back to what has it now. */
    openField: () => setOpen(true),
    button: (compact: boolean, hints = false) => (replies && sessionKey ? (
      <ReplyButton
        config={replies}
        sessionKey={sessionKey}
        compact={compact}
        expanded={managed ? open : undefined}
        onClick={() => setOpen(!open)}
        hint={<KeyHint show={hints && !compact} k="r" />}
      />
    ) : null),
    field: (compact: boolean) => (replies && sessionKey ? (
      <ReplyField
        config={replies}
        sessionKey={sessionKey}
        name={name}
        compact={compact}
        onClose={() => setOpen(false)}
        draft={managed?.draft}
        onDraftChange={managed?.setDraft}
      />
    ) : null),
    panel: (compact: boolean, className?: string) => (replies && reply ? (
      <ReplyPanel
        reply={reply}
        name={name}
        hue={view.hue}
        compact={compact}
        onOpen={onOpen}
        onDismiss={() => replies.store.dismiss(reply.sessionKey)}
        className={className}
      />
    ) : null),
  };
}
