/**
 * File browser API routes.
 *
 * Provides directory tree listing and file reading for the workspace
 * file browser UI. All paths are relative to the workspace root
 * (~/.openclaw/workspace/) and validated against traversal + exclusion rules.
 *
 * When the workspace is not locally accessible, falls back to gateway RPC
 * for top-level persona files. Mutation endpoints (rename, move, trash,
 * restore) return 501 for remote workspaces.
 *
 * GET  /api/files/tree  — List directory entries (lazy, depth-limited)
 * GET  /api/files/read  — Read a text file's content
 * PUT  /api/files/write — Write/update a text file
 * @module
 */

import { Hono, type Context } from 'hono';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import type { Dirent } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import {
  getWorkspaceRoot,
  resolveWorkspacePathForRoot,
  isExcluded,
  isBinary,
  MAX_FILE_SIZE,
} from '../lib/file-utils.js';
import { config } from '../lib/config.js';
import {
  FileOpError,
  moveEntry,
  renameEntry,
  restoreEntry,
  trashEntry,
} from '../lib/file-ops.js';
import { InvalidAgentIdError, resolveAgentWorkspace } from '../lib/agent-workspace.js';
import { isWorkspaceLocal } from '../lib/workspace-detect.js';
import { gatewayFilesList, gatewayFilesGet, gatewayFilesSet } from '../lib/gateway-rpc.js';

const app = new Hono();

// ── Types ────────────────────────────────────────────────────────────

interface TreeEntry {
  name: string;
  path: string;         // relative to workspace root
  type: 'file' | 'directory';
  size?: number;        // bytes, files only
  mtime?: number;       // epoch ms
  binary?: boolean;     // true for binary files
  children?: TreeEntry[] | null; // null = not loaded, [] = empty dir
}

interface ScopedWorkspace {
  agentId: string;
  workspaceRoot: string;
  isCustomWorkspace: boolean;
}

interface DirectoryListing {
  entries: TreeEntry[];
  totalEntries: number;
  returnedEntries: number;
  limit: number;
  cursor: number;
  truncated: boolean;
  nextCursor?: string;
}

interface ListingBudget {
  remaining: number;
  truncated: boolean;
}

const DEFAULT_TREE_LIMIT = 1_000;
const MAX_TREE_LIMIT = 5_000;
const MAX_TREE_RESPONSE_ENTRIES = 5_000;
const STAT_CONCURRENCY = 16;

// ── Helpers ──────────────────────────────────────────────────────────

function resolveScopedWorkspace(agentId?: string): ScopedWorkspace {
  const customRoot = (config.fileBrowserRoot || '').trim();
  if (customRoot) {
    return {
      agentId: 'main',
      workspaceRoot: getWorkspaceRoot(),
      isCustomWorkspace: true,
    };
  }

  const workspace = resolveAgentWorkspace(agentId);
  return {
    agentId: workspace.agentId,
    workspaceRoot: workspace.workspaceRoot,
    isCustomWorkspace: false,
  };
}

function handleAgentWorkspaceError(c: Context, err: unknown) {
  if (err instanceof InvalidAgentIdError) {
    return c.json({ ok: false, error: err.message }, 400);
  }
  const message = err instanceof Error ? err.message : 'Invalid workspace request';
  return c.json({ ok: false, error: message }, 500);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseTreeLimit(value: string | undefined): number {
  return Math.min(parsePositiveInt(value, DEFAULT_TREE_LIMIT), MAX_TREE_LIMIT);
}

function parseTreeCursor(value: string | undefined): number {
  return parsePositiveInt(value, 0);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]!);
    }
  });

  await Promise.all(workers);
  return results;
}

function shouldIncludeDirent(item: Dirent, basePath: string, showHidden: boolean): boolean {
  if (isExcluded(item.name)) return false;

  const inTrash = basePath === '.trash' || basePath.startsWith('.trash/');
  if (inTrash) {
    return item.name !== '.index.json';
  }

  if (!showHidden && item.name.startsWith('.') && item.name !== '.nerveignore' && item.name !== '.trash') {
    return false;
  }

  return !(config.fileBrowserRoot && item.name === '.trash');
}

