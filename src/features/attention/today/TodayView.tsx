/**
 * Today: the operator's day so far, beside the Now board in the Attention view. A heading, one
 * quiet line of facts that filter or jump to their rows, and a short model-written paragraph;
 * then the board's grid: Chats today in the wide column and Done today in the rail.
 *
 * Chats today come first. Each chat row says what it is about (the first sentence of its "What
 * happened", whole) and whose turn it is: Waiting on you when the Now board holds the session
 * against the operator or its agent's last message asks them something, Working while a run is
 * active. Subagents sit under their parent with how they ended. Every chat's summary is asked in
 * one request; the server answers cached ones cheaply.
 *
 * Done today is a timeline: crons still failing pinned on top with Run now, then tasks (with the
 * pull requests they merged), then cron failures that recovered as one line each, then every
 * successful cron run folded into one quiet line. Finished rows keep a dark pane; the agent's
 * hue is on its name only.
 *
 * Writes are the operator's own: Run now and Pause through Now's item actions, and Reply, Nudge
 * or Ask into a session through the board's reply store. Sources fail on their own and are
 * named. Open rows and the filter live while the view is mounted; open sections are remembered
 * per browser. While any row is open the order is frozen (useStableOrder).
 */

import { useMemo, useState, useSyncExternalStore } from 'react';
import { dayHeading } from './dayHeading';
import { ChevronRight } from 'lucide-react';
import { Pane } from '@/components/ui/Pane';
import type { KanbanTask } from '@/features/kanban/types';
import type { CronJob } from '@/features/workspace/hooks/useCrons';
import { useAgentHues, nameHueStyle } from '@/lib/agentColors';
import { timeAgo } from '@/lib/formatting';
import { cn } from '@/lib/utils';
import type { GranularAgentState, Session } from '@/types';
import { formatClock, formatDayClock } from '../briefCopy';
import { Clocked, NewTag } from '../textBits';
import { WhatHappened } from '../AttentionCard';
import { ActionButton, ActionError, ActionStrip } from '../AttentionActions';
import { ReplyButton, ReplyField, ReplyPanel, type ReplyConfig } from '../AttentionReply';
import { TEXT_BUTTON, variantClass } from '../actionStyles';
import { useInlineReply } from '../useInlineReplies';
import { useAttentionSummaries, type ThreadSummary } from '../useAttentionSummaries';
import { useItemActions, type AttentionActionsConfig } from '../useAttentionActions';
import { useStableOrder } from '../useStableOrder';
import type { AttentionItem, OpenTarget, SourceStatus } from '../types';
import {
  buildDay,
  dayFacts,
  firstSentence,
  flattenChats,
  startOfLocalDay,
  turnOf,
  type ChatRow,
  type DayRow,
  type DaySource,
  type ReplyTarget,
} from './buildDay';
import { useCronRuns } from './useCronRuns';
import { useDaySummary } from './useDaySummary';
import { useTodaySections, type TodaySection } from './todaySections';

const SOURCE_NAMES: Record<DaySource, string> = {
  tasks: 'Tasks',
  crons: 'Crons',
  cronRuns: 'Cron runs',
  sessions: 'Sessions',
};
const SECTION_SOURCES: Record<TodaySection, DaySource[]> = {
  done: ['tasks', 'crons', 'cronRuns'],
  chats: ['sessions'],
};
/** The summaries route answers this many keys per request. */
export const MAX_SUMMARY_KEYS = 50;
/** The paragraph is asked again this often while the view is open; cached answers are cheap. */
const SUMMARY_REASK_MS = 5 * 60_000;
/** Chats are asked again when their activity moves past a minute, not on every update. */
const ACTIVITY_STEP_MS = 60_000;

/** Pane width, and the row gaps at the desk and on phones, for detail that lines up with titles. */
const PANE_REM = 0.667;
const GAP_REM = { desk: 0.625, phone: 0.75 };
const TIME_REM = 2.75;

export type TodayFilter = 'done' | 'merged' | 'failing' | null;

export interface TodayViewProps {
  active: boolean;
  /** The board's header row already shows the date and Refresh; Today then skips its own. */
  hideHeading?: boolean;
  compact: boolean;
  now: number;
  tasks: KanbanTask[];
  crons: CronJob[];
  sources: { tasks: SourceStatus; crons: SourceStatus; sessions: SourceStatus };
  sessions: Session[];
  agentStatus: Record<string, GranularAgentState>;
  busyState: Record<string, boolean>;
  /** Session keys the Now brief holds against the operator, with the kind word. */
  needsReply: ReadonlyMap<string, string>;
  agentNames: ReadonlyMap<string, string>;
  replies: ReplyConfig;
  /** Now's item actions; without them Run now refreshes the view when it lands. */
  actions?: AttentionActionsConfig;
  /** Set while the gateway is lost; the view's notice already says so. */
  disconnectedSince: number | null;
  onOpen: (target: OpenTarget) => void;
  onRefresh: () => void;
  /** Changes on every Refresh. */
  refreshSignal: number;
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}


function ago(ts: number, now: number): string {
  const age = timeAgo(ts, now);
  return age === 'now' ? 'just now' : `${age} ago`;
}

function duration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
}

/** Sources that keep the day from reading complete, in words. Empty on a normal day. */
function gapSentences(sources: Record<DaySource, SourceStatus>, hidden: (source: DaySource) => boolean): string[] {
  const all = Object.keys(SOURCE_NAMES) as DaySource[];
  const errors = all.filter((source) => sources[source].state === 'error' && !hidden(source));
  const out: string[] = [];
  if (errors.length > 0) {
    out.push(`${joinWords(errors.map((source) => SOURCE_NAMES[source]))} could not be read, so this day may be incomplete.`);
  }
  if (sources.tasks.state === 'off') out.push('Tasks are turned off, so done tasks and merged pull requests are not counted.');
  return out;
}

