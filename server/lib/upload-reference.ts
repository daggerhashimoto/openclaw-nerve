import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { getWorkspaceRoot, resolveWorkspacePath } from './file-utils.js';

export type CanonicalUploadReferenceKind = 'direct_workspace_reference' | 'imported_workspace_reference';

export interface CanonicalUploadReference {
  kind: CanonicalUploadReferenceKind;
  canonicalPath: string;
  absolutePath: string;
  uri: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
}

function toFileUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${encodeURI(normalized)}`;
  return `file://${encodeURI(normalized)}`;
}

function isWithinDir(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function toCanonicalWorkspacePath(absolutePath: string, workspaceRoot: string): string {
  const relative = path.relative(workspaceRoot, absolutePath);
  return relative.split(path.sep).join('/');
}

function inferMimeTypeFromName(name: string): string {
  const ext = path.extname(name).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.avif': return 'image/avif';
    case '.svg': return 'image/svg+xml';
    case '.ico': return 'image/x-icon';
    case '.txt': return 'text/plain';
    case '.md': return 'text/markdown';
    case '.json': return 'application/json';
    case '.pdf': return 'application/pdf';
    case '.mov': return 'video/quicktime';
    case '.mp4': return 'video/mp4';
    default: return 'application/octet-stream';
  }
}

function expandHomePath(input: string): string {
  const home = process.env.HOME || os.homedir();
  if (input === '~') return home;
  if (input.startsWith('~/')) return path.join(home, input.slice(2));
  return input;
}

function sanitizeFileName(name: string): string {
  const trimmed = name.trim();
  const base = path.basename(trimmed || 'upload.bin');
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'upload.bin';
}

function buildStagedFileName(originalName: string): string {
  const safeName = sanitizeFileName(originalName);
  const ext = path.extname(safeName);
  const stem = ext ? safeName.slice(0, -ext.length) : safeName;
  const suffix = crypto.randomUUID().slice(0, 8);
  return `${stem || 'upload'}-${suffix}${ext}`;
}

function buildStagedSubdir(now = new Date()): string {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return path.join(year, month, day);
}

function getUploadStagingDir(): string {
  const stagingRoot = process.env.NERVE_UPLOAD_STAGING_TEMP_DIR
    || path.join(getWorkspaceRoot(), '.temp', 'nerve-uploads');
  return path.resolve(expandHomePath(stagingRoot));
}

async function buildCanonicalReference(params: {
  kind: CanonicalUploadReferenceKind;
  absolutePath: string;
  originalName: string;
  mimeType?: string;
}): Promise<CanonicalUploadReference> {
  const workspaceRoot = path.resolve(getWorkspaceRoot());
  const realAbsolutePath = await fs.realpath(params.absolutePath);

  if (!isWithinDir(realAbsolutePath, workspaceRoot)) {
    throw new Error('Resolved attachment path is outside the workspace root.');
  }

  const stat = await fs.stat(realAbsolutePath);
  if (!stat.isFile()) {
    throw new Error('Resolved attachment path is not a file.');
  }

  return {
    kind: params.kind,
    canonicalPath: toCanonicalWorkspacePath(realAbsolutePath, workspaceRoot),
    absolutePath: realAbsolutePath,
    uri: toFileUri(realAbsolutePath),
    mimeType: params.mimeType?.trim() || inferMimeTypeFromName(params.originalName),
    sizeBytes: stat.size,
    originalName: params.originalName,
  };
}

export async function resolveDirectWorkspaceReference(relativePath: string): Promise<CanonicalUploadReference> {
  const resolved = await resolveWorkspacePath(relativePath);
  if (!resolved) {
    throw new Error('Invalid or excluded workspace path.');
  }

  return buildCanonicalReference({
    kind: 'direct_workspace_reference',
    absolutePath: resolved,
    originalName: path.basename(resolved),
  });
}

export async function importExternalUploadToCanonicalReference(params: {
  originalName: string;
  mimeType?: string;
  bytes: Uint8Array;
}): Promise<CanonicalUploadReference> {
  const workspaceRoot = path.resolve(getWorkspaceRoot());
  const rootDir = getUploadStagingDir();
  const targetDir = path.join(rootDir, buildStagedSubdir());
  const stagedPath = path.join(targetDir, buildStagedFileName(params.originalName));

  if (!isWithinDir(stagedPath, workspaceRoot)) {
    throw new Error('Resolved attachment path is outside the workspace root.');
  }

  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(stagedPath, params.bytes);

  return buildCanonicalReference({
    kind: 'imported_workspace_reference',
    absolutePath: stagedPath,
    originalName: params.originalName,
    mimeType: params.mimeType,
  });
}
