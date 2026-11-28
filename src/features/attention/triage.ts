/**
 * What the Now board shares with its items for triage: the one open composer (a Request changes
 * note or a Reply field) with every draft kept by item, the keyboard commands each item answers,
 * which item shows its keycap hints, and Undo. Items work without it (Today, tests): then each
 * keeps its own field state, as before.
 */

import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';

export type ComposerKind = 'note' | 'reply';

/** What a keyboard command asks of the focused item. */
export type ItemCommand = 'primary' | 'reject' | 'changes' | 'pause' | 'reply' | 'stop' | 'seen' | 'open' | 'toggle';

/** Answers a command; false when the item has nothing for it. */
export type CommandHandler = (command: ItemCommand) => boolean;

export interface Composer {
  isOpen: (itemKey: string, kind: ComposerKind) => boolean;
  /** Opens one field and closes any other; drafts stay. `opener` gets focus back on close. */
  open: (itemKey: string, kind: ComposerKind, opener?: Element | null) => void;
  close: (itemKey: string, kind: ComposerKind, options?: { restoreFocus?: boolean }) => void;
  draft: (itemKey: string, kind: ComposerKind) => string;
  setDraft: (itemKey: string, kind: ComposerKind, text: string) => void;
  subscribe: (listener: () => void) => () => void;
  version: () => number;
}

const idOf = (itemKey: string, kind: ComposerKind) => `${kind}\n${itemKey}`;

/** Finds an item on the board by its key, without building a selector from it. */
export function findNavItem(root: ParentNode | null | undefined, key: string): HTMLElement | null {
  if (!root) return null;
  for (const el of root.querySelectorAll<HTMLElement>('[data-nav-key]')) {
    if (el.dataset.navKey === key) return el;
  }
  return null;
}

/** Moves focus to an item's head (its toggle, the plate, an agent line). */
export function focusNavItem(root: ParentNode | null | undefined, key: string): boolean {
  const item = findNavItem(root, key);
  const head = item?.querySelector<HTMLElement>('[data-nav-head]') ?? (item?.hasAttribute('data-nav-head') ? item : null);
  if (!head) return false;
  head.focus();
  return document.activeElement === head;
}

export function createComposer(fallbackFocus: (itemKey: string) => void = () => {}): Composer {
  let openId: string | null = null;
  let version = 0;
  const drafts = new Map<string, string>();
  const openers = new Map<string, Element>();
  const listeners = new Set<() => void>();
  const notify = () => {
    version += 1;
    for (const listener of listeners) listener();
  };
  return {
    isOpen: (itemKey, kind) => openId === idOf(itemKey, kind),
    open: (itemKey, kind, opener) => {
      const id = idOf(itemKey, kind);
      if (opener) openers.set(id, opener);
      if (openId === id) return;
      openId = id;
      notify();
    },
    close: (itemKey, kind, { restoreFocus = true } = {}) => {
      const id = idOf(itemKey, kind);
      if (openId !== id) return;
      openId = null;
      const opener = openers.get(id);
      openers.delete(id);
      // Focus goes back before the field unmounts, so it never drops to the page.
      if (restoreFocus) {
        if (opener instanceof HTMLElement && opener.isConnected && !opener.hasAttribute('disabled')) opener.focus();
        else fallbackFocus(itemKey);
      }
      notify();
    },
    draft: (itemKey, kind) => drafts.get(idOf(itemKey, kind)) ?? '',
    setDraft: (itemKey, kind, text) => {
      const id = idOf(itemKey, kind);
      if ((drafts.get(id) ?? '') === text) return;
      if (text) drafts.set(id, text);
      else drafts.delete(id);
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    version: () => version,
  };
}

export interface Triage {
  composer: Composer;
  /** Registers the commands an item answers while it is on the board. */
  register: (key: string, handler: CommandHandler) => () => void;
  /** The item whose keycap hints show (the keyboard-focused one, at the desk), or null. */
  hintKey: string | null;
  /** Takes back the action waiting on `key`, or the latest one. */
  undo: (key?: string) => void;
}

const TriageContext = createContext<Triage | null>(null);
export const TriageProvider = TriageContext.Provider;

export function useTriage(): Triage | null {
  return useContext(TriageContext);
}

const noSubscribe = () => () => {};
const zero = () => 0;

/**
 * One field's open state and draft. With the board's composer, opening it closes any other
 * field and the draft survives closing; without it, the caller's own state is used.
 */
export function useComposerField(itemKey: string, kind: ComposerKind) {
  const composer = useTriage()?.composer ?? null;
  useSyncExternalStore(composer?.subscribe ?? noSubscribe, composer?.version ?? zero);
  return composer
    ? {
      managed: true as const,
      open: composer.isOpen(itemKey, kind),
      draft: composer.draft(itemKey, kind),
      setOpen: (value: boolean, opener?: Element | null, restoreFocus = true) => {
        if (value) composer.open(itemKey, kind, opener ?? document.activeElement);
        else composer.close(itemKey, kind, { restoreFocus });
      },
      setDraft: (text: string) => composer.setDraft(itemKey, kind, text),
    }
    : null;
}

/** Registers an item's command handler, always calling the latest one. An empty key registers nothing. */
export function useItemCommands(key: string, handler: CommandHandler) {
  const triage = useTriage();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  const register = triage?.register;
  useEffect(() => {
    if (!register || !key) return;
    return register(key, (command) => ref.current(command));
  }, [register, key]);
}

/** The item shows its keycap hints. */
export function useHints(key: string | undefined): boolean {
  const triage = useTriage();
  return Boolean(key && triage?.hintKey === key);
}

/**
 * Escape inside a field. App's own Escape shortcut listens on the window in the capture phase
 * and stops propagation, so a React onKeyDown never sees it; a window capture listener still does.
 */
export function useEscapeWithin(ref: React.RefObject<HTMLElement | null>, onEscape: () => void, enabled = true) {
  const latest = useRef(onEscape);
  useEffect(() => {
    latest.current = onEscape;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target;
      if (target instanceof Node && ref.current?.contains(target)) latest.current();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [ref, enabled]);
}