export function TodayView({
  active,
  hideHeading = false,
  compact,
  now,
  tasks,
  crons,
  sources,
  sessions,
  agentStatus,
  busyState,
  needsReply,
  agentNames,
  replies,
  actions,
  disconnectedSince,
  onOpen,
  onRefresh,
  refreshSignal,
}: TodayViewProps) {
  const dayStart = startOfLocalDay(now);
  const cronRuns = useCronRuns({ active, crons, cronsStatus: sources.crons, dayStart });
  const daySources = useMemo<Record<DaySource, SourceStatus>>(() => ({
    tasks: sources.tasks,
    crons: sources.crons,
    cronRuns: cronRuns.status,
    sessions: sources.sessions,
  }), [sources.tasks, sources.crons, sources.sessions, cronRuns.status]);

  const day = useMemo(() => buildDay({
    now,
    tasks,
    crons,
    cronRuns: cronRuns.runs,
    sessions,
    agentStatus,
    busyState,
    needsReply,
    agentNames,
    sources: daySources,
  }), [now, tasks, crons, cronRuns.runs, sessions, agentStatus, busyState, needsReply, agentNames, daySources]);

  // Without the cron list its runs cannot be asked; the Crons note speaks for both. A lost
  // gateway is told by the view's own notice.
  const hiddenNote = (source: DaySource) => (
    (source === 'cronRuns' && daySources.crons.state !== 'live')
    || (source === 'sessions' && disconnectedSince !== null)
  );

  const allChats = useMemo(() => flattenChats(day.chats), [day.chats]);
  const agentIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const row of [...day.failing, ...day.done, ...day.cronsOk]) if (row.agentId) ids.add(row.agentId);
    for (const row of allChats) if (row.agentId) ids.add(row.agentId);
    return [...ids].sort().join('|');
  }, [day, allChats]);
  const agentIds = useMemo(() => (agentIdsKey ? agentIdsKey.split('|') : []), [agentIdsKey]);
  const { hueFor } = useAgentHues(agentIds);

  // The paragraph is asked only once every source has answered, so a half-read day is never
  // summarized as the whole day.
  const allAnswered = (Object.keys(daySources) as DaySource[]).every((source) => daySources[source].state !== 'loading');
  const missing = (Object.keys(daySources) as DaySource[])
    .filter((source) => daySources[source].state === 'error')
    .map((source) => SOURCE_NAMES[source].toLowerCase());
  const facts = allAnswered ? dayFacts(day, missing) : null;
  const summary = useDaySummary({
    active,
    facts,
    signal: `${refreshSignal}|${Math.floor(now / SUMMARY_REASK_MS)}`,
  });

  // Rows open in place; while any is open the order holds still.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const liveDoneEpoch = `live:${day.done.map((row) => row.key).join('|')}`;
  const liveChatsEpoch = `live:${day.chats.map((row) => row.key).join('|')}`;
  const [frozen, setFrozen] = useState<{ done: string; chats: string } | null>(null);
  const presentKeys = useMemo(() => new Set([
    ...[...day.failing, ...day.done, ...day.cronsOk].map((row) => `done:${row.key}`),
    ...allChats.map((row) => `chat:${row.key}`),
  ]), [day, allChats]);
  // Only rows still in the day hold the order.
  const openCount = [...expanded].filter((key) => presentKeys.has(key)).length;
  const holding = openCount > 0 && frozen !== null;
  const done = useStableOrder(day.done, holding ? frozen.done : liveDoneEpoch);
  const chats = useStableOrder(day.chats, holding ? frozen.chats : liveChatsEpoch);

  const setRowOpen = (key: string, open: boolean) => {
    if (open === expanded.has(key)) return;
    if (open && openCount === 0) setFrozen({ done: liveDoneEpoch, chats: liveChatsEpoch });
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  const toggle = (key: string) => setRowOpen(key, !expanded.has(key));

  const sections = useTodaySections(compact);
  const [okOpen, setOkOpen] = useState(false);
  const [filter, setFilter] = useState<TodayFilter>(null);

  // Which row a reply was sent from, per target session, so only that row shows it.
  const [sentFrom, setSentFrom] = useState<Record<string, string>>({});
  const markSent = (sessionKey: string, rowKey: string) => setSentFrom((prev) => ({ ...prev, [sessionKey]: rowKey }));

  // Every chat's summary and turn, plus open task rows' threads, in one request.
  const summaryKeys = useMemo(() => {
    const keys: string[] = [];
    for (const row of day.done) if (expanded.has(`done:${row.key}`) && row.sessionKey) keys.push(row.sessionKey);
    for (const row of allChats) keys.push(row.key);
    return [...new Set(keys)].slice(0, MAX_SUMMARY_KEYS);
  }, [day.done, allChats, expanded]);
  const chatsSignal = allChats.map((row) => `${row.key}:${Math.floor(row.lastActivity / ACTIVITY_STEP_MS)}:${row.running ? 1 : 0}`).join('|');
  const repliesEnded = useSyncExternalStore(
    replies.store.subscribe,
    () => summaryKeys.map((key) => replies.store.get(key)?.endedAt ?? '').join('|'),
  );
  const threadSummaries = useAttentionSummaries({
    active,
    sessionKeys: summaryKeys,
    signal: `${refreshSignal}|${repliesEnded}|${chatsSignal}`,
  });

  // Run now and Pause go through Now's actions; alone, Today refreshes once one lands.
  const kanbanEnabled = sources.tasks.state !== 'off';
  const fallbackActions = useMemo<AttentionActionsConfig>(() => ({ kanbanEnabled, onDone: () => onRefresh() }), [kanbanEnabled, onRefresh]);
  const itemActions = actions ?? fallbackActions;

  const gaps = gapSentences(daySources, hiddenNote);
  const rowProps: RowCommon = { compact, now, replies, onOpen, hueFor, nameOf: replies.nameOf, onSent: markSent, sentFrom, actions: itemActions };

  // Filters narrow the rows to what a fact counts.
  // Chats matter most: only the failing filter narrows them.
  const shownChats = filter === 'failing' ? pruneChats(chats.items, (row) => row.failing) : chats.items;
  const shownFailing = filter === null || filter === 'failing' ? day.failing : [];
  const shownDone = filter === 'failing'
    ? []
    : done.items.filter((row) => filter === null || (row.kind === 'task' && (filter === 'done' || (row.prs?.length ?? 0) > 0)));
  const showOk = filter === null && day.cronsOk.length > 0;

  const jump = (section: TodaySection) => {
    sections.set(section, true);
    // After the section renders open.
    requestAnimationFrame(() => document.getElementById(`today-${section}`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }));
  };
  const applyFilter = (next: TodayFilter) => {
    const value = filter === next ? null : next;
    setFilter(value);
    if (value === 'failing') {
      if (day.failing.length > 0) jump('done');
      if (day.stats.failing > day.failing.length) sections.set('chats', true);
    } else if (value) {
      jump('done');
    }
  };

  const { stats } = day;
  const factItems: Array<{ id: 'chats' | Exclude<TodayFilter, null>; n: number; word: string; tone?: 'error' }> = [
    { id: 'chats', n: stats.sessions, word: stats.sessions === 1 ? 'chat' : 'chats' },
    { id: 'done', n: stats.done, word: 'done' },
    ...(stats.merged > 0 ? [{ id: 'merged' as const, n: stats.merged, word: 'merged' }] : []),
    ...(stats.failing > 0 ? [{ id: 'failing' as const, n: stats.failing, word: 'failing', tone: 'error' as const }] : []),
  ];

  const clearFilter = filter && (
    <button type="button" onClick={() => setFilter(null)} className={cn(variantClass('text', compact), 'text-[0.8rem]')}>
      Show all
    </button>
  );

  const chatsSection = (
    <DaySection
      id="today-chats"
      title="Chats today"
      count={stats.sessions}
      open={sections.open.chats}
      onToggle={() => sections.toggle('chats')}
      compact={compact}
      trailing={filter === 'failing' ? clearFilter : null}
    >
      <TodayNotes sources={daySources} relevant={SECTION_SOURCES.chats} hidden={hiddenNote} compact={compact} onOpen={onOpen} />
      {shownChats.length > 0 ? (
        <div className={compact ? 'flex flex-col' : 'flex flex-col gap-0.5'}>
          {shownChats.map((row) => (
            <ChatRowView
              key={row.key}
              row={row}
              depth={0}
              newKeys={chats.newKeys}
              expanded={expanded}
              onToggle={toggle}
              setOpen={setRowOpen}
              summaries={threadSummaries}
              {...rowProps}
            />
          ))}
        </div>
      ) : filter === null ? (
        <Empty compact={compact} hidden={hasNotes(daySources, 'chats', hiddenNote)}>No chats yet today.</Empty>
      ) : (
        <Empty compact={compact} hidden={false}>No chat is failing.</Empty>
      )}
    </DaySection>
  );

  const doneCount = day.failing.length + day.done.length;
  const nothingDone = doneCount === 0 && day.cronsOk.length === 0;
  const doneSection = (
    <DaySection
      id="today-done"
      title="Done today"
      count={doneCount}
      open={sections.open.done}
      onToggle={() => sections.toggle('done')}
      compact={compact}
      trailing={filter && filter !== 'failing' ? clearFilter : filter === 'failing' && day.failing.length > 0 ? clearFilter : null}
    >
      <TodayNotes sources={daySources} relevant={SECTION_SOURCES.done} hidden={hiddenNote} compact={compact} onOpen={onOpen} />
      {nothingDone ? (
        <Empty compact={compact} hidden={hasNotes(daySources, 'done', hiddenNote)}>Nothing has finished yet today.</Empty>
      ) : (
        <div className={compact ? 'flex flex-col' : 'flex flex-col gap-0.5'}>
          {shownFailing.map((row) => (
            <FailingCronRow
              key={row.key}
              row={row}
              item={row.item!}
              open={expanded.has(`done:${row.key}`)}
              onToggle={() => toggle(`done:${row.key}`)}
              {...rowProps}
            />
          ))}
          {shownDone.map((row, index) => (
            <DoneRowView
              key={row.key}
              row={row}
              showTime={index === 0 || formatClock(shownDone[index - 1].at) !== formatClock(row.at)}
              isNew={done.newKeys.has(row.key)}
              open={expanded.has(`done:${row.key}`)}
              onToggle={() => toggle(`done:${row.key}`)}
              summary={row.sessionKey ? threadSummaries[row.sessionKey] : undefined}
              {...rowProps}
            />
          ))}
          {showOk && (
            <CronsOk
              rows={day.cronsOk}
              runs={stats.cronOk}
              partial={stats.cronPartial}
              open={okOpen}
              onToggle={() => setOkOpen((prev) => !prev)}
              expanded={expanded}
              onToggleRow={toggle}
              common={rowProps}
            />
          )}
          {filter !== null && shownFailing.length === 0 && shownDone.length === 0 && (
            <Empty compact={compact} hidden={false}>
              {filter === 'failing' ? 'No cron is failing.' : filter === 'merged' ? 'Nothing merged yet today.' : 'No task done yet today.'}
            </Empty>
          )}
        </div>
      )}
    </DaySection>
  );

  return (
    <div className={cn('flex w-full flex-col', compact ? 'gap-4 pb-8' : 'gap-6 pb-6')}>
      <section aria-label="Today summary" className={cn('flex flex-col gap-1.5', compact && 'px-4')}>
        {!hideHeading && (
          <div className="flex items-start gap-3">
            <h1 className={cn('m-0 font-semibold leading-tight text-foreground', compact ? 'text-[1.333rem]' : 'text-[1.2rem]')}>
              {dayHeading(now)}
            </h1>
            <span className="flex-1" />
            <button type="button" onClick={onRefresh} className={cn('shell-chip shrink-0', compact && 'min-h-11')}>
              Refresh
            </button>
          </div>
        )}
        <p data-testid="today-facts" className="m-0 flex flex-wrap items-center gap-x-1.5 text-[0.867rem] text-muted-foreground">
          {factItems.map((fact, index) => (
            <span key={fact.id} className="inline-flex items-center whitespace-nowrap">
              {index > 0 && <span aria-hidden="true" className="pr-1.5">·</span>}
              <button
                type="button"
                data-testid={`today-fact-${fact.id}`}
                aria-pressed={fact.id === 'chats' ? undefined : filter === fact.id}
                onClick={() => (fact.id === 'chats' ? jump('chats') : applyFilter(fact.id))}
                className={cn(
                  TEXT_BUTTON,
                  'decoration-transparent hover:decoration-operator',
                  compact && 'inline-block min-h-11 leading-[2.75rem]',
                  filter === fact.id && 'text-foreground decoration-foreground',
                )}
              >
                <span className={cn('font-mono tabular', fact.tone === 'error' ? 'text-destructive' : 'text-foreground')}>{fact.n}</span>
                {` ${fact.word}`}
              </button>
            </span>
          ))}
        </p>
        {summary?.text ? (
          <p data-testid="today-paragraph" className="m-0 max-w-[72ch] text-[1rem] leading-relaxed text-foreground">
            {summary.text}
          </p>
        ) : summary?.status === 'pending' ? (
          <p className="m-0 text-[0.867rem] text-muted-foreground" role="status">Summarizing the day...</p>
        ) : null}
        {gaps.length > 0 && (
          <p className="m-0 max-w-[90ch] text-[0.8rem] leading-normal text-muted-foreground">{gaps.join(' ')}</p>
        )}
      </section>

      {/* The board's grid: Chats in the wide column, Done in the rail; one column on phones. */}
      <div className={cn('attention-grid items-start', compact && 'gap-y-2!')}>
        <div className="flex min-w-0 flex-col">{chatsSection}</div>
        <div className="flex min-w-0 flex-col">{doneSection}</div>
      </div>
    </div>
  );
}

