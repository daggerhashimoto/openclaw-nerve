import { useState, useEffect, useCallback } from 'react';
import { ContextMeter } from './ContextMeter';
import { UpdateBadge } from './UpdateBadge';
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
    ? 'border-green/30 bg-green/10 text-green'
    : connectionState === 'connecting' || connectionState === 'reconnecting'
    ? 'border-orange/30 bg-orange/10 text-orange animate-pulse-dot'
    : 'border-red/30 bg-red/10 text-red';

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
    <div className="shell-panel mx-2 mb-2 flex min-h-10 flex-wrap items-center gap-y-1 overflow-hidden rounded-2xl px-3 py-2 text-[10px] text-muted-foreground shrink-0 select-none max-[378px]:min-h-9 max-[378px]:gap-y-0.5 max-[378px]:px-2.5 max-[378px]:py-1.5 max-[378px]:text-[9px] sm:mx-4 sm:mb-3 sm:flex-nowrap sm:gap-y-0 sm:overflow-x-auto sm:px-4 sm:text-[11px]">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 overflow-visible whitespace-normal max-[378px]:gap-x-2 max-[378px]:gap-y-0.5 sm:flex-nowrap sm:gap-x-3 sm:gap-y-0 sm:whitespace-nowrap">
        {/* Connection status */}
        <span
          key={flashKey}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] max-[378px]:gap-0.5 max-[378px]:px-1.5 max-[378px]:py-0.5 max-[378px]:text-[8px] max-[378px]:tracking-[0.06em] sm:gap-1.5 sm:px-2.5 sm:tracking-[0.12em] ${statusColor} animate-status-flash`}
        >
          <span className="text-[8px] max-[378px]:text-[7px]" aria-hidden="true">●</span>
          <span>{statusLabel}</span>
        </span>

        {/* Server time (hidden on narrow screens) */}
        <span className="hidden text-border md:inline">•</span>
        {serverTime ? (
          <span className="hidden font-mono tabular-nums text-foreground/72 md:inline">{formatServerTime(serverTime)}</span>
        ) : (
          <span className="hidden font-mono text-muted-foreground/40 md:inline">--:--:--</span>
        )}

        <span className="text-border max-[378px]:text-[8px]">•</span>

        {/* Session count */}
        <span className="shrink-0 text-foreground/78 max-[378px]:text-[9px]">
          <span className="font-mono tabular-nums text-foreground">{sessionCount}</span>
          <span className="ml-1 sm:hidden">sessions</span>
          <span className="ml-1 hidden sm:inline">active sessions</span>
        </span>

        {/* Gateway uptime (hidden on narrow/medium screens) */}
        <span className="hidden text-border lg:inline">•</span>
        <span className="hidden text-foreground/72 lg:inline">
          Uptime <span className="font-mono tabular-nums">{gatewayUptimeSecs !== null ? formatUptime(gatewayUptimeSecs) : '--:--:--'}</span>
        </span>

        {/* Context Meter (always visible when available) */}
        {contextTokens != null && contextLimit != null && contextLimit > 0 && (
          <>
            <span className="text-border max-[378px]:text-[8px]">•</span>
            <span className="inline-flex shrink-0">
              <ContextMeter used={contextTokens} limit={contextLimit} />
            </span>
          </>
        )}
      </div>

      {/* Right side telemetry (hidden on smaller screens) */}
      <div className="ml-3 hidden shrink-0 items-center gap-2 lg:flex">
        <span className="rounded-full border border-border/70 bg-background/75 px-2.5 py-1 font-mono text-[10px] tracking-[-0.08em] text-muted-foreground">
          {sparkline}<span className="ml-1 text-primary animate-alive">_</span>
        </span>
        <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground/55">v{__APP_VERSION__}</span>
        <UpdateBadge />
      </div>
    </div>
  );
}
