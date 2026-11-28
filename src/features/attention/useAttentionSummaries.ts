/**
 * "What happened" summaries for the cards and Start here: one request for every shown session,
 * repeated with a back-off while any is still being summarized. The server answers cached
 * summaries cheaply, so a new `signal` (Refresh, a changed item, a finished reply) just asks
 * again. A failed request keeps what was shown and stops quietly; the board does not depend on it.
 */

import { useEffect, useState } from 'react';

export interface ThreadSummary {
  status: 'ready' | 'pending' | 'error' | 'empty';
  text?: string;
  updatedAt?: number;
}

export const SUMMARIES_URL = '/api/attention/summaries';
/** Waits between polls while a summary is pending; the last one repeats. */
export const SUMMARY_POLL_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 30_000];
/** Polls per request before giving up until the next signal. */
export const SUMMARY_MAX_POLLS = 20;

const STATUSES = new Set<ThreadSummary['status']>(['ready', 'pending', 'error', 'empty']);

function readSummary(value: unknown): ThreadSummary | null {
  if (!value || typeof value !== 'object') return null;
  const { status, text, updatedAt } = value as Record<string, unknown>;
  if (typeof status !== 'string' || !STATUSES.has(status as ThreadSummary['status'])) return null;
  return {
    status: status as ThreadSummary['status'],
    ...(typeof text === 'string' && text.trim() ? { text: text.trim() } : {}),
    ...(typeof updatedAt === 'number' ? { updatedAt } : {}),
  };
}

export async function fetchSummaries(sessionKeys: string[], signal?: AbortSignal): Promise<Record<string, ThreadSummary>> {
  const res = await fetch(SUMMARIES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionKeys }),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { summaries?: Record<string, unknown> } | null;
  const out: Record<string, ThreadSummary> = {};
  for (const key of sessionKeys) {
    const summary = readSummary(data?.summaries?.[key]);
    if (summary) out[key] = summary;
  }
  return out;
}

interface Options {
  /** The board is on screen; nothing is requested while it is not. */
  active: boolean;
  /** Sessions of the items shown as cards or Start here. */
  sessionKeys: string[];
  /** Any change asks again. */
  signal: string;
}

export function useAttentionSummaries({ active, sessionKeys, signal }: Options): Record<string, ThreadSummary> {
  const [summaries, setSummaries] = useState<Record<string, ThreadSummary>>({});
  const keysId = [...new Set(sessionKeys.filter(Boolean))].join('\n');

  useEffect(() => {
    if (!active || !keysId) return;
    const keys = keysId.split('\n');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;

    const run = async () => {
      try {
        const next = await fetchSummaries(keys, controller.signal);
        if (controller.signal.aborted) return;
        setSummaries((prev) => ({ ...prev, ...next }));
        if (keys.some((key) => next[key]?.status === 'pending') && polls < SUMMARY_MAX_POLLS) {
          const delay = SUMMARY_POLL_DELAYS_MS[Math.min(polls, SUMMARY_POLL_DELAYS_MS.length - 1)];
          polls += 1;
          timer = setTimeout(() => { void run(); }, delay);
        }
      } catch {
        // Quiet: the cards simply show no summary.
      }
    };
    void run();

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [active, keysId, signal]);

  return summaries;
}
