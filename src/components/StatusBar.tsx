import { useEffect, useMemo, useState } from 'react';
import { ContextMeter } from './ContextMeter';
import { UpdateBadge } from './UpdateBadge';
import { useGateway } from '@/contexts/GatewayContext';
import { Pane } from '@/components/ui/Pane';
import { fleetCounts } from '@/lib/paneState';
import { timeAgo } from '@/lib/formatting';
import type { GranularAgentState, Session } from '@/types';

/** Props for {@link StatusBar}. */
interface StatusBarProps {
  /** Current WebSocket connection state to the gateway. */
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  /** Number of active agent sessions. */
  sessionCount: number;
  /** Context tokens consumed in the active session (omit to hide the meter). */
  contextTokens?: number;
  /** Context window limit in tokens (omit to hide the meter). */
  contextLimit?: number;
  /** Open session's last heartbeat, epoch milliseconds (omit to hide the label). */
  lastHeartbeatAt?: number | null;
  /**
   * Freeze non-essential live telemetry for lower idle repaint cost.
   * Accepted for layout/API parity; the status bar currently ignores it.
   */
  performanceMode?: boolean;
  /** Sessions to count as running or waiting (omit to show only the session count). */
  sessions?: Session[];
  /** Busy flags keyed by session key; a busy session counts as running. */
  busyState?: Record<string, boolean>;
  /** Unread flags keyed by session key; unread work counts as waiting on the operator. */
  unreadSessions?: Record<string, boolean>;
  /** Granular status keyed by session key; a failed run counts as failed, not running. */
  agentStatus?: Record<string, GranularAgentState>;
  /** The open session is generating, even before the gateway reports it busy. */
  generating?: boolean;
  /** Key of the open session, so a generating session is counted once. */
  currentSessionKey?: string;
}

function Separator() {
  return <span className="h-3.5 w-px shrink-0 bg-border" aria-hidden="true" />;
}

/**
 * Bottom status bar for the Nerve cockpit.
 *
 * One row unit tall: connection state, a plain-language count of what is
 * running and what waits on the operator (the agents column's facade draws
 * the windows themselves), the open session's last heartbeat, the context
 * meter, and the app version.
 */
export function StatusBar({
  connectionState,
  sessionCount,
  contextTokens,
  contextLimit,
  lastHeartbeatAt,
  sessions,
  busyState,
  unreadSessions,
  agentStatus,
  generating = false,
  currentSessionKey,
}: StatusBarProps) {
  useGateway(); // Keep gateway context connected

  // The same reading the top bar uses, so the two never disagree about who is working.
  const fleet = useMemo(
    () => (sessions ? fleetCounts({ sessions, busyState, unreadSessions, agentStatus, generating, currentSessionKey }) : null),
    [sessions, busyState, unreadSessions, agentStatus, generating, currentSessionKey],
  );

  const runningCount = fleet?.running ?? 0;
  const waitingCount = fleet?.waiting ?? 0;
  const failedCount = fleet?.failed ?? 0;
  const sessionNoun = sessionCount === 1 ? 'session' : 'sessions';
  const sessionSummary = [
    runningCount > 0 ? `${runningCount} running` : null,
    waitingCount > 0 ? `${waitingCount} waiting on you` : null,
    failedCount > 0 ? `${failedCount} failed` : null,
  ].filter(Boolean).join(', ');
  const sessionText = `${sessionCount} ${sessionNoun}${sessionSummary ? `: ${sessionSummary}` : ''}`;

  const connection = connectionState === 'connected'
    ? { pane: null, label: 'Connected' }
    : connectionState === 'reconnecting'
    ? { pane: 'operator' as const, label: 'Reconnecting' }
    : connectionState === 'connecting'
    ? { pane: 'operator' as const, label: 'Connecting' }
    : { pane: 'error' as const, label: 'Disconnected' };

  const [, setHeartbeatTick] = useState(0);

  const heartbeatAt = lastHeartbeatAt != null ? new Date(lastHeartbeatAt) : null;
  const heartbeatValid = heartbeatAt != null && !Number.isNaN(heartbeatAt.getTime());
  const heartbeatAge = heartbeatValid ? timeAgo(heartbeatAt) : null;
  const heartbeatText = heartbeatAge == null
    ? null
    : `last heartbeat ${heartbeatAge === 'now' ? 'just now' : `${heartbeatAge} ago`}`;

  useEffect(() => {
    if (!heartbeatValid) return;
    const id = window.setInterval(() => setHeartbeatTick(t => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, [heartbeatValid]);

  return (
    <div className="flex h-[var(--row-unit)] shrink-0 select-none items-center gap-2.5 overflow-hidden whitespace-nowrap border-t border-border bg-background px-3 text-[0.8rem] text-muted-foreground max-[378px]:gap-2 max-[378px]:px-2">
      {/* Connection status */}
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="inline-flex shrink-0 items-center gap-1.5"
      >
        {connection.pane && <Pane state={connection.pane} />}
        <span className={connection.pane ? 'text-foreground' : undefined}>{connection.label}</span>
      </span>

      <Separator />

      {/* Sessions: the counts in words */}
      <span className="inline-flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate" title={sessionText}>
          <span className="tabular">{sessionCount}</span> {sessionNoun}
          {sessionSummary && ': '}
          {runningCount > 0 && (
            <span className="text-live-text">
              <span className="tabular">{runningCount}</span> running
            </span>
          )}
          {runningCount > 0 && waitingCount > 0 && ', '}
          {waitingCount > 0 && (
            <span className="text-operator-text">
              <span className="tabular">{waitingCount}</span> waiting on you
            </span>
          )}
          {(runningCount > 0 || waitingCount > 0) && failedCount > 0 && ', '}
          {failedCount > 0 && (
            <span className="text-destructive">
              <span className="tabular">{failedCount}</span> failed
            </span>
          )}
        </span>
      </span>

      {/* Heartbeat: how fresh the open session's last sign of life is */}
      {heartbeatText && heartbeatAt && (
        <span
          className="hidden shrink-0 items-center gap-2.5 sm:inline-flex"
          title={heartbeatAt.toLocaleString()}
        >
          <Separator />
          {heartbeatText}
        </span>
      )}

      {/* Context meter (when available) */}
      {contextTokens != null && contextLimit != null && contextLimit > 0 && (
        <>
          <Separator />
          <span className="inline-flex shrink-0">
            <ContextMeter used={contextTokens} limit={contextLimit} />
          </span>
        </>
      )}

      {/* Right side: version, update notice */}
      <span className="ml-auto flex shrink-0 items-center gap-2.5">
        <span className="hidden font-mono tabular text-muted-foreground sm:inline">v{__APP_VERSION__}</span>
        <UpdateBadge />
      </span>
    </div>
  );
}
