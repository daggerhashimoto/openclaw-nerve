import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Pane } from '@/components/ui/Pane';
import type { PaneState } from '@/lib/paneState';
import { cn } from '@/lib/utils';
import { escapeRegex } from '@/lib/constants';
import { splitToolDescription } from '../utils';

/** Shared geometry for one tool row: a 28px line of mono text. */
export const toolRowClass =
  'flex min-h-[var(--row-unit)] w-full min-w-0 items-center gap-2 px-2.5 text-left font-mono text-[0.8rem] leading-none';

/** Hover and focus treatment for tool rows that expand. */
export const toolRowButtonClass =
  'cursor-pointer transition-colors duration-[120ms] hover:bg-raised focus-visible:bg-raised';

/** One plate that holds consecutive tool rows, separated by hairlines (see .tool-stack in index.css). */
export const toolStackClass = 'tool-stack divide-y divide-border';

/**
 * The current search match on a tool row: the operator's ring that marks a matching message,
 * drawn inside the row because the tool stack clips what falls outside it.
 */
export const toolRowMatchClass = 'ring-1 ring-inset ring-operator/60';

/** Text with the search terms marked, as message bodies mark them. */
export function SearchHighlight({ text, query }: { text: string; query?: string }) {
  if (!query?.trim()) return <>{text}</>;

  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
  const parts = text.split(regex);

  // split() with a capture group alternates: non-match, match, non-match, ...
  // Odd indices are always the captured matches
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="search-highlight">{part}</mark>
        ) : part
      )}
    </>
  );
}

const TOOL_PANE_LABEL: Record<PaneState, string | undefined> = {
  live: 'Running',
  operator: 'Waiting on you',
  error: 'Failed',
  off: undefined,
};

interface ToolRowContentProps {
  /** Pane state: live while running, off when done, error when failed. */
  state: PaneState;
  /** Tool description, e.g. "exec: ls -la" or "reading src/app.ts". */
  text: string;
  /** Right-aligned measure: duration, elapsed clock, diff stat or time. */
  meta?: string;
  /** Show an expand affordance at the end of the row. */
  expandable?: boolean;
  expanded?: boolean;
  /** Optional transform for the visible text (search highlighting). */
  renderText?: (text: string) => ReactNode;
}

/**
 * A tool's result under its open row, as plain text: React renders it as a text
 * node, so markdown and angle brackets in the result are shown, never interpreted.
 */
export function ToolResultText({ text, searchQuery }: { text: string; searchQuery?: string }) {
  return (
    <pre className="tool-result m-0 max-h-[300px] overflow-y-auto whitespace-pre-wrap break-words font-mono text-[0.8rem] text-muted-foreground [overflow-wrap:anywhere]">
      {text.trim() ? <SearchHighlight text={text} query={searchQuery} /> : '(empty result)'}
    </pre>
  );
}

/**
 * The inside of a tool row: pane, verb, arguments, measure.
 * Wrap it in a button (expandable rows) or a div (plain rows) using toolRowClass.
 */
export function ToolRowContent({ state, text, meta, expandable, expanded, renderText }: ToolRowContentProps) {
  const { verb, args } = splitToolDescription(text);
  const render = renderText ?? ((value: string) => value);

  return (
    <>
      <Pane state={state} size="sm" label={TOOL_PANE_LABEL[state]} />
      <span className="max-w-[45%] shrink-0 truncate py-1.5 text-foreground">{render(verb)}</span>
      <span className="min-w-0 flex-1 truncate py-1.5 text-muted-foreground">{args ? render(args) : null}</span>
      {meta && (
        <span className={cn('shrink-0 tabular', state === 'live' ? 'text-live-text' : 'text-muted-foreground')}>
          {meta}
        </span>
      )}
      {expandable && (
        expanded
          ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          : <ChevronRight size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
    </>
  );
}
