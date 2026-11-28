/**
 * The Today digest's paragraph: two or three sentences about the operator's day so far, written
 * by the same cheap one-shot model run as the thread summaries (see {@link runOneShot}).
 *
 * The client sends the day's compact facts (counts and short lines, already bounded by the
 * route) with its own local day key, since the server cannot know the viewer's midnight. The
 * facts are fingerprinted. The same fingerprint returns the cached text. New facts start one
 * background generation and answer `pending` (with the previous text, if any) so the client
 * polls; within `minIntervalMs` of the last text, new facts answer `ready` with that text and
 * the next ask after the interval regenerates. A failed run is retried only after a back-off,
 * and the client shows its facts without a paragraph meanwhile.
 *
 * Ready texts live in memory and in `${NERVE_DATA_DIR:-~/.nerve}/attention/day-summary.json`,
 * one per day key, the newest few days kept.
 * @module
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SUMMARY_RETRY_MS,
  SUMMARY_TIMEOUT_MS,
  runOneShot,
  type RpcCall,
  type SummaryResult,
} from './attention-summaries.js';

export interface DayFacts {
  /** The viewer's local day, `YYYY-MM-DD`. */
  day: string;
  counts: {
    sessions: number;
    done: number;
    merged: number;
    cronOk: number;
    cronFailed: number;
  };
  /** Newest first, one short line each. */
  done: string[];
  /** One short line per session active today. */
  chats: string[];
  /** Sources that could not be read, by name. */
  missing: string[];
}

export interface DaySummaryOptions {
  rpc: RpcCall;
  filePath?: string;
  model?: () => string | undefined;
  now?: () => number;
  timeoutMs?: number;
  retryMs?: number;
  minIntervalMs?: number;
}

export interface DaySummary {
  get: (facts: DayFacts) => Promise<SummaryResult>;
  whenIdle: () => Promise<void>;
}

export const DAY_SUMMARY_MIN_INTERVAL_MS = 10 * 60_000;
export const DAY_SUMMARY_MAX_CHARS = 640;
/** The run goes out as the main agent; the explicit session keeps it off the main thread. */
const RUN_AS = 'agent:main:main';
const DAYS_KEPT = 14;

export function buildDayPrompt(facts: DayFacts): string {
  const { counts } = facts;
  const lines = [
    'You write a short note for the operator of a team of AI agents about their day so far.',
    'Write at most three short plain sentences, under 60 words in all.',
    'Lead with what needs the operator (failures first), then what got done. Mention routine cron runs only as a count, never one by one.',
    'Leave out anything that is zero; do not say that nothing was done or merged.',
    'Use only the facts below. Do not add names, numbers or events that are not listed, and do not say anything is open or waiting unless the facts show it. If a source was not read, do not guess about it.',
    'No markdown, no lists, no headings and no preamble.',
    '',
    `Day: ${facts.day}`,
    `Counts: ${counts.sessions} sessions active, ${counts.done} things done, ${counts.merged} pull requests merged, ${counts.cronOk} cron runs ok, ${counts.cronFailed} cron runs failed.`,
  ];
  if (facts.missing.length > 0) lines.push(`Not read: ${facts.missing.join(', ')}.`);
  lines.push('', 'Done today, newest first:', ...(facts.done.length > 0 ? facts.done : ['(nothing)']));
  lines.push('', 'Chats today:', ...(facts.chats.length > 0 ? facts.chats : ['(none)']));
  return lines.join('\n');
}

export function fingerprintFacts(facts: DayFacts): string {
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 32);
}

/**
 * The facts a paragraph must never contradict: what got done, merged or failed, and which
 * sources were unread. A change here rewrites the paragraph at once; anything else (cron run
 * counts, chat times) waits for the minimum interval.
 */
export function majorFingerprintFacts(facts: DayFacts): string {
  const { counts } = facts;
  const major = { done: counts.done, merged: counts.merged, cronFailed: counts.cronFailed, missing: facts.missing };
  return createHash('sha256').update(JSON.stringify(major)).digest('hex').slice(0, 32);
}

