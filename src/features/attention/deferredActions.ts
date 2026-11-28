/**
 * Deferred sends with undo. An action applies on screen at once and its request goes out only
 * when the undo window closes, so the operator can take it back. A hidden or unloading page
 * sends everything still waiting at once (keepalive), so nothing the operator did is lost.
 *
 * A plain store read with useSyncExternalStore, like the inline replies store: the item a
 * receipt stands for can unmount and come back (row, plate, receipt), so the pending entry,
 * its error and the handled list live here, not in the item's own state.
 */

import { useEffect, useState } from 'react';
import { ACTION_COPY, type ActionId } from './useAttentionActions';
import type { AttentionItem } from './types';

/** How long an action waits for Undo before its request is sent. */
export const UNDO_WINDOW_MS = 6000;

export interface PendingAction {
  id: number;
  key: string;
  item: AttentionItem;
  action: ActionId;
  note?: string;
  createdAt: number;
  /** When the request goes out. */
  deadline: number;
  /** Waiting for the window to close, or already on its way (no Undo then). */
  status: 'waiting' | 'sending';
}

export interface HandledReceipt {
  id: number;
  key: string;
  title: string;
  action: ActionId;
  /** When the request settled. */
  at: number;
  outcome: 'done' | 'failed';
  error?: string;
}

export type ActionSender = (
  item: AttentionItem,
  action: ActionId,
  note: string | undefined,
  options: { keepalive: boolean },
) => Promise<void>;

export interface DeferredEvents {
  onSent?: (entry: PendingAction) => void;
  onFailed?: (entry: PendingAction, error: string) => void;
}

export interface DeferredActions {
  /** Starts the undo window for an action. Null when the item already has one waiting. */
  commit: (item: AttentionItem, action: ActionId, note?: string) => PendingAction | null;
  /** Takes back the action on `key`, or the latest one still waiting. Null when nothing can be undone. */
  undo: (key?: string) => PendingAction | null;
  /** Sends every waiting action now. `keepalive` lets the requests outlive the page. */
  flush: (options?: { keepalive?: boolean }) => void;
  pendingOf: (key: string) => PendingAction | undefined;
  /** Every action still waiting or sending, oldest first. */
  pending: () => PendingAction[];
  errorOf: (key: string) => string | undefined;
  clearError: (key: string) => void;
  /** The last action sent for the item this visit, and when. */
  sentOf: (key: string) => { action: ActionId; at: number } | undefined;
  /** What was handled this visit, newest first. */
  handled: () => HandledReceipt[];
  subscribe: (listener: () => void) => () => void;
  /** Changes on every update, for useSyncExternalStore. */
  version: () => number;
  setSender: (send: ActionSender) => void;
  setEvents: (events: DeferredEvents) => void;
  /** Sends what is waiting (keepalive) and stops the timers. */
  dispose: () => void;
}

/** The receipt's verb, in the past tense, ahead of the item's title. */
const RECEIPT_WORD: Record<ActionId, string> = {
  approve: 'Approved',
  'request-changes': 'Asked for changes on',
  'approve-proposal': 'Approved',
  'reject-proposal': 'Rejected',
  retry: 'Retried',
  stop: 'Stopped',
  'run-cron': 'Started',
  'pause-cron': 'Paused',
  'allow-once': 'Allowed',
  'allow-always': 'Always allowed',
  deny: 'Denied',
};

export function receiptText(action: ActionId, title: string): string {
  return `${RECEIPT_WORD[action]} ‘${title}’`;
}

export function errorText(action: ActionId, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `Could not ${ACTION_COPY[action].verb}: ${message}`;
}

