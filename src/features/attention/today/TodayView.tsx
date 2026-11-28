/**
 * Today: what happened in the operator's day so far, beside the Now brief in the Attention view.
 * A facts strip and a short model-written paragraph, then Done today (newest first, every task,
 * merged pull request, cron run and finished subagent) and Chats today (every session active
 * since local midnight, subagents under their parent). Both sections open on desktop and start
 * collapsed on phones, with their counts showing.
 *
 * Read-only except for the operator's own messages: a row's Nudge or Reply sends into its
 * session through the brief's reply store, and a finished subagent's row asks its parent.
 * Each source fails on its own and is named; a day with a source missing never reads complete.
 *
 * While any row is open the order is frozen (useStableOrder), so rows arriving from a poll are
 * appended and marked New instead of pushing the open row away; closing every row re-sorts.
 */

import { useMemo, useState, useSyncExternalStore } from 'react';
import { ChevronRight } from 'lucide-react';
import { Pane } from '@/components/ui/Pane';
import type { KanbanTask } from '@/features/kanban/types';
import type { CronJob } from '@/features/workspace/hooks/useCrons';
import { useAgentHues, nameHueStyle } from '@/lib/agentColors';
import { timeAgo } from '@/lib/formatting';
import { cn } from '@/lib/utils';
import type { GranularAgentState, Session } from '@/types';
import { formatClock } from '../briefCopy';
import { Clocked, NewTag } from '../AttentionRow';
import { WhatHappened } from '../AttentionCard';
import { ReplyButton, ReplyField, ReplyPanel, type ReplyConfig } from '../AttentionReply';
import { variantClass } from '../actionStyles';
import { useInlineReply } from '../useInlineReplies';
import { useAttentionSummaries, type ThreadSummary } from '../useAttentionSummaries';
import { useStableOrder } from '../useStableOrder';
import type { OpenTarget, SourceStatus } from '../types';
import {
  buildDay,
  dayFacts,
  flattenChats,
  groupByHour,
  startOfLocalDay,
  type ChatRow,
  type DayRow,
  type DaySource,
  type ReplyTarget,
} from './buildDay';
import { useCronRuns } from './useCronRuns';
import { useDaySummary } from './useDaySummary';

const SOURCE_NAMES: Record<DaySource, string> = {
  tasks: 'Tasks',
  crons: 'Crons',
  cronRuns: 'Cron runs',
  sessions: 'Sessions',
};
const SECTION_SOURCES: Record<'done' | 'chats', DaySource[]> = {
  done: ['tasks', 'crons', 'cronRuns', 'sessions'],
  chats: ['sessions'],
};
const DETAIL_MAX = 600;
/** The summaries route answers this many keys per request. */
const MAX_SUMMARY_KEYS = 12;
/** The paragraph is asked again this often while the view is open; cached answers are cheap. */
const SUMMARY_REASK_MS = 5 * 60_000;

