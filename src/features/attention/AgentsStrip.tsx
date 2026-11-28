/**
 * The Agents strip: one line per top-level agent, working ones first. The name is set in the
 * names face and the agent's hue, then what it is doing in words and for how long. A task run
 * that went quiet says so and offers Stop; an idle agent just says idle. A line opens the
 * agent's main chat.
 */

import { Pane } from '@/components/ui/Pane';
import { nameHueStyle } from '@/lib/agentColors';
import { timeAgo } from '@/lib/formatting';
import { cn } from '@/lib/utils';
import { ActionButton, ActionError, StopConfirm } from './AttentionActions';
import { useItemActions, type AttentionActionsConfig } from './useAttentionActions';
import type { AgentLine } from './buildAgents';
import type { AttentionItem, OpenTarget } from './types';

function since(ts: number | undefined, now: number): string | null {
  if (ts === undefined) return null;
  const age = timeAgo(ts, now);
  return age === 'now' ? 'just now' : age;
}

/**
 * Stop for the task run on a line, with its confirm step; it never opens the chat. A quiet run
 * shows it outright; a healthy one keeps it out of sight at the desk until the line is hovered
 * or focused, so the strip stays quiet.
 */
function RunStop({ item, actions, compact, reveal }: { item: AttentionItem; actions: AttentionActionsConfig; compact: boolean; reveal: boolean }) {
  const state = useItemActions(item, actions);
  if (state.actions.primary !== 'stop') return null;
  return (
    <span className={cn('flex shrink-0 flex-col items-end gap-1', reveal && !state.confirming && 'opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-within:opacity-100')}>
      {state.confirming
        ? <StopConfirm state={state} compact={compact} />
        : <ActionButton state={state} action="stop" variant="text" compact={compact} className="text-[0.8rem]" />}
      {state.error && <ActionError message={state.error} />}
    </span>
  );
}

export function AgentsStrip({
  lines,
  now,
  compact,
  hueFor,
  onOpen,
  actions,
}: {
  lines: AgentLine[];
  now: number;
  compact: boolean;
  hueFor: (agentId: string) => string;
  onOpen: (target: OpenTarget) => void;
  actions: AttentionActionsConfig;
}) {
  return (
    <ul className="m-0 flex list-none flex-col p-0" aria-label="Agents">
      {lines.map((line) => {
        const hue = line.agentId ? hueFor(line.agentId) : undefined;
        const target = line.open;
        const age = since(line.since, now);
        const quietFor = line.quietSince !== undefined ? timeAgo(line.quietSince, now) : null;
        const pane = line.state === 'working'
          ? { state: 'live' as const, label: 'Running' }
          : { state: 'off' as const, label: line.state === 'quiet' ? 'Gone quiet' : 'Idle' };
        return (
          <li key={line.agentId ?? line.name} data-testid="agent-line" data-state={line.state} className={cn('group flex min-w-0 items-center gap-2', compact && 'border-b border-border pr-3')}>
            <button
              type="button"
              disabled={!target}
              onClick={() => { if (target) onOpen(target); }}
              aria-label={line.agentId && target?.type === 'session' ? `Open ${line.name}'s chat` : `Open ${line.activity ?? line.name}`}
              className={cn(
                'flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left transition-colors duration-[120ms] hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                compact ? 'min-h-[52px] py-2 pl-4' : 'min-h-[var(--row-unit)] rounded-[3px] px-1 py-1',
              )}
            >
              <Pane state={pane.state} hue={pane.state === 'off' ? hue : undefined} label={pane.label} />
              <span
                className={cn('w-[6.5rem] shrink-0 truncate', line.agentId ? 'font-display font-semibold' : 'text-muted-foreground', hue && 'name-hued')}
                style={nameHueStyle(hue)}
              >
                {line.name}
              </span>
              {line.state === 'idle' ? (
                <span className="min-w-0 flex-1 truncate text-[0.8rem] text-muted-foreground">idle</span>
              ) : (
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-[0.8rem]">
                  <span className="min-w-0 truncate text-foreground">{line.activity}</span>
                  {line.state === 'working' && age && <span className="shrink-0 font-mono tabular text-live-text">{age}</span>}
                  {line.more > 0 && <span className="shrink-0 text-muted-foreground">{`+${line.more}`}</span>}
                </span>
              )}
              {quietFor && (
                <span className="shrink-0 text-[0.8rem] text-foreground">
                  quiet <span className="font-mono tabular">{quietFor}</span>
                </span>
              )}
            </button>
            {line.stopItem && (
              <RunStop item={line.stopItem} actions={actions} compact={compact} reveal={!compact && line.state !== 'quiet'} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
