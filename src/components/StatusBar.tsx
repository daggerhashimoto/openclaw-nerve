import { useMemo } from 'react';
import { ContextMeter } from './ContextMeter';
import { UpdateBadge } from './UpdateBadge';
import { useGateway } from '@/contexts/GatewayContext';
import { Pane } from '@/components/ui/Pane';
import { isSessionRunning, paneStateFor } from '@/lib/paneState';
import { getSessionKey, type Session } from '@/types';

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
  /** Freeze non-essential live telemetry for lower idle repaint cost. */
  performanceMode?: boolean;
  /** Sessions to count as running or waiting (omit to show only the session count). */
  sessions?: Session[];
  /** Busy flags keyed by session key; a busy session counts as running. */
  busyState?: Record<string, boolean>;
  /** Unread flags keyed by session key; unread work counts as waiting on the operator. */
  unreadSessions?: Record<string, boolean>;
}

function Separator() {
  return <span className="h-3.5 w-px shrink-0 bg-border" aria-hidden="true" />;
}

/**
 * Bottom status bar for the Nerve cockpit.
 *
 * One row unit tall: connection state, a plain-language count of what is
 * running and what waits on the operator (the agents column's facade draws
 * the windows themselves), the context meter, and the app version.
 */
export function StatusBar({
  connectionState,
  sessionCount,
  contextTokens,
  contextLimit,
  sessions,
  busyState,
  unreadSessions,
}: StatusBarProps) {
  useGateway(); // Keep gateway context connected

  const sessionPanes = useMemo(() => {
    if (!sessions) return null;
    return sessions
      .map((session) => {
        const key = getSessionKey(session);
        const running = isSessionRunning(session, Boolean(busyState?.[key]));
        const unread = Boolean(unreadSessions?.[key]);
        return { key, state: paneStateFor({ running, unread }) };
      });
  }, [sessions, busyState, unreadSessions]);

  const runningCount = sessionPanes?.filter((pane) => pane.state === 'live').length ?? 0;
  const waitingCount = sessionPanes?.filter((pane) => pane.state === 'operator').length ?? 0;
  const sessionNoun = sessionCount === 1 ? 'session' : 'sessions';
  const sessionSummary = [
    runningCount > 0 ? `${runningCount} running` : null,
    waitingCount > 0 ? `${waitingCount} waiting on you` : null,
  ].filter(Boolean).join(', ');
  const sessionText = `${sessionCount} ${sessionNoun}${sessionSummary ? `: ${sessionSummary}` : ''}`;

  const connection = connectionState === 'connected'
    ? { pane: null, label: 'Connected' }
    : connectionState === 'reconnecting'
    ? { pane: 'operator' as const, label: 'Reconnecting' }
    : connectionState === 'connecting'
    ? { pane: 'operator' as const, label: 'Connecting' }
    : { pane: 'error' as const, label: 'Disconnected' };

  return (
    <div className="flex h-[var(--row-unit)] shrink-0 select-none items-center gap-2.5 overflow-hidden whitespace-nowrap border-t border-border bg-card px-3 text-[0.8rem] text-muted-foreground max-[378px]:gap-2 max-[378px]:px-2">
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
        </span>
      </span>

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
