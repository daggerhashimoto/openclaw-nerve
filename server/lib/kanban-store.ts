/**
 * Kanban task store — JSON file persistence with mutex-protected I/O.
 *
 * Runtime data lives under `${NERVE_DATA_DIR:-~/.nerve}/kanban/tasks.json`.
 * Legacy installs may still have data under `server-dist/data/kanban/` or
 * `server/data/kanban/`, so the store performs a one-time migration into the
 * canonical runtime directory on first init. Every mutating operation acquires
 * the store mutex, reads the file, applies the change, and writes back
 * atomically. CAS version checks prevent stale overwrites.
 * @module
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalizeKanbanAssignee } from './kanban-assignee.js';
import { createMutex } from './mutex.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Derive a URL-safe slug from a task title, capped at `max` chars. */
function slugify(title: string, max = 30): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')   // non-alphanumeric → dash
    .replace(/^-+|-+$/g, '')        // trim leading/trailing dashes
    .slice(0, max)
    .replace(/-+$/, '');            // trim trailing dash after slice
}

/** Build a unique task ID from the title, appending -2, -3… on collision. */
function uniqueSlugId(title: string, existingIds: Set<string>): string {
  const base = slugify(title) || 'task';
  if (!existingIds.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!existingIds.has(candidate)) return candidate;
  }
}

const runKeySequenceByBase = new Map<string, number>();

/** Build a human-readable run key that stays unique across same-millisecond reruns. */
function uniqueRunSessionKey(id: string, now: number): string {
  const base = `kb-${id}-${now}`;
  const nextSequence = (runKeySequenceByBase.get(base) ?? 0) + 1;
  runKeySequenceByBase.set(base, nextSequence);
  return nextSequence === 1 ? base : `${base}-${nextSequence.toString(36)}`;
}

function matchesRunIdentifier(run: TaskRunLink, value: string): boolean {
  return value === run.sessionKey
    || value === run.childSessionKey
    || value === run.sessionId
    || value === run.runId;
}

function canonicalizeProposalPayloadAssignee(payload: Record<string, unknown>): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(payload, 'assignee')) return payload;
  return {
    ...payload,
    assignee: payload.assignee == null
      ? undefined
      : canonicalizeKanbanAssignee(String(payload.assignee)),
  };
}

// ── Types ────────────────────────────────────────────────────────────

/** Built-in status keys that ship with the default board config. */
export const BUILT_IN_STATUSES = ['backlog', 'todo', 'in-progress', 'review', 'done', 'cancelled'] as const;
export type BuiltInStatus = typeof BUILT_IN_STATUSES[number];

/**
 * TaskStatus is a string so users can define custom column keys.
 * Built-in values are still the recommended defaults.
 */
export type TaskStatus = string;
export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';
export type TaskActor = 'operator' | `agent:${string}`;

export interface TaskFeedback {
  at: number;
  by: TaskActor;
  note: string;
}

