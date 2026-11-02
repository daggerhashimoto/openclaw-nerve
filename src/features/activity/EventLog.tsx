import type { EventEntry } from '@/types';
import { Pane } from '@/components/ui/Pane';
import { timeAgo } from '@/lib/formatting';
import { eventKind } from './activityWords';

interface EventLogProps {
  entries: EventEntry[];
}

/** Raw gateway events for debugging: kind in mono, what happened, how long ago. Errors carry a red pane. */
export function EventLog({ entries }: EventLogProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="panel-header pr-3">
        <span className="panel-label">Events</span>
        <span className="ml-auto font-mono text-[0.8rem] tabular text-muted-foreground">{entries.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1 text-[0.8rem]" role="log" aria-label="Event log">
        {entries.length === 0 ? (
          <div className="flex min-h-[var(--row-unit)] items-center px-3 text-muted-foreground">No events yet.</div>
        ) : entries.map((e, i) => {
          const isError = e.badgeCls === 'badge-error';
          return (
            <div key={`${e.badge}-${+e.ts}-${i}`} className="flex min-h-[1.6rem] items-center gap-2 px-3">
              <Pane state={isError ? 'error' : 'off'} size="sm" label={isError ? 'Failed' : undefined} />
              <span className={`w-12 shrink-0 font-mono ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>{eventKind(e.badge)}</span>
              <span className={`min-w-0 flex-1 truncate ${isError ? 'text-destructive' : 'text-foreground'}`}>{e.desc}</span>
              <span className="shrink-0 font-mono tabular text-muted-foreground">{timeAgo(e.ts)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