/** Rows that match, with the parents that lead to them. */
function pruneChats(rows: ChatRow[], match: (row: ChatRow) => boolean): ChatRow[] {
  return rows.flatMap((row) => {
    const children = pruneChats(row.children, match);
    return match(row) || children.length > 0 ? [{ ...row, children }] : [];
  });
}

function hasNotes(sources: Record<DaySource, SourceStatus>, section: TodaySection, hidden: (source: DaySource) => boolean): boolean {
  return SECTION_SOURCES[section].some((source) => {
    const state = sources[source].state;
    return state === 'loading' || (state === 'error' && !hidden(source)) || (section === 'done' && source === 'tasks' && state === 'off');
  });
}

function DaySection({
  id,
  title,
  count,
  open,
  onToggle,
  compact,
  trailing,
  children,
}: {
  id: string;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  compact: boolean;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex min-w-0 scroll-mt-4 flex-col gap-3">
      <div className="flex items-center gap-3 border-b border-border">
        <h2 className="m-0 min-w-0 flex-1 text-[0.867rem] font-semibold text-foreground">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-body`}
            onClick={onToggle}
            className={cn(
              'flex w-full cursor-pointer items-center gap-x-2 text-left hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
              compact ? 'min-h-11 px-4' : 'min-h-7',
            )}
          >
            <ChevronRight
              size={14}
              aria-hidden="true"
              className={cn('shrink-0 text-muted-foreground transition-transform duration-[120ms]', open && 'rotate-90')}
            />
            <span id={`${id}-title`}>{title}</span>
            <span data-testid={`${id}-count`} className="font-mono text-[0.8rem] font-normal tabular text-muted-foreground">{count}</span>
          </button>
        </h2>
        {trailing && <span className={cn('shrink-0', compact && 'pr-4')}>{trailing}</span>}
      </div>
      {open && <div id={`${id}-body`} className="flex min-w-0 flex-col gap-3">{children}</div>}
    </section>
  );
}

function Empty({ compact, hidden, children }: { compact: boolean; hidden: boolean; children: React.ReactNode }) {
  if (hidden) return null;
  return <p className={cn('m-0 text-[0.867rem] text-muted-foreground', compact && 'px-4')}>{children}</p>;
}

function TodayNotes({
  sources,
  relevant,
  hidden,
  compact,
  onOpen,
}: {
  sources: Record<DaySource, SourceStatus>;
  relevant: DaySource[];
  hidden: (source: DaySource) => boolean;
  compact: boolean;
  onOpen: (target: OpenTarget) => void;
}) {
  const errors = relevant.filter((source) => sources[source].state === 'error' && !hidden(source));
  const loading = relevant.filter((source) => sources[source].state === 'loading');
  const off = relevant.includes('tasks') && sources.tasks.state === 'off';
  if (errors.length === 0 && loading.length === 0 && !off) return null;
  return (
    <div className={cn('flex flex-col gap-1 text-[0.867rem] text-muted-foreground', compact && 'px-4')}>
      {errors.map((source) => {
        const error = sources[source].error?.trim();
        const panel = source === 'tasks' ? 'tasks' : source === 'sessions' ? null : 'crons';
        return (
          <p key={source} className="m-0 flex flex-wrap items-center gap-x-2">
            <span className="text-foreground">
              {error ? `${SOURCE_NAMES[source]} could not be read (${error}).` : `${SOURCE_NAMES[source]} could not be read.`}
            </span>
            {panel && (
              <button
                type="button"
                onClick={() => onOpen({ type: 'source', source: panel })}
                className={variantClass('text', compact)}
              >
                {panel === 'crons' ? 'Open Crons' : 'Open Tasks'}
              </button>
            )}
          </p>
        );
      })}
      {loading.length > 0 && (
        <p className="m-0">{`Loading ${joinWords(loading.map((source) => SOURCE_NAMES[source].toLowerCase()))}.`}</p>
      )}
      {off && <p className="m-0">Tasks are turned off.</p>}
    </div>
  );
}

// ── Rows ─────────────────────────────────────────────────────────────

interface RowCommon {
  compact: boolean;
  now: number;
  replies: ReplyConfig;
  onOpen: (target: OpenTarget) => void;
  hueFor: (agentId: string) => string;
  nameOf?: (sessionKey: string) => string | undefined;
  onSent: (sessionKey: string, rowKey: string) => void;
  sentFrom: Record<string, string>;
  actions: AttentionActionsConfig;
}

const ROW_BUTTON = 'flex min-w-0 flex-1 cursor-pointer items-start text-left transition-colors duration-[120ms] hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';

/** Left padding of a row's toggle, in rem: phones pad 16px, the desk 4px; nesting adds an indent. */
function rowInset(compact: boolean, depth = 0): number {
  return (compact ? 1 : 0.25) + depth * (compact ? 1.25 : 1.5);
}

/** Where the title starts, so an open row's detail lines up with it. */
function titleInset(compact: boolean, { time, depth = 0 }: { time: boolean; depth?: number }): number {
  const gap = compact ? GAP_REM.phone : GAP_REM.desk;
  return rowInset(compact, depth) + (time ? TIME_REM + gap : 0) + PANE_REM + gap;
}

function rowButtonClass(compact: boolean) {
  return cn(ROW_BUTTON, compact ? 'min-h-[60px] gap-3 py-2.5 pr-4' : 'min-h-[44px] gap-2.5 rounded-[3px] py-2 pr-1');
}

function Chevron({ open, compact }: { open: boolean; compact: boolean }) {
  // The whole row opens on a phone, so the chevron gives its width back to the text.
  if (compact) return null;
  return (
    <ChevronRight
      size={16}
      aria-hidden="true"
      className={cn('mt-0.5 shrink-0 text-muted-foreground transition-transform duration-[120ms]', open && 'rotate-90')}
    />
  );
}

/** The time column: printed once when rows in a row share a minute. */
function TimeCell({ at, show }: { at: number; show: boolean }) {
  return (
    <span className="w-[2.75rem] shrink-0 pt-px font-mono text-[0.8rem] tabular text-muted-foreground" aria-hidden={!show}>
      {show ? formatClock(at) : ''}
    </span>
  );
}

function PaneSlot({ children }: { children: React.ReactNode }) {
  // Lines the pane up with the first line of text.
  return <span className="flex h-[1.3rem] shrink-0 items-center">{children}</span>;
}

/** The way to message from a row: Reply when it waits on the operator, Ask <parent> for an ended session, else Nudge. */
function composerWords(target: ReplyTarget, waiting: boolean, name: string | undefined) {
  if (target.ask) return { label: name ? `Ask ${name}` : 'Ask the parent', verb: 'Ask' };
  return waiting ? { label: 'Reply', verb: 'Reply to' } : { label: 'Nudge', verb: 'Nudge' };
}

/**
 * A row's message control. Closed, it is the Reply outline button on a row that waits on the
 * operator (the same main action as Now) and muted text (Nudge, Ask) otherwise; open, the field.
 */
function Composer({
  rowKey,
  target,
  waiting,
  composing,
  setComposing,
  common,
}: {
  rowKey: string;
  target: ReplyTarget;
  waiting: boolean;
  composing: boolean;
  setComposing: (value: boolean) => void;
  common: RowCommon;
}) {
  const { replies, compact, nameOf, onSent } = common;
  const name = nameOf?.(target.sessionKey);
  const words = composerWords(target, waiting, name);
  if (composing) {
    return (
      <ReplyField
        config={replies}
        sessionKey={target.sessionKey}
        name={name}
        compact={compact}
        context={target.context}
        verb={words.verb}
        onSent={() => onSent(target.sessionKey, rowKey)}
        onClose={() => setComposing(false)}
      />
    );
  }
  if (waiting && !target.ask) {
    return (
      <button type="button" onClick={() => setComposing(true)} className={variantClass('outline', compact)}>
        Reply
      </button>
    );
  }
  return (
    <ReplyButton
      config={replies}
      sessionKey={target.sessionKey}
      compact={compact}
      label={words.label}
      onClick={() => setComposing(true)}
    />
  );
}

/** The reply sent from this row, while it is the latest one for the target session. */
function RowReply({ rowKey, target, common, hue, inset }: { rowKey: string; target?: ReplyTarget; common: RowCommon; hue?: string; inset: number }) {
  const { replies, compact, onOpen, nameOf, sentFrom } = common;
  const reply = useInlineReply(replies.store, target?.sessionKey, 'item');
  if (!target || !reply || sentFrom[target.sessionKey] !== rowKey) return null;
  return (
    <div className={cn('pb-2', compact ? 'pr-4' : 'pr-1')} style={{ paddingLeft: `${inset}rem` }}>
      <ReplyPanel
        reply={reply}
        name={nameOf?.(target.sessionKey)}
        hue={hue}
        compact={compact}
        onOpen={onOpen}
        onDismiss={() => replies.store.dismiss(reply.sessionKey)}
      />
    </div>
  );
}

function OwnerName({ name, hue }: { name: string; hue?: string }) {
  return (
    <span className={cn('font-medium', hue ? 'name-hued' : 'text-foreground')} style={nameHueStyle(hue)}>{name}</span>
  );
}

function Detail({ inset, compact, children }: { inset: number; compact: boolean; children: React.ReactNode }) {
  return (
    <div
      data-testid="today-row-detail"
      className={cn('flex min-w-0 flex-col gap-2 pb-3 [overflow-wrap:anywhere]', compact ? 'pr-4' : 'pr-1')}
      style={{ paddingLeft: `${inset}rem` }}
    >
      {children}
    </div>
  );
}

/** A cron run's facts for an open cron row: its last output, how long it took, and the next run. */
function CronFacts({ row, now }: { row: DayRow; now: number }) {
  const cron = row.cron;
  if (!cron) return null;
  const latest = cron.latest;
  const output = latest?.summary;
  const line = [
    latest ? `Last run ${formatDayClock(latest.at, now)}` : undefined,
    latest?.durationMs !== undefined ? `took ${duration(latest.durationMs)}` : undefined,
    cron.nextRun !== undefined ? `next ${formatDayClock(cron.nextRun, now)}` : cron.enabled ? undefined : 'paused',
  ].filter(Boolean).join(' · ');
  return (
    <>
      {cron.error && (cron.failing || cron.failedAt.length > 0) && (
        <p className="m-0 whitespace-pre-wrap break-words font-mono text-[0.8rem] text-destructive">{cron.error}</p>
      )}
      {output && <p data-testid="today-cron-output" className="m-0 max-w-[72ch] whitespace-pre-wrap text-[0.867rem] leading-relaxed text-foreground">{output}</p>}
      {line && <p className="m-0 text-[0.8rem] text-muted-foreground"><Clocked text={line} /></p>}
    </>
  );
}

function FailingCronRow({
  row,
  item,
  open,
  onToggle,
  ...common
}: RowCommon & { row: DayRow; item: AttentionItem; open: boolean; onToggle: () => void }) {
  const { compact, now, onOpen, actions } = common;
  const state = useItemActions(item, actions);
  const primary = state.actions.primary;
  const failures = row.cron?.failedAt.length ?? 0;
  const sub = [
    `Failed ${formatDayClock(row.at, now)}`,
    failures > 1 ? `${failures} times today` : undefined,
  ].filter(Boolean).join(' · ');
  const openCron = (
    <button type="button" onClick={() => onOpen({ type: 'cron', id: row.cronId! })} className={variantClass('text', compact)}>Open cron</button>
  );

  return (
    <div data-testid="today-failing" className={cn('flex min-w-0 flex-col', compact && 'border-b border-border')}>
      <div className={cn('flex min-w-0 items-center gap-2', compact ? 'pr-4' : 'pr-1')}>
        <button
          type="button"
          data-testid="today-row"
          aria-expanded={open}
          onClick={onToggle}
          className={cn(rowButtonClass(compact), compact && 'pr-0')}
          style={{ paddingLeft: `${rowInset(compact)}rem` }}
        >
          <TimeCell at={row.at} show />
          <PaneSlot><Pane state="error" label="Failed" /></PaneSlot>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className={cn('min-w-0 text-foreground', compact ? 'text-[1rem] leading-snug' : 'text-[0.867rem]')}>{row.title}</span>
            <span className={cn('min-w-0 text-destructive', compact ? 'text-[0.867rem]' : 'text-[0.8rem]')}><Clocked text={sub} /></span>
          </span>
          <Chevron open={open} compact={compact} />
        </button>
        {primary && !open && <ActionButton state={state} action={primary} variant="outline" compact={compact} />}
      </div>
      {open && (
        <Detail inset={titleInset(compact, { time: true })} compact={compact}>
          <CronFacts row={row} now={now} />
          <ActionStrip state={state} compact={compact} extra={openCron} />
        </Detail>
      )}
      {!open && state.error && (
        <div className="pb-2" style={{ paddingLeft: `${titleInset(compact, { time: true })}rem` }}>
          <ActionError message={state.error} />
        </div>
      )}
    </div>
  );
}

/** The line under a finished row's title. */
function doneSub(row: DayRow, now: number): string {
  if (row.kind === 'task') {
    const prs = row.prs ?? [];
    return prs.length > 0 ? `merged ${prs.map((pr) => `#${pr.number}`).join(', ')}` : 'Task done';
  }
  const cron = row.cron;
  if (!cron) return 'Cron ran';
  const failed = cron.failedAt.map((at) => formatClock(at));
  const failedWords = failed.length > 3 ? `${failed.length} times, last ${failed.at(-1)}` : joinWords(failed);
  if (!cron.enabled) return `Failed ${failedWords}, now paused`;
  if (cron.recoveredAt !== undefined) return `Failed ${failedWords}, recovered ${formatDayClock(cron.recoveredAt, now)}`;
  return `Failed ${failedWords}, fine since`;
}

function DoneRowView({
  row,
  showTime,
  isNew,
  open,
  onToggle,
  summary,
  ...common
}: RowCommon & {
  row: DayRow;
  showTime: boolean;
  isNew: boolean;
  open: boolean;
  onToggle: () => void;
  summary?: ThreadSummary;
}) {
  const { compact, now, onOpen, hueFor, nameOf } = common;
  const [composing, setComposing] = useState(false);
  const hue = row.agentId ? hueFor(row.agentId) : undefined;
  const ownerName = row.kind === 'task' && row.agentId ? nameOf?.(`agent:${row.agentId}:main`) ?? row.agentId : undefined;
  const linkClass = variantClass('text', compact);
  const rowKey = `done:${row.key}`;
  const inset = titleInset(compact, { time: true });

  return (
    <div className={cn('flex min-w-0 flex-col', compact && 'border-b border-border')}>
      <button
        type="button"
        data-testid="today-row"
        aria-expanded={open}
        onClick={onToggle}
        className={rowButtonClass(compact)}
        style={{ paddingLeft: `${rowInset(compact)}rem` }}
      >
        <TimeCell at={row.at} show={showTime} />
        {/* Finished work keeps a dark pane; the agent's hue is on its name. */}
        <PaneSlot><Pane state="off" label="Finished" /></PaneSlot>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-start gap-2">
            <span className={cn('min-w-0 flex-1 text-foreground', compact ? 'text-[1rem] leading-snug' : 'text-[0.867rem]')}>{row.title}</span>
            {isNew && <NewTag />}
          </span>
          <span className={cn('min-w-0 text-muted-foreground', compact ? 'text-[0.867rem]' : 'text-[0.8rem]')}>
            {ownerName && <><OwnerName name={ownerName} hue={hue} />{' · '}</>}
            <Clocked text={doneSub(row, now)} />
          </span>
        </span>
        <Chevron open={open} compact={compact} />
      </button>
      {open && (
        <Detail inset={inset} compact={compact}>
          {row.kind === 'cron' && <CronFacts row={row} now={now} />}
          {row.detail && (
            <p className="m-0 max-w-[72ch] whitespace-pre-wrap text-[0.867rem] leading-relaxed text-foreground">{row.detail}</p>
          )}
          <WhatHappened summary={summary} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {(row.prs ?? []).filter((pr) => pr.href).map((pr) => (
              <a key={pr.number} href={pr.href} target="_blank" rel="noopener noreferrer" className={cn(linkClass, 'inline-flex items-center')}>
                {`Open PR #${pr.number}`}
              </a>
            ))}
            {row.taskId && (
              <button type="button" onClick={() => onOpen({ type: 'task', id: row.taskId! })} className={linkClass}>Open task</button>
            )}
            {row.cronId && (
              <button type="button" onClick={() => onOpen({ type: 'cron', id: row.cronId! })} className={linkClass}>Open cron</button>
            )}
            {row.sessionKey && (
              <button type="button" onClick={() => onOpen({ type: 'session', key: row.sessionKey! })} className={linkClass}>Open in chat</button>
            )}
            {row.target && !composing && (
              <Composer rowKey={rowKey} target={row.target} waiting={false} composing={false} setComposing={setComposing} common={common} />
            )}
          </div>
          {row.target && composing && (
            <Composer rowKey={rowKey} target={row.target} waiting={false} composing setComposing={setComposing} common={common} />
          )}
        </Detail>
      )}
      <RowReply rowKey={rowKey} target={row.target} common={common} hue={hue} inset={inset} />
    </div>
  );
}

