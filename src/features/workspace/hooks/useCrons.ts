/**
 * useCrons — Fetch, toggle, run, add, update, and delete cron jobs.
 */

import { useState, useCallback, useEffect, useRef } from 'react';

export interface CronDelivery {
  mode: string;
  channel?: string;
  to?: string;
}

export interface CronJob {
  id: string;
  name?: string;
  label?: string;
  enabled: boolean;
  // Schedule (normalized)
  scheduleKind: 'every' | 'cron' | 'at';
  schedule?: string;      // cron expr
  scheduleTz?: string;    // cron tz
  everyMs?: number;
  at?: string;            // ISO string
  // Payload
  payloadKind: 'agentTurn' | 'systemEvent';
  message?: string;       // agentTurn message or systemEvent text
  model?: string;
  sessionTarget?: 'main' | 'isolated';
  sessionKey?: string;
  // Delivery
  delivery?: CronDelivery;
  // State
  nextRun?: string;
  lastRun?: string;
  lastStatus?: string;
  lastError?: string;
  lastDeliveryStatus?: string;
}

export interface CronRun {
  timestamp: string;
  status: string;
  duration?: number;
  error?: string;
  summary?: string;
}

export function normalizeCronJob(j: Record<string, unknown>): CronJob {
  const sched = (j.schedule || {}) as Record<string, unknown>;
  const payload = (j.payload || {}) as Record<string, unknown>;
  const state = (j.state || {}) as Record<string, unknown>;
  const delivery = (j.delivery || undefined) as CronDelivery | undefined;

  const scheduleKind = (sched.kind as string) || (sched.everyMs ? 'every' : sched.expr ? 'cron' : sched.at ? 'at' : 'every');

  return {
    id: (j.id || j.jobId || '') as string,
    name: (j.name || j.label || '') as string,
    label: (j.label || j.name || '') as string,
    enabled: (j.enabled as boolean) ?? true,
    // Schedule
    scheduleKind: scheduleKind as CronJob['scheduleKind'],
    schedule: sched.expr as string | undefined,
    scheduleTz: sched.tz as string | undefined,
    everyMs: sched.everyMs as number | undefined,
    at: sched.at as string | undefined,
    // Payload
    payloadKind: (payload.kind as string) === 'systemEvent' ? 'systemEvent' : 'agentTurn',
    message: (payload.message || payload.text || '') as string,
    model: payload.model as string | undefined,
    sessionTarget:
      (j.sessionTarget as string) === 'main' || (j.sessionTarget as string) === 'isolated'
        ? (j.sessionTarget as 'main' | 'isolated')
        : undefined,
    sessionKey:
      typeof j.sessionKey === 'string' && j.sessionKey.trim().length > 0
        ? j.sessionKey
        : undefined,
    // Delivery
    delivery: delivery?.mode ? delivery : undefined,
    // State
    nextRun: state.nextRunAtMs
      ? new Date(state.nextRunAtMs as number).toISOString()
      : undefined,
    lastRun: state.lastRunAtMs
      ? new Date(state.lastRunAtMs as number).toISOString()
      : undefined,
    lastStatus: state.lastStatus as string | undefined,
    lastError: state.lastError as string | undefined,
    lastDeliveryStatus: state.lastDeliveryStatus as string | undefined,
  };
}

/** Hook to list, create, update, delete, and toggle cron jobs via the gateway API. */
export function useCrons() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  const fetchJobs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/crons');
      const data = await res.json() as { ok: boolean; result?: { jobs?: unknown[]; details?: { jobs?: unknown[] } }; error?: string };
      if (!data.ok) throw new Error(data.error || 'Failed to fetch crons');
      const rawJobs = data.result?.jobs || data.result?.details?.jobs || (Array.isArray(data.result) ? data.result : []);
      setJobs((rawJobs as Record<string, unknown>[]).map(normalizeCronJob));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Auto-fetch on first mount so activeCount is available immediately (e.g. for tab badge)
  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      fetchJobs();
    }
  }, [fetchJobs]);

  const toggleJob = useCallback(async (id: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/crons/${encodeURIComponent(id)}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error || 'Failed to toggle');
      setJobs(prev => prev.map(j => j.id === id ? { ...j, enabled } : j));
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }, []);

  const runJob = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/crons/${encodeURIComponent(id)}/run`, { method: 'POST' });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error || 'Failed to run');
      const nowIso = new Date().toISOString();
      setJobs(prev => prev.map(job => (
        job.id === id
          ? { ...job, lastRun: nowIso }
          : job
      )));
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }, []);

  const fetchRuns = useCallback(async (id: string): Promise<CronRun[]> => {
    try {
      const res = await fetch(`/api/crons/${encodeURIComponent(id)}/runs`);
      const data = await res.json() as {
        ok: boolean;
        result?: { entries?: unknown[]; runs?: unknown[]; details?: { entries?: unknown[] } };
        error?: string;
      };
      if (!data.ok) throw new Error(data.error || 'Failed to fetch runs');
      const rawRuns = data.result?.entries || data.result?.runs || data.result?.details?.entries || (Array.isArray(data.result) ? data.result : []);
      return (rawRuns as Record<string, unknown>[]).map(r => ({
        timestamp: r.timestamp as string || (r.ts ? new Date(r.ts as number).toISOString() : ''),
        status: (r.status as string) || 'unknown',
        duration: (r.durationMs as number) ?? (r.duration as number),
        error: r.error as string | undefined,
        summary: r.summary as string | undefined,
      }));
    } catch {
      return [];
    }
  }, []);

  const addJob = useCallback(async (job: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/crons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error || 'Failed to add cron');
      await fetchJobs();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }, [fetchJobs]);

  const updateJob = useCallback(async (id: string, patch: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/crons/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error || 'Failed to update cron');
      await fetchJobs();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }, [fetchJobs]);

  const deleteJob = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/crons/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error || 'Failed to delete');
      setJobs(prev => prev.filter(j => j.id !== id));
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }, []);

  const activeCount = jobs.filter(j => j.enabled).length;

  return { jobs, isLoading, error, activeCount, fetchJobs, toggleJob, runJob, fetchRuns, addJob, updateJob, deleteJob };
}
