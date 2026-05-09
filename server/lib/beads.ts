import { execFile as execFileCallback } from 'node:child_process';
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
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

export class BeadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BeadValidationError';
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
  workspacePath: string | null;
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
  const segments = [...getPreferredLocalBinDirs(), ...(basePath || '').split(path.delimiter).filter(Boolean)];
  return [...new Set(segments)].join(path.delimiter);
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

function resolveExistingRealPath(candidatePath: string): string | null {
  try {
    return realpathSync.native(candidatePath);
  } catch {
    return null;
  }
}

function resolveRealPathForContainment(candidatePath: string): string {
  const normalizedCandidate = path.resolve(candidatePath);
  const missingSegments: string[] = [];
  let current = normalizedCandidate;

  while (true) {
    const realCurrent = resolveExistingRealPath(current);
    if (realCurrent) {
      return path.join(realCurrent, ...missingSegments.reverse());
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return normalizedCandidate;
    }

    missingSegments.push(path.basename(current));
    current = parent;
  }
}

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const containmentCandidate = resolveRealPathForContainment(candidatePath);
  const containmentRoot = resolveRealPathForContainment(rootPath);
  const relative = path.relative(containmentRoot, containmentCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertPathWithinWorkspace(candidatePath: string, workspaceRoot: string, label: string): string {
  const normalizedCandidate = path.resolve(candidatePath);
  if (!isPathWithinRoot(normalizedCandidate, workspaceRoot)) {
    throw new BeadValidationError(`${label} must stay within the workspace root`);
  }
  return normalizedCandidate;
}

function assertRepoRootReadableDirectory(repoRoot: string): string {
  const normalizedRepoRoot = path.resolve(repoRoot);
  try {
    if (!statSync(normalizedRepoRoot).isDirectory()) {
      throw new BeadValidationError('Resolved bead repo root must be an existing directory');
    }
  } catch (error) {
    if (error instanceof BeadValidationError) {
      throw error;
    }
    throw new BeadValidationError('Resolved bead repo root must be an existing directory');
  }
  return normalizedRepoRoot;
}

function resolveAbsoluteCurrentDocumentPath(currentDocumentPath: string, workspaceRoot: string): string {
  return assertPathWithinWorkspace(
    path.isAbsolute(currentDocumentPath)
      ? currentDocumentPath
      : path.resolve(workspaceRoot, currentDocumentPath),
    workspaceRoot,
    'Current document path',
  );
}

function resolveLegacyBeadLookupRepoRootFromCurrentDocumentPath(currentDocumentPath: string, workspaceRoot: string): string {
  const absoluteDocumentPath = resolveAbsoluteCurrentDocumentPath(currentDocumentPath, workspaceRoot);
  let currentDir = path.dirname(absoluteDocumentPath);

  while (isPathWithinRoot(currentDir, workspaceRoot)) {
    const beadDir = path.join(currentDir, '.beads');
    try {
      if (statSync(beadDir).isDirectory()) {
        return currentDir;
      }
    } catch {
      // Keep walking toward the workspace root.
    }

    if (currentDir === path.resolve(workspaceRoot)) {
      break;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return path.dirname(absoluteDocumentPath);
}

export function resolveBeadLookupRepoRoot(options: BeadLookupOptions = {}): string {
  const workspaceRoot = resolveAgentWorkspace(options.workspaceAgentId).workspaceRoot;
  const currentDocumentPath = options.currentDocumentPath?.trim();

  if (!options.targetPath?.trim()) {
    if (currentDocumentPath) {
      return normalizeBeadRepoRoot(resolveLegacyBeadLookupRepoRootFromCurrentDocumentPath(currentDocumentPath, workspaceRoot));
    }

    const cwd = process.cwd();
    const defaultWorkspaceRoot = resolveAgentWorkspace().workspaceRoot;
    if (!isPathWithinRoot(cwd, defaultWorkspaceRoot)) {
      return options.workspaceAgentId ? normalizeBeadRepoRoot(workspaceRoot) : cwd;
    }
    return normalizeBeadRepoRoot(path.resolve(workspaceRoot, path.relative(defaultWorkspaceRoot, cwd)));
  }

  const targetPath = options.targetPath.trim();
  if (path.isAbsolute(targetPath)) {
    return normalizeBeadRepoRoot(assertPathWithinWorkspace(targetPath, workspaceRoot, 'Explicit bead target path'));
  }

  if (!currentDocumentPath) {
    throw new BeadValidationError('Relative explicit bead URIs require a current document path');
  }

  const absoluteDocumentPath = resolveAbsoluteCurrentDocumentPath(currentDocumentPath, workspaceRoot);

  const repoRoot = normalizeBeadRepoRoot(path.resolve(path.dirname(absoluteDocumentPath), targetPath));
  return assertPathWithinWorkspace(repoRoot, workspaceRoot, 'Resolved bead repo root');
}

export async function getBeadDetail(beadId: string, options: BeadLookupOptions = {}): Promise<BeadDetail> {
  const normalizedBeadId = beadId.trim();
  if (!normalizedBeadId) {
    throw new BeadValidationError('Bead id is required');
  }

  const repoRoot = assertRepoRootReadableDirectory(resolveBeadLookupRepoRoot(options));

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

  let linkedPlan: Awaited<ReturnType<typeof findRepoPlanByBeadId>> = null;
  let linkedPlanWorkspacePath: string | null = null;

  try {
    linkedPlan = await findRepoPlanByBeadId(normalizedBeadId, repoRoot);
    if (linkedPlan) {
      const workspaceRoot = resolveAgentWorkspace(options.workspaceAgentId).workspaceRoot;
      const absoluteLinkedPlanPath = path.resolve(repoRoot, linkedPlan.path);
      if (isPathWithinRoot(absoluteLinkedPlanPath, workspaceRoot)) {
        const relativePath = path.relative(workspaceRoot, absoluteLinkedPlanPath).split(path.sep).join('/');
        linkedPlanWorkspacePath = relativePath && relativePath !== '.' ? relativePath : null;
      }
    }
  } catch {
    linkedPlan = null;
    linkedPlanWorkspacePath = null;
  }

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
      workspacePath: linkedPlanWorkspacePath,
      title: linkedPlan.title,
      planId: linkedPlan.planId,
      archived: linkedPlan.archived,
      status: linkedPlan.status,
      updatedAt: linkedPlan.updatedAt,
    } : null,
  };
}
