import { useState, useEffect } from 'react';
import type { ProcessingStage, ActivityLogEntry } from '@/contexts/ChatContext';
import { HeartbeatPulse } from './HeartbeatPulse';
import { ThinkingDots } from './ThinkingDots';
import { ActivityLog } from './ActivityLog';
import { formatElapsed } from '../utils';

interface ProcessingIndicatorProps {
  stage?: ProcessingStage;
  elapsedMs: number;
  lastEventTimestamp: number;
  currentToolDescription: string | null;
  activityLog: ActivityLogEntry[];
  isRecovering?: boolean;
  recoveryReason?: string | null;
}

/**
 * Processing status indicator shown during generation.
 *
 * Layout:
 * - Row 1: [HeartbeatPulse] [◆] [STAGE LABEL] [──] [ELAPSED] [ThinkingDots]
 * - Row 2: currentToolDescription or "Reasoning..." (indented, smaller, muted)
 * - Separator: thin dotted line (only if activityLog has entries)
 * - Activity log: scrolling feed of recent tool actions
 * - Stale warning: "Still working…" when no event for >30s
 */
export function ProcessingIndicator({
  stage,
  elapsedMs,
  lastEventTimestamp,
  currentToolDescription,
  activityLog,
  isRecovering = false,
  recoveryReason = null,
}: ProcessingIndicatorProps) {
  // Local timer for stale detection (1s resolution)
  // Lazy initializer avoids impure Date.now() call during render
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const secondsSinceEvent = lastEventTimestamp
    ? Math.floor((now - lastEventTimestamp) / 1000)
    : null;
  const isStale = secondsSinceEvent !== null && secondsSinceEvent > 30;

  // Description line: tool description during tool_use, "Reasoning..." during thinking
  const descriptionText =
    currentToolDescription ??
    (stage === 'thinking' ? 'Reasoning...' : null);

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      {/* Row 1: heartbeat + stage label + elapsed + dots */}
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-2 text-[0.8rem] font-semibold text-foreground">
          <HeartbeatPulse lastEventTimestamp={lastEventTimestamp} stage={stage} />
          <span className={`text-[0.667rem] ${stage === 'tool_use' ? 'text-green' : 'text-primary'}`}>◆</span>
          {stage === 'thinking' && (
            <span className="cockpit-badge animate-pulse" data-tone="primary">Thinking</span>
          )}
          {stage === 'tool_use' && (
            <span className="cockpit-badge" data-tone="success">Using tools</span>
          )}
          {(!stage || stage === 'streaming') && (
            <span className="cockpit-badge" data-tone="primary">Processing</span>
          )}
          <span className="mx-1 text-muted-foreground">──</span>
          <span className="font-mono tabular-nums text-muted-foreground">{formatElapsed(elapsedMs)}</span>
        </span>
        <ThinkingDots stage={stage} />
      </div>

      {/* Row 2: description line (indented to align past diamond) */}
      {descriptionText && (
        <div
          className="break-all text-[0.733rem] text-muted-foreground"
          style={{ paddingLeft: '2rem' }}
        >
          {descriptionText}
        </div>
      )}

      {/* Separator: thin dotted line, only if activity log has entries */}
      {activityLog.length > 0 && (
        <div
          className="border-border"
          style={{
            borderTop: '1px dotted var(--color-border)',
            marginTop: '2px',
            marginBottom: '2px',
            marginLeft: '2rem',
          }}
        />
      )}

      {/* Activity log */}
      {activityLog.length > 0 && (
        <div style={{ paddingLeft: '2rem' }}>
          <ActivityLog entries={activityLog} />
        </div>
      )}

      {/* Recovery status */}
      {isRecovering && (
        <div
          className="text-primary text-[0.733rem]"
          style={{
            paddingLeft: '2rem',
          }}
        >
          Resyncing transcript…{recoveryReason ? ` ${recoveryReason}` : ''}
        </div>
      )}

      {/* Stale warning */}
      {isStale && (
        <div
          className="text-orange text-[0.733rem]"
          style={{
            paddingLeft: '2rem',
            animation: 'stale-pulse 2s ease-in-out infinite',
          }}
        >
          Still working… last update {secondsSinceEvent}s ago
        </div>
      )}
    </div>
  );
}