/** Every successful cron run in one quiet line; it opens to a row per job. */
function CronsOk({
  rows,
  runs,
  partial,
  open,
  onToggle,
  expanded,
  onToggleRow,
  common,
}: {
  rows: DayRow[];
  runs: number;
  partial: boolean;
  open: boolean;
  onToggle: () => void;
  expanded: ReadonlySet<string>;
  onToggleRow: (key: string) => void;
  common: RowCommon;
}) {
  const { compact, now } = common;
  const label = `${runs}${partial ? '+' : ''} cron ${runs === 1 && !partial ? 'run' : 'runs'} ok`;
  return (
    <div data-testid="today-crons-ok" className={cn('flex min-w-0 flex-col', compact && 'border-b border-border')}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(ROW_BUTTON, 'items-center text-[0.8rem] text-muted-foreground', compact ? 'min-h-11 gap-3 pr-4' : 'min-h-7 gap-2.5 rounded-[3px] pr-1')}
        style={{ paddingLeft: `${titleInset(compact, { time: true })}rem` }}
      >
        <span className="min-w-0 flex-1">{label}</span>
        <ChevronRight size={14} aria-hidden="true" className={cn('shrink-0 transition-transform duration-[120ms]', open && 'rotate-90')} />
      </button>
      {open && rows.map((row, index) => {
        const rowOpen = expanded.has(`done:${row.key}`);
        const count = row.cron?.okRuns ?? 0;
        return (
          <div key={row.key} className="flex min-w-0 flex-col">
            <button
              type="button"
              data-testid="today-cron-ok-row"
              aria-expanded={rowOpen}
              onClick={() => onToggleRow(`done:${row.key}`)}
              className={rowButtonClass(compact)}
              style={{ paddingLeft: `${rowInset(compact)}rem` }}
            >
              <TimeCell at={row.at} show={index === 0 || formatClock(rows[index - 1].at) !== formatClock(row.at)} />
              <PaneSlot><Pane state="off" label="Ran fine" /></PaneSlot>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={cn('min-w-0 text-foreground', compact ? 'text-[1rem] leading-snug' : 'text-[0.867rem]')}>{row.title}</span>
                <span className={cn('min-w-0 text-muted-foreground', compact ? 'text-[0.867rem]' : 'text-[0.8rem]')}>
                  {`${count}${row.cron?.partial ? '+' : ''} ${count === 1 && !row.cron?.partial ? 'run' : 'runs'} ok`}
                </span>
              </span>
              <Chevron open={rowOpen} compact={compact} />
            </button>
            {rowOpen && (
              <Detail inset={titleInset(compact, { time: true })} compact={compact}>
                <CronFacts row={row} now={now} />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <button type="button" onClick={() => common.onOpen({ type: 'cron', id: row.cronId! })} className={variantClass('text', compact)}>Open cron</button>
                </div>
              </Detail>
            )}
          </div>
        );
      })}
    </div>
  );
}

