import type { EventEntry } from '@/types';
import { timeAgo } from '@/lib/formatting';

interface EventLogProps {
  entries: EventEntry[];
}

const badgeColors: Record<string, string> = {
  'badge-chat': 'bg-green/20 text-green',
  'badge-agent': 'bg-purple/20 text-purple',
  'badge-cron': 'bg-orange/20 text-orange',
  'badge-system': 'bg-muted-foreground/20 text-muted-foreground',
  'badge-error': 'bg-red/20 text-red',
};

/** Scrollable list of raw gateway events for debugging. */
export function EventLog({ entries }: EventLogProps) {
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="panel-header border-l-[3px] border-l-purple">
        <span className="panel-label text-purple">
          <span className="panel-diamond">◆</span>
          EVENTS
        </span>
        <span className="text-muted-foreground text-[0.733rem]">{entries.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto text-[0.733rem]" role="log" aria-label="Event log">
        {entries.map((e, i) => (
          <div key={`${e.badge}-${+e.ts}-${i}`} className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40">
            <span className={`inline-block text-[0.6rem] font-bold tracking-[1px] uppercase px-1.5 py-0.5 rounded-sm shrink-0 min-w-12 text-center ${badgeColors[e.badgeCls] || badgeColors['badge-system']}`}>
              {e.badge}
            </span>
            <span className="flex-1 text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">{e.desc}</span>
            <span className="text-muted-foreground shrink-0 text-[0.667rem]">{timeAgo(e.ts)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
