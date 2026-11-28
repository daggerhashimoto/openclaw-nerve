/**
 * The actions an Attention item offers and the requests behind them. These are the only writes
 * the brief makes; the polling hook stays read-only. Request shapes match useKanban,
 * useProposals and useCrons for the same endpoints.
 */

import { useState, useSyncExternalStore } from 'react';
import { resolveApproval, type ApprovalDecision } from './execApprovals';
import type { DeferredActions, PendingAction } from './deferredActions';
import { useComposerField } from './triage';
import type { AttentionItem } from './types';

export type ActionId =
  | 'approve'
  | 'request-changes'
  | 'approve-proposal'
  | 'reject-proposal'
  | 'retry'
  | 'stop'
  | 'run-cron'
  | 'pause-cron'
  | 'allow-once'
  | 'allow-always'
  | 'deny';

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
  'allow-once': { label: 'Allow', pending: 'Allowing...', done: 'Allowed', verb: 'allow' },
  'allow-always': { label: 'Allow always', pending: 'Allowing...', done: 'Allowed always', verb: 'allow always' },
  deny: { label: 'Deny', pending: 'Denying...', done: 'Denied', verb: 'deny' },
};

/** The board's keyboard shortcut for each action, shown as a faint keycap at the desk. */
export const KEY_FOR_ACTION: Partial<Record<ActionId, string>> = {
  approve: 'a',
  'approve-proposal': 'a',
  'allow-once': 'a',
  retry: 'a',
  'run-cron': 'a',
  'reject-proposal': 'x',
  deny: 'x',
  'request-changes': 'c',
  'pause-cron': 'p',
  stop: 's',
};

const APPROVAL_DECISIONS: Partial<Record<ActionId, ApprovalDecision>> = {
  'allow-once': 'allow-once',
  'allow-always': 'allow-always',
  deny: 'deny',
};

export interface ItemActionSet {
  primary: ActionId | null;
  secondary: ActionId | null;
  /** Further choices, shown only where the item opens in full (an approval's Allow always). */
  more?: ActionId[];
}

const NONE: ItemActionSet = { primary: null, secondary: null };

/** What the operator can do to an item from the brief. Sessions and finishes have no actions yet. */
export function actionsFor(item: AttentionItem, kanbanEnabled: boolean): ItemActionSet {
  switch (item.kind) {
    case 'approval': {
      const decisions = item.detail.decisions ?? ['allow-once', 'deny'];
      return {
        primary: decisions.includes('allow-once') ? 'allow-once' : null,
        secondary: decisions.includes('deny') ? 'deny' : null,
        more: decisions.includes('allow-always') ? ['allow-always'] : [],
      };
    }
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

/** A request the page may not outlive takes `keepalive`, so it still reaches the server. */
function postInit(body: unknown, keepalive: boolean): RequestInit {
  const init: RequestInit = body === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) };
  return keepalive ? { ...init, keepalive: true } : init;
}

async function kanbanPost(url: string, body?: unknown, keepalive = false): Promise<void> {
  const res = await fetch(url, postInit(body, keepalive));
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { details?: string; error?: string };
    throw new Error(data.details || data.error || `HTTP ${res.status}`);
  }
}

async function cronPost(url: string, body?: unknown, keepalive = false): Promise<void> {
  const res = await fetch(url, postInit(body, keepalive));
  const data = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
}

type Rpc = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

/**
 * Sends one action to the item's source. Throws with the server's error text on failure.
 * `keepalive` is for a page being hidden or closed; approvals go over the socket, best effort.
 */
export async function postAction(
  item: AttentionItem,
  action: ActionId,
  note?: string,
  rpc?: Rpc,
  { keepalive = false }: { keepalive?: boolean } = {},
): Promise<void> {
  const id = encodeURIComponent(item.sourceId);
  const trimmed = note?.trim();
  const decision = APPROVAL_DECISIONS[action];
  if (decision) return resolveApproval(rpc, item.sourceId, decision);
  switch (action) {
    case 'approve':
      return kanbanPost(`/api/kanban/tasks/${id}/approve`, trimmed ? { note: trimmed } : {}, keepalive);
    case 'request-changes':
      if (!trimmed) throw new Error('A note is required');
      return kanbanPost(`/api/kanban/tasks/${id}/reject`, { note: trimmed }, keepalive);
    case 'approve-proposal':
      return kanbanPost(`/api/kanban/proposals/${id}/approve`, undefined, keepalive);
    case 'reject-proposal':
      return kanbanPost(`/api/kanban/proposals/${id}/reject`, trimmed ? { reason: trimmed } : {}, keepalive);
    case 'retry':
      return kanbanPost(`/api/kanban/tasks/${id}/execute`, {}, keepalive);
    case 'stop':
      return kanbanPost(`/api/kanban/tasks/${id}/abort`, {}, keepalive);
    case 'run-cron':
      return cronPost(`/api/crons/${id}/run`, undefined, keepalive);
    case 'pause-cron':
      // The route reads `enabled` from the body and treats a missing body as enabling.
      return cronPost(`/api/crons/${id}/toggle`, { enabled: false }, keepalive);
    default:
      throw new Error('Unknown action');
  }
}