function endWord(status: string): string {
  switch (status) {
    case 'timeout':
      return 'Timed out';
    case 'killed':
      return 'Stopped';
    case 'interrupted':
      return 'Interrupted';
    case 'failed':
      return 'Failed';
    default:
      return 'Finished';
  }
}

function ChatRowView({
  row,
  depth,
  newKeys,
  expanded,
  onToggle,
  setOpen,
  summaries,
  ...common
}: RowCommon & {
  row: ChatRow;
  depth: number;
  newKeys: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
  onToggle: (key: string) => void;
  setOpen: (key: string, open: boolean) => void;
  summaries: Record<string, ThreadSummary>;
}) {
  const { compact, now, onOpen, hueFor } = common;
  const [composing, setComposing] = useState(false);
  const hue = row.agentId ? hueFor(row.agentId) : undefined;
  const rowKey = `chat:${row.key}`;
  const open = expanded.has(rowKey);
  const summary = summaries[row.key];
  const turn = turnOf(row, summary);
  const inset = titleInset(compact, { time: false, depth });

  let pane: { state: 'operator' | 'live' | 'error' | 'off'; label: string };
  if (row.running) pane = { state: 'live', label: 'Running' };
  else if (row.failed) pane = { state: 'error', label: 'Failed' };
  else if (turn === 'waiting') pane = { state: 'operator', label: 'Waiting on you' };
  else pane = { state: 'off', label: row.ended ? 'Finished' : 'Idle' };

  const gist = summary?.text ? firstSentence(summary.text) : undefined;
  // An ended subagent says how it ended; anything else says when it last moved.
  const endLine = row.end ? `${endWord(row.end.status)} ${formatDayClock(row.end.at, now)}` : undefined;
  // The desk prints the time beside the name; a phone says the age here instead.
  const age = compact && !endLine && turn !== 'working' ? ago(row.lastActivity, now) : undefined;
  const meta = [row.needs ? `${row.needs} on Now` : undefined, endLine, age].filter(Boolean).join(' · ');
  const waiting = turn === 'waiting';
  const replyFirst = waiting && !row.target.ask;

  const startReply = () => {
    setOpen(rowKey, true);
    setComposing(true);
  };

  return (
    <div className="flex min-w-0 flex-col">
      <div data-testid="today-chat-row" className={cn('flex min-w-0 flex-col', compact && 'border-b border-border')}>
        <div className={cn('flex min-w-0 items-center gap-2', compact ? 'pr-4' : 'pr-1')}>
          <button
            type="button"
            data-testid="today-chat"
            aria-expanded={open}
            onClick={() => onToggle(rowKey)}
            className={cn(rowButtonClass(compact), compact && 'pr-0')}
            style={{ paddingLeft: `${rowInset(compact, depth)}rem` }}
          >
            {/* Idle chats keep their family hue; finished runs go dark. */}
            <PaneSlot><Pane state={pane.state} hue={pane.state === 'off' && !row.ended ? hue : undefined} label={pane.label} /></PaneSlot>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-baseline gap-x-2">
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                  <span
                    className={cn(
                      'min-w-0 font-medium',
                      compact ? 'text-[1rem] leading-snug' : 'text-[0.867rem]',
                      row.topLevel && hue ? 'name-hued' : 'text-foreground',
                    )}
                    style={row.topLevel ? nameHueStyle(hue) : undefined}
                  >
                    {row.title}
                  </span>
                  {row.channel && !row.title.toLowerCase().includes(row.channel.toLowerCase()) && (
                    <span className="text-[0.8rem] text-muted-foreground">{row.channel}</span>
                  )}
                  {newKeys.has(row.key) && <NewTag />}
                </span>
                {turn && (
                  <span data-testid="today-turn" className={cn('shrink-0 text-[0.8rem]', waiting ? 'text-operator-text' : 'text-live-text')}>
                    {waiting ? 'Waiting on you' : 'Working'}
                  </span>
                )}
                {!compact && (
                  <span className={cn('shrink-0 font-mono text-[0.733rem] tabular', row.running ? 'text-live-text' : 'text-muted-foreground')}>
                    {formatClock(row.lastActivity)}
                  </span>
                )}
              </span>
              {/* The first sentence of what happened, whole; the open row shows all of it. */}
              {gist && !open && (
                <span data-testid="today-gist" className={cn('min-w-0 leading-snug text-foreground', compact ? 'text-[0.933rem]' : 'text-[0.867rem]')}>
                  {gist}
                </span>
              )}
              {!gist && !open && row.end?.error && (
                <span className="min-w-0 font-mono text-[0.8rem] text-destructive">{row.end.error}</span>
              )}
              {meta && (
                <span className={cn('min-w-0 text-muted-foreground', compact ? 'text-[0.8rem]' : 'text-[0.733rem]')}>
                  <Clocked text={meta} />
                </span>
              )}
            </span>
            <Chevron open={open} compact={compact} />
          </button>
          {replyFirst && !open && (
            <button type="button" onClick={startReply} className={variantClass('outline', compact)}>Reply</button>
          )}
        </div>
        {open && (
          <Detail inset={inset} compact={compact}>
            {row.end?.error && <p className="m-0 whitespace-pre-wrap break-words font-mono text-[0.8rem] text-destructive">{row.end.error}</p>}
            <WhatHappened summary={summary} />
            {composing ? (
              <Composer rowKey={rowKey} target={row.target} waiting={waiting} composing setComposing={setComposing} common={common} />
            ) : (
              // Reply leads when the chat waits on the operator; otherwise Open in chat, then Nudge or Ask.
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {replyFirst && <Composer rowKey={rowKey} target={row.target} waiting composing={false} setComposing={setComposing} common={common} />}
                <button type="button" onClick={() => onOpen({ type: 'session', key: row.key })} className={variantClass('text', compact)}>
                  Open in chat
                </button>
                {!replyFirst && <Composer rowKey={rowKey} target={row.target} waiting={false} composing={false} setComposing={setComposing} common={common} />}
              </div>
            )}
          </Detail>
        )}
        <RowReply rowKey={rowKey} target={row.target} common={common} hue={hue} inset={inset} />
      </div>
      {row.children.map((child) => (
        <ChatRowView
          key={child.key}
          row={child}
          depth={depth + 1}
          newKeys={newKeys}
          expanded={expanded}
          onToggle={onToggle}
          setOpen={setOpen}
          summaries={summaries}
          {...common}
        />
      ))}
    </div>
  );
}
