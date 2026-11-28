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
import { ReceiptLine } from './Receipts';
import { agentNavKey, runItemCommand } from './itemCommands';
import { useHints, useItemCommands, useTriage } from './triage';
import { KeyHint } from './KeyHint';
import { useItemActions, type AttentionActionsConfig, type ItemActionsState } from './useAttentionActions';
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
 * or focused, so the strip stays quiet. While a Stop waits for its undo window the line says so.
 */
function RunStop({
  state,
  compact,
  reveal,
  hints,
}: {
  state: ItemActionsState;
  compact: boolean;
  reveal: boolean;
  hints: boolean;
}) {
  const triage = useTriage();
  if (state.actions.primary !== 'stop') return null;
  if (state.pending && triage) {
    return <ReceiptLine entry={state.pending} compact={compact} onUndo={triage.undo} hints={hints} className="min-h-0 border-0 px-0 pl-0" />;
  }
  return (
    <span className={cn('flex shrink-0 flex-col items-end gap-1', reveal && !state.confirming && !hints && 'opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-within:opacity-100')}>
      {state.confirming
        ? <StopConfirm state={state} compact={compact} />
        : <ActionButton state={state} action="stop" variant="text" compact={compact} className="text-[0.8rem]" />}
      {state.error && <ActionError message={state.error} />}
    </span>
  );
}

const PLACEHOLDER: AttentionItem = {
  key: '',
  source: 'tasks',
  sourceId: '',
  kind: 'task-running',
  section: 'progress',
  title: '',
  updatedAt: 0,
  priority: 'normal',
  freshness: 'live',
  open: null,
  detail: {},
};

function AgentRow({
  line,
  now,
  compact,
  hueFor,
  onOpen,
  actions,
}: {
  line: AgentLine;
  now: number;
  compact: boolean;
  hueFor: (agentId: string) => string;
  onOpen: (target: OpenTarget) => void;
  actions: AttentionActionsConfig;
}) {
  const navKey = agentNavKey(line);
  const hints = useHints(navKey) && !compact;
  // A line without a task run still answers o; its stop state is never shown.
  const actionState = useItemActions(line.stopItem ?? PLACEHOLDER, line.stopItem ? actions : undefined);
  // The keycaps and the board's commands follow the line, not the run behind it.
  const state: ItemActionsState = { ...actionState, itemKey: navKey };
  useItemCommands(navKey, (command) => {
    if (command === 'stop') return Boolean(line.stopItem) && runItemCommand('stop', { state, open: true });
    if (command === 'open') {
      if (!line.open) return false;
      onOpen(line.open);
      return true;
    }
    return false;
  });
  const hue = line.agentId ? hueFor(line.agentId) : undefined;
  const target = line.open;
  const age = since(line.since, now);
  const quietFor = line.quietSince !== undefined ? timeAgo(line.quietSince, now) : null;
  const pane = line.state === 'working'
    ? { state: 'live' as const, label: 'Running' }
    : { state: 'off' as const, label: line.state === 'quiet' ? 'Gone quiet' : 'Idle' };
  return (
    <li
      data-testid="agent-line"
      data-state={line.state}
      data-nav-key={target || line.stopItem ? navKey : undefined}
      data-nav-current={hints || undefined}
      className={cn(
        'group flex min-w-0 items-center gap-2',
        compact && 'border-b border-border pr-3',
        hints && 'rounded-[3px] outline-1 outline-offset-1 outline-border',
      )}
    >
      <button
        type="button"
        data-nav-head=""
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
        <KeyHint show={hints && Boolean(target)} k="o" />
      </button>
      {line.stopItem && (
        <RunStop state={state} compact={compact} reveal={!compact && line.state !== 'quiet'} hints={hints} />
      )}
    </li>
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
      {lines.map((line) => (
        <AgentRow key={line.agentId ?? line.name} line={line} now={now} compact={compact} hueFor={hueFor} onOpen={onOpen} actions={actions} />
      ))}
    </ul>
  );
}
