import type { GranularAgentState } from '@/types';
import { paneStateFor, type PaneState } from '@/lib/paneState';

/** True when the granular state describes agent work in progress (thinking, streaming or a tool call). */
export function isGranularLive(state: GranularAgentState): boolean {
  return Boolean(state.toolName) || state.status === 'THINKING' || state.status === 'STREAMING';
}

/** Pane state for a granular agent state: live work lights the pane, errors go red, done and idle go dark. */
export function getStatusPaneState(state: GranularAgentState): PaneState {
  if (state.status === 'ERROR') return 'error';
  return isGranularLive(state) ? 'live' : 'off';
}

interface SessionPaneInput {
  running: boolean;
  unread?: boolean;
  granularStatus?: GranularAgentState;
}

/**
 * Pane state for a session row. Granular status is authoritative when present
 * (error beats live beats waiting-on-you); otherwise the binary running flag decides.
 */
export function getSessionPaneState({ running, unread, granularStatus }: SessionPaneInput): PaneState {
  if (!granularStatus) return paneStateFor({ running, unread });
  return paneStateFor({
    running: isGranularLive(granularStatus),
    unread,
    error: granularStatus.status === 'ERROR',
  });
}

/** Plain sentence-case text for a granular state: the tool name, or the status in lower case. */
export function getStatusBadgeText(state: GranularAgentState): string {
  if (state.toolName) return state.toolName;
  return state.status.toLowerCase();
}

/** Text colour for the granular state: live text while working, destructive on error, muted otherwise. */
export function getStatusBadgeClasses(state: GranularAgentState): string {
  switch (getStatusPaneState(state)) {
    case 'live':
      return 'text-live-text';
    case 'error':
      return 'text-destructive';
    default:
      return 'text-muted-foreground';
  }
}
