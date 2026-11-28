/**
 * Read-only polling of the three HTTP sources behind the Attention brief.
 * While the view is active: tasks and proposals every 5 s, crons every 60 s,
 * all fetched at once on activation. A tick is skipped while that source's
 * previous request is still pending. While inactive nothing is requested.
 * Only GET requests are made, and a failed poll keeps the last good data.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KanbanTask } from '@/features/kanban/types';
import type { KanbanProposal } from '@/features/kanban/hooks/useProposals';
import { normalizeCronJob, type CronJob } from '@/features/workspace/hooks/useCrons';
import type { AttentionSource, SourceStatus } from './types';

type PolledSource = Exclude<AttentionSource, 'sessions' | 'approvals'>;

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

interface TasksPage {
  items: KanbanTask[];
  hasMore: boolean;
}

async function readTasksPage(res: Response): Promise<TasksPage> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { items?: unknown; hasMore?: unknown } | null;
  if (!Array.isArray(data?.items)) throw new Error('Unexpected response');
  return { items: data.items as KanbanTask[], hasMore: data.hasMore === true };
}

/** Every task, following `offset` until the server reports no more pages. */
async function loadTasks(signal: AbortSignal): Promise<KanbanTask[]> {
  const tasks: KanbanTask[] = [];
  let offset = 0;
  for (;;) {
    const url = offset === 0 ? TASKS_URL : `${TASKS_URL}&offset=${offset}`;
    const page = await readTasksPage(await fetch(url, { signal }));
    tasks.push(...page.items);
    if (!page.hasMore || page.items.length === 0) return tasks;
    offset += page.items.length;
  }
}

async function loadProposals(signal: AbortSignal): Promise<KanbanProposal[]> {
  const res = await fetch(PROPOSALS_URL, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { proposals?: unknown } | null;
  if (!Array.isArray(data?.proposals)) throw new Error('Unexpected response');
  return data.proposals as KanbanProposal[];
}

/** Parsed the way `useCrons.fetchJobs` parses the same endpoint. */
async function loadCrons(signal: AbortSignal): Promise<CronJob[]> {
  const res = await fetch(CRONS_URL, { signal });
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
  const inFlight = useRef<Partial<Record<PolledSource, boolean>>>({});

  const abort = useCallback((source: PolledSource) => {
    controllers.current[source]?.abort();
    inFlight.current[source] = false;
  }, []);

  /**
   * One load. An explicit request (activation, Refresh) replaces an older one in flight; an
   * automatic poll tick is skipped while the previous request is still pending, so a slow
   * source can finish instead of being aborted by every tick.
   */
  const poll = useCallback(async <T,>(
    source: PolledSource,
    load: (signal: AbortSignal) => Promise<T>,
    apply: (value: T) => void,
    automatic: boolean,
  ) => {
    if (automatic && inFlight.current[source]) return;
    abort(source);
    const controller = new AbortController();
    controllers.current[source] = controller;
    inFlight.current[source] = true;
    try {
      const value = await load(controller.signal);
      if (controller.signal.aborted) return;
      apply(value);
      setFetchStatus((prev) => ({ ...prev, [source]: { state: 'live', checkedAt: Date.now() } }));
    } catch (err) {
      if (controller.signal.aborted) return;
      const error = err instanceof Error ? err.message : String(err);
      setFetchStatus((prev) => ({ ...prev, [source]: { state: 'error', error } }));
    } finally {
      if (controllers.current[source] === controller) inFlight.current[source] = false;
    }
  }, [abort]);

  const fetchTasks = useCallback(
    (automatic = false) => poll('tasks', loadTasks, setTasks, automatic),
    [poll],
  );
  const fetchProposals = useCallback(
    (automatic = false) => poll('proposals', loadProposals, setProposals, automatic),
    [poll],
  );
  const fetchCrons = useCallback(
    (automatic = false) => poll('crons', loadCrons, setCrons, automatic),
    [poll],
  );

  useEffect(() => {
    if (!active || !kanbanEnabled) return;
    void fetchTasks();
    void fetchProposals();
    const id = setInterval(() => {
      void fetchTasks(true);
      void fetchProposals(true);
    }, KANBAN_POLL_MS);
    return () => {
      clearInterval(id);
      abort('tasks');
      abort('proposals');
    };
  }, [active, kanbanEnabled, fetchTasks, fetchProposals, abort]);

  useEffect(() => {
    if (!active) return;
    void fetchCrons();
    const id = setInterval(() => {
      void fetchCrons(true);
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
