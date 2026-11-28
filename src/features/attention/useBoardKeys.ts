/**
 * The Now board's keys. One window listener while the view is on screen; it stays out of the way
 * of typing (any text field, IME composition), of modified keys (the app's own shortcuts are
 * all Cmd or Ctrl combinations), and of anything outside the board (the palette, a drawer).
 */

import { useEffect, useRef } from 'react';
import type { AttentionSegment } from './attentionSegment';
import type { ItemCommand } from './triage';

/** How long `g` waits for its second key. */
const G_WINDOW_MS = 1500;

export interface BoardKeyHandlers {
  move: (delta: 1 | -1) => void;
  /** Runs a command on the focused item; false when it had nothing for it. */
  command: (command: ItemCommand) => boolean;
  undo: () => void;
  showNew: () => void;
  focusAsk: () => void;
  toggleHelp: () => void;
  /** Closes the shortcuts panel; false when it was not open. */
  closeHelp: () => boolean;
  switchTo: (segment: AttentionSegment) => void;
  /** A key reached the board: keycap hints may show. */
  usedKeyboard: () => void;
}

const ITEM_KEYS: Record<string, ItemCommand> = {
  o: 'open',
  a: 'primary',
  x: 'reject',
  c: 'changes',
  p: 'pause',
  r: 'reply',
  s: 'stop',
  e: 'seen',
};

/** Text fields own their keys. */
export function isTypingTarget(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(type);
}

export function useBoardKeys({
  active,
  nowShown,
  rootRef,
  handlers,
}: {
  /** The Attention view is on screen. */
  active: boolean;
  /** Now is the shown half (Today answers only the switch, Undo and the panel). */
  nowShown: boolean;
  rootRef: React.RefObject<HTMLElement | null>;
  handlers: BoardKeyHandlers;
}) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  const gAt = useRef(0);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (isTypingTarget(target) || isTypingTarget(document.activeElement)) return;
      const root = rootRef.current;
      // Only the board and the bare page; never the palette, a drawer or a dialog.
      const onBoard = !target || target === document.body || target === document.documentElement || Boolean(root?.contains(target));
      if (!root || !onBoard) return;
      const key = event.key;
      // `?` takes Shift on most layouts; every other key is unshifted.
      if (event.shiftKey && key !== '?') return;
      const h = latest.current;
      const handled = () => {
        event.preventDefault();
        h.usedKeyboard();
      };

      if (gAt.current && Date.now() - gAt.current < G_WINDOW_MS && (key === 'n' || key === 't')) {
        gAt.current = 0;
        handled();
        h.switchTo(key === 'n' ? 'now' : 'today');
        return;
      }
      gAt.current = 0;
      if (key === 'g') {
        gAt.current = Date.now();
        handled();
        return;
      }
      if (key === '?') {
        handled();
        h.toggleHelp();
        return;
      }
      if (key === 'Escape') {
        if (h.closeHelp()) event.preventDefault();
        return;
      }
      if (key === 'u') {
        handled();
        h.undo();
        return;
      }
      if (!nowShown) return;

      const inItem = Boolean(target?.closest('[data-nav-key]'));
      // Enter on a row's head opens or closes it in place (and stops the button's own click);
      // anywhere else, Enter keeps its native meaning (a focused Approve approves).
      if (key === 'Enter') {
        if (target?.hasAttribute('data-nav-head') && h.command('toggle')) handled();
        return;
      }
      switch (key) {
        case 'j':
          handled();
          h.move(1);
          return;
        case 'k':
          handled();
          h.move(-1);
          return;
        // Arrows move once triage has started; on the bare page they still scroll.
        case 'ArrowDown':
          if (!inItem) return;
          handled();
          h.move(1);
          return;
        case 'ArrowUp':
          if (!inItem) return;
          handled();
          h.move(-1);
          return;
        case 'n':
          handled();
          h.showNew();
          return;
        case '/':
          handled();
          h.focusAsk();
          return;
        default: {
          const command = ITEM_KEYS[key];
          if (!command) return;
          handled();
          h.command(command);
        }
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [active, nowShown, rootRef]);
}
