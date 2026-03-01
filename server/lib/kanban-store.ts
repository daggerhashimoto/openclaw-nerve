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
}

export interface StoreData {
  tasks: KanbanTask[];
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
};

function emptyStore(): StoreData {
  return {
    tasks: [],
    config: structuredClone(DEFAULT_CONFIG),
    meta: { schemaVersion: CURRENT_SCHEMA_VERSION, updatedAt: Date.now() },
  };
}

// ── Audit log ────────────────────────────────────────────────────────

export type AuditAction = 'create' | 'update' | 'delete' | 'reorder' | 'config_update';

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
