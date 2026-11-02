import type { ProcessingStage } from '@/contexts/ChatContext';

/**
 * Format elapsed time as MM:SS.T (minutes, seconds, tenths)
 */
/** Local calendar day of a timestamp, as a sortable key. */
export function dayKey(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The day in words for a transcript divider: Today, Yesterday, then "Mon 20 May",
 * with the year only once the day is in another year.
 */
export function dayLabel(date: Date, now: Date = new Date()): string {
  const key = dayKey(date);
  if (key === dayKey(now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (key === dayKey(yesterday)) return 'Yesterday';
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const sec = (totalSec % 60).toString().padStart(2, '0');
  const tenth = Math.floor((ms % 1000) / 100);
  return `${min}:${sec}.${tenth}s`;
}

/** Format a running clock as mm:ss (hours roll into minutes). */
export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const sec = (totalSec % 60).toString().padStart(2, '0');
  return `${min}:${sec}`;
}

/** Format a finished duration compactly: 0.8s, 12s, 2m 05s. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = (totalSec % 60).toString().padStart(2, '0');
  return `${min}m ${sec}s`;
}

/** Plain-language run state for a processing stage, shown beside a live pane. */
export function runStateLabel(stage: ProcessingStage | undefined): string {
  switch (stage) {
    case 'thinking':
      return 'Thinking';
    case 'tool_use':
      return 'Running';
    case 'streaming':
      return 'Writing';
    default:
      return 'Working';
  }
}

/**
 * Split a tool description ("exec: ls -la", "reading src/app.ts") into the
 * verb and its arguments so a tool row can set the verb apart.
 */
export function splitToolDescription(text: string): { verb: string; args: string } {
  const trimmed = text.trim();
  const colon = trimmed.match(/^([^:\s][^:]{0,39}):\s+([\s\S]*)$/);
  if (colon) return { verb: colon[1], args: colon[2] };
  const space = trimmed.indexOf(' ');
  if (space === -1) return { verb: trimmed, args: '' };
  return { verb: trimmed.slice(0, space), args: trimmed.slice(space + 1) };
}
