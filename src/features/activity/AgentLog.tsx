import type { AgentLogEntry } from '@/types';
import { Pane } from '@/components/ui/Pane';
import { logPaneState } from './activityWords';

interface AgentLogProps {
  entries: AgentLogEntry[];
  /** The agent is working right now; the header pane lights blue. */
  glow?: boolean;
}

/** The agent log: one line per thing the fleet did, newest first, with a pane that lights only for failures and approvals. */
export function AgentLog({ entries, glow }: AgentLogProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="panel-header pr-3">
        <span className="panel-label">Agent log</span>
        {glow && <Pane state="live" size="sm" label="Agent working" />}
        <span className="ml-auto font-mono text-[0.8rem] tabular text-muted-foreground">{entries.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1" role="log" aria-label="Agent activity log">
        {entries.length === 0 ? (
          <div className="flex min-h-[var(--row-unit)] items-center px-3 text-[0.8rem] text-muted-foreground">Nothing logged yet.</div>
        ) : entries.map((e, i) => {
          const time = new Date(e.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const state = logPaneState(e.icon);
          return (
            <div key={`${e.ts}-${i}`} className="flex min-h-[1.6rem] items-center gap-2 px-3 text-[0.8rem]">
              <Pane state={state} size="sm" label={state === 'error' ? 'Failed' : state === 'operator' ? 'Waiting on you' : undefined} />
              <span className="w-[4.4rem] shrink-0 font-mono tabular text-muted-foreground">{time}</span>
              <span className={`min-w-0 flex-1 truncate ${state === 'error' ? 'text-destructive' : 'text-foreground'}`}>{e.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
