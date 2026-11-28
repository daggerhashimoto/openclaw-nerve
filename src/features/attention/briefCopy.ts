/**
 * Words for the Now board: the heading in counts, the notes about sources that are not live,
 * and each item's reason. Pure: every time comes from the arguments.
 * Nothing here calls agent-reported work verified or approved.
 */

import { timeAgo } from '@/lib/formatting';
import type { AttentionBrief, AttentionItem, AttentionSource } from './types';

const SOURCE_ORDER: AttentionSource[] = ['tasks', 'proposals', 'approvals', 'crons', 'sessions'];
const SOURCE_NAMES: Record<AttentionSource, string> = {
  tasks: 'Tasks',
  proposals: 'Proposals',
  crons: 'Crons',
  sessions: 'Sessions',
  approvals: 'Approvals',
};
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type SourceState = 'loading' | 'live' | 'error' | 'off';

/** The error a socket-fed source carries while the gateway is lost. */
export const NOT_CONNECTED = 'not connected';

/** Local 24-hour `HH:MM`. */
export function formatClock(ts: number): string {
  const date = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function sameLocalDay(a: number, b: number): boolean {
  const first = new Date(a);
  const second = new Date(b);
  return first.getFullYear() === second.getFullYear()
    && first.getMonth() === second.getMonth()
    && first.getDate() === second.getDate();
}

/** `HH:MM` when `ts` falls on the same local day as `now`, otherwise `Sat 07:57`. */
export function formatDayClock(ts: number, now: number): string {
  const clock = formatClock(ts);
  return sameLocalDay(ts, now) ? clock : `${WEEKDAYS[new Date(ts).getDay()]} ${clock}`;
}

/** `at HH:MM` when `ts` is today, otherwise `Sat 07:57`. */
function atDayClock(ts: number, now: number): string {
  return sameLocalDay(ts, now) ? `at ${formatClock(ts)}` : formatDayClock(ts, now);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function nameList(sources: AttentionSource[], capitalizeFirst = true): string {
  const names = sources.map((source) => SOURCE_NAMES[source].toLowerCase());
  const text = joinWords(names);
  return capitalizeFirst ? capitalize(text) : text;
}

/** Proposals live on the task board, so they are off whenever tasks are. Approvals missing are off. */
function stateOf(brief: AttentionBrief, source: AttentionSource): SourceState {
  if (source === 'proposals' && brief.sources.tasks.state === 'off') return 'off';
  if (source === 'approvals') return brief.sources.approvals?.state ?? 'off';
  return brief.sources[source].state;
}

function sourcesIn(brief: AttentionBrief, state: SourceState, among = SOURCE_ORDER): AttentionSource[] {
  return among.filter((source) => stateOf(brief, source) === state);
}

/** Off sources worth naming: proposals fold into "Tasks are turned off", and approvals a gateway lacks are not news. */
function offSources(brief: AttentionBrief): AttentionSource[] {
  const off = sourcesIn(brief, 'off').filter((source) => source !== 'approvals');
  return brief.sources.tasks.state === 'off' ? off.filter((source) => source !== 'proposals') : off;
}

/** "5m ago", or "just now" inside the first minute. */
function ago(ts: number, now: number): string {
  const age = timeAgo(ts, now);
  return age === 'now' ? 'just now' : `${age} ago`;
}

/** The time the board is as fresh as: the stalest live polled source, else now. */
export function checkedAt(brief: AttentionBrief, now: number): number {
  const times = (['tasks', 'proposals', 'crons'] as const)
    .filter((source) => stateOf(brief, source) === 'live')
    .map((source) => brief.sources[source].checkedAt)
    .filter((at): at is number => typeof at === 'number');
  return times.length > 0 ? Math.min(...times) : now;
}

export interface HeadlinePart {
  n: number;
  word: string;
  tone: 'error' | 'operator' | 'live';
}

/** Failures that need the operator: everything blocked except runs that only went quiet. */
export function failingItems(items: AttentionItem[]): AttentionItem[] {
  return items.filter((item) => item.kind !== 'gone-quiet');
}

/**
 * The board's heading in counts: failing, to decide, working. Only counts above zero are named.
 * With none, the heading says nothing needs the operator only when the brief is all clear.
 */
export function headline(brief: AttentionBrief, working: number): { parts: HeadlinePart[]; text: string } {
  const parts: HeadlinePart[] = [];
  const failing = failingItems(brief.blocked).length;
  if (failing > 0) parts.push({ n: failing, word: 'failing', tone: 'error' });
  if (brief.decide.length > 0) parts.push({ n: brief.decide.length, word: 'to decide', tone: 'operator' });
  if (working > 0) parts.push({ n: working, word: 'working', tone: 'live' });
  if (parts.length > 0) return { parts, text: parts.map((part) => `${part.n} ${part.word}`).join(' · ') };
  return { parts, text: brief.allClear ? 'Nothing needs you' : 'Nothing to show' };
}

/** What keeps the board from being complete, in words; empty when every source is live. */
export function gapSentences(brief: AttentionBrief, { loading: sayLoading = true }: { loading?: boolean } = {}): string[] {
  const sentences: string[] = [];
  // A lost gateway is told by the board's own notice, not once per source.
  const errors = sourcesIn(brief, 'error').filter((source) => brief.sources[source]?.error !== NOT_CONNECTED);
  if (errors.length > 0) sentences.push(`${nameList(errors)} could not be read, so this may be incomplete.`);
  const loading = sourcesIn(brief, 'loading');
  if (sayLoading && loading.length > 0) sentences.push(`Loading ${nameList(loading, false)}.`);
  const off = offSources(brief);
  if (off.length > 0) sentences.push(`${nameList(off)} are turned off.`);
  return sentences;
}

/** The kind of an item in a word, for its meta line. */
export function kindWord(item: AttentionItem): string {
  switch (item.kind) {
    case 'approval':
      return 'Approval';
    case 'review':
      return 'Review';
    case 'proposal':
      return item.detail.proposalChange ? `Proposal, changes ${item.detail.proposalChange}` : 'Proposal';
    case 'task-failed':
      return 'Run failed';
    case 'cron-failed':
      return 'Cron failed';
    case 'session-failed':
      return 'Session failed';
    case 'gone-quiet':
      return 'Gone quiet';
    case 'task-running':
    case 'session-running':
      return 'Running';
    case 'task-finished':
      return 'Run finished';
    case 'cron-recovered':
      return 'Cron recovered';
  }
}

export function reasonFor(item: AttentionItem, now: number, ownerName?: string): string {
  switch (item.kind) {
    case 'approval': {
      const expires = item.detail.expiresAt;
      const asked = `Asked ${ago(item.updatedAt, now)}`;
      return expires !== undefined && expires > now ? `${asked} · expires ${atDayClock(expires, now)}` : asked;
    }
    case 'review':
      return `Ready ${ago(item.updatedAt, now)} · ${ownerName ? `${ownerName} says done` : 'Waiting for your review'}`;
    case 'proposal':
      return `${ownerName ?? 'An agent'} proposes this`;
    case 'task-failed':
      return `Run failed ${ago(item.updatedAt, now)}`;
    case 'gone-quiet':
      return `Quiet for ${timeAgo(item.detail.quietSince ?? item.updatedAt, now)}`;
    case 'cron-failed': {
      const nextRun = item.detail.nextRun;
      const failed = `Failed ${ago(item.updatedAt, now)}`;
      return nextRun !== undefined && nextRun > now
        ? `${failed} · fails again ${atDayClock(nextRun, now)}`
        : failed;
    }
    case 'session-failed':
      return 'Run failed while this page was open';
    case 'task-running':
    case 'session-running': {
      const age = timeAgo(item.updatedAt, now);
      return age === 'now' ? 'Just started' : `Running for ${age}`;
    }
    case 'task-finished':
      return `Run finished ${ago(item.updatedAt, now)}`;
    case 'cron-recovered': {
      const failedAt = item.detail.failedAt;
      const failed = failedAt !== undefined ? `Failed ${formatDayClock(failedAt, now)}, ` : 'Failed, ';
      return `${failed}recovered ${formatDayClock(item.updatedAt, now)}`;
    }
  }
}