async function listDirectoryPage(
  dirPath: string,
  basePath: string,
  depth: number,
  showHidden: boolean,
  options: {
    cursor: number;
    limit: number;
    budget: ListingBudget;
  },
): Promise<DirectoryListing> {
  let items;
  try {
    items = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return {
      entries: [],
      totalEntries: 0,
      returnedEntries: 0,
      limit: options.limit,
      cursor: options.cursor,
      truncated: false,
    };
  }

  const visibleItems = items
    .filter((item) => shouldIncludeDirent(item, basePath, showHidden))
    // Sort: directories first, then alphabetical (case-insensitive)
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

  const totalEntries = visibleItems.length;
  const start = Math.min(options.cursor, totalEntries);
  const pageItems = visibleItems.slice(start, start + options.limit);
  const nextCursor = start + pageItems.length < totalEntries ? String(start + pageItems.length) : undefined;
  const entries: TreeEntry[] = [];

  const directories = pageItems.filter((item) => item.isDirectory());
  const files = pageItems.filter((item) => item.isFile());

  for (const item of directories) {
    if (options.budget.remaining <= 0) {
      options.budget.truncated = true;
      break;
    }
    options.budget.remaining -= 1;
    const relativePath = basePath ? path.join(basePath, item.name) : item.name;
    const fullPath = path.join(dirPath, item.name);

    const childListing = depth > 1
      ? await listDirectoryPage(fullPath, relativePath, depth - 1, showHidden, {
          cursor: 0,
          limit: options.limit,
          budget: options.budget,
        })
      : null;

    entries.push({
      name: item.name,
      path: relativePath,
      type: 'directory',
      children: childListing?.entries ?? null,
    });
  }

  const allowedFileCount = Math.min(files.length, Math.max(0, options.budget.remaining));
  if (allowedFileCount < files.length) {
    options.budget.truncated = true;
  }
  options.budget.remaining -= allowedFileCount;

  const fileEntries = await mapWithConcurrency<Dirent, TreeEntry | null>(
    files.slice(0, allowedFileCount),
    STAT_CONCURRENCY,
    async (item) => {
      const relativePath = basePath ? path.join(basePath, item.name) : item.name;
      const fullPath = path.join(dirPath, item.name);
      try {
        const stat = await fs.stat(fullPath);
        return {
          name: item.name,
          path: relativePath,
          type: 'file' as const,
          size: stat.size,
          mtime: Math.floor(stat.mtimeMs),
          binary: isBinary(item.name) || undefined,
        };
      } catch {
        return null;
      }
    },
  );

  entries.push(...fileEntries.filter((entry): entry is TreeEntry => Boolean(entry)));

  return {
    entries,
    totalEntries,
    returnedEntries: entries.length,
    limit: options.limit,
    cursor: start,
    truncated: Boolean(nextCursor) || options.budget.truncated,
    nextCursor,
  };
}

async function listDirectory(
  dirPath: string,
  basePath: string,
  depth: number,
  showHidden: boolean,
  cursor: number,
  limit: number,
): Promise<DirectoryListing> {
  return listDirectoryPage(dirPath, basePath, depth, showHidden, {
    cursor,
    limit,
    budget: {
      remaining: MAX_TREE_RESPONSE_ENTRIES,
      truncated: false,
    },
  });
}

function handleFileOpError(c: Context, err: unknown) {
  if (err instanceof FileOpError) {
    return c.json({ ok: false, error: err.message, code: err.code }, err.status);
  }
  const message = err instanceof Error ? err.message : 'Operation failed';
  return c.json({ ok: false, error: message }, 500);
}

/** Convert gateway file list to TreeEntry format for the UI. */
function gatewayFilesToTree(
  files: Awaited<ReturnType<typeof gatewayFilesList>>,
  showHidden: boolean,
): TreeEntry[] {
  return files
    .filter((f) => !f.missing)
    .filter((f) => showHidden || !f.name.startsWith('.') || f.name === '.nerveignore' || f.name === '.trash')
    .map((f) => ({
      name: f.name,
      path: f.name,
      type: 'file' as const,
      size: f.size,
      mtime: f.updatedAtMs,
    }));
}

