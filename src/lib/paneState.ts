/**
 * Lit pane states: Nerve's state vocabulary.
 *
 *   live      agent work in progress (running, streaming, a tool call underway)
 *   operator  the operator, or finished work waiting for the operator to look
 *   error     the run failed
 *   off       done or idle: the pane goes dark
 */
import { getSessionKey, type GranularAgentState, type Session } from '@/types';

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

/** True when a granular state describes agent work in progress (thinking, streaming or a tool call). */
export function isGranularLive(state: GranularAgentState): boolean {
  return Boolean(state.toolName) || state.status === 'THINKING' || state.status === 'STREAMING';
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
  /** Granular status per session key; ERROR here makes the session a failure, never a runner. */
  agentStatus?: Record<string, GranularAgentState>;
  /** The open session is generating right now, even before the gateway reports it busy. */
  generating?: boolean;
}

type SessionFlags = Pick<FleetActivityInput, 'busyState' | 'unreadSessions' | 'agentStatus'>;

/**
 * One session's pane as the fleet sees it. When the gateway has reported a
 * granular status for the session it is authoritative, as on the session rows:
 * ERROR is red, DONE and IDLE are not running even while the session snapshot
 * still says so, and only live work lights the pane. Without one, the session's
 * own running flags decide. Unread work waits on the operator.
 */
export function sessionPaneState(session: Session, { busyState, unreadSessions, agentStatus }: SessionFlags): PaneState {
  const key = getSessionKey(session);
  const granular = agentStatus?.[key];
  const failed = granular?.status === 'ERROR';
  const running = granular ? isGranularLive(granular) : isSessionRunning(session, Boolean(busyState?.[key]));
  return paneStateFor({
    running: !failed && running,
    unread: Boolean(unreadSessions?.[key]),
    error: failed,
  });
}

/**
 * The whole fleet in one pane: red while any run stands failed, live while any
 * agent works, operator while any finished work waits on the operator, otherwise off.
 */
export function fleetActivity(input: FleetActivityInput): PaneState {
  const { failed, running, waiting } = fleetCounts(input);
  if (failed > 0) return 'error';
  if (running > 0) return 'live';
  return waiting > 0 ? 'operator' : 'off';
}

/** The fleet in numbers: how many sessions exist, how many work, wait on the operator, or stand failed. */
export interface FleetCounts {
  total: number;
  running: number;
  waiting: number;
  failed: number;
}

export function fleetCounts({ sessions, busyState, unreadSessions, agentStatus, generating }: FleetActivityInput): FleetCounts {
  let running = 0;
  let waiting = 0;
  let failed = 0;
  for (const session of sessions) {
    const state = sessionPaneState(session, { busyState, unreadSessions, agentStatus });
    if (state === 'error') failed += 1;
    else if (state === 'live') running += 1;
    else if (state === 'operator') waiting += 1;
  }
  if (generating && running === 0) running = 1;
  return { total: sessions.length, running, waiting, failed };
}

/** The fleet in words for the top bar: quiet when nothing is happening. */
export function fleetWords({ total, running, waiting, failed }: FleetCounts): string {
  if (total === 0) return 'No agents';
  const parts: string[] = [];
  if (running > 0) parts.push(`${running} working`);
  if (waiting > 0) parts.push(`${waiting} waiting on you`);
  if (failed > 0) parts.push(`${failed} failed`);
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
