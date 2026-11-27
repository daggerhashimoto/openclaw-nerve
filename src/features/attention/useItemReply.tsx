/**
 * Reply on an item with a session, shared by cards, Start here and rows.
 */

import { useState } from 'react';
import { ReplyButton, ReplyField, ReplyPanel, type ReplyConfig } from './AttentionReply';
import { useInlineReply } from './useInlineReplies';
import type { ItemView } from './itemPresentation';
import type { AttentionItem, OpenTarget } from './types';

/**
 * Reply on an item with a session: the collapsed text button, the field it opens, and the
 * reply under the item. Without `replies` or a session each part renders nothing. Rows use only
 * the panel, so a reply sent from a card still shows after its item turns into a row.
 */
export function useItemReply(
  item: AttentionItem,
  view: ItemView,
  replies: ReplyConfig | undefined,
  onOpen: (target: OpenTarget) => void,
) {
  const sessionKey = replies ? item.detail.sessionKey : undefined;
  const reply = useInlineReply(replies?.store, sessionKey, 'item');
  const [open, setOpen] = useState(false);
  // A task with no owner still runs as some agent: name the reply after its session's agent
  const name = view.ownerName ?? (sessionKey ? replies?.nameOf?.(sessionKey) : undefined);
  const enabled = Boolean(replies && sessionKey);
  return {
    fieldOpen: enabled && open,
    button: (compact: boolean) => (replies && sessionKey ? (
      <ReplyButton config={replies} sessionKey={sessionKey} compact={compact} onClick={() => setOpen(true)} />
    ) : null),
    field: (compact: boolean) => (replies && sessionKey ? (
      <ReplyField
        config={replies}
        sessionKey={sessionKey}
        name={name}
        compact={compact}
        onClose={() => setOpen(false)}
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
