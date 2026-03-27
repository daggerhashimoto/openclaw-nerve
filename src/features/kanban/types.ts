// Kanban type contracts — Frozen v1
// Change policy: coordinator approval + issue-file sync required.

/** Built-in status keys shipped with the default board config. */
export const BUILT_IN_STATUSES = ['backlog', 'todo', 'in-progress', 'review', 'done', 'cancelled'] as const;
export type BuiltInStatus = typeof BUILT_IN_STATUSES[number];

/**
 * TaskStatus is a plain string so custom column keys are supported.
 * The board config (from /api/kanban/config) is the canonical source of truth
 * for which statuses are valid and how columns are ordered.
 */
export type TaskStatus = string;
export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

/**
 * Default column display order used as a fallback before the board config loads.
 * Consumers should prefer `config.columns` from useKanban() over this constant.
 */
export const COLUMNS: TaskStatus[] = ['backlog', 'todo', 'in-progress', 'review', 'done'];

/** Human-readable labels for built-in columns. Custom columns use their `title` from config. */
export const COLUMN_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  'in-progress': 'In Progress',
  review: 'Review',
  done: 'Done',
  cancelled: 'Cancelled',
};
export type TaskActor = 'operator' | `agent:${string}`;

export interface TaskFeedback {
  at: number;
  by: TaskActor;
  note: string;
}

export interface TaskRunLink {
  sessionKey: string;
  sessionId?: string;
  runId?: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'done' | 'error' | 'aborted';
  error?: string;
}

export interface KanbanTask {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdBy: TaskActor;
  createdAt: number;
  updatedAt: number;
  version: number;
  sourceSessionKey?: string;
  assignee?: TaskActor;
  labels: string[];
  columnOrder: number;
  run?: TaskRunLink;
  result?: string;
  resultAt?: number;
  model?: string;
  thinking?: 'off' | 'low' | 'medium' | 'high';
  dueAt?: number;
  estimateMin?: number;
  actualMin?: number;
  feedback: TaskFeedback[];
}