export interface ItemActionsState {
  /** The item's key, for keycap hints and the board's commands. */
  itemKey: string;
  actions: ItemActionSet;
  /** The action waiting in its undo window (or on its way), with the board's deferred sends. */
  pending: PendingAction | null;
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
  onDone: (item: AttentionItem, action: ActionId) => void;
  /** The gateway socket, for exec approval decisions. */
  rpc?: Rpc;
  /** The socket is up; approval decisions wait for it. */
  connected?: boolean;
  /**
   * Deferred sends with undo. With it an action applies at once and its request waits for the
   * undo window; the store calls back when it is sent. Without it each action is sent at once.
   */
  deferred?: DeferredActions;
  /** An action entered its undo window; the board moves focus on and says so. */
  onCommit?: (item: AttentionItem, action: ActionId) => void;
}

const noSubscribe = () => () => {};
const zero = () => 0;

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
  const [localNoteOpen, setLocalNoteOpen] = useState(false);
  const [localNote, setLocalNote] = useState('');
  // On the board the note is one of its composers: opening it closes any other, and the draft stays.
  const field = useComposerField(item.key, 'note');
  const deferred = config?.deferred;
  useSyncExternalStore(deferred?.subscribe ?? noSubscribe, deferred?.version ?? zero);
  const pending = deferred?.pendingOf(item.key) ?? null;
  // A sent action locks the item only for Run now: its cron stays failed under the same key until
  // the run reports. Any other key that comes back (a review resubmitted, a task run again) is a
  // new round and starts clean.
  const sentAction = deferred?.sentOf(item.key)?.action;
  const doneAction = done ?? (sentAction === 'run-cron' ? sentAction : null);
  const shownError = error ?? deferred?.errorOf(item.key) ?? null;

  const noteOpen = field ? field.open : localNoteOpen;
  const note = field ? field.draft : localNote;
  const setNote = field ? field.setDraft : setLocalNote;
  const setNoteOpen = (value: boolean) => {
    if (field) field.setOpen(value);
    else setLocalNoteOpen(value);
  };

  const actions = config ? actionsFor(item, config.kanbanEnabled) : NONE;
  // Run now leaves the cron failed until its run reports, so the item stays under the same key.
  const locked = busy !== null || pending !== null || (doneAction !== null && doneAction !== 'run-cron');
  // Approval decisions go over the socket, so they wait while it is down.
  const offline = item.kind === 'approval' && config?.connected === false;
  const isLocked = (action: ActionId) => locked || doneAction === action || offline;

  const clearError = () => {
    setError(null);
    deferred?.clearError(item.key);
  };

  const run = async (action: ActionId) => {
    if (isLocked(action) || !config) return;
    const text = action === 'request-changes' ? note : undefined;
    if (deferred) {
      if (action === 'request-changes' && !note.trim()) return;
      clearError();
      if (!deferred.commit(item, action, text)) return;
      setConfirming(false);
      // The item turns into its receipt; the board moves focus on, so the note does not take it back.
      if (field) field.setOpen(false, undefined, false);
      else setLocalNoteOpen(false);
      if (action === 'request-changes') setNote('');
      config.onCommit?.(item, action);
      return;
    }
    setBusy(action);
    setError(null);
    try {
      await postAction(item, action, text, config.rpc);
      setDone(action);
      setConfirming(false);
      setNoteOpen(false);
      config.onDone(item, action);
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
      clearError();
      setNoteOpen(true);
    } else {
      void run(action);
    }
  };

  const labelOf = (action: ActionId) => {
    const copy = ACTION_COPY[action];
    if (busy === action) return copy.pending;
    if (doneAction === action) return copy.done;
    return copy.label;
  };

  return {
    itemKey: item.key,
    actions,
    pending,
    busy,
    done: doneAction,
    error: shownError,
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
