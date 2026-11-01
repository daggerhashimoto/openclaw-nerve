/**
 * Lit pane states: Nerve's state vocabulary.
 *
 *   live      agent work in progress (running, streaming, a tool call underway)
 *   operator  the operator, or finished work waiting for the operator to look
 *   error     the run failed
 *   off       done or idle: the pane goes dark
 */
import { getSessionKey, type Session } from '@/types';

export type PaneState = 'live' | 'operator' | 'error' | 'off';

interface PaneStateInput {
  running?: boolean;
  unread?: boolean;
  error?: boolean;
}

/** Resolve the pane for a session or run: error beats live beats waiting-on-you. */
export function paneStateFor({ running, unread, error }: PaneStateInput): PaneState {
  if (error) return 'error';
  if (running) return 'live';
  if (unread) return 'operator';
  return 'off';
}

/** Running test shared by the agents column, the status strip and the brand pane. */
export function isSessionRunning(session: Session, busy = false): boolean {
  return busy
    || session.state === 'running'
    || session.agentState === 'running'
    || Boolean(session.busy)
    || Boolean(session.processing)
    || session.status === 'running'
    || session.status === 'busy';
}

interface FleetActivityInput {
  sessions: readonly Session[];
  busyState?: Record<string, boolean>;
  unreadSessions?: Record<string, boolean>;
  /** The open session is generating right now, even before the gateway reports it busy. */
  generating?: boolean;
}

/**
 * The whole fleet in one pane: live while any agent works, operator while any
 * finished work waits on the operator, otherwise off.
 */
export function fleetActivity({ sessions, busyState, unreadSessions, generating }: FleetActivityInput): PaneState {
  if (generating) return 'live';
  let waiting = false;
  for (const session of sessions) {
    const key = getSessionKey(session);
    if (isSessionRunning(session, Boolean(busyState?.[key]))) return 'live';
    if (unreadSessions?.[key]) waiting = true;
  }
  return waiting ? 'operator' : 'off';
}

/** The fleet in numbers: how many sessions exist, how many are working, how many wait on the operator. */
export interface FleetCounts {
  total: number;
  running: number;
  waiting: number;
}

export function fleetCounts({ sessions, busyState, unreadSessions, generating }: FleetActivityInput): FleetCounts {
  let running = 0;
  let waiting = 0;
  for (const session of sessions) {
    const key = getSessionKey(session);
    if (isSessionRunning(session, Boolean(busyState?.[key]))) running += 1;
    else if (unreadSessions?.[key]) waiting += 1;
  }
  if (generating && running === 0) running = 1;
  return { total: sessions.length, running, waiting };
}

/** The fleet in words for the top bar: quiet when nothing is happening. */
export function fleetWords({ total, running, waiting }: FleetCounts): string {
  if (total === 0) return 'No agents';
  const parts: string[] = [];
  if (running > 0) parts.push(`${running} working`);
  if (waiting > 0) parts.push(`${waiting} waiting on you`);
  if (parts.length === 0) return `${total} ${total === 1 ? 'agent' : 'agents'}, all quiet`;
  return parts.join(', ');
}

/** Plain-language name for a pane state, for labels and tooltips. */
export function paneStateLabel(state: PaneState): string {
  switch (state) {
    case 'live':
      return 'Running';
    case 'operator':
      return 'Waiting on you';
    case 'error':
      return 'Failed';
    default:
      return 'Idle';
  }
}
