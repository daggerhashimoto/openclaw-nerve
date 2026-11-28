/**
 * Run history for the cron jobs that ran today, for the Today digest. Only jobs whose last run
 * falls on or after `dayStart` are asked, each with `GET /api/crons/:id/runs`, and again when
 * that last run changes. Read-only. A job that could not be read, or that ran today by its own
 * state but returned no runs for today, makes the source an error that names it; runs already
 * read are kept.
 */

import { useEffect, useMemo, useState } from 'react';
import type { CronJob } from '@/features/workspace/hooks/useCrons';
import type { SourceStatus } from '../types';
import type { CronRunEntry } from './buildDay';

/** At most this many jobs are asked per load. */
export const MAX_CRON_JOBS = 30;

function toMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : undefined;
  }
  return undefined;
}

/** One run entry as the route passes it through from the gateway (or Nerve's manual runs). */
export function normalizeCronRun(raw: Record<string, unknown>): CronRunEntry | null {
  const at = toMs(raw.ts) ?? toMs(raw.runAtMs) ?? toMs(raw.timestamp);
  if (at === undefined) return null;
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  return {
    at,
    status: text(raw.status) ?? 'unknown',
    error: text(raw.error),
    summary: text(raw.summary),
    durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : undefined,
    sessionKey: text(raw.sessionKey),
  };
}

/** Unlike `useCrons().fetchRuns`, a failure throws, so the digest can say the job was not read. */
export async function loadCronRuns(id: string, signal?: AbortSignal): Promise<CronRunEntry[]> {
  const res = await fetch(`/api/crons/${encodeURIComponent(id)}/runs`, { signal });
  const data = await res.json().catch(() => null) as {
    ok?: boolean;
    result?: { entries?: unknown[]; runs?: unknown[] } | unknown[];
    error?: string;
  } | null;
  if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  const result = data.result;
  const raw = Array.isArray(result) ? result : result?.entries ?? result?.runs ?? [];
  return (raw as Record<string, unknown>[])
    .map((entry) => (entry && typeof entry === 'object' ? normalizeCronRun(entry) : null))
    .filter((entry): entry is CronRunEntry => entry !== null);
}

interface Options {
  active: boolean;
  crons: CronJob[];
  /** The crons list's own status; runs cannot be known before it answers. */
  cronsStatus: SourceStatus;
  dayStart: number;
}

export function useCronRuns({ active, crons, cronsStatus, dayStart }: Options): {
  runs: Record<string, CronRunEntry[]>;
  status: SourceStatus;
} {
  const [runs, setRuns] = useState<Record<string, CronRunEntry[]>>({});
  const [fetchStatus, setFetchStatus] = useState<SourceStatus>({ state: 'loading' });
  const [answered, setAnswered] = useState<string | null>(null);

  const jobs = useMemo(() => crons
    .filter((job) => (toMs(job.lastRun) ?? 0) >= dayStart)
    .slice(0, MAX_CRON_JOBS), [crons, dayStart]);
  const signature = jobs.length > 0 ? JSON.stringify(jobs.map((job) => [job.id, job.name || job.id, job.lastRun ?? ''])) : '';

  useEffect(() => {
    if (!active || !signature) return;
    const controller = new AbortController();
    const asked = (JSON.parse(signature) as [string, string, string][]).map(([id, name]) => ({ id, name }));
    void (async () => {
      const results = await Promise.allSettled(asked.map(({ id }) => loadCronRuns(id, controller.signal)));
      if (controller.signal.aborted) return;
      const failures: string[] = [];
      const next: Record<string, CronRunEntry[]> = {};
      results.forEach((result, index) => {
        const { id, name } = asked[index];
        if (result.status === 'rejected') {
          failures.push(name);
          return;
        }
        if (!result.value.some((entry) => entry.at >= dayStart)) failures.push(name);
        next[id] = result.value;
      });
      setRuns((prev) => ({ ...prev, ...next }));
      setFetchStatus(failures.length > 0
        ? { state: 'error', error: failures.join(', ') }
        : { state: 'live', checkedAt: Date.now() });
      setAnswered(signature);
    })();
    return () => controller.abort();
  }, [active, signature, dayStart]);

  // Only the jobs still in today's list count.
  const todays = useMemo(() => {
    const out: Record<string, CronRunEntry[]> = {};
    for (const job of jobs) if (runs[job.id]) out[job.id] = runs[job.id];
    return out;
  }, [jobs, runs]);

  let status: SourceStatus;
  // Without the cron list the runs cannot be asked; the Crons note speaks for both.
  if (cronsStatus.state !== 'live') status = cronsStatus;
  else if (!signature) status = { state: 'live', checkedAt: cronsStatus.checkedAt };
  else if (answered === null) status = { state: 'loading' };
  else status = fetchStatus;

  return { runs: todays, status };
}