function normalizeWorkspaceLookupPath(input: string, workspaceRoots: string[] = []): string {
  const trimmed = input.trim();
  if (trimmed === '/workspace' || trimmed === '/workspace/') {
    return '.';
  }

  if (trimmed.startsWith('/workspace/')) {
    return trimmed.slice('/workspace/'.length);
  }

  const normalizedWorkspaceRoots = workspaceRoots
    .map((root) => getWorkspaceRoot(root).split(path.sep).join('/').replace(/\/+$/, ''))
    .filter((root, index, array) => Boolean(root) && array.indexOf(root) === index);

  for (const normalizedWorkspaceRoot of normalizedWorkspaceRoots) {
    if (trimmed === normalizedWorkspaceRoot || trimmed === `${normalizedWorkspaceRoot}/`) {
      return '.';
    }

    if (trimmed.startsWith(`${normalizedWorkspaceRoot}/`)) {
      return trimmed.slice(normalizedWorkspaceRoot.length + 1);
    }
  }

  return trimmed;
}

async function getWorkspaceLookupRoots(workspaceRoot: string): Promise<string[]> {
  const root = getWorkspaceRoot(workspaceRoot);
  const realRoot = await fs.realpath(root).catch(() => root);
  return realRoot === root ? [root] : [root, realRoot];
}

// ── GET /api/files/tree ──────────────────────────────────────────────

app.get('/api/files/tree', async (c) => {
  let workspace: ScopedWorkspace;
  try {
    workspace = resolveScopedWorkspace(c.req.query('agentId'));
  } catch (err) {
    return handleAgentWorkspaceError(c, err);
  }

  const root = workspace.workspaceRoot;
  const subPath = c.req.query('path') || '';
  const depth = Math.min(Math.max(Number(c.req.query('depth')) || 1, 1), 5);
  const limit = parseTreeLimit(c.req.query('limit'));
  const cursor = parseTreeCursor(c.req.query('cursor'));
  const showHidden = c.req.query('showHidden') === 'true';

  // Check if workspace is local
  const isLocal = await isWorkspaceLocal(root);

  if (isLocal) {
    // Resolve the target directory
    let targetDir: string;
    if (subPath) {
      const resolved = await resolveWorkspacePathForRoot(root, subPath);
      if (!resolved) {
        return c.json({ ok: false, error: 'Invalid path' }, 400);
      }
      targetDir = resolved;

      // Ensure it's a directory
      try {
        const stat = await fs.stat(targetDir);
        if (!stat.isDirectory()) {
          return c.json({ ok: false, error: 'Not a directory' }, 400);
        }
      } catch {
        return c.json({ ok: false, error: 'Directory not found' }, 404);
      }
    } else {
      targetDir = root;
    }

    const listing = await listDirectory(targetDir, subPath, depth, showHidden, cursor, limit);

    return c.json({
      ok: true,
      root: subPath || '.',
      entries: listing.entries,
      totalEntries: listing.totalEntries,
      returnedEntries: listing.returnedEntries,
      limit: listing.limit,
      cursor: listing.cursor,
      truncated: listing.truncated,
      nextCursor: listing.nextCursor,
      workspaceInfo: {
        isCustomWorkspace: workspace.isCustomWorkspace,
        rootPath: root,
      },
    });
  }

  // Remote workspace — gateway fallback (top-level only)
  if (subPath) {
    // Gateway only supports top-level files
    return c.json({
      ok: true,
      root: subPath,
      entries: [],
      totalEntries: 0,
      returnedEntries: 0,
      limit,
      cursor,
      truncated: false,
      remoteWorkspace: true,
      workspaceInfo: {
        isCustomWorkspace: workspace.isCustomWorkspace,
        rootPath: root,
      },
    });
  }

  try {
    const remoteFiles = await gatewayFilesList(workspace.agentId);
    const entries = gatewayFilesToTree(remoteFiles, showHidden);
    const start = Math.min(cursor, entries.length);
    const pagedEntries = entries.slice(start, start + limit);
    const nextCursor =
      start + pagedEntries.length < entries.length ? String(start + pagedEntries.length) : undefined;
    return c.json({
      ok: true,
      root: '.',
      entries: pagedEntries,
      totalEntries: entries.length,
      returnedEntries: pagedEntries.length,
      limit,
      cursor: start,
      truncated: Boolean(nextCursor),
      ...(nextCursor ? { nextCursor } : {}),
      remoteWorkspace: true,
      workspaceInfo: {
        isCustomWorkspace: workspace.isCustomWorkspace,
        rootPath: root,
      },
    });
  } catch (err) {
    console.warn('[file-browser] Gateway tree fallback failed:', (err as Error).message);
    return c.json({
      ok: true,
      root: '.',
      entries: [],
      totalEntries: 0,
      returnedEntries: 0,
      limit,
      cursor: 0,
      truncated: false,
      remoteWorkspace: true,
      workspaceInfo: {
        isCustomWorkspace: workspace.isCustomWorkspace,
        rootPath: root,
      },
    });
  }
});

