/** Shared words for Attention rows: the kind word, the pane each kind lights, and the per-item view data. */

import type { PaneState } from '@/lib/paneState';
import type { AttentionItem, AttentionKind } from './types';

export const KIND_WORD: Record<AttentionKind, string> = {
  approval: 'Approval',
  review: 'Review',
  proposal: 'Proposal',
  'task-failed': 'Run failed',
  'gone-quiet': 'Gone quiet',
  'cron-failed': 'Cron failed',
  'session-failed': 'Session failed',
  'task-running': 'Running',
  'session-running': 'Session running',
  'task-finished': 'Run finished',
  'cron-recovered': 'Cron recovered',
};

/** Decisions wait on the operator, failures are red, running is blue, finished history is dark. */
export function paneFor(kind: AttentionKind): { state: PaneState; label: string } {
  switch (kind) {
    case 'approval':
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
    case 'cron-recovered':
      return { state: 'off', label: 'Finished' };
  }
}

/** "Open review", "Open proposal": the explicit way to the item's source. */
export function openLabel(item: AttentionItem): string {
  switch (item.open?.type) {
    case 'task':
      return item.kind === 'review' ? 'Open review' : 'Open task';
    case 'proposal':
      return 'Open proposal';
    case 'cron':
      return 'Open cron';
    case 'session':
      return 'Open in chat';
    default:
      return 'Open';
  }
}

/** Freshness is said only when it is not the default: a stale item reads "stale". */
export function freshnessNote(item: AttentionItem): string | null {
  return item.freshness === 'live' ? null : item.freshness;
}

/** Per-item display data the view computes once and hands to rows and the plate. */
export interface ItemView {
  reason: string;
  ownerName?: string;
  hue?: string;
  isNew: boolean;
}
