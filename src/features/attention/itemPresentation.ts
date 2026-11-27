/** Shared words for Attention cards and rows: the kind word, the pane each kind lights, the source tag. */

import type { PaneState } from '@/lib/paneState';
import type { AttentionItem, AttentionKind } from './types';

export const KIND_WORD: Record<AttentionKind, string> = {
  review: 'Review',
  proposal: 'Proposal',
  'task-failed': 'Run failed',
  'gone-quiet': 'Gone quiet',
  'cron-failed': 'Cron failed',
  'session-failed': 'Session failed',
  'task-running': 'Running',
  'session-running': 'Session running',
  'task-finished': 'Run finished',
  'cron-finished': 'Cron finished',
};

/** Review and proposal wait on the operator, failures are red, running is blue, the rest is dark. */
export function paneFor(kind: AttentionKind): { state: PaneState; label: string } {
  switch (kind) {
    case 'review':
    case 'proposal':
      return { state: 'operator', label: 'Waiting on you' };
    case 'task-failed':
    case 'cron-failed':
    case 'session-failed':
      return { state: 'error', label: 'Failed' };
    case 'gone-quiet':
      return { state: 'off', label: 'Gone quiet' };
    case 'task-running':
    case 'session-running':
      return { state: 'live', label: 'Running' };
    case 'task-finished':
    case 'cron-finished':
      return { state: 'off', label: 'Finished' };
  }
}

/** Where the card came from and how fresh that source is: "tasks · live". */
export function sourceTag(item: AttentionItem): string {
  return `${item.source} · ${item.freshness}`;
}

/** The reason line with the owner named: reasons that do not say who get "owner · " in front. */
export function ownedReason(reason: string, ownerName?: string): string {
  if (!ownerName || reason.includes(ownerName)) return reason;
  return `${ownerName} · ${reason}`;
}

/** Per-item display data the view computes once and hands to cards and rows. */
export interface ItemView {
  reason: string;
  ownerName?: string;
  hue?: string;
  isNew: boolean;
}