// ── GET /api/files/resolve ───────────────────────────────────────────

app.get('/api/files/resolve', async (c) => {
  const targetPath = c.req.query('path');
  const relativeTo = c.req.query('relativeTo');
  if (!targetPath) {
    return c.json({ ok: false, error: 'Missing path parameter' }, 400);
  }

  let workspace: ScopedWorkspace;
  try {
    workspace = resolveScopedWorkspace(c.req.query('agentId'));
  } catch (err) {
    return handleAgentWorkspaceError(c, err);
  }

  if (!(await isWorkspaceLocal(workspace.workspaceRoot))) {
    return c.json({ ok: false, error: 'Not supported for remote workspaces', code: 'REMOTE_WORKSPACE' }, 501);
  }

  const workspaceLookupRoots = await getWorkspaceLookupRoots(workspace.workspaceRoot);
  const rawTargetPath = targetPath.trim().replace(/\\/g, '/');
  const normalizedTargetPath = normalizeWorkspaceLookupPath(rawTargetPath, workspaceLookupRoots);
  const workspaceRelativePath = (() => {
    if (!relativeTo) return normalizedTargetPath;
    if (normalizedTargetPath === '.') return '.';
    if (normalizedTargetPath !== rawTargetPath) return normalizedTargetPath;
    if (rawTargetPath.startsWith('/')) return rawTargetPath.replace(/^\/+/, '');

    const normalizedRelativeTo = normalizeWorkspaceLookupPath(
      relativeTo.replace(/\\/g, '/'),
      workspaceLookupRoots,
    ).replace(/^\/+/, '');
    const relativeDir = path.posix.dirname(normalizedRelativeTo);
    return path.posix.normalize(path.posix.join(relativeDir === '.' ? '' : relativeDir, normalizedTargetPath));
  })();

  const resolved = await resolveWorkspacePathForRoot(
    workspace.workspaceRoot,
    workspaceRelativePath,
    { allowNonExistent: true },
  );
  if (!resolved) {
    return c.json({ ok: false, error: 'Invalid or excluded path' }, 403);
  }

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    return c.json({ ok: false, error: 'Path not found' }, 404);
  }

  const relative = path.relative(workspace.workspaceRoot, resolved).split(path.sep).join('/');
  if (!relative || relative === '.') {
    return c.json({ ok: false, error: 'Path not found' }, 404);
  }

  return c.json({
    ok: true,
    path: relative,
    type: stat.isDirectory() ? 'directory' : 'file',
    binary: stat.isFile() ? isBinary(path.basename(resolved)) : false,
  });
});

// ── GET /api/files/read ──────────────────────────────────────────────

