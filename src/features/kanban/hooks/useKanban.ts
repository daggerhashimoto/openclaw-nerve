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
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  labels?: string[];
  assignee?: string;
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
  const fetchTasks = useCallback(async (f?: KanbanFilters) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const qs = buildQuery(f ?? filters);
      const res = await fetch(`/api/kanban/tasks?${qs}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TasksResponse = await res.json();
      setTasks(data.items);
      setTotal(data.total);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  /* Initial fetch + refetch on filter change */
  useEffect(() => {
    fetchTasks(filters);
    return () => abortRef.current?.abort();
  }, [filters, fetchTasks]);

  /* Auto-refresh every 5s so board stays current */
  useEffect(() => {
    const id = setInterval(() => fetchTasks(), 5_000);
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
      if (res.status === 409) throw new Error('version_conflict');
      throw new Error(body.details || body.error || `HTTP ${res.status}`);
    }
    const updated: KanbanTask = await res.json();
    await fetchTasks();
    return updated;
  }, [fetchTasks]);

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

  /* ── Helpers ── */
  const tasksByStatus = useCallback((status: TaskStatus): KanbanTask[] => {
    return tasks
      .filter(t => t.status === status)
      .sort((a, b) => a.columnOrder - b.columnOrder);
  }, [tasks]);

  const statusCounts = useMemo(() => {
    const counts: Record<TaskStatus, number> = {
      backlog: 0, todo: 0, 'in-progress': 0, review: 0, done: 0, cancelled: 0,
    };
    for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;
    return counts;
  }, [tasks]);

  return {
    tasks,
    total,
    loading,
    error,
    filters,
    setFilters,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    tasksByStatus,
    statusCounts,
  };
}
