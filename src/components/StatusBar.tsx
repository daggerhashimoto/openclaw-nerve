import { useState, useEffect, useCallback } from 'react';
import { ContextMeter } from './ContextMeter';
import { useGateway } from '@/contexts/GatewayContext';

/** Props for {@link StatusBar}. */
interface StatusBarProps {
  /** Current WebSocket connection state to the gateway. */
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  /** Number of active agent sessions. */
  sessionCount: number;
  /** ASCII sparkline string rendered at the right edge of the bar. */
  sparkline: string;
  /** Context tokens consumed in the active session (omit to hide the meter). */
  contextTokens?: number;
  /** Context window limit in tokens (omit to hide the meter). */
  contextLimit?: number;
}

function formatUptime(seconds: number): string {
  if (seconds < 0) return '00:00:00';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return d > 0 ? `${d}d ${h}:${m}:${s}` : `${h}:${m}:${s}`;
}

function formatServerTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour12: false });
}

/** Fetch server time and gateway uptime from /api/server-info */
async function fetchServerInfo(): Promise<{ serverTime?: number; gatewayStartedAt?: number } | null> {
  try {
    const res = await fetch('/api/server-info');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Bottom status bar for the Nerve cockpit.
 *
 * Shows connection state, server time, session count, gateway uptime,
 * an optional context-window meter, a sparkline, and the app version.
 */
export function StatusBar({ connectionState, sessionCount, sparkline, contextTokens, contextLimit }: StatusBarProps) {
  useGateway(); // Keep gateway context connected

  // Server time: offset between local clock and server clock
  const [serverTimeOffset, setServerTimeOffset] = useState<number | null>(null);
  // Gateway start time (epoch ms) — persists across page loads
  const [gatewayStartedAt, setGatewayStartedAt] = useState<number | null>(null);
  // Ticking display values
  const [now, setNow] = useState(() => Date.now());

  // Use connectionState as key to trigger CSS animation on change
  const flashKey = connectionState;

  // Sync server info helper
  const syncServerInfo = useCallback(async (signal: { cancelled: boolean }) => {
    const data = await fetchServerInfo();
    if (signal.cancelled || !data) return;
    const localNow = Date.now();
    if (typeof data.serverTime === 'number') {
      setServerTimeOffset(data.serverTime - localNow);
    }
    if (typeof data.gatewayStartedAt === 'number') {
      setGatewayStartedAt(data.gatewayStartedAt);
    }
  }, []);

  // Fetch server info on mount and reconnect
  useEffect(() => {
    // Skip if disconnected/connecting (except initial mount)
    if (connectionState !== 'connected' && connectionState !== 'disconnected') return;
    const signal = { cancelled: false };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch with cancellation is valid
    syncServerInfo(signal);
    return () => { signal.cancelled = true; };
  }, [connectionState, syncServerInfo]);

  // Tick every second
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const statusColor = connectionState === 'connected'
    ? 'text-green'
    : connectionState === 'connecting' || connectionState === 'reconnecting'
    ? 'text-orange animate-pulse-dot'
    : 'text-red';

  const statusLabel = connectionState === 'connected'
    ? 'CONNECTED'
    : connectionState === 'connecting'
    ? 'CONNECTING'
    : connectionState === 'reconnecting'
    ? 'RECONNECTING'
    : 'OFFLINE';

  // Server time = local time + offset
  const serverTime = serverTimeOffset !== null
    ? new Date(now + serverTimeOffset)
    : null;

  // Gateway uptime = (server now) - gatewayStartedAt
  const gatewayUptimeSecs = gatewayStartedAt && serverTimeOffset !== null
    ? Math.floor((now + serverTimeOffset - gatewayStartedAt) / 1000)
    : null;

  return (
    <div className="h-6 bg-secondary border-t border-border flex items-center px-2 sm:px-3 text-[10px] font-mono uppercase tracking-wide text-muted-foreground shrink-0 select-none">
      <div className="flex items-center gap-0 flex-1 min-w-0 overflow-hidden whitespace-nowrap">
        {/* Connection status */}
        <span
          key={flashKey}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`flex items-center gap-1.5 ${statusColor} animate-status-flash shrink-0`}
        >
          <span className="text-[8px]" aria-hidden="true">●</span>
          <span>{statusLabel}</span>
        </span>

        {/* Server time (hidden on narrow screens) */}
        <span className="text-border mx-2 hidden md:inline">│</span>
        {serverTime ? (
          <span className="text-foreground/70 tabular-nums hidden md:inline">{formatServerTime(serverTime)}</span>
        ) : (
          <span className="text-muted-foreground/40 hidden md:inline">--:--:--</span>
        )}

        <span className="text-border mx-2">│</span>

        {/* Session count */}
        <span className="text-foreground/70 shrink-0">{sessionCount} SESSIONS</span>

        {/* Gateway uptime (hidden on narrow/medium screens) */}
        <span className="text-border mx-2 hidden lg:inline">│</span>
        <span className="text-foreground/70 tabular-nums hidden lg:inline">
          UP {gatewayUptimeSecs !== null ? formatUptime(gatewayUptimeSecs) : '--:--:--'}
        </span>

        {/* Context Meter (always visible when available) */}
        {contextTokens != null && contextLimit != null && contextLimit > 0 && (
          <>
            <span className="text-border mx-2">│</span>
            <span className="inline-flex shrink-0">
              <ContextMeter used={contextTokens} limit={contextLimit} />
            </span>
          </>
        )}
      </div>

      {/* Right side telemetry (hidden on smaller screens) */}
      <div className="hidden lg:flex items-center shrink-0 ml-3">
        <span className="text-muted-foreground text-[10px] tracking-[-1px]">{sparkline}</span>
        <span className="text-primary font-bold animate-alive ml-0.5">_</span>
        <span className="text-muted-foreground/40 text-[9px] tracking-wide ml-2">v{__APP_VERSION__}</span>
      </div>
    </div>
  );
}