export interface TodayViewProps {
  active: boolean;
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

function excerpt(text: string, max = DETAIL_MAX): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}...` : trimmed;
}

function dayHeading(now: number): string {
  const date = new Date(now);
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'short' });
  const month = date.toLocaleDateString('en-GB', { month: 'short' });
  return `Today, ${weekday} ${date.getDate()} ${month}`;
}

function ago(ts: number, now: number): string {
  const age = timeAgo(ts, now);
  return age === 'now' ? 'just now' : `${age} ago`;
}

/** Sources that keep the day from reading complete, in words. */
function gapSentences(sources: Record<DaySource, SourceStatus>, hidden: (source: DaySource) => boolean): string[] {
  const all = Object.keys(SOURCE_NAMES) as DaySource[];
  const errors = all.filter((source) => sources[source].state === 'error' && !hidden(source));
  const loading = all.filter((source) => sources[source].state === 'loading');
  const out: string[] = [];
  if (errors.length > 0) {
    out.push(`${joinWords(errors.map((source) => SOURCE_NAMES[source]))} could not be read, so this day may be incomplete.`);
  }
  if (loading.length > 0) out.push(`Loading ${joinWords(loading.map((source) => SOURCE_NAMES[source].toLowerCase()))}.`);
  if (sources.tasks.state === 'off') out.push('Tasks are turned off, so done tasks and merged pull requests are not counted.');
  return out;
}

export function TodayView({
  active,
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

  const agentIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const row of day.done) if (row.agentId) ids.add(row.agentId);
    for (const row of flattenChats(day.chats)) if (row.agentId) ids.add(row.agentId);
    return [...ids].sort().join('|');
  }, [day]);
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
  // Only rows still in the day hold the order; a row that left (a job's runs folding into one)
  // does not keep it frozen.
  const openCount = useMemo(() => {
    const present = new Set([
      ...day.done.map((row) => `done:${row.key}`),
      ...flattenChats(day.chats).map((row) => `chat:${row.key}`),
    ]);
    return [...expanded].filter((key) => present.has(key)).length;
  }, [day, expanded]);
  const holding = openCount > 0 && frozen !== null;
  const done = useStableOrder(day.done, holding ? frozen.done : liveDoneEpoch);
  const chats = useStableOrder(day.chats, holding ? frozen.chats : liveChatsEpoch);

  const toggle = (key: string) => {
    if (openCount === 0) setFrozen({ done: liveDoneEpoch, chats: liveChatsEpoch });
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const [openSections, setOpenSections] = useState(() => ({ done: !compact, chats: !compact }));
  const toggleSection = (section: 'done' | 'chats') => setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));

  // Which row a reply was sent from, per target session, so only that row shows it.
  const [sentFrom, setSentFrom] = useState<Record<string, string>>({});
  const markSent = (sessionKey: string, rowKey: string) => setSentFrom((prev) => ({ ...prev, [sessionKey]: rowKey }));

  // "What happened" only for open rows, read lazily.
  const summaryKeys = useMemo(() => {
    const keys: string[] = [];
    for (const row of day.done) if (expanded.has(`done:${row.key}`) && row.sessionKey) keys.push(row.sessionKey);
    for (const row of flattenChats(day.chats)) if (expanded.has(`chat:${row.key}`)) keys.push(row.key);
    return [...new Set(keys)].slice(0, MAX_SUMMARY_KEYS);
  }, [day, expanded]);
  const repliesEnded = useSyncExternalStore(
    replies.store.subscribe,
    () => summaryKeys.map((key) => replies.store.get(key)?.endedAt ?? '').join('|'),
  );
  const threadSummaries = useAttentionSummaries({
    active,
    sessionKeys: summaryKeys,
    signal: `${refreshSignal}|${repliesEnded}`,
  });

  const liveChecked = (['tasks', 'crons'] as const)
    .map((source) => daySources[source])
    .filter((status) => status.state === 'live' && typeof status.checkedAt === 'number')
    .map((status) => status.checkedAt as number);
  const checkedAt = liveChecked.length > 0 ? Math.min(...liveChecked) : undefined;
  const gaps = gapSentences(daySources, hiddenNote);

  const rowProps = { compact, now, replies, onOpen, hueFor, nameOf: replies.nameOf, onSent: markSent, sentFrom };

  const doneSection = (
    <DaySection
      id="today-done"
      title="Done today"
      count={day.done.length}
      open={openSections.done}
      onToggle={() => toggleSection('done')}
      compact={compact}
    >
      <TodayNotes sources={daySources} relevant={SECTION_SOURCES.done} hidden={hiddenNote} compact={compact} onOpen={onOpen} />
      {done.items.length > 0 ? (
        <div className={compact ? 'flex flex-col' : 'flex flex-col gap-0.5'}>
          {groupByHour(done.items).map((group, index) => (
            <div key={group.label ?? index} className="flex flex-col">
              {group.label && (
                <div className={cn('font-mono text-[0.733rem] tabular text-muted-foreground', compact ? 'px-4 pb-1 pt-3' : 'px-1 pb-0.5 pt-2')}>
                  {group.label}
                </div>
              )}
              {group.rows.map((row) => (
                <DoneRowView
                  key={row.key}
                  row={row}
                  isNew={done.newKeys.has(row.key)}
                  open={expanded.has(`done:${row.key}`)}
                  onToggle={() => toggle(`done:${row.key}`)}
                  summary={row.sessionKey ? threadSummaries[row.sessionKey] : undefined}
                  {...rowProps}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <Empty compact={compact} hidden={hasNotes(daySources, 'done', hiddenNote)}>Nothing has finished yet today.</Empty>
      )}
    </DaySection>
  );

  const chatsSection = (
    <DaySection
      id="today-chats"
      title="Chats today"
      count={day.stats.sessions}
      open={openSections.chats}
      onToggle={() => toggleSection('chats')}
      compact={compact}
    >
      <TodayNotes sources={daySources} relevant={SECTION_SOURCES.chats} hidden={hiddenNote} compact={compact} onOpen={onOpen} />
      {chats.items.length > 0 ? (
        <div className={compact ? 'flex flex-col' : 'flex flex-col gap-0.5'}>
          {chats.items.map((row) => (
            <ChatRowView
              key={row.key}
              row={row}
              depth={0}
              newKeys={chats.newKeys}
              expanded={expanded}
              onToggle={toggle}
              summaries={threadSummaries}
              {...rowProps}
            />
          ))}
        </div>
      ) : (
        <Empty compact={compact} hidden={hasNotes(daySources, 'chats', hiddenNote)}>No chats yet today.</Empty>
      )}
    </DaySection>
  );

  const { stats } = day;
  const factItems = [
    { n: String(stats.sessions), word: stats.sessions === 1 ? 'session' : 'sessions' },
    { n: String(stats.done), word: 'done' },
    { n: String(stats.merged), word: 'merged' },
    { n: `${stats.cronOk}${stats.cronPartial ? '+' : ''}`, word: stats.cronOk === 1 && !stats.cronPartial ? 'cron run ok' : 'cron runs ok' },
  ];

  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-[1320px] flex-col',
        compact ? 'gap-4 pb-8 pt-2' : 'gap-6 px-7 pb-6 pt-4',
        disconnectedSince !== null && 'opacity-60',
      )}
    >
      <section aria-label="Today summary" className={cn('flex flex-col gap-1.5', compact && 'px-4')}>
        <div className="flex items-start gap-3">
          <h1 className={cn('m-0 font-semibold leading-tight text-foreground', compact ? 'text-[1.333rem]' : 'text-[1.2rem]')}>
            {dayHeading(now)}
          </h1>
          <span className="flex-1" />
          <button type="button" onClick={onRefresh} className={cn('shell-chip shrink-0', compact && 'min-h-11')}>
            Refresh
          </button>
        </div>
        <p data-testid="today-facts" className="m-0 flex flex-wrap gap-x-1.5 text-[0.867rem] text-muted-foreground">
          {factItems.map((fact, index) => (
            <span key={fact.word} className="whitespace-nowrap">
              {index > 0 && <span aria-hidden="true">{'· '}</span>}
              <span className="font-mono tabular text-foreground">{fact.n}</span>
              {` ${fact.word}`}
            </span>
          ))}
          {stats.cronFailed > 0 && (
            <span className="whitespace-nowrap">
              <span aria-hidden="true">{'· '}</span>
              <span className="font-mono tabular text-destructive">{stats.cronFailed}</span>
              {' failed'}
            </span>
          )}
        </p>
        {summary?.text ? (
          <p data-testid="today-paragraph" className="m-0 max-w-[72ch] text-[1rem] leading-relaxed text-foreground">
            {summary.text}
          </p>
        ) : summary?.status === 'pending' ? (
          <p className="m-0 text-[0.867rem] text-muted-foreground" role="status">Summarizing the day...</p>
        ) : null}
        <p className="m-0 max-w-[90ch] text-[0.8rem] leading-normal text-muted-foreground">
          <Clocked
            text={[
              checkedAt !== undefined ? `Checked ${formatClock(checkedAt)}.` : '',
              ...gaps,
              stats.cronPartial ? 'Some crons ran more often than their history shows, so cron counts are at least these.' : '',
            ].filter(Boolean).join(' ')}
          />
        </p>
      </section>

      {compact ? (
        <div className="flex flex-col gap-2">
          {chatsSection}
          {doneSection}
        </div>
      ) : (
        // Chats lead: the wide column is theirs, Done today sits beside them.
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-6">{chatsSection}</div>
          <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-6">{doneSection}</div>
        </div>
      )}
    </div>
  );
}

function hasNotes(sources: Record<DaySource, SourceStatus>, section: 'done' | 'chats', hidden: (source: DaySource) => boolean): boolean {
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
  children,
}: {
  id: string;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  compact: boolean;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <h2 className="m-0 border-b border-border text-[0.867rem] font-semibold text-foreground">
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
          <span id={id}>{title}</span>
          <span data-testid={`${id}-count`} className="font-mono text-[0.8rem] font-normal tabular text-muted-foreground">{count}</span>
        </button>
      </h2>
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
}

function rowButtonClass(compact: boolean, depth = 0) {
  return cn(
    'flex min-w-0 flex-1 cursor-pointer items-center text-left transition-colors duration-[120ms] hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
    compact ? 'min-h-[60px] gap-3 py-2 pr-4' : 'min-h-[44px] gap-2.5 rounded-[3px] py-2 pr-1',
    compact ? (depth > 0 ? 'pl-9' : 'pl-4') : (depth > 0 ? 'pl-7' : 'pl-1'),
  );
}

function sessionStatusWord(status: string | undefined): string {
  switch (status) {
    case 'timeout':
      return 'timed out';
    case 'killed':
      return 'was stopped';
    case 'interrupted':
      return 'was interrupted';
    case 'failed':
      return 'failed';
    default:
      return 'finished';
  }
}

function doneSub(row: DayRow, ownerName: string | undefined): string {
  const owner = ownerName ? ` · ${ownerName}` : '';
  switch (row.kind) {
    case 'task':
      return `Task done${owner}`;
    case 'pr':
      return `${row.detail ?? 'Pull request'}${owner}`;
    case 'cron':
      if (row.failed) return 'Cron failed';
      if (row.runs) return `Cron ran ${row.runs.ok}${row.runs.partial ? '+' : ''} times, last at ${formatClock(row.at)}`;
      return 'Cron ran';
    case 'session':
      return `Subagent ${sessionStatusWord(row.status)}${owner}`;
  }
}

/** The way to message from a row: Ask <parent> for an ended session, else Reply or Nudge. */
function composerWords(target: ReplyTarget, needs: boolean, name: string | undefined) {
  if (target.ask) return { label: name ? `Ask ${name}` : 'Ask the parent', verb: 'Ask' };
  return needs ? { label: 'Reply', verb: 'Reply to' } : { label: 'Nudge', verb: 'Nudge' };
}

function Composer({
  rowKey,
  target,
  needs,
  common,
}: {
  rowKey: string;
  target: ReplyTarget;
  needs: boolean;
  common: RowCommon;
}) {
  const { replies, compact, nameOf, onSent } = common;
  const [open, setOpen] = useState(false);
  const name = nameOf?.(target.sessionKey);
  const words = composerWords(target, needs, name);
  if (open) {
    return (
      <ReplyField
        config={replies}
        sessionKey={target.sessionKey}
        name={name}
        compact={compact}
        context={target.context}
        verb={words.verb}
        onSent={() => onSent(target.sessionKey, rowKey)}
        onClose={() => setOpen(false)}
      />
    );
  }
  return (
    <ReplyButton
      config={replies}
      sessionKey={target.sessionKey}
      compact={compact}
      label={words.label}
      onClick={() => setOpen(true)}
    />
  );
}

/** The reply sent from this row, while it is the latest one for the target session. */
function RowReply({ rowKey, target, common, hue }: { rowKey: string; target?: ReplyTarget; common: RowCommon; hue?: string }) {
  const { replies, compact, onOpen, nameOf, sentFrom } = common;
  const reply = useInlineReply(replies.store, target?.sessionKey, 'item');
  if (!target || !reply || sentFrom[target.sessionKey] !== rowKey) return null;
  return (
    <div className={cn('pb-2', compact ? 'px-4' : 'px-1')}>
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

function DoneRowView({
  row,
  isNew,
  open,
  onToggle,
  summary,
  ...common
}: RowCommon & {
  row: DayRow;
  isNew: boolean;
  open: boolean;
  onToggle: () => void;
  summary?: ThreadSummary;
}) {
  const { compact, onOpen, hueFor, nameOf } = common;
  const hue = row.agentId ? hueFor(row.agentId) : undefined;
  const ownerName = row.agentId ? nameOf?.(`agent:${row.agentId}:main`) ?? row.agentId : undefined;
  const pane = row.failed
    ? { state: 'error' as const, label: 'Failed' }
    : { state: 'off' as const, label: 'Finished' };
  const linkClass = variantClass('text', compact);
  const rowKey = `done:${row.key}`;

  return (
    <div className={cn('flex min-w-0 flex-col', compact && 'border-b border-border')}>
      <button type="button" data-testid="today-row" aria-expanded={open} onClick={onToggle} className={rowButtonClass(compact)}>
        <span className="w-[2.75rem] shrink-0 font-mono text-[0.8rem] tabular text-muted-foreground">{formatClock(row.at)}</span>
        <Pane state={pane.state} hue={pane.state === 'off' ? hue : undefined} label={pane.label} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn('min-w-0 flex-1 truncate text-foreground', compact ? 'text-[1rem]' : 'text-[0.867rem]')}>{row.title}</span>
            {isNew && <NewTag />}
          </span>
          <span className={cn('min-w-0 truncate', row.failed ? 'text-destructive' : 'text-muted-foreground', compact ? 'text-[0.867rem]' : 'text-[0.8rem]')}>
            <Clocked text={doneSub(row, ownerName)} />
          </span>
        </span>
        <ChevronRight size={16} aria-hidden="true" className={cn('shrink-0 text-muted-foreground transition-transform duration-[120ms]', open && 'rotate-90')} />
      </button>
      {open && (
        <div data-testid="today-row-detail" className={cn('flex min-w-0 flex-col gap-2 pb-3 [overflow-wrap:anywhere]', compact ? 'pl-4 pr-4' : 'pl-[3.6rem] pr-1')}>
          {row.detail && row.kind !== 'pr' && (
            row.failed
              ? <p className="m-0 break-words font-mono text-[0.8rem] text-destructive">{excerpt(row.detail)}</p>
              : <p className="m-0 whitespace-pre-wrap text-[0.867rem] leading-relaxed text-foreground">{excerpt(row.detail)}</p>
          )}
          <WhatHappened summary={summary} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {row.href && (
              <a href={row.href} target="_blank" rel="noopener noreferrer" className={cn(linkClass, 'inline-flex items-center')}>Open PR</a>
            )}
            {row.taskId && (
              <button type="button" onClick={() => onOpen({ type: 'task', id: row.taskId! })} className={linkClass}>Open task</button>
            )}
            {row.cronId && (
              <button type="button" onClick={() => onOpen({ type: 'cron', id: row.cronId! })} className={linkClass}>Open cron</button>
            )}
            {row.sessionKey && (
              <button type="button" onClick={() => onOpen({ type: 'session', key: row.sessionKey! })} className={linkClass}>Open in chat</button>
            )}
            {row.target && <Composer rowKey={rowKey} target={row.target} needs={false} common={common} />}
          </div>
        </div>
      )}
      <RowReply rowKey={rowKey} target={row.target} common={common} hue={hue} />
    </div>
  );
}

function ChatRowView({
  row,
  depth,
  newKeys,
  expanded,
  onToggle,
  summaries,
  ...common
}: RowCommon & {
  row: ChatRow;
  depth: number;
  newKeys: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
  onToggle: (key: string) => void;
  summaries: Record<string, ThreadSummary>;
}) {
  const { compact, now, onOpen, hueFor } = common;
  const hue = row.agentId ? hueFor(row.agentId) : undefined;
  const rowKey = `chat:${row.key}`;
  const open = expanded.has(rowKey);
  let pane: { state: 'operator' | 'live' | 'error' | 'off'; label: string };
  if (row.running) pane = { state: 'live', label: 'Running' };
  else if (row.failed) pane = { state: 'error', label: 'Failed' };
  else if (row.needs) pane = { state: 'operator', label: 'Waiting on you' };
  else pane = { state: 'off', label: row.ended ? 'Finished' : 'Idle' };

  const sub = [
    row.channel,
    row.running ? 'running' : row.ended ? (row.failed ? 'ended' : 'finished') : undefined,
    ago(row.lastActivity, now),
  ].filter(Boolean).join(' · ');

  return (
    <div className="flex min-w-0 flex-col">
      <div className={cn('flex min-w-0 flex-col', compact && 'border-b border-border')}>
        <button type="button" data-testid="today-chat" aria-expanded={open} onClick={() => onToggle(rowKey)} className={rowButtonClass(compact, depth)}>
          <Pane state={pane.state} hue={pane.state === 'off' ? hue : undefined} label={pane.label} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  'min-w-0 flex-1 truncate',
                  compact ? 'text-[1rem]' : 'text-[0.867rem]',
                  row.topLevel && hue ? 'name-hued font-medium' : 'text-foreground',
                )}
                style={row.topLevel ? nameHueStyle(hue) : undefined}
              >
                {row.title}
              </span>
              {newKeys.has(row.key) && <NewTag />}
              {row.needs && <span className="shrink-0 text-[0.8rem] text-operator-text">Needs you</span>}
              {!compact && (
                <span className={cn('shrink-0 font-mono text-[0.733rem] tabular', row.running ? 'text-live-text' : 'text-muted-foreground')}>
                  {formatClock(row.lastActivity)}
                </span>
              )}
            </span>
            <span className={cn('min-w-0 truncate text-muted-foreground', compact ? 'text-[0.867rem]' : 'text-[0.8rem]')}>
              {row.needs ? `${row.needs} · ${sub}` : sub}
            </span>
          </span>
          <ChevronRight size={16} aria-hidden="true" className={cn('shrink-0 text-muted-foreground transition-transform duration-[120ms]', open && 'rotate-90')} />
        </button>
        {open && (
          <div data-testid="today-row-detail" className={cn('flex min-w-0 flex-col gap-2 pb-3 [overflow-wrap:anywhere]', compact ? (depth > 0 ? 'pl-9 pr-4' : 'pl-4 pr-4') : (depth > 0 ? 'pl-12 pr-1' : 'pl-7 pr-1'))}>
            <WhatHappened summary={summaries[row.key]} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <button type="button" onClick={() => onOpen({ type: 'session', key: row.key })} className={variantClass('text', compact)}>
                Open in chat
              </button>
              <Composer rowKey={rowKey} target={row.target} needs={Boolean(row.needs)} common={common} />
            </div>
          </div>
        )}
        <RowReply rowKey={rowKey} target={row.target} common={common} hue={hue} />
      </div>
      {row.children.map((child) => (
        <ChatRowView
          key={child.key}
          row={child}
          depth={depth + 1}
          newKeys={newKeys}
          expanded={expanded}
          onToggle={onToggle}
          summaries={summaries}
          {...common}
        />
      ))}
    </div>
  );
}