export function createDeferredActions({
  send: initialSend,
  windowMs = UNDO_WINDOW_MS,
}: {
  send: ActionSender;
  windowMs?: number;
}): DeferredActions {
  let send = initialSend;
  let events: DeferredEvents = {};
  let nextId = 1;
  let version = 0;
  const entries = new Map<string, PendingAction>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const errors = new Map<string, string>();
  const sent = new Map<string, { action: ActionId; at: number }>();
  let handled: HandledReceipt[] = [];
  const listeners = new Set<() => void>();

  const notify = () => {
    version += 1;
    for (const listener of listeners) listener();
  };

  const clearTimer = (key: string) => {
    const timer = timers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(key);
  };

  const fire = (key: string, keepalive: boolean) => {
    const entry = entries.get(key);
    // Single flight: a flushed entry is already sending, and its timer is gone.
    if (!entry || entry.status !== 'waiting') return;
    clearTimer(key);
    const sending: PendingAction = { ...entry, status: 'sending' };
    entries.set(key, sending);
    notify();
    let request: Promise<void>;
    try {
      request = send(sending.item, sending.action, sending.note, { keepalive });
    } catch (err) {
      request = Promise.reject(err);
    }
    request.then(
      () => {
        if (entries.get(key)?.id !== sending.id) return;
        entries.delete(key);
        const at = Date.now();
        sent.set(key, { action: sending.action, at });
        handled = [{ id: sending.id, key, title: sending.item.title, action: sending.action, at, outcome: 'done' as const }, ...handled];
        notify();
        events.onSent?.(sending);
      },
      (err: unknown) => {
        if (entries.get(key)?.id !== sending.id) return;
        entries.delete(key);
        const error = errorText(sending.action, err);
        errors.set(key, error);
        handled = [{ id: sending.id, key, title: sending.item.title, action: sending.action, at: Date.now(), outcome: 'failed' as const, error }, ...handled];
        notify();
        events.onFailed?.(sending, error);
      },
    );
  };

  const commit = (item: AttentionItem, action: ActionId, note?: string): PendingAction | null => {
    if (entries.has(item.key)) return null;
    const now = Date.now();
    const entry: PendingAction = {
      id: nextId++,
      key: item.key,
      item,
      action,
      note,
      createdAt: now,
      deadline: now + windowMs,
      status: 'waiting',
    };
    entries.set(item.key, entry);
    errors.delete(item.key);
    timers.set(item.key, setTimeout(() => fire(item.key, false), windowMs));
    notify();
    return entry;
  };

  const undo = (key?: string): PendingAction | null => {
    let entry: PendingAction | undefined;
    if (key !== undefined) {
      entry = entries.get(key);
    } else {
      for (const candidate of entries.values()) {
        if (candidate.status === 'waiting' && (!entry || candidate.id > entry.id)) entry = candidate;
      }
    }
    if (!entry || entry.status !== 'waiting') return null;
    clearTimer(entry.key);
    entries.delete(entry.key);
    notify();
    return entry;
  };

  const flush = ({ keepalive = false }: { keepalive?: boolean } = {}) => {
    for (const key of [...entries.keys()]) fire(key, keepalive);
  };

  return {
    commit,
    undo,
    flush,
    pendingOf: (key) => entries.get(key),
    pending: () => [...entries.values()].sort((a, b) => a.id - b.id),
    errorOf: (key) => errors.get(key),
    clearError: (key) => {
      if (errors.delete(key)) notify();
    },
    sentOf: (key) => sent.get(key),
    handled: () => handled,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    version: () => version,
    setSender: (next) => { send = next; },
    setEvents: (next) => { events = next; },
    dispose: () => {
      flush({ keepalive: true });
      for (const key of [...timers.keys()]) clearTimer(key);
    },
  };
}

/**
 * One store for the board. Pending actions are sent at once when the page is hidden or
 * unloaded, and when the board itself goes away.
 */
export function useDeferredActions(send: ActionSender, windowMs = UNDO_WINDOW_MS): DeferredActions {
  const [store] = useState(() => createDeferredActions({ send, windowMs }));
  useEffect(() => {
    store.setSender(send);
  }, [store, send]);
  useEffect(() => {
    const flushNow = () => store.flush({ keepalive: true });
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };
    window.addEventListener('pagehide', flushNow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flushNow);
      document.removeEventListener('visibilitychange', onVisibility);
      store.dispose();
    };
  }, [store]);
  return store;
}