export function defaultDaySummaryPath(): string {
  const root = process.env.NERVE_DATA_DIR || path.join(os.homedir() || process.cwd(), '.nerve');
  return path.join(root, 'attention', 'day-summary.json');
}

interface Entry {
  fingerprint: string;
  /** Older cache files lack it; such an entry counts as a major change. */
  major?: string;
  text: string;
  updatedAt: number;
}

export function createDaySummary(options: DaySummaryOptions): DaySummary {
  const {
    rpc,
    filePath,
    model = () => undefined,
    now = Date.now,
    timeoutMs = SUMMARY_TIMEOUT_MS,
    retryMs = SUMMARY_RETRY_MS,
    minIntervalMs = DAY_SUMMARY_MIN_INTERVAL_MS,
  } = options;

  const cache = new Map<string, Entry>();
  const errors = new Map<string, number>();
  const running = new Map<string, Promise<void>>();
  let loaded: Promise<void> | null = null;
  let writeChain: Promise<void> = Promise.resolve();

  const load = () => {
    loaded ??= (async () => {
      if (!filePath) return;
      try {
        const raw = JSON.parse(await fs.promises.readFile(filePath, 'utf-8')) as { entries?: Record<string, Entry> };
        for (const [day, entry] of Object.entries(raw.entries ?? {})) {
          if (entry && typeof entry.fingerprint === 'string' && typeof entry.text === 'string' && typeof entry.updatedAt === 'number') {
            cache.set(day, entry);
          }
        }
      } catch {
        // Missing or unreadable: start empty.
      }
    })();
    return loaded;
  };

  const persist = () => {
    if (!filePath) return;
    const days = [...cache.keys()].sort();
    for (const day of days.slice(0, Math.max(0, days.length - DAYS_KEPT))) cache.delete(day);
    const body = JSON.stringify({ version: 1, entries: Object.fromEntries(cache) });
    writeChain = writeChain.then(async () => {
      try {
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        const tmp = `${filePath}.tmp`;
        await fs.promises.writeFile(tmp, body);
        await fs.promises.rename(tmp, filePath);
      } catch (err) {
        console.warn('[attention-day-summary] could not save:', (err as Error).message);
      }
    });
  };

  const start = (facts: DayFacts, fingerprint: string) => {
    const job = runOneShot(rpc, {
      sessionKey: RUN_AS,
      prompt: buildDayPrompt(facts),
      modelRef: model(),
      timeoutMs,
      maxChars: DAY_SUMMARY_MAX_CHARS,
      what: 'Day summary',
    })
      .then((text) => {
        cache.set(facts.day, { fingerprint, major: majorFingerprintFacts(facts), text, updatedAt: now() });
        errors.delete(facts.day);
        persist();
      })
      .catch((err: unknown) => {
        errors.set(facts.day, now() + retryMs);
        console.warn(`[attention-day-summary] ${facts.day}: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        running.delete(facts.day);
      });
    running.set(facts.day, job);
  };

  return {
    get: async (facts) => {
      await load();
      const fingerprint = fingerprintFacts(facts);
      const cached = cache.get(facts.day);
      const previous = cached ? { text: cached.text, updatedAt: cached.updatedAt } : {};

      if (cached?.fingerprint === fingerprint) return { status: 'ready', ...previous };
      if (running.has(facts.day)) return { status: 'pending', ...previous };
      const retryAt = errors.get(facts.day);
      if (retryAt !== undefined && now() < retryAt) return cached ? { status: 'ready', ...previous } : { status: 'error' };
      // Too soon after the last text, and nothing it states has changed: keep it; an ask after
      // the interval writes a new one. A change in what got done, merged or failed rewrites now.
      const majorChanged = cached?.major !== majorFingerprintFacts(facts);
      if (cached && !majorChanged && now() - cached.updatedAt < minIntervalMs) return { status: 'ready', ...previous };

      start(facts, fingerprint);
      return { status: 'pending', ...previous };
    },
    whenIdle: async () => {
      while (running.size > 0) await Promise.all(running.values());
      await writeChain;
    },
  };
}