export interface TaskRunLink {
  sessionKey: string;
  childSessionKey?: string;
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
    key: string;
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
  defaultThinking?: string;
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

export class InvalidTaskStatusError extends Error {
  status: string;
  allowed: string[];
  constructor(status: string, allowed: Iterable<string>) {
    const allowedList = [...allowed];
    super(`Invalid task status: ${status}`);
    this.name = 'InvalidTaskStatusError';
    this.status = status;
    this.allowed = allowedList;
  }
}

export class InvalidBoardConfigError extends Error {
  details: string;
  statuses: string[];
  constructor(details: string, statuses: Iterable<string> = []) {
    const statusList = [...statuses];
    super(details);
    this.name = 'InvalidBoardConfigError';
    this.details = details;
    this.statuses = statusList;
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

const STATUS_ORDER: Record<string, number> = {
  backlog: 0,
  todo: 1,
  'in-progress': 2,
  review: 3,
  done: 4,
  cancelled: 5,
};

const REQUIRED_BOARD_COLUMNS: TaskStatus[] = ['backlog', 'todo', 'in-progress', 'review', 'done'];
const VALID_TASK_STATUSES = new Set<string>(BUILT_IN_STATUSES);
const VALID_TASK_PRIORITIES = new Set<TaskPriority>(['critical', 'high', 'normal', 'low']);

function getConfiguredStatuses(config: KanbanBoardConfig): TaskStatus[] {
  return config.columns.map((column) => column.key);
}

function getStatusOrderMap(config: KanbanBoardConfig): Map<string, number> {
  return new Map(config.columns.map((column, index) => [column.key, index] as const));
}

function getAllowedTaskStatuses(config: KanbanBoardConfig): Set<string> {
  return new Set([...BUILT_IN_STATUSES, ...getConfiguredStatuses(config)]);
}

function isAllowedTaskStatus(value: string, config: KanbanBoardConfig): boolean {
  return getAllowedTaskStatuses(config).has(value);
}

function normalizeTaskStatus(value: unknown, configColumns?: TaskStatus[]): TaskStatus {
  if (typeof value !== 'string') return DEFAULT_CONFIG.defaults.status;
  // Accept built-in statuses or any key defined in the current board config
  if (VALID_TASK_STATUSES.has(value)) return value;
  if (configColumns && configColumns.includes(value)) return value;
  return DEFAULT_CONFIG.defaults.status;
}

function normalizeTaskPriority(value: unknown): TaskPriority {
  if (value === 'medium') return 'normal';
  return typeof value === 'string' && VALID_TASK_PRIORITIES.has(value as TaskPriority)
    ? (value as TaskPriority)
    : DEFAULT_CONFIG.defaults.priority;
}

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
  private readonly legacyCandidatePaths: string[];

  constructor(filePath?: string) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const projectRoot = process.env.NERVE_PROJECT_ROOT || path.resolve(__dirname, '..', '..');
    const dataRoot = process.env.NERVE_DATA_DIR || path.join(os.homedir() || process.cwd(), '.nerve');
    const dataDir = path.join(dataRoot, 'kanban');
    this.filePath = filePath || path.join(dataDir, 'tasks.json');
    this.auditPath = path.join(path.dirname(this.filePath), 'audit.log');
    this.legacyCandidatePaths = filePath
      ? []
      : [
          path.join(projectRoot, 'server-dist', 'data', 'kanban', 'tasks.json'),
          path.join(projectRoot, 'server', 'data', 'kanban', 'tasks.json'),
        ];
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
    // Backfill missing config fields from defaults
    if (!data.config.columns || data.config.columns.length === 0) {
      data.config.columns = structuredClone(DEFAULT_CONFIG.columns);
    }
    if (!data.config.defaults || !data.config.defaults.status) {
      data.config.defaults = structuredClone(DEFAULT_CONFIG.defaults);
    }
    const configuredStatuses = getConfiguredStatuses(data.config);
    data.config.defaults.status = normalizeTaskStatus(data.config.defaults.status, configuredStatuses);
    data.config.defaults.priority = normalizeTaskPriority(data.config.defaults.priority);
    if (!data.config.proposalPolicy) {
      data.config.proposalPolicy = 'confirm';
    }
    if (data.config.reviewRequired === undefined) {
      data.config.reviewRequired = DEFAULT_CONFIG.reviewRequired;
    }
    if (data.config.allowDoneDragBypass === undefined) {
      data.config.allowDoneDragBypass = DEFAULT_CONFIG.allowDoneDragBypass;
    }
    if (data.config.quickViewLimit === undefined) {
      data.config.quickViewLimit = DEFAULT_CONFIG.quickViewLimit;
    }
    data.tasks = data.tasks.map((task) => {
      const childSessionKey = task.run?.childSessionKey ?? task.run?.sessionId;
      return {
        ...task,
        status: normalizeTaskStatus(task.status, configuredStatuses),
        priority: normalizeTaskPriority(task.priority),
        run: task.run
          ? {
              ...task.run,
              childSessionKey,
              sessionId: task.run.sessionId ?? childSessionKey,
            }
          : task.run,
      };
    });
    data.meta.schemaVersion = CURRENT_SCHEMA_VERSION;
    return data;
  }

  private async loadLegacyCandidate(filePath: string): Promise<{
    filePath: string;
    auditPath: string;
    data: StoreData;
    contentScore: number;
    mtimeMs: number;
  } | null> {
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as StoreData;
      const data = this.migrate(parsed);
      const stats = await fs.promises.stat(filePath);
      return {
        filePath,
        auditPath: path.join(path.dirname(filePath), 'audit.log'),
        data,
        contentScore: data.tasks.length + data.proposals.length,
        mtimeMs: stats.mtimeMs,
      };
    } catch {
      return null;
    }
  }

