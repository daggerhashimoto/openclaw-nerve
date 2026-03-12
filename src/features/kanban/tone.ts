import type { TaskPriority, TaskRunLink, TaskStatus } from './types';

const FALLBACK_STATUS: TaskStatus = 'backlog';
const FALLBACK_PRIORITY: TaskPriority = 'normal';
const FALLBACK_RUN_STATUS: TaskRunLink['status'] = 'error';

export const TASK_STATUS_TONE: Record<
  TaskStatus,
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
