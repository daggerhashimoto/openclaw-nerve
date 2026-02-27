/**
 * File operation pipeline for the file explorer.
 *
 * Single source of truth for rename/move/trash/restore semantics.
 * All operations are constrained to workspace-relative paths.
 */

import fs from 'node:fs/promises';
import type { Stats } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  getWorkspaceRoot,
  isExcluded,
  resolveWorkspacePath,
} from './file-utils.js';

const TRASH_DIR = '.trash';
const TRASH_INDEX = '.index.json';

export interface FileOpResult {
  from: string;
  to: string;
}

interface TrashIndexItem {
  id: string;
  originalPath: string;
  deletedAtMs: number;
  type: 'file' | 'directory';
}

interface TrashIndexDoc {
  version: 1;
  items: Record<string, TrashIndexItem>;
}

const EMPTY_INDEX: TrashIndexDoc = { version: 1, items: {} };

export class FileOpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'FileOpError';
    this.status = status;
    this.code = code;
  }
}

function toPosix(rel: string): string {
  return rel.replace(/\\/g, '/');
}

function workspaceRoot(): string {
  return getWorkspaceRoot();
}

function toWorkspaceRelative(absPath: string): string {
  const rel = path.relative(workspaceRoot(), absPath);
  return toPosix(rel || '.');
}

function isInTrash(relPath: string): boolean {
  return relPath === TRASH_DIR || relPath.startsWith(`${TRASH_DIR}/`);
}

function isTrashRoot(relPath: string): boolean {
  return relPath === TRASH_DIR;
}

async function exists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function statOrThrow(absPath: string): Promise<Stats> {
  try {
    return await fs.stat(absPath);
  } catch {
    throw new FileOpError(404, 'not_found', 'Path not found');
  }
}

function assertValidNewName(newName: string): void {
  const trimmed = newName.trim();
  if (!trimmed) {
    throw new FileOpError(400, 'invalid_name', 'Name cannot be empty');
  }
  if (trimmed === '.' || trimmed === '..') {
    throw new FileOpError(400, 'invalid_name', 'Invalid name');
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    throw new FileOpError(400, 'invalid_name', 'Name cannot include path separators');
  }
  if (isExcluded(trimmed)) {
    throw new FileOpError(403, 'excluded_name', 'Name is not allowed');
  }
}

async function resolveExistingPathOrThrow(relPath: string): Promise<string> {
  const resolved = await resolveWorkspacePath(relPath);
  if (!resolved) {
    throw new FileOpError(403, 'invalid_path', 'Invalid or excluded path');
  }
  return resolved;
}

async function resolvePathAllowNewOrThrow(relPath: string): Promise<string> {
  const resolved = await resolveWorkspacePath(relPath, { allowNonExistent: true });
  if (!resolved) {
    throw new FileOpError(403, 'invalid_path', 'Invalid or excluded path');
  }
  return resolved;
}

function assertNotProtected(relPath: string): void {
  if (isTrashRoot(relPath)) {
    throw new FileOpError(422, 'protected_path', 'This path is protected');
  }
}

function assertNotMovingDirIntoSelf(sourceAbs: string, targetAbs: string, sourceIsDirectory: boolean): void {
  if (!sourceIsDirectory) return;
  if (targetAbs === sourceAbs || targetAbs.startsWith(sourceAbs + path.sep)) {
    throw new FileOpError(422, 'invalid_move', 'Cannot move a folder into itself');
  }
}

async function assertTargetNotExists(targetAbs: string): Promise<void> {
  if (await exists(targetAbs)) {
    throw new FileOpError(409, 'conflict', 'A file or folder with this name already exists');
  }
}

function trashDirAbs(): string {
  return path.join(workspaceRoot(), TRASH_DIR);
}

function trashIndexAbs(): string {
  return path.join(trashDirAbs(), TRASH_INDEX);
}

async function ensureTrashInfra(): Promise<void> {
  await fs.mkdir(trashDirAbs(), { recursive: true });
  if (!(await exists(trashIndexAbs()))) {
    await fs.writeFile(trashIndexAbs(), JSON.stringify(EMPTY_INDEX, null, 2) + '\n', 'utf-8');
  }
}