  private async migrateLegacyStoreIfNeeded(): Promise<boolean> {
    if (this.legacyCandidatePaths.length === 0) return false;

    const candidates = (await Promise.all(this.legacyCandidatePaths.map((filePath) => this.loadLegacyCandidate(filePath))))
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
      .sort((a, b) => b.contentScore - a.contentScore || b.mtimeMs - a.mtimeMs);

    if (candidates.length === 0) return false;

    const selected = candidates[0];
    await this.writeRaw(selected.data);

    try {
      await fs.promises.copyFile(selected.auditPath, this.auditPath);
    } catch {
      // audit log migration is best-effort
    }

    console.log(`[kanban-store] migrated legacy store from ${selected.filePath} to ${this.filePath}`);
    return true;
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
        return;
      } catch {
        // canonical store missing, continue
      }

      const migrated = await this.migrateLegacyStoreIfNeeded();
      if (!migrated) {
        await this.writeRaw(emptyStore());
      }
    });
  }

  private async withStore<T>(fn: () => Promise<T>): Promise<T> {
    await this.init();
    return this.withLock(fn);
  }

  // ── Tasks: List ──────────────────────────────────────────────────

  async listTasks(filters: TaskFilters = {}): Promise<TaskListResult> {
    return this.withStore(async () => {
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

      const statusOrder = getStatusOrderMap(data.config);

      // Sort: status order → columnOrder → updatedAt desc
      tasks.sort((a, b) => {
        const statusDiff = (statusOrder.get(a.status) ?? STATUS_ORDER[a.status] ?? Number.MAX_SAFE_INTEGER)
          - (statusOrder.get(b.status) ?? STATUS_ORDER[b.status] ?? Number.MAX_SAFE_INTEGER);
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
    return this.withStore(async () => {
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
    return this.withStore(async () => {
      const data = await this.readRaw();

      if (input.status && !isAllowedTaskStatus(input.status, data.config)) {
        throw new InvalidTaskStatusError(input.status, getAllowedTaskStatuses(data.config));
      }

      // Compute columnOrder — append to end of target column
      const targetStatus = input.status ?? data.config.defaults.status;
      const maxOrder = data.tasks
        .filter((t) => t.status === targetStatus)
        .reduce((max, t) => Math.max(max, t.columnOrder), -1);

      const now = Date.now();
      const existingIds = new Set(data.tasks.map((t) => t.id));
      const assignee = input.assignee == null
        ? undefined
        : canonicalizeKanbanAssignee(input.assignee);
      const task: KanbanTask = {
        id: uniqueSlugId(input.title, existingIds),
        title: input.title,
        description: input.description,
        status: targetStatus,
        priority: input.priority ?? data.config.defaults.priority,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
        version: 1,
        sourceSessionKey: input.sourceSessionKey,
        assignee,
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
    return this.withStore(async () => {
      const data = await this.readRaw();
      const idx = data.tasks.findIndex((t) => t.id === id);
      if (idx === -1) throw new TaskNotFoundError(id);

      const task = data.tasks[idx];
      if (task.version !== version) {
        throw new VersionConflictError(task.version, task);
      }

      if (patch.status && !isAllowedTaskStatus(patch.status, data.config)) {
        throw new InvalidTaskStatusError(patch.status, getAllowedTaskStatuses(data.config));
      }

      // Apply patch
      const normalizedPatch = { ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, 'assignee')) {
        normalizedPatch.assignee = patch.assignee == null
          ? undefined
          : canonicalizeKanbanAssignee(patch.assignee);
      }

      const now = Date.now();
      const updated: KanbanTask = {
        ...task,
        ...normalizedPatch,
        updatedAt: now,
        version: task.version + 1,
      };

      // If status changed, re-compute columnOrder (append to end of new column)
      if (normalizedPatch.status && normalizedPatch.status !== task.status) {
        const maxOrder = data.tasks
          .filter((t) => t.status === normalizedPatch.status && t.id !== id)
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
        detail: Object.keys(normalizedPatch).join(','),
      });
      return updated;
    });
  }

  // ── Tasks: Delete ────────────────────────────────────────────────

  async deleteTask(id: string, actor?: string): Promise<void> {
    return this.withStore(async () => {
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
    return this.withStore(async () => {
      const data = await this.readRaw();
      const idx = data.tasks.findIndex((t) => t.id === id);
      if (idx === -1) throw new TaskNotFoundError(id);

      const task = data.tasks[idx];
      if (task.version !== version) {
        throw new VersionConflictError(task.version, task);
      }

      if (!isAllowedTaskStatus(targetStatus, data.config)) {
        throw new InvalidTaskStatusError(targetStatus, getAllowedTaskStatuses(data.config));
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
    return this.withStore(async () => {
      const data = await this.readRaw();
      return data.config;
    });
  }

  async updateConfig(patch: Partial<KanbanBoardConfig>): Promise<KanbanBoardConfig> {
    return this.withStore(async () => {
      const data = await this.readRaw();
      const nextConfig: KanbanBoardConfig = {
        ...data.config,
        ...patch,
        columns: patch.columns ?? data.config.columns,
        defaults: { ...data.config.defaults, ...patch.defaults },
      };

      const configuredStatuses = new Set(getConfiguredStatuses(nextConfig));
      const missingBuiltIns = REQUIRED_BOARD_COLUMNS.filter((status) => !configuredStatuses.has(status));
      if (missingBuiltIns.length > 0) {
        throw new InvalidBoardConfigError(
          `Missing required board columns: ${missingBuiltIns.join(', ')}`,
          missingBuiltIns,
        );
      }

      if (!isAllowedTaskStatus(nextConfig.defaults.status, nextConfig)) {
        throw new InvalidTaskStatusError(nextConfig.defaults.status, getAllowedTaskStatuses(nextConfig));
      }

      const referencedStatuses = new Set<string>([
        ...data.tasks.map((task) => task.status),
        ...data.proposals.flatMap((proposal) => (
          typeof proposal.payload?.status === 'string' ? [proposal.payload.status] : []
        )),
      ]);
      const removedReferencedStatuses = [...referencedStatuses].filter((status) => !configuredStatuses.has(status));
      if (removedReferencedStatuses.length > 0) {
        throw new InvalidBoardConfigError(
          `Cannot remove columns still in use: ${removedReferencedStatuses.join(', ')}`,
          removedReferencedStatuses,
        );
      }

      data.config = nextConfig;
      await this.writeRaw(data);
      await this.audit({ ts: Date.now(), action: 'config_update' });
      return data.config;
    });
  }

  // ── Workflow: Execute ──────────────────────────────────────────────

  async executeTask(
    id: string,
    options?: { model?: string; thinking?: 'off' | 'low' | 'medium' | 'high'; sessionKey?: string },
    actor?: string,
  ): Promise<KanbanTask> {
    return this.withStore(async () => {
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
      const sessionKey = options?.sessionKey ?? uniqueRunSessionKey(id, now);

      task.status = 'in-progress';
      task.run = {
        sessionKey,
        startedAt: now,
        status: 'running',
      };
      task.result = undefined;
      task.resultAt = undefined;
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

  async attachRunIdentifiers(
    taskId: string,
    sessionKey: string,
    identifiers: { childSessionKey?: string; runId?: string },
  ): Promise<KanbanTask | null> {
    return this.withStore(async () => {
      const data = await this.readRaw();
      const idx = data.tasks.findIndex((t) => t.id === taskId);
      if (idx === -1) throw new TaskNotFoundError(taskId);

      const task = data.tasks[idx];
      if (!task.run || task.run.status !== 'running' || task.run.sessionKey !== sessionKey) {
        return null;
      }

      const nextChildSessionKey = identifiers.childSessionKey ?? task.run.childSessionKey ?? task.run.sessionId;
      const nextRunId = identifiers.runId ?? task.run.runId;
      const nextSessionId = task.run.sessionId ?? nextChildSessionKey;

      if (
        nextChildSessionKey === task.run.childSessionKey
        && nextRunId === task.run.runId
        && nextSessionId === task.run.sessionId
      ) {
        return task;
      }

      task.run = {
        ...task.run,
        childSessionKey: nextChildSessionKey,
        sessionId: nextSessionId,
        runId: nextRunId,
      };
      data.tasks[idx] = task;
      await this.writeRaw(data);
      return task;
    });
  }

  // ── Workflow: Approve ────────────────────────────────────────────

  async approveTask(id: string, note?: string, actor?: string): Promise<KanbanTask> {
    return this.withStore(async () => {
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
    return this.withStore(async () => {
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
    return this.withStore(async () => {
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
    sessionKey: string,
    result?: string,
    error?: string,
  ): Promise<KanbanTask> {
    return this.withStore(async () => {
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

      if (!matchesRunIdentifier(task.run, sessionKey)) {
        throw new InvalidTransitionError(
          task.status,
          error ? 'todo' : 'review',
          `Run key mismatch for task "${taskId}": active run is "${task.run.sessionKey}", got "${sessionKey}"`,
        );
      }

      const now = Date.now();
      task.run.endedAt = now;

      if (error) {
        // Error path: mark run as error, move back to todo
        task.run.status = 'error';
        task.run.error = error;
        task.status = 'todo';
        task.result = undefined;
        task.resultAt = undefined;

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
        detail: error ? `session=${sessionKey},error: ${error}` : `session=${sessionKey},success`,
      });
      return task;
    });
  }

  // ── Stale run reconciliation ─────────────────────────────────────

  async reconcileStaleRuns(maxAgeMs: number): Promise<KanbanTask[]> {
    return this.withStore(async () => {
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
    return this.withStore(async () => {
      const data = await this.readRaw();
      const now = Date.now();

      const payload = canonicalizeProposalPayloadAssignee(input.payload);

      if ('status' in payload && typeof payload.status === 'string' && !isAllowedTaskStatus(payload.status, data.config)) {
        throw new InvalidTaskStatusError(payload.status, getAllowedTaskStatuses(data.config));
      }

      const proposal: KanbanProposal = {
        id: crypto.randomUUID(),
        type: input.type,
        payload,
        sourceSessionKey: input.sourceSessionKey,
        proposedBy: input.proposedBy,
        proposedAt: now,
        status: 'pending',
        version: 1,
      };

      // In auto mode, immediately execute the proposal
      if (data.config.proposalPolicy === 'auto') {
        if (input.type === 'create') {
          const task = await this._createTaskUnlocked(data, payload, input.proposedBy);
          proposal.status = 'approved';
          proposal.resolvedAt = now;
          proposal.resolvedBy = input.proposedBy;
          proposal.resultTaskId = task.id;
        } else {
          await this._applyUpdateUnlocked(data, payload);
          proposal.status = 'approved';
          proposal.resolvedAt = now;
          proposal.resolvedBy = input.proposedBy;
          proposal.resultTaskId = payload.id as string;
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
    return this.withStore(async () => {
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
    return this.withStore(async () => {
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
    return this.withStore(async () => {
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
    if (!isAllowedTaskStatus(targetStatus, data.config)) {
      throw new InvalidTaskStatusError(targetStatus, getAllowedTaskStatuses(data.config));
    }
    const maxOrder = data.tasks
      .filter((t) => t.status === targetStatus)
      .reduce((max, t) => Math.max(max, t.columnOrder), -1);

    const now = Date.now();
    const existingIds = new Set(data.tasks.map((t) => t.id));
    const title = typeof payload.title === 'string' && payload.title ? payload.title : 'untitled';
    const assignee = payload.assignee == null
      ? undefined
      : canonicalizeKanbanAssignee(String(payload.assignee));
    const task: KanbanTask = {
      id: uniqueSlugId(title, existingIds),
      title,
      description: payload.description as string | undefined,
      status: targetStatus,
      priority: (payload.priority as TaskPriority) ?? data.config.defaults.priority,
      createdBy: proposedBy,
      createdAt: now,
      updatedAt: now,
      version: 1,
      sourceSessionKey: payload.sourceSessionKey as string | undefined,
      assignee,
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
    if (Object.prototype.hasOwnProperty.call(patch, 'assignee')) {
      patch.assignee = patch.assignee == null
        ? undefined
        : canonicalizeKanbanAssignee(String(patch.assignee));
    }

    // If status changed, re-compute columnOrder
    if (patch.status && patch.status !== task.status) {
      if (typeof patch.status !== 'string' || !isAllowedTaskStatus(patch.status, data.config)) {
        throw new InvalidTaskStatusError(String(patch.status), getAllowedTaskStatuses(data.config));
      }
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
