/**
 * Kanban task store — JSON file persistence with mutex-protected I/O.
 *
 * Data lives at `server/data/kanban/tasks.json`. Every mutating operation
 * acquires the store mutex, reads the file, applies the change, and writes
 * back atomically. CAS version checks prevent stale overwrites.
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createMutex } from './mutex.js';

// ── Types ────────────────────────────────────────────────────────────

export type TaskStatus = 'backlog' | 'todo' | 'in-progress' | 'review' | 'done' | 'cancelled';
export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';
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

export interface KanbanBoardConfig {
  columns: Array<{
    key: TaskStatus;
    title: string;
    wipLimit?: number;
    visible: boolean;
  }>;
  defaults: {
    status: TaskStatus;
    priority: TaskPriority;
  };
  reviewRequired: boolean;
  allowDoneDragBypass: boolean;
  quickViewLimit: number;
  proposalPolicy: 'confirm' | 'auto';
  defaultModel?: string;
}

// ── Proposals ────────────────────────────────────────────────────────

export type ProposalStatus = 'pending' | 'approved' | 'rejected';

export interface KanbanProposal {
  id: string;
  type: 'create' | 'update';
  payload: Record<string, unknown>;
  sourceSessionKey?: string;
  proposedBy: TaskActor;
  proposedAt: number;
  status: ProposalStatus;
  version: number;
  resolvedAt?: number;
  resolvedBy?: TaskActor;
  reason?: string;
  resultTaskId?: string;
}

export class ProposalNotFoundError extends Error {
  constructor(id: string) {
    super(`Proposal not found: ${id}`);
    this.name = 'ProposalNotFoundError';
  }
}

export class ProposalAlreadyResolvedError extends Error {
  proposal: KanbanProposal;
  constructor(proposal: KanbanProposal) {
    super(`Proposal already resolved: ${proposal.id} (${proposal.status})`);
    this.name = 'ProposalAlreadyResolvedError';
    this.proposal = proposal;
  }
}

export interface StoreData {
  tasks: KanbanTask[];
  proposals: KanbanProposal[];
  config: KanbanBoardConfig;
  meta: {
    schemaVersion: number;
    updatedAt: number;
  };
}

// ── Pagination envelope ──────────────────────────────────────────────

export interface TaskListResult {
  items: KanbanTask[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// ── Filter options ───────────────────────────────────────────────────

export interface TaskFilters {
  status?: TaskStatus[];
  priority?: TaskPriority[];
  assignee?: string;
  label?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

// ── Version-conflict error ───────────────────────────────────────────

export class VersionConflictError extends Error {
  serverVersion: number;
  latest: KanbanTask;
  constructor(serverVersion: number, latest: KanbanTask) {
    super('version_conflict');
    this.name = 'VersionConflictError';
    this.serverVersion = serverVersion;
    this.latest = latest;
  }
}

export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`Task not found: ${id}`);
    this.name = 'TaskNotFoundError';
  }
}

export class InvalidTransitionError extends Error {
  from: TaskStatus;
  to: TaskStatus;
  constructor(from: TaskStatus, to: TaskStatus, message: string) {
    super(message);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

// ── Constants ────────────────────────────────────────────────────────

const CURRENT_SCHEMA_VERSION = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const STATUS_ORDER: Record<TaskStatus, number> = {
  backlog: 0,
  todo: 1,
  'in-progress': 2,
  review: 3,
  done: 4,
  cancelled: 5,
};

const DEFAULT_CONFIG: KanbanBoardConfig = {
  columns: [
    { key: 'backlog', title: 'Backlog', visible: true },
    { key: 'todo', title: 'To Do', visible: true },
    { key: 'in-progress', title: 'In Progress', visible: true },
    { key: 'review', title: 'Review', visible: true },
    { key: 'done', title: 'Done', visible: true },
    { key: 'cancelled', title: 'Cancelled', visible: false },
  ],
  defaults: {
    status: 'todo',
    priority: 'normal',
  },
  reviewRequired: true,
  allowDoneDragBypass: false,
  quickViewLimit: 5,
  proposalPolicy: 'confirm',
};

function emptyStore(): StoreData {
  return {
    tasks: [],
    proposals: [],
    config: structuredClone(DEFAULT_CONFIG),
    meta: { schemaVersion: CURRENT_SCHEMA_VERSION, updatedAt: Date.now() },
  };
}

// ── Audit log ────────────────────────────────────────────────────────

export type AuditAction = 'create' | 'update' | 'delete' | 'reorder' | 'config_update'
  | 'execute' | 'approve' | 'reject' | 'abort' | 'complete_run' | 'reconcile'
  | 'proposal_create' | 'proposal_approve' | 'proposal_reject';

interface AuditEntry {
  ts: number;
  action: AuditAction;
  taskId?: string;
  actor?: string;
  detail?: string;
}

// ── Store class ──────────────────────────────────────────────────────

export class KanbanStore {
  private readonly filePath: string;
  private readonly auditPath: string;
  private readonly withLock: ReturnType<typeof createMutex>;

  constructor(filePath?: string) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const dataDir = path.resolve(__dirname, '..', 'data', 'kanban');
    this.filePath = filePath || path.join(dataDir, 'tasks.json');
    this.auditPath = path.join(path.dirname(this.filePath), 'audit.log');
    this.withLock = createMutex();
  }

  // ── Low-level I/O ────────────────────────────────────────────────

  private async readRaw(): Promise<StoreData> {
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as StoreData;
      return this.migrate(data);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return emptyStore();
      }
      throw err;
    }
  }

  private async writeRaw(data: StoreData): Promise<void> {
    data.meta.updatedAt = Date.now();
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    // Atomic write: write to temp file then rename
    const tmp = this.filePath + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.promises.rename(tmp, this.filePath);
  }

  private migrate(data: StoreData): StoreData {
    // Future migrations go here, keyed on data.meta.schemaVersion
    if (!data.meta) {
      data.meta = { schemaVersion: CURRENT_SCHEMA_VERSION, updatedAt: Date.now() };
    }
    if (!data.config) {
      data.config = structuredClone(DEFAULT_CONFIG);
    }
    if (!Array.isArray(data.tasks)) {
      data.tasks = [];
    }
    if (!Array.isArray(data.proposals)) {
      data.proposals = [];
    }
    // Backfill proposalPolicy for existing configs
    if (!data.config.proposalPolicy) {
      data.config.proposalPolicy = 'confirm';
    }
    data.meta.schemaVersion = CURRENT_SCHEMA_VERSION;
    return data;
  }

  private async audit(entry: AuditEntry): Promise<void> {
    try {
      const dir = path.dirname(this.auditPath);
      await fs.promises.mkdir(dir, { recursive: true });
      const line = JSON.stringify(entry) + '\n';
      await fs.promises.appendFile(this.auditPath, line);
    } catch {
      // audit is best-effort, never block mutations
    }
  }

  // ── Public API ───────────────────────────────────────────────────

  /** Initialise the store file if it doesn't exist. */
  async init(): Promise<void> {
    await this.withLock(async () => {
      try {
        await fs.promises.access(this.filePath);
      } catch {
        await this.writeRaw(emptyStore());
      }
    });
  }

  // ── Tasks: List ──────────────────────────────────────────────────

  async listTasks(filters: TaskFilters = {}): Promise<TaskListResult> {
    return this.withLock(async () => {
      const data = await this.readRaw();
      let tasks = data.tasks;

      // Apply filters
      if (filters.status?.length) {
        const set = new Set(filters.status);
        tasks = tasks.filter((t) => set.has(t.status));
      }
      if (filters.priority?.length) {
        const set = new Set(filters.priority);
        tasks = tasks.filter((t) => set.has(t.priority));
      }
      if (filters.assignee) {
        tasks = tasks.filter((t) => t.assignee === filters.assignee);
      }
      if (filters.label) {
        tasks = tasks.filter((t) => t.labels.includes(filters.label!));
      }
      if (filters.q) {
        const q = filters.q.toLowerCase();
        tasks = tasks.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            (t.description?.toLowerCase().includes(q) ?? false) ||
            t.labels.some((l) => l.toLowerCase().includes(q)),
        );
      }

      // Sort: status order → columnOrder → updatedAt desc
      tasks.sort((a, b) => {
        const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        if (statusDiff !== 0) return statusDiff;
        const orderDiff = a.columnOrder - b.columnOrder;
        if (orderDiff !== 0) return orderDiff;
        return b.updatedAt - a.updatedAt;
      });

      const total = tasks.length;
      const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
      const offset = Math.max(filters.offset ?? 0, 0);
      const items = tasks.slice(offset, offset + limit);

      return { items, total, limit, offset, hasMore: offset + limit < total };
    });
  }

  // ── Tasks: Get ───────────────────────────────────────────────────

  async getTask(id: string): Promise<KanbanTask> {
    return this.withLock(async () => {
      const data = await this.readRaw();
      const task = data.tasks.find((t) => t.id === id);
      if (!task) throw new TaskNotFoundError(id);
      return task;
    });
  }

  // ── Tasks: Create ────────────────────────────────────────────────

  async createTask(input: {
    title: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    createdBy: TaskActor;
    sourceSessionKey?: string;
    assignee?: TaskActor;
    labels?: string[];
    model?: string;
    thinking?: 'off' | 'low' | 'medium' | 'high';
    dueAt?: number;
    estimateMin?: number;
  }): Promise<KanbanTask> {
    return this.withLock(async () => {
      const data = await this.readRaw();

      // Compute columnOrder — append to end of target column
      const targetStatus = input.status ?? data.config.defaults.status;
      const maxOrder = data.tasks
        .filter((t) => t.status === targetStatus)
        .reduce((max, t) => Math.max(max, t.columnOrder), -1);

      const now = Date.now();
      const task: KanbanTask = {
        id: crypto.randomUUID(),
        title: input.title,
        description: input.description,
        status: targetStatus,
        priority: input.priority ?? data.config.defaults.priority,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
        version: 1,
        sourceSessionKey: input.sourceSessionKey,
        assignee: input.assignee,
        labels: input.labels ?? [],
        columnOrder: maxOrder + 1,
        model: input.model,
        thinking: input.thinking,
        dueAt: input.dueAt,
        estimateMin: input.estimateMin,
        feedback: [],
      };

      data.tasks.push(task);
      await this.writeRaw(data);
      await this.audit({ ts: now, action: 'create', taskId: task.id, actor: input.createdBy });
      return task;
    });
  }

  // ── Tasks: Update (with CAS) ─────────────────────────────────────

  async updateTask(
    id: string,
    version: number,
    patch: Partial<
      Pick<
        KanbanTask,
        | 'title'
        | 'description'
        | 'status'
        | 'priority'
        | 'assignee'
        | 'labels'
        | 'model'
        | 'thinking'
        | 'dueAt'
        | 'estimateMin'
        | 'actualMin'
        | 'result'
        | 'resultAt'
        | 'run'
        | 'feedback'
      >
    >,
    actor?: string,
  ): Promise<KanbanTask> {
    return this.withLock(async () => {
      const data = await this.readRaw();
      const idx = data.tasks.findIndex((t) => t.id === id);
      if (idx === -1) throw new TaskNotFoundError(id);

      const task = data.tasks[idx];
      if (task.version !== version) {
        throw new VersionConflictError(task.version, task);
      }

      // Apply patch
      const now = Date.now();
      const updated: KanbanTask = { ...task, ...patch, updatedAt: now, version: task.version + 1 };

      // If status changed, re-compute columnOrder (append to end of new column)
      if (patch.status && patch.status !== task.status) {
        const maxOrder = data.tasks
          .filter((t) => t.status === patch.status && t.id !== id)
          .reduce((max, t) => Math.max(max, t.columnOrder), -1);
        updated.columnOrder = maxOrder + 1;
      }

      data.tasks[idx] = updated;
      await this.writeRaw(data);
      await this.audit({
        ts: now,
        action: 'update',
        taskId: id,
        actor,
        detail: Object.keys(patch).join(','),
      });
      return updated;
    });
  }

  // ── Tasks: Delete ────────────────────────────────────────────────

  async deleteTask(id: string, actor?: string): Promise<void> {
    return this.withLock(async () => {
      const data = await this.readRaw();
      const idx = data.tasks.findIndex((t) => t.id === id);
      if (idx === -1) throw new TaskNotFoundError(id);

      data.tasks.splice(idx, 1);
      await this.writeRaw(data);
      await this.audit({ ts: Date.now(), action: 'delete', taskId: id, actor });
    });
  }

  // ── Tasks: Reorder ───────────────────────────────────────────────

  async reorderTask(
    id: string,
    version: number,
    targetStatus: TaskStatus,
    targetIndex: number,
    actor?: string,
  ): Promise<KanbanTask> {
    return this.withLock(async () => {
      const data = await this.readRaw();
      const idx = data.tasks.findIndex((t) => t.id === id);
      if (idx === -1) throw new TaskNotFoundError(id);

      const task = data.tasks[idx];
      if (task.version !== version) {
        throw new VersionConflictError(task.version, task);
      }

      const now = Date.now();

      // Get all tasks in target column (excluding the task being moved)
      const columnTasks = data.tasks
        .filter((t) => t.status === targetStatus && t.id !== id)
        .sort((a, b) => a.columnOrder - b.columnOrder);

      // Clamp index
      const clampedIndex = Math.max(0, Math.min(targetIndex, columnTasks.length));

      // Insert at target position and reassign columnOrder sequentially
      columnTasks.splice(clampedIndex, 0, task);
      for (let i = 0; i < columnTasks.length; i++) {
        const t = data.tasks.find((dt) => dt.id === columnTasks[i].id)!;
        t.columnOrder = i;
        if (t.id !== id) {
          t.updatedAt = now;
        }
      }

      // Update the moved task
      task.status = targetStatus;
      task.columnOrder = clampedIndex;
      task.updatedAt = now;
      task.version += 1;

      await this.writeRaw(data);
      await this.audit({
        ts: now,
        action: 'reorder',
        taskId: id,
        actor,
        detail: `status=${targetStatus},index=${clampedIndex}`,
      });
      return task;
    });
  }

  // ── Config ───────────────────────────────────────────────────────

  async getConfig(): Promise<KanbanBoardConfig> {
    return this.withLock(async () => {
      const data = await this.readRaw();
      return data.config;
    });
  }

  async updateConfig(patch: Partial<KanbanBoardConfig>): Promise<KanbanBoardConfig> {
    return this.withLock(async () => {
      const data = await this.readRaw();
      data.config = { ...data.config, ...patch };
      if (patch.columns) data.config.columns = patch.columns;
      if (patch.defaults) data.config.defaults = { ...data.config.defaults, ...patch.defaults };
      await this.writeRaw(data);
      await this.audit({ ts: Date.now(), action: 'config_update' });
      return data.config;
    });
  }

  // ── Workflow: Execute ──────────────────────────────────────────────

  async executeTask(
    id: string,
    options?: { model?: string; thinking?: 'off' | 'low' | 'medium' | 'high' },
    actor?: string,
  ): Promise<KanbanTask> {
    return this.withLock(async () => {
      const data = await this.readRaw();
      const idx = data.tasks.findIndex((t) => t.id === id);
      if (idx === -1) throw new TaskNotFoundError(id);

      const task = data.tasks[idx];

      // Idempotency: if already in-progress with an active run, return as-is
      if (task.status === 'in-progress' && task.run?.status === 'running') {
        return task;
      }

      // Validate transition: must be in todo or backlog
      if (task.status !== 'todo' && task.status !== 'backlog') {
        throw new InvalidTransitionError(
          task.status,
          'in-progress',
          `Cannot execute task in "${task.status}" status; must be "todo" or "backlog"`,
        );
      }

      const now = Date.now();
      const sessionKey = `kanban-run-${id}-${now}`;

      task.status = 'in-progress';
      task.run = {
        sessionKey,
        startedAt: now,
        status: 'running',
      };
      if (options?.model) task.model = options.model;
      if (options?.thinking) task.thinking = options.thinking;

      // Re-compute columnOrder for in-progress column
      const maxOrder = data.tasks
        .filter((t) => t.status === 'in-progress' && t.id !== id)
        .reduce((max, t) => Math.max(max, t.columnOrder), -1);
      task.columnOrder = maxOrder + 1;

      task.updatedAt = now;
      task.version += 1;

      data.tasks[idx] = task;
      await this.writeRaw(data);
      await this.audit({ ts: now, action: 'execute', taskId: id, actor });
      return task;
    });
  }

  // ── Workflow: Approve ────────────────────────────────────────────

  async approveTask(id: string, note?: string, actor?: string): Promise<KanbanTask> {
    return this.withLock(async () => {
      const data = await this.readRaw();
      const idx = data.tasks.findIndex((t) => t.id === id);
      if (idx === -1) throw new TaskNotFoundError(id);

      const task = data.tasks[idx];

      if (task.status !== 'review') {
        throw new InvalidTransitionError(
          task.status,
          'done',
          `Cannot approve task in "${task.status}" status; must be "review"`,
        );
      }

      const now = Date.now();
      task.status = 'done';

      if (note) {
        task.feedback.push({
          at: now,
          by: (actor as TaskActor) ?? 'operator',
          note,
        });
      }

      // Re-compute columnOrder for done column
      const maxOrder = data.tasks
        .filter((t) => t.status === 'done' && t.id !== id)
        .reduce((max, t) => Math.max(max, t.columnOrder), -1);
      task.columnOrder = maxOrder + 1;

      task.updatedAt = now;
      task.version += 1;

      data.tasks[idx] = task;
      await this.writeRaw(data);
      await this.audit({ ts: now, action: 'approve', taskId: id, actor });
      return task;
    });
  }

  // ── Workflow: Reject ─────────────────────────────────────────────

  async rejectTask(id: string, note: string, actor?: string): Promise<KanbanTask> {
    return this.withLock(async () => {
      const data = await this.readRaw();
      const idx = data.tasks.findIndex((t) => t.id === id);
      if (idx === -1) throw new TaskNotFoundError(id);

      const task = data.tasks[idx];

      if (task.status !== 'review') {
        throw new InvalidTransitionError(
          task.status,
          'todo',
          `Cannot reject task in "${task.status}" status; must be "review"`,
        );
      }

      const now = Date.now();
      task.status = 'todo';

      task.feedback.push({
        at: now,
        by: (actor as TaskActor) ?? 'operator',
        note,
      });

      // Clear the run so it can be re-executed
      task.run = undefined;
      task.result = undefined;
      task.resultAt = undefined;

      // Re-compute columnOrder for todo column
      const maxOrder = data.tasks
        .filter((t) => t.status === 'todo' && t.id !== id)
        .reduce((max, t) => Math.max(max, t.columnOrder), -1);
      task.columnOrder = maxOrder + 1;

      task.updatedAt = now;
      task.version += 1;

      data.tasks[idx] = task;
      await this.writeRaw(data);
      await this.audit({ ts: now, action: 'reject', taskId: id, actor });
      return task;
    });
  }

  // ── Workflow: Abort ──────────────────────────────────────────────

  async abortTask(id: string, note?: string, actor?: string): Promise<KanbanTask> {
    return this.withLock(async () => {
      const data = await this.readRaw();
      const idx = data.tasks.findIndex((t) => t.id === id);
      if (idx === -1) throw new TaskNotFoundError(id);

      const task = data.tasks[idx];

      if (task.status !== 'in-progress' || !task.run || task.run.status !== 'running') {
        throw new InvalidTransitionError(
          task.status,
          'todo',
          `Cannot abort task: must be "in-progress" with an active run`,
        );
      }

      const now = Date.now();

      // Mark run as aborted
      task.run.status = 'aborted';
      task.run.endedAt = now;

      // Move back to todo
      task.status = 'todo';

      if (note) {
        task.feedback.push({
          at: now,
          by: (actor as TaskActor) ?? 'operator',
          note,
        });
      }

      // Re-compute columnOrder for todo column
      const maxOrder = data.tasks
        .filter((t) => t.status === 'todo' && t.id !== id)
        .reduce((max, t) => Math.max(max, t.columnOrder), -1);
      task.columnOrder = maxOrder + 1;

      task.updatedAt = now;
      task.version += 1;

      data.tasks[idx] = task;
      await this.writeRaw(data);
      await this.audit({ ts: now, action: 'abort', taskId: id, actor });
      return task;
    });
  }

  // ── Run completion handler ───────────────────────────────────────

  async completeRun(
    taskId: string,
    result?: string,
    error?: string,
  ): Promise<KanbanTask> {
    return this.withLock(async () => {
      const data = await this.readRaw();
      const idx = data.tasks.findIndex((t) => t.id === taskId);
      if (idx === -1) throw new TaskNotFoundError(taskId);

      const task = data.tasks[idx];

      if (!task.run || task.run.status !== 'running') {
        throw new InvalidTransitionError(
          task.status,
          error ? 'todo' : 'review',
          `No active run to complete on task "${taskId}"`,
        );
      }

      const now = Date.now();
      task.run.endedAt = now;

      if (error) {
        // Error path: mark run as error, move back to todo
        task.run.status = 'error';
        task.run.error = error;
        task.status = 'todo';

        const maxOrder = data.tasks
          .filter((t) => t.status === 'todo' && t.id !== taskId)
          .reduce((max, t) => Math.max(max, t.columnOrder), -1);
        task.columnOrder = maxOrder + 1;
      } else {
        // Success path: mark run as done, move to review
        task.run.status = 'done';
        task.status = 'review';
        if (result) {
          task.result = result;
          task.resultAt = now;
        }

        const maxOrder = data.tasks
          .filter((t) => t.status === 'review' && t.id !== taskId)
          .reduce((max, t) => Math.max(max, t.columnOrder), -1);
        task.columnOrder = maxOrder + 1;
      }

      task.updatedAt = now;
      task.version += 1;

      data.tasks[idx] = task;
      await this.writeRaw(data);
      await this.audit({
        ts: now,
        action: 'complete_run',
        taskId,
        detail: error ? `error: ${error}` : 'success',
      });
      return task;
    });
  }

  // ── Stale run reconciliation ─────────────────────────────────────

  async reconcileStaleRuns(maxAgeMs: number): Promise<KanbanTask[]> {
    return this.withLock(async () => {
      const data = await this.readRaw();
      const now = Date.now();
      const reconciled: KanbanTask[] = [];

      for (let i = 0; i < data.tasks.length; i++) {
        const task = data.tasks[i];
        if (
          task.status === 'in-progress' &&
          task.run?.status === 'running' &&
          now - task.run.startedAt > maxAgeMs
        ) {
          task.run.status = 'error';
          task.run.endedAt = now;
          task.run.error = 'stale run reconciled';

          task.status = 'todo';

          const maxOrder = data.tasks
            .filter((t) => t.status === 'todo' && t.id !== task.id)
            .reduce((max, t) => Math.max(max, t.columnOrder), -1);
          task.columnOrder = maxOrder + 1;

          task.updatedAt = now;
          task.version += 1;

          data.tasks[i] = task;
          reconciled.push(task);
        }
      }

      if (reconciled.length > 0) {
        await this.writeRaw(data);
        await this.audit({
          ts: now,
          action: 'reconcile',
          detail: `reconciled ${reconciled.length} stale run(s)`,
        });
      }

      return reconciled;
    });
  }

  // ── Proposals ─────────────────────────────────────────────────────

  async createProposal(input: {
    type: 'create' | 'update';
    payload: Record<string, unknown>;
    sourceSessionKey?: string;
    proposedBy: TaskActor;
  }): Promise<KanbanProposal> {
    return this.withLock(async () => {
      const data = await this.readRaw();
      const now = Date.now();

      const proposal: KanbanProposal = {
        id: crypto.randomUUID(),
        type: input.type,
        payload: input.payload,
        sourceSessionKey: input.sourceSessionKey,
        proposedBy: input.proposedBy,
        proposedAt: now,
        status: 'pending',
        version: 1,
      };

      // In auto mode, immediately execute the proposal
      if (data.config.proposalPolicy === 'auto') {
        if (input.type === 'create') {
          const task = await this._createTaskUnlocked(data, input.payload, input.proposedBy);
          proposal.status = 'approved';
          proposal.resolvedAt = now;
          proposal.resolvedBy = input.proposedBy;
          proposal.resultTaskId = task.id;
        } else {
          await this._applyUpdateUnlocked(data, input.payload);
          proposal.status = 'approved';
          proposal.resolvedAt = now;
          proposal.resolvedBy = input.proposedBy;
          proposal.resultTaskId = input.payload.id as string;
        }
      }

      data.proposals.push(proposal);
      await this.writeRaw(data);
      await this.audit({ ts: now, action: 'proposal_create', detail: `type=${input.type}` });
      return proposal;
    });
  }

  async approveProposal(
    id: string,
    actor: TaskActor = 'operator',
  ): Promise<{ proposal: KanbanProposal; task: KanbanTask }> {
    return this.withLock(async () => {
      const data = await this.readRaw();
      const proposal = data.proposals.find((p) => p.id === id);
      if (!proposal) throw new ProposalNotFoundError(id);
      if (proposal.status !== 'pending') throw new ProposalAlreadyResolvedError(proposal);

      const now = Date.now();
      let task: KanbanTask;

      if (proposal.type === 'create') {
        task = await this._createTaskUnlocked(data, proposal.payload, proposal.proposedBy);
        proposal.resultTaskId = task.id;
      } else {
        task = await this._applyUpdateUnlocked(data, proposal.payload);
        proposal.resultTaskId = proposal.payload.id as string;
      }

      proposal.status = 'approved';
      proposal.resolvedAt = now;
      proposal.resolvedBy = actor;
      proposal.version += 1;

      await this.writeRaw(data);
      await this.audit({ ts: now, action: 'proposal_approve', detail: `proposal=${id}`, actor });
      return { proposal, task };
    });
  }

  async rejectProposal(
    id: string,
    reason?: string,
    actor: TaskActor = 'operator',
  ): Promise<KanbanProposal> {
    return this.withLock(async () => {
      const data = await this.readRaw();
      const proposal = data.proposals.find((p) => p.id === id);
      if (!proposal) throw new ProposalNotFoundError(id);
      if (proposal.status !== 'pending') throw new ProposalAlreadyResolvedError(proposal);

      const now = Date.now();
      proposal.status = 'rejected';
      proposal.resolvedAt = now;
      proposal.resolvedBy = actor;
      proposal.reason = reason;
      proposal.version += 1;

      await this.writeRaw(data);
      await this.audit({ ts: now, action: 'proposal_reject', detail: `proposal=${id}`, actor });
      return proposal;
    });
  }

  async listProposals(statusFilter?: ProposalStatus): Promise<KanbanProposal[]> {
    return this.withLock(async () => {
      const data = await this.readRaw();
      let proposals = data.proposals;
      if (statusFilter) {
        proposals = proposals.filter((p) => p.status === statusFilter);
      }
      // Most recent first
      return proposals.sort((a, b) => b.proposedAt - a.proposedAt);
    });
  }

  // ── Internal helpers for proposals (call ONLY while lock is held) ──

  private async _createTaskUnlocked(
    data: StoreData,
    payload: Record<string, unknown>,
    proposedBy: TaskActor,
  ): Promise<KanbanTask> {
    const targetStatus = (payload.status as TaskStatus) ?? data.config.defaults.status;
    const maxOrder = data.tasks
      .filter((t) => t.status === targetStatus)
      .reduce((max, t) => Math.max(max, t.columnOrder), -1);

    const now = Date.now();
    const task: KanbanTask = {
      id: crypto.randomUUID(),
      title: payload.title as string,
      description: payload.description as string | undefined,
      status: targetStatus,
      priority: (payload.priority as TaskPriority) ?? data.config.defaults.priority,
      createdBy: proposedBy,
      createdAt: now,
      updatedAt: now,
      version: 1,
      sourceSessionKey: payload.sourceSessionKey as string | undefined,
      assignee: payload.assignee as TaskActor | undefined,
      labels: (payload.labels as string[]) ?? [],
      columnOrder: maxOrder + 1,
      model: payload.model as string | undefined,
      thinking: payload.thinking as KanbanTask['thinking'],
      dueAt: payload.dueAt as number | undefined,
      estimateMin: payload.estimateMin as number | undefined,
      feedback: [],
    };

    data.tasks.push(task);
    return task;
  }

  private async _applyUpdateUnlocked(
    data: StoreData,
    payload: Record<string, unknown>,
  ): Promise<KanbanTask> {
    const taskId = payload.id as string;
    const idx = data.tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) throw new TaskNotFoundError(taskId);

    const task = data.tasks[idx];
    const now = Date.now();

    // No CAS version check here — proposals intentionally override current state.
    // The proposal workflow (confirm/auto) serves as the gating mechanism instead.

    // Build patch from payload — allowlist safe fields only
    const ALLOWED_UPDATE_FIELDS = ['title', 'description', 'status', 'priority', 'assignee', 'labels', 'result'] as const;
    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED_UPDATE_FIELDS) {
      if (key in payload) patch[key] = payload[key];
    }

    // If status changed, re-compute columnOrder
    if (patch.status && patch.status !== task.status) {
      const maxOrder = data.tasks
        .filter((t) => t.status === (patch.status as TaskStatus) && t.id !== taskId)
        .reduce((max, t) => Math.max(max, t.columnOrder), -1);
      patch.columnOrder = maxOrder + 1;
    }

    const updated: KanbanTask = { ...task, ...patch, updatedAt: now, version: task.version + 1 } as KanbanTask;
    data.tasks[idx] = updated;
    return updated;
  }

  /** Reset store to empty (for testing). */
  async reset(): Promise<void> {
    await this.withLock(async () => {
      await this.writeRaw(emptyStore());
    });
  }
}

// ── Singleton ────────────────────────────────────────────────────────

let _instance: KanbanStore | undefined;

export function getKanbanStore(): KanbanStore {
  if (!_instance) {
    _instance = new KanbanStore();
  }
  return _instance;
}

/** Override the singleton (for testing). */
export function setKanbanStore(store: KanbanStore): void {
  _instance = store;
}
