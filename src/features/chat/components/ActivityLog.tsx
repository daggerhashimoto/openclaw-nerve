import { useEffect, useState } from 'react';
import type { ActivityLogEntry } from '@/contexts/ChatContext';
import { formatClock, formatDuration } from '../utils';
import { ToolRowContent, toolRowClass, toolStackClass } from './ToolRow';

interface ActivityLogProps {
  entries: ActivityLogEntry[];
  maxVisible?: number;
}

/**
 * Live feed of recent tool calls: one 28px row per call in a bordered stack.
 * A running call is lit blue and shows its elapsed clock; a finished call goes
 * dark and shows how long it took.
 */
export function ActivityLog({ entries, maxVisible = 4 }: ActivityLogProps) {
  const hasRunning = entries.some((entry) => entry.phase === 'running');
  // Lazy initializer avoids an impure Date.now() call during render.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!hasRunning) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [hasRunning]);

  if (entries.length === 0) return null;

  const visible = entries.slice(-maxVisible);

  return (
    <div className={toolStackClass} role="group" aria-label="Recent tool calls">
      {visible.map((entry) => {
        const running = entry.phase === 'running';
        const meta = running
          ? formatClock(now - entry.startedAt)
          : entry.completedAt
            ? formatDuration(entry.completedAt - entry.startedAt)
            : undefined;

        return (
          <div key={entry.id} className={toolRowClass}>
            <ToolRowContent state={running ? 'live' : 'off'} text={entry.description} meta={meta} />
          </div>
        );
      })}
    </div>
  );
}
