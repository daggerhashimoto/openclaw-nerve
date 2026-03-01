import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { KanbanTask, TaskStatus, TaskPriority } from '../types';

/* ── API response shape ── */
interface TasksResponse {
  items: KanbanTask[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/* ── Filter state ── */
export interface KanbanFilters {
  q: string;
  priority: TaskPriority[];
  assignee: string;
  labels: string[];
}

const EMPTY_FILTERS: KanbanFilters = { q: '', priority: [], assignee: '', labels: [] };

/** Error with attached latest task from a 409 response */
export interface VersionConflictError extends Error {
  latest?: KanbanTask;
}

/* ── Create / Update payloads ── */
export interface CreateTaskPayload {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  labels?: string[];
  assignee?: string;
}

export interface UpdateTaskPayload {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  labels?: string[];
  assignee?: string | null;
  version: number;
}

/* ── Build query string from filters ── */
function buildQuery(filters: KanbanFilters): string {
  const p = new URLSearchParams();
  if (filters.q) p.set('q', filters.q);
  for (const pr of filters.priority) p.append('priority[]', pr);
  if (filters.assignee) p.set('assignee', filters.assignee);
  for (const l of filters.labels) p.append('label', l);
  p.set('limit', '200');
  return p.toString();
}

/* ── Hook ── */
export function useKanban() {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<KanbanFilters>(EMPTY_FILTERS);
  const abortRef = useRef<AbortController | null>(null);

  /* ── Fetch ── */

  const fetchTasks = useCallback(async (f?: KanbanFilters, { silent = false }: { silent?: boolean } = {}) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Only show loading skeleton on first load or explicit filter changes, not background polls
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const qs = buildQuery(f ?? filters);
      const res = await fetch(`/api/kanban/tasks?${qs}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TasksResponse = await res.json();
      setTasks(data.items);
      setTotal(data.total);
      if (!silent) setError(null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      // Only surface errors on explicit fetches, not silent polls
      if (!silent) setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filters]);

  /* Initial fetch + refetch on filter change */
  useEffect(() => {
    fetchTasks(filters);
    return () => abortRef.current?.abort();
  }, [filters, fetchTasks]);

  /* Auto-refresh every 5s so board stays current (silent — no loading flash) */
  useEffect(() => {
    const id = setInterval(() => fetchTasks(undefined, { silent: true }), 5_000);
    return () => clearInterval(id);
  }, [fetchTasks]);

  /* ── Mutations ── */
  const createTask = useCallback(async (payload: CreateTaskPayload): Promise<KanbanTask> => {
    const res = await fetch('/api/kanban/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.details || body.error || `HTTP ${res.status}`);
    }
    const created: KanbanTask = await res.json();
    // Refetch to get accurate ordering
    await fetchTasks();
    return created;
  }, [fetchTasks]);

  const updateTask = useCallback(async (id: string, payload: UpdateTaskPayload): Promise<KanbanTask> => {
    const res = await fetch(`/api/kanban/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        const err = new Error('version_conflict');
        (err as VersionConflictError).latest = body.latest;
        throw err;
      }
      throw new Error(body.details || body.error || `HTTP ${res.status}`);
    }
    const updated: KanbanTask = await res.json();
    await fetchTasks();
    return updated;
  }, [fetchTasks]);

  /** Reorder / move a task via the dedicated reorder endpoint. */
  const reorderTask = useCallback(async (
    id: string,
    version: number,
    targetStatus: TaskStatus,
    targetIndex: number,
  ): Promise<KanbanTask> => {
    const res = await fetch(`/api/kanban/tasks/${encodeURIComponent(id)}/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, targetStatus, targetIndex }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        const err = new Error('version_conflict');
        (err as VersionConflictError).latest = body.latest;
        throw err;
      }
      throw new Error(body.details || body.error || `HTTP ${res.status}`);
    }
    const updated: KanbanTask = await res.json();
    // Refetch to sync all columnOrder values from server
    await fetchTasks(undefined, { silent: true });
    return updated;
  }, [fetchTasks]);

  /** Optimistic state updater for drag-and-drop — applies immediately, no API call. */
  const setTasksOptimistic = useCallback((updater: (prev: KanbanTask[]) => KanbanTask[]) => {
    setTasks(updater);
  }, []);

  const deleteTask = useCallback(async (id: string): Promise<void> => {
    const res = await fetch(`/api/kanban/tasks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.details || body.error || `HTTP ${res.status}`);
    }
    await fetchTasks();
  }, [fetchTasks]);

  /* ── Workflow mutations ── */

  const executeTask = useCallback(async (id: string, options?: { model?: string; thinking?: string }): Promise<KanbanTask> => {
    const res = await fetch(`/api/kanban/tasks/${encodeURIComponent(id)}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options ?? {}),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.details || body.error || `HTTP ${res.status}`);
    }
    const task: KanbanTask = await res.json();
    await fetchTasks(undefined, { silent: true });
    return task;
  }, [fetchTasks]);

  const approveTask = useCallback(async (id: string, note?: string): Promise<KanbanTask> => {
    const res = await fetch(`/api/kanban/tasks/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note ? { note } : {}),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.details || body.error || `HTTP ${res.status}`);
    }
    const task: KanbanTask = await res.json();
    await fetchTasks(undefined, { silent: true });
    return task;
  }, [fetchTasks]);

  const rejectTask = useCallback(async (id: string, note: string): Promise<KanbanTask> => {
    const res = await fetch(`/api/kanban/tasks/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.details || body.error || `HTTP ${res.status}`);
    }
    const task: KanbanTask = await res.json();
    await fetchTasks(undefined, { silent: true });
    return task;
  }, [fetchTasks]);

  const abortTask = useCallback(async (id: string, note?: string): Promise<KanbanTask> => {
    const res = await fetch(`/api/kanban/tasks/${encodeURIComponent(id)}/abort`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note ? { note } : {}),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.details || body.error || `HTTP ${res.status}`);
    }
    const task: KanbanTask = await res.json();
    await fetchTasks(undefined, { silent: true });
    return task;
  }, [fetchTasks]);

  /* ── Helpers ── */
  const tasksByStatusMap = useMemo(() => {
    const map = new Map<TaskStatus, KanbanTask[]>();
    for (const t of tasks) {
      let list = map.get(t.status);
      if (!list) { list = []; map.set(t.status, list); }
      list.push(t);
    }
    for (const list of map.values()) list.sort((a, b) => a.columnOrder - b.columnOrder);
    return map;
  }, [tasks]);

  const tasksByStatus = useCallback((status: TaskStatus): KanbanTask[] => {
    return tasksByStatusMap.get(status) ?? [];
  }, [tasksByStatusMap]);

  const statusCounts = useMemo(() => {
    const counts: Record<TaskStatus, number> = {
      backlog: 0, todo: 0, 'in-progress': 0, review: 0, done: 0, cancelled: 0,
    };
    for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;
    return counts;
  }, [tasks]);

  return {
    tasks,
    setTasks,
    total,
    loading,
    error,
    filters,
    setFilters,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    reorderTask,
    setTasksOptimistic,
    tasksByStatus,
    statusCounts,
    executeTask,
    approveTask,
    rejectTask,
    abortTask,
  };
}