async function readTrashIndex(): Promise<TrashIndexDoc> {
  try {
    const raw = await fs.readFile(trashIndexAbs(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<TrashIndexDoc>;
    if (parsed && parsed.version === 1 && parsed.items && typeof parsed.items === 'object') {
      return {
        version: 1,
        items: parsed.items as Record<string, TrashIndexItem>,
      };
    }
    return { ...EMPTY_INDEX, items: {} };
  } catch {
    return { ...EMPTY_INDEX, items: {} };
  }
}

async function writeTrashIndex(index: TrashIndexDoc): Promise<void> {
  await fs.writeFile(trashIndexAbs(), JSON.stringify(index, null, 2) + '\n', 'utf-8');
}

function randomId(): string {
  return crypto.randomBytes(4).toString('hex');
}

async function buildUniqueTrashTarget(sourceAbs: string, sourceIsDirectory: boolean): Promise<string> {
  const base = path.basename(sourceAbs);
  const parsed = path.parse(base);

  for (let i = 0; i < 100; i++) {
    const id = randomId();
    const candidateName = sourceIsDirectory
      ? `${base}--${id}`
      : parsed.ext
        ? `${parsed.name}--${id}${parsed.ext}`
        : `${base}--${id}`;

    const candidateAbs = path.join(trashDirAbs(), candidateName);
    if (!(await exists(candidateAbs))) {
      return candidateAbs;
    }
  }

  throw new FileOpError(500, 'trash_name_generation_failed', 'Failed to allocate trash path');
}

async function updateTrashIndexAfterMove(fromRel: string, toRel: string): Promise<void> {
  const fromInTrash = isInTrash(fromRel);
  const toInTrash = isInTrash(toRel);

  if (!fromInTrash && !toInTrash) return;

  await ensureTrashInfra();
  const index = await readTrashIndex();

  // Move/rename inside trash => rename key.
  if (fromInTrash && toInTrash) {
    const item = index.items[fromRel];
    if (item) {
      delete index.items[fromRel];
      index.items[toRel] = item;
      await writeTrashIndex(index);
    }
    return;
  }

  // Moved out of trash manually => drop index entry.
  if (fromInTrash && !toInTrash) {
    if (index.items[fromRel]) {
      delete index.items[fromRel];
      await writeTrashIndex(index);
    }
    return;
  }
}

export async function renameEntry(params: { path: string; newName: string }): Promise<FileOpResult> {
  assertValidNewName(params.newName);

  const sourceAbs = await resolveExistingPathOrThrow(params.path);
  const sourceRel = toWorkspaceRelative(sourceAbs);
  assertNotProtected(sourceRel);

  await statOrThrow(sourceAbs);

  const targetAbs = await resolvePathAllowNewOrThrow(
    toPosix(path.join(path.dirname(sourceRel), params.newName.trim())),
  );
  const targetRel = toWorkspaceRelative(targetAbs);

  if (sourceAbs === targetAbs) {
    return { from: sourceRel, to: targetRel };
  }

  await assertTargetNotExists(targetAbs);
  await fs.rename(sourceAbs, targetAbs);
  await updateTrashIndexAfterMove(sourceRel, targetRel);

  return { from: sourceRel, to: targetRel };
}

export async function moveEntry(params: { sourcePath: string; targetDirPath: string }): Promise<FileOpResult> {
  const sourceAbs = await resolveExistingPathOrThrow(params.sourcePath);
  const sourceRel = toWorkspaceRelative(sourceAbs);
  assertNotProtected(sourceRel);

  const sourceStat = await statOrThrow(sourceAbs);

  let targetDirAbs: string;
  if (!params.targetDirPath) {
    targetDirAbs = workspaceRoot();
  } else {
    targetDirAbs = await resolveExistingPathOrThrow(params.targetDirPath);
  }

  const targetDirStat = await statOrThrow(targetDirAbs);
  if (!targetDirStat.isDirectory()) {
    throw new FileOpError(400, 'target_not_directory', 'Target must be a directory');
  }

  const targetAbs = path.join(targetDirAbs, path.basename(sourceAbs));
  const targetRel = toWorkspaceRelative(targetAbs);

  if (sourceAbs === targetAbs) {
    return { from: sourceRel, to: targetRel };
  }

  assertNotMovingDirIntoSelf(sourceAbs, targetAbs, sourceStat.isDirectory());
  await assertTargetNotExists(targetAbs);

  await fs.rename(sourceAbs, targetAbs);
  await updateTrashIndexAfterMove(sourceRel, targetRel);

  return { from: sourceRel, to: targetRel };
}

export async function trashEntry(params: { path: string }): Promise<FileOpResult & { undoTtlMs: number }> {
  const sourceAbs = await resolveExistingPathOrThrow(params.path);
  const sourceRel = toWorkspaceRelative(sourceAbs);

  assertNotProtected(sourceRel);
  if (isInTrash(sourceRel)) {
    throw new FileOpError(422, 'already_in_trash', 'Path is already in trash');
  }

  const sourceStat = await statOrThrow(sourceAbs);

  await ensureTrashInfra();
  const targetAbs = await buildUniqueTrashTarget(sourceAbs, sourceStat.isDirectory());
  const targetRel = toWorkspaceRelative(targetAbs);

  await fs.rename(sourceAbs, targetAbs);

  const index = await readTrashIndex();
  index.items[targetRel] = {
    id: randomId(),
    originalPath: sourceRel,
    deletedAtMs: Date.now(),
    type: sourceStat.isDirectory() ? 'directory' : 'file',
  };
  await writeTrashIndex(index);

  return { from: sourceRel, to: targetRel, undoTtlMs: 10000 };
}

export async function restoreEntry(params: { path: string }): Promise<FileOpResult> {
  const sourceAbs = await resolveExistingPathOrThrow(params.path);
  const sourceRel = toWorkspaceRelative(sourceAbs);

  if (!isInTrash(sourceRel) || isTrashRoot(sourceRel)) {
    throw new FileOpError(422, 'not_restorable', 'Only trashed items can be restored');
  }

  await ensureTrashInfra();
  const index = await readTrashIndex();
  const item = index.items[sourceRel];

  if (!item) {
    throw new FileOpError(404, 'restore_metadata_missing', 'Restore metadata not found for this item');
  }

  const targetAbs = await resolvePathAllowNewOrThrow(item.originalPath);
  const targetRel = toWorkspaceRelative(targetAbs);

  await assertTargetNotExists(targetAbs);
  await fs.mkdir(path.dirname(targetAbs), { recursive: true });
  await fs.rename(sourceAbs, targetAbs);

  delete index.items[sourceRel];
  await writeTrashIndex(index);

  return { from: sourceRel, to: targetRel };
}
