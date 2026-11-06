import type { KanbanTask, TaskPriority, TaskRunLink, TaskStatus } from './types';
import type { PaneState } from '@/lib/paneState';
import { COLUMN_LABELS } from './types';

/* ── Night light: a task's pane carries its light temperature ── */

/**
 * Blue while the task's agent is running, red when its run broke, cantaloupe while the task
 * waits on the operator (review), otherwise off. The off pane shows the assignee's family hue.
 */
export function taskPaneState(task: Pick<KanbanTask, 'status' | 'run'>): PaneState {
  if (task.run?.status === 'running') return 'live';
  if (task.run?.status === 'error') return 'error';
  if (task.status === 'review') return 'operator';
  return 'off';
}

/** A run's own pane: blue in flight, red when it broke, off once it ended or was aborted. */
export function runPaneState(status: string | null | undefined): PaneState {
  if (status === 'running') return 'live';
  if (status === 'error') return 'error';
  return 'off';
}

export const RUN_WORD: Record<TaskRunLink['status'], string> = {
  running: 'Running',
  done: 'Done',
  error: 'Failed',
  aborted: 'Aborted',
};

/** Text colour for the run word: only the lit states take colour. */
export const RUN_WORD_CLASS: Record<TaskRunLink['status'], string> = {
  running: 'text-live-text',
  done: 'text-muted-foreground',
  error: 'text-destructive',
  aborted: 'text-muted-foreground',
};

/** Priority as a word; normal says nothing. Critical reads in Signal Red, high in Reading White. */
export function priorityWord(priority: string | null | undefined): { word: string; className: string } | null {
  const p = getTaskPriority(priority);
  if (p === 'critical') return { word: 'Critical', className: 'text-destructive' };
  if (p === 'high') return { word: 'High', className: 'text-foreground' };
  if (p === 'low') return { word: 'Low', className: 'text-muted-foreground' };
  return null;
}

/** The agent id behind an `agent:<id>` assignee, or null for the operator and unassigned. */
export function assigneeAgentId(assignee: string | null | undefined): string | null {
  if (!assignee || !assignee.startsWith('agent:')) return null;
  const id = assignee.slice('agent:'.length);
  return id || null;
}

/** How an assignee is named in the board: the operator is "You", an agent is its id. */
export function assigneeName(assignee: string | null | undefined): string | null {
  if (!assignee) return null;
  if (assignee === 'operator') return 'You';
  return assigneeAgentId(assignee) ?? assignee;
}

/** Sentence-case column title: "In Progress" reads "In progress"; acronyms keep their case. */
export function columnTitle(status: TaskStatus, label?: string): string {
  const raw = label ?? COLUMN_LABELS[status] ?? status.replace(/-/g, ' ');
  return raw
    .split(' ')
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word === word.toUpperCase() && word.length > 1 ? word : word.toLowerCase()))
    .join(' ');
}

/** The board in words for the header: "12 tasks, 1 in progress, 2 waiting on you". */
export function boardWords(counts: Record<string, number>): string {
  const total = Object.values(counts).reduce((sum, n) => sum + (n || 0), 0);
  if (total === 0) return '';
  const parts = [`${total} ${total === 1 ? 'task' : 'tasks'}`];
  if (counts['in-progress']) parts.push(`${counts['in-progress']} in progress`);
  if (counts.review) parts.push(`${counts.review} waiting on you`);
  return parts.join(', ');
}

const FALLBACK_STATUS: TaskStatus = 'backlog';
const FALLBACK_PRIORITY: TaskPriority = 'normal';
const FALLBACK_RUN_STATUS: TaskRunLink['status'] = 'error';

export const TASK_STATUS_TONE: Record<
  string,
  { textClass: string; badgeClass: string; statClass: string }
> = {
  backlog: {
    textClass: 'text-muted-foreground',
    badgeClass: 'border-border/70 bg-background/55 text-muted-foreground',
    statClass: 'border-border/70 bg-background/50 text-muted-foreground',
  },
  todo: {
    textClass: 'text-info',
    badgeClass: 'border-info/30 bg-info/10 text-info',
    statClass: 'border-info/24 bg-info/8 text-info',
  },
  'in-progress': {
    textClass: 'text-primary',
    badgeClass: 'border-primary/30 bg-primary/10 text-primary',
    statClass: 'border-primary/24 bg-primary/8 text-primary',
  },
  review: {
    textClass: 'text-orange',
    badgeClass: 'border-orange/30 bg-orange/10 text-orange',
    statClass: 'border-orange/24 bg-orange/8 text-orange',
  },
  done: {
    textClass: 'text-green',
    badgeClass: 'border-green/30 bg-green/10 text-green',
    statClass: 'border-green/24 bg-green/8 text-green',
  },
  cancelled: {
    textClass: 'text-destructive',
    badgeClass: 'border-destructive/30 bg-destructive/10 text-destructive',
    statClass: 'border-destructive/24 bg-destructive/8 text-destructive',
  },
};

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  critical: 'Critical',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

export const TASK_PRIORITY_TONE: Record<
  TaskPriority,
  { dotClass: string; textClass: string; badgeClass: string }
> = {
  critical: {
    dotClass: 'bg-destructive',
    textClass: 'text-destructive',
    badgeClass: 'border-destructive/28 bg-destructive/10 text-destructive',
  },
  high: {
    dotClass: 'bg-orange',
    textClass: 'text-orange',
    badgeClass: 'border-orange/28 bg-orange/10 text-orange',
  },
  normal: {
    dotClass: 'bg-info',
    textClass: 'text-info',
    badgeClass: 'border-info/28 bg-info/10 text-info',
  },
  low: {
    dotClass: 'bg-muted-foreground',
    textClass: 'text-muted-foreground',
    badgeClass: 'border-border/70 bg-background/55 text-muted-foreground',
  },
};

export const TASK_RUN_TONE: Record<
  TaskRunLink['status'],
  { textClass: string; badgeClass: string }
> = {
  running: {
    textClass: 'text-info',
    badgeClass: 'border-info/30 bg-info/10 text-info',
  },
  done: {
    textClass: 'text-green',
    badgeClass: 'border-green/30 bg-green/10 text-green',
  },
  error: {
    textClass: 'text-destructive',
    badgeClass: 'border-destructive/30 bg-destructive/10 text-destructive',
  },
  aborted: {
    textClass: 'text-orange',
    badgeClass: 'border-orange/30 bg-orange/10 text-orange',
  },
};

export function getTaskStatus(value: string | null | undefined): TaskStatus {
  if (value && value in TASK_STATUS_TONE) return value as TaskStatus;
  return FALLBACK_STATUS;
}

export function getTaskStatusTone(value: string | null | undefined) {
  return TASK_STATUS_TONE[getTaskStatus(value)];
}

export function getTaskPriority(value: string | null | undefined): TaskPriority {
  if (value === 'medium') return 'normal';
  if (value && value in TASK_PRIORITY_TONE) return value as TaskPriority;
  return FALLBACK_PRIORITY;
}

export function getTaskPriorityTone(value: string | null | undefined) {
  return TASK_PRIORITY_TONE[getTaskPriority(value)];
}

export function getTaskPriorityLabel(value: string | null | undefined) {
  return TASK_PRIORITY_LABEL[getTaskPriority(value)];
}

export function getTaskRunStatus(value: string | null | undefined): TaskRunLink['status'] {
  if (value && value in TASK_RUN_TONE) return value as TaskRunLink['status'];
  return FALLBACK_RUN_STATUS;
}

export function getTaskRunTone(value: string | null | undefined) {
  return TASK_RUN_TONE[getTaskRunStatus(value)];
}
