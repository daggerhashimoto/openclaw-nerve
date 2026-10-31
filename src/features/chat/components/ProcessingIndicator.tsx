import { useState, useEffect } from 'react';
import type { ProcessingStage, ActivityLogEntry } from '@/contexts/ChatContext';
import { Pane } from '@/components/ui/Pane';
import { ThinkingDots } from './ThinkingDots';
import { ActivityLog } from './ActivityLog';
import { formatClock } from '../utils';

interface ProcessingIndicatorProps {
  stage?: ProcessingStage;
  elapsedMs: number;
  lastEventTimestamp: number;
  currentToolDescription: string | null;
  activityLog: ActivityLogEntry[];
  isRecovering?: boolean;
  recoveryReason?: string | null;
  /** Agent display name for the header line. */
  agentName?: string;
}

/**
 * Processing status shown in the transcript while the agent works and before
 * any prose streams in. It reads like the head of the agent's next message:
 *
 * - Header line: live pane, agent name, run state ("Thinking", "Running",
 *   "Writing") and the elapsed clock
 * - The current tool description when no running tool row already shows it
 * - Recent tool calls as a stack of tool rows
 * - Recovery and stale notes as plain muted text
 */
export function ProcessingIndicator({
  stage,
  elapsedMs,
  lastEventTimestamp,
  currentToolDescription,
  activityLog,
  isRecovering = false,
  recoveryReason = null,
  agentName = 'Agent',
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

  // The running tool row already names the tool; only repeat it when no row does.
  const hasRunningRow = activityLog.some((entry) => entry.phase === 'running');
  const descriptionText = !hasRunningRow ? currentToolDescription : null;

  return (
    <div className="relative flex flex-col gap-1.5 pb-1 pl-6 pt-2" aria-label={`${agentName} is working`} role="group">
      <div className="flex min-h-[var(--row-unit)] items-center gap-2 text-[0.867rem]">
        <Pane state="live" size="sm" className="absolute left-0 top-[1.1rem]" />
        <span className="min-w-0 truncate font-display font-semibold text-foreground">{agentName}</span>
        <ThinkingDots stage={stage} />
        <span className="shrink-0 font-mono text-[0.8rem] tabular text-live-text">{formatClock(elapsedMs)}</span>
      </div>

      {descriptionText && (
        <div className="break-all font-mono text-[0.8rem] text-muted-foreground">
          {descriptionText}
        </div>
      )}

      {activityLog.length > 0 && <ActivityLog entries={activityLog} />}

      {isRecovering && (
        <div className="text-[0.8rem] text-muted-foreground">
          Resyncing transcript{recoveryReason ? `: ${recoveryReason}` : ''}
        </div>
      )}

      {isStale && (
        <div className="text-[0.8rem] text-muted-foreground">
          Still working, last update <span className="font-mono tabular">{secondsSinceEvent}s</span> ago
        </div>
      )}
    </div>
  );
}
