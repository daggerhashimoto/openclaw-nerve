import type { PaneState } from '@/lib/paneState';

/**
 * The glyph a log line was recorded with is history, not state, so most lines
 * carry a dark pane. Only two meanings light it: a failure is red, and a
 * request for the operator's approval is cantaloupe.
 */
const PANE_BY_ICON: Record<string, PaneState> = {
  '❌': 'error',
  '⛔': 'error',
  '🔐': 'operator',
};

export function logPaneState(icon: string): PaneState {
  return PANE_BY_ICON[icon] ?? 'off';
}

/** The event kind in the mono voice: lower case, one word. */
export function eventKind(badge: string): string {
  return badge.toLowerCase();
}
