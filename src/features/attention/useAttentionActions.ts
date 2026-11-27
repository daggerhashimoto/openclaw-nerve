/**
 * The actions an Attention item offers and the requests behind them. These are the only writes
 * the brief makes; the polling hook stays read-only. Request shapes match useKanban,
 * useProposals and useCrons for the same endpoints.
 */

import { useState } from 'react';
import type { AttentionItem } from './types';

export type ActionId =
  | 'approve'
  | 'request-changes'
  | 'approve-proposal'
  | 'reject-proposal'
  | 'retry'
  | 'stop'
  | 'run-cron'
  | 'pause-cron';

interface ActionCopy {
  label: string;
  pending: string;
  done: string;
  /** Lower case, for "Could not approve: ...". */
  verb: string;
}

export const ACTION_COPY: Record<ActionId, ActionCopy> = {
  approve: { label: 'Approve', pending: 'Approving...', done: 'Approved', verb: 'approve' },
  'request-changes': { label: 'Request changes', pending: 'Sending...', done: 'Changes requested', verb: 'request changes' },
  'approve-proposal': { label: 'Approve', pending: 'Approving...', done: 'Approved', verb: 'approve' },
  'reject-proposal': { label: 'Reject', pending: 'Rejecting...', done: 'Rejected', verb: 'reject' },
  retry: { label: 'Retry', pending: 'Retrying...', done: 'Started', verb: 'retry' },
  stop: { label: 'Stop', pending: 'Stopping...', done: 'Stopped', verb: 'stop' },
  'run-cron': { label: 'Run now', pending: 'Starting...', done: 'Started', verb: 'run' },
  'pause-cron': { label: 'Pause', pending: 'Pausing...', done: 'Paused', verb: 'pause' },
};

export interface ItemActionSet {
  primary: ActionId | null;
  secondary: ActionId | null;
}

const NONE: ItemActionSet = { primary: null, secondary: null };

/** What the operator can do to an item from the brief. Sessions and finishes have no actions yet. */
export function actionsFor(item: AttentionItem, kanbanEnabled: boolean): ItemActionSet {
  switch (item.kind) {
    case 'review':
      return kanbanEnabled ? { primary: 'approve', secondary: 'request-changes' } : NONE;
    case 'proposal':
      return kanbanEnabled ? { primary: 'approve-proposal', secondary: 'reject-proposal' } : NONE;
    case 'task-failed':
      return kanbanEnabled ? { primary: 'retry', secondary: null } : NONE;
    case 'task-running':
    case 'gone-quiet':
      return kanbanEnabled ? { primary: 'stop', secondary: null } : NONE;
    case 'cron-failed':
      // The brief only lists enabled crons, so Pause always disables.
      return { primary: 'run-cron', secondary: 'pause-cron' };
    default:
      return NONE;
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function kanbanPost(url: string, body?: unknown): Promise<void> {
  const init: RequestInit = body === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) };
  const res = await fetch(url, init);
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { details?: string; error?: string };
    throw new Error(data.details || data.error || `HTTP ${res.status}`);
  }
}

async function cronPost(url: string, body?: unknown): Promise<void> {
  const init: RequestInit = body === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) };
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
}

/** Sends one action to the item's source. Throws with the server's error text on failure. */
export async function postAction(item: AttentionItem, action: ActionId, note?: string): Promise<void> {
  const id = encodeURIComponent(item.sourceId);
  const trimmed = note?.trim();
  switch (action) {
    case 'approve':
      return kanbanPost(`/api/kanban/tasks/${id}/approve`, trimmed ? { note: trimmed } : {});
    case 'request-changes':
      if (!trimmed) throw new Error('A note is required');
      return kanbanPost(`/api/kanban/tasks/${id}/reject`, { note: trimmed });
    case 'approve-proposal':
      return kanbanPost(`/api/kanban/proposals/${id}/approve`);
    case 'reject-proposal':
      return kanbanPost(`/api/kanban/proposals/${id}/reject`, trimmed ? { reason: trimmed } : {});
    case 'retry':
      return kanbanPost(`/api/kanban/tasks/${id}/execute`, {});
    case 'stop':
      return kanbanPost(`/api/kanban/tasks/${id}/abort`, {});
    case 'run-cron':
      return cronPost(`/api/crons/${id}/run`);
    case 'pause-cron':
      // The route reads `enabled` from the body and treats a missing body as enabling.
      return cronPost(`/api/crons/${id}/toggle`, { enabled: false });
  }
}

export interface ItemActionsState {
  actions: ItemActionSet;
  /** The action whose request is running. */
  busy: ActionId | null;
  /** The action that succeeded; its item leaves or changes on the next refresh. */
  done: ActionId | null;
  error: string | null;
  /** No request may start: one is running or one already succeeded. */
  locked: boolean;
  /** This action may not start. After Run now only Run now stays locked, so Pause still works. */
  isLocked: (action: ActionId) => boolean;
  /** Stop is waiting for its confirm. */
  confirming: boolean;
  setConfirming: (value: boolean) => void;
  /** The Request changes note field is open. */
  noteOpen: boolean;
  setNoteOpen: (value: boolean) => void;
  note: string;
  setNote: (value: string) => void;
  run: (action: ActionId) => Promise<void>;
  /** A click on an action: Stop asks to confirm, Request changes opens its note, the rest run. */
  begin: (action: ActionId) => void;
  labelOf: (action: ActionId) => string;
}

export interface AttentionActionsConfig {
  kanbanEnabled: boolean;
  /** Called after a request succeeds, to re-read the sources. */
  onDone: () => void;
}

/**
 * Per-item action state. The caller keys its component by `item.key`, so a new item (or the
 * same task in a new state) starts clean. After a success the buttons stay locked until the
 * refreshed brief moves or drops the item, so a second click cannot race the poll. Run now is
 * the exception: the cron stays listed until its run reports, so only Run now stays locked.
 */
export function useItemActions(item: AttentionItem, config: AttentionActionsConfig | undefined): ItemActionsState {
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [done, setDone] = useState<ActionId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  const actions = config ? actionsFor(item, config.kanbanEnabled) : NONE;
  // Run now leaves the cron failed until its run reports, so the item stays under the same key.
  const locked = busy !== null || (done !== null && done !== 'run-cron');
  const isLocked = (action: ActionId) => locked || done === action;

  const run = async (action: ActionId) => {
    if (isLocked(action) || !config) return;
    setBusy(action);
    setError(null);
    try {
      await postAction(item, action, action === 'request-changes' ? note : undefined);
      setDone(action);
      setConfirming(false);
      setNoteOpen(false);
      config.onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Could not ${ACTION_COPY[action].verb}: ${message}`);
    } finally {
      setBusy(null);
    }
  };

  const begin = (action: ActionId) => {
    if (isLocked(action)) return;
    if (action === 'stop') {
      setConfirming(true);
    } else if (action === 'request-changes') {
      setError(null);
      setNoteOpen(true);
    } else {
      void run(action);
    }
  };

  const labelOf = (action: ActionId) => {
    const copy = ACTION_COPY[action];
    if (busy === action) return copy.pending;
    if (done === action) return copy.done;
    return copy.label;
  };

  return {
    actions,
    busy,
    done,
    error,
    locked,
    isLocked,
    confirming,
    setConfirming,
    noteOpen,
    setNoteOpen,
    note,
    setNote,
    run,
    begin,
    labelOf,
  };
}