app.get('/api/files/read', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) {
    return c.json({ ok: false, error: 'Missing path parameter' }, 400);
  }

  let workspace: ScopedWorkspace;
  try {
    workspace = resolveScopedWorkspace(c.req.query('agentId'));
  } catch (err) {
    return handleAgentWorkspaceError(c, err);
  }

  // Note: Write endpoint uses config.workspaceRemote instead to allow bootstrapping new workspaces
  const isLocal = await isWorkspaceLocal(workspace.workspaceRoot);

  if (isLocal) {
    const resolved = await resolveWorkspacePathForRoot(workspace.workspaceRoot, filePath);
    if (!resolved) {
      return c.json({ ok: false, error: 'Invalid or excluded path' }, 403);
    }

    // Check if binary
    if (isBinary(path.basename(resolved))) {
      return c.json({ ok: false, error: 'Binary file', binary: true }, 415);
    }

    // Stat the file
    let stat;
    try {
      stat = await fs.stat(resolved);
    } catch {
      return c.json({ ok: false, error: 'File not found' }, 404);
    }

    if (!stat.isFile()) {
      return c.json({ ok: false, error: 'Not a file' }, 400);
    }

    if (stat.size > MAX_FILE_SIZE) {
      return c.json({ ok: false, error: `File too large (${(stat.size / 1024).toFixed(0)}KB, max 1MB)` }, 413);
    }

    try {
      const content = await fs.readFile(resolved, 'utf-8');
      return c.json({
        ok: true,
        content,
        size: stat.size,
        mtime: Math.floor(stat.mtimeMs),
      });
    } catch {
      return c.json({ ok: false, error: 'Failed to read file' }, 500);
    }
  }

  // Remote workspace fallback — only top-level files
  const basename = path.basename(filePath);
  if (filePath !== basename) {
    // Subdirectory path — not supported via gateway
    return c.json({ ok: false, error: 'File not found', remoteWorkspace: true }, 404);
  }

  if (isBinary(basename)) {
    return c.json({ ok: false, error: 'Binary file', binary: true }, 415);
  }

  const file = await gatewayFilesGet(workspace.agentId, basename);
  if (file) {
    return c.json({
      ok: true,
      content: file.content,
      size: file.size,
      mtime: file.updatedAtMs,
      remoteWorkspace: true,
    });
  }

  return c.json({ ok: false, error: 'File not found', remoteWorkspace: true }, 404);
});

// ── PUT /api/files/write ─────────────────────────────────────────────

app.put('/api/files/write', async (c) => {
  let body: { path?: string; content?: string; expectedMtime?: number; agentId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { path: filePath, content, expectedMtime } = body;

  if (!filePath || typeof filePath !== 'string') {
    return c.json({ ok: false, error: 'Missing path' }, 400);
  }
  if (typeof content !== 'string') {
    return c.json({ ok: false, error: 'Missing or invalid content' }, 400);
  }
  if (content.length > MAX_FILE_SIZE) {
    return c.json({ ok: false, error: 'Content too large (max 1MB)' }, 413);
  }

  let workspace: ScopedWorkspace;
  try {
    workspace = resolveScopedWorkspace(body.agentId ?? c.req.query('agentId'));
  } catch (err) {
    return handleAgentWorkspaceError(c, err);
  }

  // For writes, treat workspace as local unless explicitly forced remote.
  // This allows bootstrapping new agent workspaces (directory doesn't exist yet).
  const isLocal = !config.workspaceRemote;

  if (isLocal) {
    const resolved = await resolveWorkspacePathForRoot(workspace.workspaceRoot, filePath, { allowNonExistent: true });
    if (!resolved) {
      return c.json({ ok: false, error: 'Invalid or excluded path' }, 403);
    }

    if (isBinary(path.basename(resolved))) {
      return c.json({ ok: false, error: 'Cannot write binary files' }, 415);
    }

    // Conflict detection: check mtime if expectedMtime provided
    if (typeof expectedMtime === 'number') {
      try {
        const stat = await fs.stat(resolved);
        const currentMtime = Math.floor(stat.mtimeMs);
        if (currentMtime !== expectedMtime) {
          return c.json({
            ok: false,
            error: 'File was modified since you loaded it',
            currentMtime,
          }, 409);
        }
      } catch {
        // File doesn't exist yet — no conflict possible
      }
    }

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(resolved), { recursive: true });

    // Write the file
    try {
      await fs.writeFile(resolved, content, 'utf-8');
      const stat = await fs.stat(resolved);
      return c.json({
        ok: true,
        mtime: Math.floor(stat.mtimeMs),
      });
    } catch {
      return c.json({ ok: false, error: 'Failed to write file' }, 500);
    }
  }

  // Remote workspace fallback — only top-level files
  const basename = path.basename(filePath);
  if (filePath !== basename) {
    return c.json({
      ok: false,
      error: 'Not supported for remote workspaces',
      code: 'REMOTE_WORKSPACE',
    }, 501);
  }

  if (isBinary(basename)) {
    return c.json({ ok: false, error: 'Cannot write binary files' }, 415);
  }

  try {
    await gatewayFilesSet(workspace.agentId, basename, content);
    return c.json({ ok: true, remoteWorkspace: true, mtime: Date.now() });
  } catch (err) {
    console.error('[file-browser] Gateway write fallback failed:', (err as Error).message);
    return c.json({ ok: false, error: 'Failed to write file' }, 500);
  }
});

