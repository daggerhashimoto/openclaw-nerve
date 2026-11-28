/**
 * The Today paragraph: the day's compact facts posted to the server, which answers cached text
 * for facts it has seen and writes new text in the background. While it is `pending` the hook
 * polls with a back-off. New facts, or a new `signal` (Refresh, a periodic re-ask), ask again.
 * A failed request keeps what was shown and stops quietly; the facts strip does not depend on it.
 */

import { useEffect, useState } from 'react';
import type { ThreadSummary } from '../useAttentionSummaries';

export const DAY_SUMMARY_URL = '/api/attention/day-summary';
/** Waits between polls while the text is being written; the last one repeats. */
export const DAY_SUMMARY_POLL_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 30_000];
export const DAY_SUMMARY_MAX_POLLS = 12;

export type DaySummaryState = Omit<ThreadSummary, 'status'> & { status: 'ready' | 'pending' | 'error' };

const STATUSES = new Set(['ready', 'pending', 'error']);

export async function fetchDaySummary(facts: unknown, signal?: AbortSignal): Promise<DaySummaryState | null> {
  const res = await fetch(DAY_SUMMARY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ facts }),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { summary?: Record<string, unknown> } | null;
  const summary = data?.summary;
  if (!summary || typeof summary.status !== 'string' || !STATUSES.has(summary.status)) return null;
  return {
    status: summary.status as DaySummaryState['status'],
    ...(typeof summary.text === 'string' && summary.text.trim() ? { text: summary.text.trim() } : {}),
    ...(typeof summary.updatedAt === 'number' ? { updatedAt: summary.updatedAt } : {}),
  };
}

interface Options {
  active: boolean;
  /** Null while the day is still loading: nothing is asked for a half-read day. */
  facts: unknown;
  signal: string;
}

export function useDaySummary({ active, facts, signal }: Options): DaySummaryState | undefined {
  const [state, setState] = useState<{ day?: string; summary?: DaySummaryState }>({});
  const factsId = facts ? JSON.stringify(facts) : '';
  const day = facts ? (facts as { day?: string }).day : undefined;

  useEffect(() => {
    if (!active || !factsId) return;
    const body = JSON.parse(factsId) as { day?: string };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;

    const run = async () => {
      try {
        const next = await fetchDaySummary(body, controller.signal);
        if (controller.signal.aborted || !next) return;
        setState({ day: body.day, summary: next });
        if (next.status === 'pending' && polls < DAY_SUMMARY_MAX_POLLS) {
          const delay = DAY_SUMMARY_POLL_DELAYS_MS[Math.min(polls, DAY_SUMMARY_POLL_DELAYS_MS.length - 1)];
          polls += 1;
          timer = setTimeout(() => { void run(); }, delay);
        }
      } catch {
        // Quiet: the facts strip stands alone.
      }
    };
    void run();

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [active, factsId, signal]);

  // Yesterday's text never stands for today.
  return state.day === day ? state.summary : undefined;
}
