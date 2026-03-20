import type { ActivityLogEntry } from '@/contexts/ChatContext';

interface ActivityLogProps {
  entries: ActivityLogEntry[];
  maxVisible?: number;
}

/**
 * Scrolling feed of recent tool-call activity with tree connectors.
 * Shows completed entries muted with ✓, running entries green with animated dots.
 */
export function ActivityLog({ entries, maxVisible = 4 }: ActivityLogProps) {
  if (entries.length === 0) return null;

  const visible = entries.slice(-maxVisible);
  const lastIdx = visible.length - 1;

  return (
    <div className="flex flex-col text-[0.733rem]" style={{ fontFamily: 'var(--font-mono, monospace)', lineHeight: 1.6 }}>
      {visible.map((entry, i) => {
        const isLast = i === lastIdx;
        const connector = isLast ? '└' : '├';

        return (
          <div
            key={entry.id}
            className={`flex items-center gap-1.5 ${
              entry.phase === 'completed' ? 'text-muted-foreground' : 'text-green'
            }`}
            style={{ animation: 'activity-fade-in 0.2s ease-out' }}
          >
            <span className="text-border select-none">{connector}</span>
            <span className="break-all">{entry.description}</span>
            {entry.phase === 'completed' && (
              <span className="text-green text-[0.667rem] shrink-0">✓</span>
            )}
            {entry.phase === 'running' && (
              <span className="inline-flex text-green text-xs shrink-0">
                <span className="animate-[dot-fade_1.4s_infinite_0s] opacity-0">.</span>
                <span className="animate-[dot-fade_1.4s_infinite_0.2s] opacity-0">.</span>
                <span className="animate-[dot-fade_1.4s_infinite_0.4s] opacity-0">.</span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