// ── Mutation endpoints — 501 for remote workspaces ───────────────────

async function requireLocalWorkspace(c: Context, workspace: ScopedWorkspace): Promise<Response | null> {
  if (!(await isWorkspaceLocal(workspace.workspaceRoot))) {
    return c.json({
      ok: false,
      error: 'Not supported for remote workspaces',
      code: 'REMOTE_WORKSPACE',
    }, 501);
  }
  return null;
}

// ── POST /api/files/rename ────────────────────────────────────────────

app.post('/api/files/rename', async (c) => {
  let body: { path?: string; newName?: string; agentId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  if (!body.path || typeof body.path !== 'string') {
    return c.json({ ok: false, error: 'Missing path' }, 400);
  }
  if (!body.newName || typeof body.newName !== 'string') {
    return c.json({ ok: false, error: 'Missing newName' }, 400);
  }

  let workspace: ScopedWorkspace;
  try {
    workspace = resolveScopedWorkspace(body.agentId ?? c.req.query('agentId'));
  } catch (err) {
    return handleAgentWorkspaceError(c, err);
  }

  const remoteBlock = await requireLocalWorkspace(c, workspace);
  if (remoteBlock) return remoteBlock;

  const sourceAbs = await resolveWorkspacePathForRoot(workspace.workspaceRoot, body.path);
  if (!sourceAbs) {
    return c.json({ ok: false, error: 'Invalid or excluded path' }, 403);
  }

  try {
    const result = await renameEntry({
      workspaceRoot: workspace.workspaceRoot,
      sourceAbs,
      newName: body.newName,
    });
    return c.json({ ok: true, ...result });
  } catch (err) {
    return handleFileOpError(c, err);
  }
});

// ── POST /api/files/move ──────────────────────────────────────────────

app.post('/api/files/move', async (c) => {
  let body: { sourcePath?: string; targetDirPath?: string; agentId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  if (!body.sourcePath || typeof body.sourcePath !== 'string') {
    return c.json({ ok: false, error: 'Missing sourcePath' }, 400);
  }
  if (typeof body.targetDirPath !== 'string') {
    return c.json({ ok: false, error: 'Missing targetDirPath' }, 400);
  }

  let workspace: ScopedWorkspace;
  try {
    workspace = resolveScopedWorkspace(body.agentId ?? c.req.query('agentId'));
  } catch (err) {
    return handleAgentWorkspaceError(c, err);
  }

  const remoteBlock = await requireLocalWorkspace(c, workspace);
  if (remoteBlock) return remoteBlock;

  const sourceAbs = await resolveWorkspacePathForRoot(workspace.workspaceRoot, body.sourcePath);
  if (!sourceAbs) {
    return c.json({ ok: false, error: 'Invalid or excluded path' }, 403);
  }

  const targetDirAbs = body.targetDirPath
    ? await resolveWorkspacePathForRoot(workspace.workspaceRoot, body.targetDirPath)
    : workspace.workspaceRoot;
  if (!targetDirAbs) {
    return c.json({ ok: false, error: 'Invalid or excluded path' }, 403);
  }

  try {
    const result = await moveEntry({
      workspaceRoot: workspace.workspaceRoot,
      sourceAbs,
      targetDirAbs,
    });
    return c.json({ ok: true, ...result });
  } catch (err) {
    return handleFileOpError(c, err);
  }
});

// ── POST /api/files/trash ─────────────────────────────────────────────

app.post('/api/files/trash', async (c) => {
  let body: { path?: string; agentId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  if (!body.path || typeof body.path !== 'string') {
    return c.json({ ok: false, error: 'Missing path' }, 400);
  }

  let workspace: ScopedWorkspace;
  try {
    workspace = resolveScopedWorkspace(body.agentId ?? c.req.query('agentId'));
  } catch (err) {
    return handleAgentWorkspaceError(c, err);
  }

  const remoteBlock = await requireLocalWorkspace(c, workspace);
  if (remoteBlock) return remoteBlock;

  try {
    // Custom directory browser root uses permanent deletion (no trash)
    if (workspace.isCustomWorkspace) {
      const requestedPath = body.path.trim();
      if (requestedPath === '.' || requestedPath === './') {
        return c.json({ ok: false, error: 'Deleting workspace root is not allowed' }, 400);
      }

      const resolved = await resolveWorkspacePathForRoot(workspace.workspaceRoot, requestedPath);
      if (!resolved) {
        return c.json({ ok: false, error: 'Invalid or excluded path' }, 403);
      }

      const rootRealPath = await fs.realpath(workspace.workspaceRoot).catch(() => workspace.workspaceRoot);
      if (resolved === rootRealPath) {
        return c.json({ ok: false, error: 'Deleting workspace root is not allowed' }, 400);
      }

      await fs.rm(resolved, { recursive: true, force: true });
      return c.json({ ok: true, from: body.path, to: '' });
    }

    const sourceAbs = await resolveWorkspacePathForRoot(workspace.workspaceRoot, body.path);
    if (!sourceAbs) {
      return c.json({ ok: false, error: 'Invalid or excluded path' }, 403);
    }

    const result = await trashEntry({
      workspaceRoot: workspace.workspaceRoot,
      sourceAbs,
    });
    return c.json({ ok: true, ...result });
  } catch (err) {
    return handleFileOpError(c, err);
  }
});

// ── POST /api/files/restore ───────────────────────────────────────────

app.post('/api/files/restore', async (c) => {
  let body: { path?: string; agentId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  if (!body.path || typeof body.path !== 'string') {
    return c.json({ ok: false, error: 'Missing path' }, 400);
  }

  let workspace: ScopedWorkspace;
  try {
    workspace = resolveScopedWorkspace(body.agentId ?? c.req.query('agentId'));
  } catch (err) {
    return handleAgentWorkspaceError(c, err);
  }

  const remoteBlock = await requireLocalWorkspace(c, workspace);
  if (remoteBlock) return remoteBlock;

  const sourceAbs = await resolveWorkspacePathForRoot(workspace.workspaceRoot, body.path);
  if (!sourceAbs) {
    return c.json({ ok: false, error: 'Invalid or excluded path' }, 403);
  }

  try {
    const result = await restoreEntry({
      workspaceRoot: workspace.workspaceRoot,
      sourceAbs,
    });
    return c.json({ ok: true, ...result });
  } catch (err) {
    return handleFileOpError(c, err);
  }
});

// ── GET /api/files/raw ───────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico']);

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

/** Check if a file is a supported image. */
export function isImage(name: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

app.get('/api/files/raw', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) {
    return c.json({ ok: false, error: 'Missing path parameter' }, 400);
  }

  let workspace: ScopedWorkspace;
  try {
    workspace = resolveScopedWorkspace(c.req.query('agentId'));
  } catch (err) {
    return handleAgentWorkspaceError(c, err);
  }

  // Raw/binary endpoints don't support gateway fallback
  if (!(await isWorkspaceLocal(workspace.workspaceRoot))) {
    return c.json({ ok: false, error: 'Binary files not available for remote workspaces', remoteWorkspace: true }, 404);
  }

  const resolved = await resolveWorkspacePathForRoot(workspace.workspaceRoot, filePath);
  if (!resolved) {
    return c.json({ ok: false, error: 'Invalid or excluded path' }, 403);
  }

  const ext = path.extname(resolved).toLowerCase();
  const mime = MIME_TYPES[ext];
  if (!mime) {
    return c.json({ ok: false, error: 'Unsupported file type' }, 415);
  }

  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      return c.json({ ok: false, error: 'Not a file' }, 400);
    }
    // Cap at 10MB for images, 50 MB for PDFs (can adjust as needed)
    const maxSize = ext === '.pdf' ? 52_428_800 : 10_485_760;
    if (stat.size > maxSize) {
      return c.json({ ok: false, error: `File too large (max ${ext === '.pdf' ? '50MB' : '10MB'})` }, 413);
    }

    // Parse Range header for PDFs to support partial content requests
    let start = 0;
    let end = stat.size - 1;
    let statusCode = 200;
    let rangeHeader: string | undefined;

    const rangeHeaderValue = c.req.header('range');
    if (rangeHeaderValue && ext === '.pdf') {
      // Match both explicit ranges (bytes=100-200) and suffix ranges (bytes=-500)
      const rangeMatch = rangeHeaderValue.match(/^bytes=(\d*)-(\d*)$/);
      if (rangeMatch) {
        const hasSuffix = rangeMatch[1] === '';
        let rangeStart: number;
        let rangeEnd: number;
        let isValid = false;

        if (hasSuffix) {
          // Suffix range: bytes=-500 means last 500 bytes
          const suffixLen = parseInt(rangeMatch[2], 10);
          rangeStart = Math.max(0, stat.size - suffixLen);
          rangeEnd = stat.size - 1;
          isValid = suffixLen > 0;
        } else {
          rangeStart = parseInt(rangeMatch[1], 10);
          rangeEnd = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : stat.size - 1;
          isValid = rangeStart >= 0 && rangeStart <= rangeEnd && rangeEnd < stat.size;
        }

        // Validate and apply range
        if (isValid) {
          start = rangeStart;
          end = rangeEnd;
          statusCode = 206;
          rangeHeader = `bytes ${start}-${end}/${stat.size}`;
        } else {
          // Invalid range
          return new Response('', {
            status: 416,
            headers: {
              'Content-Range': `bytes */${stat.size}`,
            },
          });
        }
      }
    }

    // Stream file with optional range support
    const fileStream = fsSync.createReadStream(resolved, { start, end });
    fileStream.on('error', (err) => {
      console.error(`[file-browser] Stream error for ${filePath}:`, err.message);
    });

    // Add error listener to surface stream failures for easier debugging
    fileStream.on('error', (err) => {
      console.error('[file-browser] fileStream error:', {
        path: resolved,
        rangeStart: start,
        rangeEnd: end,
        error: (err as Error).message,
      });
    });
    
    // Convert Node.js stream to Web Stream using Node's built-in conversion
    const webStream = Readable.toWeb(fileStream);
    
    const responseHeaders: Record<string, string> = {
      'Content-Type': mime,
      'Content-Length': String(end - start + 1),
      'Cache-Control': 'no-cache',
    };

    // Add Range headers for partial content responses
    if (ext === '.pdf') {
      responseHeaders['Accept-Ranges'] = 'bytes';
      if (rangeHeader) {
        responseHeaders['Content-Range'] = rangeHeader;
      }
    }

    return new Response(webStream, {
      status: statusCode,
      headers: responseHeaders,
    });
  } catch {
    return c.json({ ok: false, error: 'Failed to read file' }, 500);
  }
});

export default app;
