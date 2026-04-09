import { execFile as execFileCallback } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { findRepoPlanByBeadId } from './plans.js';
import { resolveAgentWorkspace } from './agent-workspace.js';

const execFile = promisify(execFileCallback);
const BD_TIMEOUT_MS = 15_000;
const BD_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

export class BeadNotFoundError extends Error {
  constructor(beadId: string) {
    super(`Bead not found: ${beadId}`);
    this.name = 'BeadNotFoundError';
  }
}

export class BeadAdapterError extends Error {
  stderr: string;

  constructor(message: string, stderr = '') {
    super(message);
    this.name = 'BeadAdapterError';
    this.stderr = stderr;
  }
}

export interface BeadRelationSummary {
  id: string;
  title: string | null;
  status: string | null;
  dependencyType: string | null;
}

export interface BeadLinkedPlanSummary {
  path: string;
  title: string;
  planId: string | null;
  archived: boolean;
  status: string | null;
  updatedAt: number;
}

export interface BeadDetail {
  id: string;
  title: string;
  notes: string | null;
  status: string | null;
  priority: number | null;
  issueType: string | null;
  owner: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  dependencies: BeadRelationSummary[];
  dependents: BeadRelationSummary[];
  linkedPlan: BeadLinkedPlanSummary | null;
}

export interface BeadLookupOptions {
  targetPath?: string;
  currentDocumentPath?: string;
  workspaceAgentId?: string;
}

interface RawBeadRelation {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  dependency_type?: unknown;
}

interface RawBeadRecord {
  id?: unknown;
  title?: unknown;
  notes?: unknown;
  status?: unknown;
  priority?: unknown;
  issue_type?: unknown;
  owner?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  closed_at?: unknown;
  close_reason?: unknown;
  dependencies?: RawBeadRelation[];
  dependents?: RawBeadRelation[];
}

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getPreferredLocalBinDirs(): string[] {
  const home = process.env.HOME || os.homedir();
  return [
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.bun', 'bin'),
  ];
}

function buildRuntimePath(basePath?: string): string {
  const segments = [...getPreferredLocalBinDirs(), ...(basePath || '').split(':').filter(Boolean)];
  return [...new Set(segments)].join(':');
}

function resolveBdBin(): string {
  if (process.env.BD_BIN?.trim()) return process.env.BD_BIN.trim();

  for (const dir of getPreferredLocalBinDirs()) {
    const candidate = path.join(dir, 'bd');
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // continue
    }
  }

  return 'bd';
}

function parseJsonPayload(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to warning-tolerant parsing.
  }

  for (let index = 0; index < trimmed.length; index += 1) {
    const ch = trimmed[index];
    if (ch !== '{' && ch !== '[') continue;
    try {
      return JSON.parse(trimmed.slice(index));
    } catch {
      // continue
    }
  }

  throw new BeadAdapterError('Failed to parse bd JSON output');
}

function normalizeRelations(value: unknown): BeadRelationSummary[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const relation = entry as RawBeadRelation;
    const id = normalizeString(relation.id);
    if (!id) return [];
    return [{
      id,
      title: normalizeString(relation.title),
      status: normalizeString(relation.status),
      dependencyType: normalizeString(relation.dependency_type),
    } satisfies BeadRelationSummary];
  });
}

function normalizeBeadRepoRoot(repoRoot: string): string {
  const trimmed = repoRoot.trim();
  if (!trimmed) return trimmed;
  return path.basename(trimmed) === '.beads' ? path.dirname(trimmed) : trimmed;
}

export function resolveBeadLookupRepoRoot(options: BeadLookupOptions = {}): string {
  if (!options.targetPath?.trim()) {
    return process.cwd();
  }

  const targetPath = options.targetPath.trim();
  if (path.isAbsolute(targetPath)) {
    return normalizeBeadRepoRoot(path.normalize(targetPath));
  }

  const currentDocumentPath = options.currentDocumentPath?.trim();
  if (!currentDocumentPath) {
    throw new BeadAdapterError('Relative explicit bead URIs require a current document path');
  }

  const workspaceRoot = resolveAgentWorkspace(options.workspaceAgentId).workspaceRoot;
  const absoluteDocumentPath = path.isAbsolute(currentDocumentPath)
    ? currentDocumentPath
    : path.resolve(workspaceRoot, currentDocumentPath);

  return normalizeBeadRepoRoot(path.resolve(path.dirname(absoluteDocumentPath), targetPath));
}

export async function getBeadDetail(beadId: string, options: BeadLookupOptions = {}): Promise<BeadDetail> {
  const normalizedBeadId = beadId.trim();
  if (!normalizedBeadId) {
    throw new BeadNotFoundError(beadId);
  }

  const repoRoot = resolveBeadLookupRepoRoot(options);

  let stdout = '';
  let stderr = '';

  try {
    const result = await execFile(resolveBdBin(), ['show', normalizedBeadId, '--json'], {
      cwd: repoRoot,
      timeout: BD_TIMEOUT_MS,
      maxBuffer: BD_MAX_BUFFER_BYTES,
      env: {
        ...process.env,
        PATH: buildRuntimePath(process.env.PATH),
      },
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string; code?: string; killed?: boolean; signal?: string };
    const stderrLine = (err.stderr || '').trim().split('\n').find(Boolean) || '';

    if (err.code === 'ENOENT') {
      throw new BeadAdapterError('bd CLI not found in PATH', stderrLine);
    }

    if (err.killed && err.signal === 'SIGTERM') {
      throw new BeadAdapterError(`bd show timed out after ${BD_TIMEOUT_MS}ms`, stderrLine);
    }

    if (stderrLine.toLowerCase().includes('not found') || stderrLine.toLowerCase().includes('no issue')) {
      throw new BeadNotFoundError(normalizedBeadId);
    }

    throw new BeadAdapterError(stderrLine || err.message || 'Failed to read bead', stderrLine);
  }

  const payload = parseJsonPayload(stdout || stderr);
  const records = Array.isArray(payload) ? payload : [payload];
  const raw = records.find((entry) => normalizeString((entry as RawBeadRecord)?.id) === normalizedBeadId) as RawBeadRecord | undefined;

  if (!raw || !normalizeString(raw.id) || !normalizeString(raw.title)) {
    throw new BeadNotFoundError(normalizedBeadId);
  }

  const linkedPlan = await findRepoPlanByBeadId(normalizedBeadId, repoRoot);

  return {
    id: normalizeString(raw.id) ?? normalizedBeadId,
    title: normalizeString(raw.title) ?? normalizedBeadId,
    notes: normalizeString(raw.notes),
    status: normalizeString(raw.status),
    priority: normalizeNumber(raw.priority),
    issueType: normalizeString(raw.issue_type),
    owner: normalizeString(raw.owner),
    createdAt: normalizeString(raw.created_at),
    updatedAt: normalizeString(raw.updated_at),
    closedAt: normalizeString(raw.closed_at),
    closeReason: normalizeString(raw.close_reason),
    dependencies: normalizeRelations(raw.dependencies),
    dependents: normalizeRelations(raw.dependents),
    linkedPlan: linkedPlan ? {
      path: linkedPlan.path,
      title: linkedPlan.title,
      planId: linkedPlan.planId,
      archived: linkedPlan.archived,
      status: linkedPlan.status,
      updatedAt: linkedPlan.updatedAt,
    } : null,
  };
}
