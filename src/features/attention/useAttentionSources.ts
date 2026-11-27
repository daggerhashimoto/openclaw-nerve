/**
 * Read-only polling of the three HTTP sources behind the Attention brief.
 * While the view is active: tasks and proposals every 5 s, crons every 60 s,
 * all fetched at once on activation. While inactive nothing is requested.
 * Only GET requests are made, and a failed poll keeps the last good data.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KanbanTask } from '@/features/kanban/types';
import type { KanbanProposal } from '@/features/kanban/hooks/useProposals';
import { normalizeCronJob, type CronJob } from '@/features/workspace/hooks/useCrons';
import type { AttentionSource, SourceStatus } from './types';

type PolledSource = Exclude<AttentionSource, 'sessions'>;

const TASKS_URL = '/api/kanban/tasks?limit=200';
const PROPOSALS_URL = '/api/kanban/proposals?status=pending';
const CRONS_URL = '/api/crons';
const KANBAN_POLL_MS = 5_000;
const CRONS_POLL_MS = 60_000;

const LOADING: SourceStatus = { state: 'loading' };
const OFF: SourceStatus = { state: 'off' };

export interface AttentionSources {
  tasks: KanbanTask[];
  proposals: KanbanProposal[];
  crons: CronJob[];
  sources: Record<PolledSource, SourceStatus>;
  /** Fetch every enabled source now. Does nothing while inactive. */
  refresh: () => void;
}

async function readTasks(res: Response): Promise<KanbanTask[]> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { items?: unknown } | null;
  if (!Array.isArray(data?.items)) throw new Error('Unexpected response');
  return data.items as KanbanTask[];
}

async function readProposals(res: Response): Promise<KanbanProposal[]> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { proposals?: unknown } | null;
  if (!Array.isArray(data?.proposals)) throw new Error('Unexpected response');
  return data.proposals as KanbanProposal[];
}

/** Parsed the way `useCrons.fetchJobs` parses the same endpoint. */
async function readCrons(res: Response): Promise<CronJob[]> {
  const data = await res.json().catch(() => null) as { ok?: boolean; result?: { jobs?: unknown[]; details?: { jobs?: unknown[] } }; error?: string } | null;
  if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to fetch crons');
  const rawJobs = data.result?.jobs || data.result?.details?.jobs || (Array.isArray(data.result) ? data.result : []);
  return (rawJobs as Record<string, unknown>[]).map(normalizeCronJob);
}

export function useAttentionSources(
  { active, kanbanEnabled }: { active: boolean; kanbanEnabled: boolean },
): AttentionSources {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [proposals, setProposals] = useState<KanbanProposal[]>([]);
  const [crons, setCrons] = useState<CronJob[]>([]);
  const [fetchStatus, setFetchStatus] = useState<Record<PolledSource, SourceStatus>>({
    tasks: LOADING,
    proposals: LOADING,
    crons: LOADING,
  });
  const controllers = useRef<Partial<Record<PolledSource, AbortController>>>({});

  const abort = useCallback((source: PolledSource) => {
    controllers.current[source]?.abort();
  }, []);

  /** One GET. A newer request for the same source replaces an older one in flight. */
  const poll = useCallback(async <T,>(
    source: PolledSource,
    url: string,
    read: (res: Response) => Promise<T>,
    apply: (value: T) => void,
  ) => {
    abort(source);
    const controller = new AbortController();
    controllers.current[source] = controller;
    try {
      const res = await fetch(url, { signal: controller.signal });
      const value = await read(res);
      if (controller.signal.aborted) return;
      apply(value);
      setFetchStatus((prev) => ({ ...prev, [source]: { state: 'live', checkedAt: Date.now() } }));
    } catch (err) {
      if (controller.signal.aborted) return;
      const error = err instanceof Error ? err.message : String(err);
      setFetchStatus((prev) => ({ ...prev, [source]: { state: 'error', error } }));
    }
  }, [abort]);

  const fetchTasks = useCallback(() => poll('tasks', TASKS_URL, readTasks, setTasks), [poll]);
  const fetchProposals = useCallback(
    () => poll('proposals', PROPOSALS_URL, readProposals, setProposals),
    [poll],
  );
  const fetchCrons = useCallback(() => poll('crons', CRONS_URL, readCrons, setCrons), [poll]);

  useEffect(() => {
    if (!active || !kanbanEnabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on activation; state is set only after the response arrives
    void fetchTasks();
    void fetchProposals();
    const id = setInterval(() => {
      void fetchTasks();
      void fetchProposals();
    }, KANBAN_POLL_MS);
    return () => {
      clearInterval(id);
      abort('tasks');
      abort('proposals');
    };
  }, [active, kanbanEnabled, fetchTasks, fetchProposals, abort]);

  useEffect(() => {
    if (!active) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on activation; state is set only after the response arrives
    void fetchCrons();
    const id = setInterval(() => {
      void fetchCrons();
    }, CRONS_POLL_MS);
    return () => {
      clearInterval(id);
      abort('crons');
    };
  }, [active, fetchCrons, abort]);

  const refresh = useCallback(() => {
    if (!active) return;
    if (kanbanEnabled) {
      void fetchTasks();
      void fetchProposals();
    }
    void fetchCrons();
  }, [active, kanbanEnabled, fetchTasks, fetchProposals, fetchCrons]);

  const sources = useMemo<Record<PolledSource, SourceStatus>>(() => ({
    tasks: kanbanEnabled ? fetchStatus.tasks : OFF,
    proposals: kanbanEnabled ? fetchStatus.proposals : OFF,
    crons: fetchStatus.crons,
  }), [kanbanEnabled, fetchStatus]);

  return { tasks, proposals, crons, sources, refresh };
}
