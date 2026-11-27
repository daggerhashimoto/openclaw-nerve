/**
 * Words for the Attention brief: the summary sentence, the source line, the
 * heading and the per-card reason. Pure: every time comes from the arguments.
 * Nothing here calls agent-reported work verified or approved.
 */

import { timeAgo } from '@/lib/formatting';
import type { AttentionBrief, AttentionItem, AttentionSource } from './types';

const SOURCE_ORDER: AttentionSource[] = ['tasks', 'proposals', 'crons', 'sessions'];
// Sessions are not listed as live; the session caveat covers them.
const LISTED_AS_LIVE: AttentionSource[] = ['tasks', 'proposals', 'crons'];
const SOURCE_NAMES: Record<AttentionSource, string> = {
  tasks: 'Tasks',
  proposals: 'Proposals',
  crons: 'Crons',
  sessions: 'Sessions',
};
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const SESSION_CAVEAT = 'session failures show from when this page opened';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type SourceState = AttentionBrief['sources'][AttentionSource]['state'];

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

/** `at HH:MM` when `ts` is today, otherwise `Sat 07:57`: reads after "since you left" and "fails again". */
function atDayClock(ts: number, now: number): string {
  return sameLocalDay(ts, now) ? `at ${formatClock(ts)}` : formatDayClock(ts, now);
}

function countWord(n: number): string {
  return n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function counted(n: number, one: string, many: string): string {
  return `${countWord(n)} ${n === 1 ? one : many}`;
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

/** Proposals live on the task board, so they are off whenever tasks are. */
function stateOf(brief: AttentionBrief, source: AttentionSource): SourceState {
  if (source === 'proposals' && brief.sources.tasks.state === 'off') return 'off';
  return brief.sources[source].state;
}

function sourcesIn(brief: AttentionBrief, state: SourceState, among = SOURCE_ORDER): AttentionSource[] {
  return among.filter((source) => stateOf(brief, source) === state);
}

/** Off sources to name; proposals are folded into "Tasks are turned off". */
function offSources(brief: AttentionBrief): AttentionSource[] {
  const off = sourcesIn(brief, 'off');
  return brief.sources.tasks.state === 'off' ? off.filter((source) => source !== 'proposals') : off;
}

function readError(brief: AttentionBrief, source: AttentionSource): string {
  const error = brief.sources[source].error?.trim();
  return error
    ? `${SOURCE_NAMES[source]} could not be read (${error}).`
    : `${SOURCE_NAMES[source]} could not be read.`;
}

/** The time the brief is as fresh as: the stalest live source, else now. */
function checkedClock(brief: AttentionBrief, live: AttentionSource[], now: number): string {
  const times = live
    .map((source) => brief.sources[source].checkedAt)
    .filter((checkedAt): checkedAt is number => typeof checkedAt === 'number');
  return formatClock(times.length > 0 ? Math.min(...times) : now);
}

/** "5m ago", or "just now" inside the first minute. */
function ago(ts: number, now: number): string {
  const age = timeAgo(ts, now);
  return age === 'now' ? 'just now' : `${age} ago`;
}

export function sinceHeading(brief: AttentionBrief, lastLook: number | null, now: number): string {
  // brief.since is the window the brief was built for; it equals lastLook when one exists.
  return lastLook === null ? 'In the last 24 hours' : `Since you left ${atDayClock(brief.since, now)}`;
}

export function sourceLine(brief: AttentionBrief, now: number): string {
  const live = sourcesIn(brief, 'live', LISTED_AS_LIVE);
  const parts: string[] = [];

  if (live.length > 0) {
    parts.push(
      `Checked ${checkedClock(brief, live, now)}. ${nameList(live)} are live; ${SESSION_CAVEAT}.`,
    );
  }
  for (const source of sourcesIn(brief, 'error')) parts.push(readError(brief, source));
  const loading = sourcesIn(brief, 'loading');
  if (loading.length > 0) parts.push(`Loading ${nameList(loading, false)}.`);
  const off = offSources(brief);
  if (off.length > 0) parts.push(`${nameList(off)} are turned off.`);
  if (live.length === 0) parts.push(capitalize(`${SESSION_CAVEAT}.`));

  return parts.join(' ');
}

/** What is missing from the brief, in words; empty when every source is live. */
function gapSentences(brief: AttentionBrief): string[] {
  const sentences: string[] = [];
  const errors = sourcesIn(brief, 'error');
  if (errors.length > 0) sentences.push(`${nameList(errors)} could not be read, so this may be incomplete.`);
  const loading = sourcesIn(brief, 'loading');
  if (loading.length > 0) sentences.push(`Still loading ${nameList(loading, false)}.`);
  const off = offSources(brief);
  if (off.length > 0) sentences.push(`${nameList(off)} are turned off.`);
  return sentences;
}

/** The failing cron that runs again soonest, if any run is still ahead. */
function soonestCronRun(brief: AttentionBrief, now: number): { title: string; nextRun: number } | null {
  let soonest: { title: string; nextRun: number } | null = null;
  for (const item of brief.blocked) {
    const nextRun = item.detail.nextRun;
    if (item.kind !== 'cron-failed' || nextRun === undefined || nextRun <= now) continue;
    if (!soonest || nextRun < soonest.nextRun) soonest = { title: item.title, nextRun };
  }
  return soonest;
}

function needsSentence(brief: AttentionBrief): string | null {
  const decisions = brief.decide.length;
  const quiet = brief.blocked.filter((item) => item.kind === 'gone-quiet').length;
  const failures = brief.blocked.length - quiet;

  const phrases: { count: number; text: string }[] = [];
  if (decisions > 0) phrases.push({ count: decisions, text: counted(decisions, 'decision', 'decisions') });
  if (failures > 0) phrases.push({ count: failures, text: counted(failures, 'failure', 'failures') });
  if (quiet > 0) phrases.push({ count: quiet, text: counted(quiet, 'quiet task', 'quiet tasks') });
  if (phrases.length === 0) return null;

  const single = phrases.length === 1 && phrases[0].count === 1;
  return capitalize(`${joinWords(phrases.map((phrase) => phrase.text))} ${single ? 'needs' : 'need'} you.`);
}

export function summarySentence(brief: AttentionBrief, now: number): string {
  if (brief.allClear) return 'Nothing needs you.';

  const sentences: string[] = [];
  const gap = gapSentences(brief);
  const needs = needsSentence(brief);

  if (needs) {
    sentences.push(needs);
    const cron = soonestCronRun(brief, now);
    if (cron) sentences.push(`${cron.title} fails again ${atDayClock(cron.nextRun, now)} unless fixed.`);
  } else if (gap.length === 0) {
    sentences.push('Nothing is waiting on you.');
  }

  if (!needs && brief.progress.length > 0) {
    const n = brief.progress.length;
    sentences.push(capitalize(`${countWord(n)} ${n === 1 ? 'item is' : 'items are'} in progress.`));
  }

  sentences.push(...gap);
  return sentences.join(' ');
}

export function reasonFor(item: AttentionItem, now: number, ownerName?: string): string {
  switch (item.kind) {
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
    case 'cron-finished':
      return `Last run finished ${ago(item.updatedAt, now)}`;
  }
}
