/**
 * File watcher for workspace files.
 *
 * Watches each known workspace's `MEMORY.md`, `memory/` directory, and
 * optionally the full workspace directory. Broadcasts SSE events so the UI can react:
 * - `memory.changed` — for backward compat (memory panel refresh)
 * - `file.changed` — for file browser (editor reload / AI lock)
 *
 * Per-source debouncing prevents duplicate events from a single save.
 * @module
 */

import path from 'node:path';
import { existsSync, readdirSync, watch, type FSWatcher } from 'node:fs';
import { broadcast } from '../routes/events.js';
import { config } from './config.js';
import { resolveAgentWorkspace, type AgentWorkspace } from './agent-workspace.js';
import { isBinary, isExcluded } from './file-utils.js';

let rootDirWatcher: FSWatcher | null = null;
const memoryWatchers = new Map<string, FSWatcher>();
const memoryDirWatchers = new Map<string, FSWatcher>();
const workspaceWatchers = new Map<string, FSWatcher>();

// Per-source debounce to avoid multiple events for single save
// (separate timers so MEMORY.md changes don't suppress daily file changes)
const lastBroadcastBySource = new Map<string, number>();
const DEBOUNCE_MS = 500;
const MAX_SOURCES = 500;
const WORKSPACE_PREFIX = 'workspace-';

function shouldBroadcast(source: string): boolean {
  const now = Date.now();
  const last = lastBroadcastBySource.get(source) ?? 0;
  if (now - last < DEBOUNCE_MS) {
    return false;
  }
  if (lastBroadcastBySource.size >= MAX_SOURCES) {
    lastBroadcastBySource.clear();
  }
  lastBroadcastBySource.set(source, now);
  return true;
}

function getWatchFilename(filename: string | Buffer | null): string | null {
  if (typeof filename === 'string') return filename;
  if (filename) return filename.toString();
  return null;
}

function getScopedSourceKey(agentId: string, source: string): string {
  return `${agentId}:${source}`;
}

function broadcastWorkspaceFileChanged(agentId: string, filePath: string): void {
  broadcast('file.changed', {
    path: filePath,
    agentId,
  });
}

function broadcastWorkspaceMemoryChanged(agentId: string, file: string): void {
  broadcast('memory.changed', {
    source: 'file',
    file,
    agentId,
  });
}

function discoverWorkspaces(): AgentWorkspace[] {
  const workspaces = new Map<string, AgentWorkspace>();
  const mainWorkspace = resolveAgentWorkspace('main');
  workspaces.set(mainWorkspace.agentId, mainWorkspace);

  const openclawDir = path.join(config.home, '.openclaw');
  if (!existsSync(openclawDir)) {
    return [...workspaces.values()];
  }

  for (const entry of readdirSync(openclawDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(WORKSPACE_PREFIX)) continue;

    const rawAgentId = entry.name.slice(WORKSPACE_PREFIX.length);
    if (!rawAgentId) continue;

    try {
      const workspace = resolveAgentWorkspace(rawAgentId);
      workspaces.set(workspace.agentId, workspace);
    } catch {
      // Ignore directories that are not valid agent workspaces.
    }
  }

  return [...workspaces.values()];
}

function closeWatchers(watchers: Map<string, FSWatcher>, agentIds?: Set<string>): void {
  for (const [agentId, watcher] of watchers.entries()) {
    if (agentIds && agentIds.has(agentId)) continue;
    watcher.close();
    watchers.delete(agentId);
  }
}

function watchWorkspaceMemoryFile(workspace: AgentWorkspace): void {
  if (memoryWatchers.has(workspace.agentId) || !existsSync(workspace.memoryPath)) return;

  try {
    const watcher = watch(workspace.memoryPath, (eventType) => {
      if (eventType !== 'change') return;
      if (!shouldBroadcast(getScopedSourceKey(workspace.agentId, 'MEMORY.md'))) return;

      console.log(`[file-watcher] ${workspace.agentId}: MEMORY.md changed`);
      broadcastWorkspaceMemoryChanged(workspace.agentId, 'MEMORY.md');
      broadcastWorkspaceFileChanged(workspace.agentId, 'MEMORY.md');
    });

    memoryWatchers.set(workspace.agentId, watcher);
    console.log(`[file-watcher] Watching ${workspace.agentId}: MEMORY.md`);
  } catch (err) {
    console.error(`[file-watcher] Failed to watch ${workspace.agentId}: MEMORY.md:`, (err as Error).message);
  }
}

function watchWorkspaceMemoryDir(workspace: AgentWorkspace): void {
  if (memoryDirWatchers.has(workspace.agentId) || !existsSync(workspace.memoryDir)) return;

  try {
    const watcher = watch(workspace.memoryDir, (_eventType, filename) => {
      const file = getWatchFilename(filename);
      if (!file?.endsWith('.md')) return;
      if (!shouldBroadcast(getScopedSourceKey(workspace.agentId, `daily:${file}`))) return;

      console.log(`[file-watcher] ${workspace.agentId}: ${file} changed`);
      broadcastWorkspaceMemoryChanged(workspace.agentId, file);
      broadcastWorkspaceFileChanged(workspace.agentId, `memory/${file}`);
    });

    memoryDirWatchers.set(workspace.agentId, watcher);
    console.log(`[file-watcher] Watching ${workspace.agentId}: memory/ directory`);
  } catch (err) {
    console.error(`[file-watcher] Failed to watch ${workspace.agentId}: memory/:`, (err as Error).message);
  }
}

function watchWorkspaceTree(workspace: AgentWorkspace): void {
  if (!config.workspaceWatchRecursive) return;
  if (workspaceWatchers.has(workspace.agentId) || !existsSync(workspace.workspaceRoot)) return;

  try {
    const watcher = watch(workspace.workspaceRoot, { recursive: true }, (_eventType, filename) => {
      const file = getWatchFilename(filename);
      if (!file) return;

      const normalized = file.replace(/\\/g, '/');
      const segments = normalized.split('/');
      if (segments.some(seg => seg && (isExcluded(seg) || seg.startsWith('.')))) return;
      if (isBinary(normalized)) return;

      if (normalized === 'MEMORY.md' || normalized.startsWith('memory/')) return;
      if (!shouldBroadcast(getScopedSourceKey(workspace.agentId, `workspace:${normalized}`))) return;

      console.log(`[file-watcher] ${workspace.agentId}: workspace ${normalized} changed`);
      broadcastWorkspaceFileChanged(workspace.agentId, normalized);
    });

    workspaceWatchers.set(workspace.agentId, watcher);
    console.log(`[file-watcher] Watching ${workspace.agentId}: workspace directory (recursive)`);
  } catch (err) {
    console.warn(`[file-watcher] Recursive workspace watch failed for ${workspace.agentId}:`, (err as Error).message);
    console.warn('[file-watcher] File browser still works, use manual refresh for non-memory file updates.');
  }
}

function refreshWorkspaceWatchers(): void {
  const workspaces = discoverWorkspaces();
  const activeAgentIds = new Set(workspaces.map((workspace) => workspace.agentId));

  closeWatchers(memoryWatchers, activeAgentIds);
  closeWatchers(memoryDirWatchers, activeAgentIds);
  closeWatchers(workspaceWatchers, activeAgentIds);

  for (const workspace of workspaces) {
    watchWorkspaceMemoryFile(workspace);
    watchWorkspaceMemoryDir(workspace);
    watchWorkspaceTree(workspace);
  }
}

function startRootWorkspaceWatcher(): void {
  const openclawDir = path.join(config.home, '.openclaw');
  if (rootDirWatcher || !existsSync(openclawDir)) return;

  try {
    rootDirWatcher = watch(openclawDir, (_eventType, filename) => {
      const file = getWatchFilename(filename);
      if (!file) return;
      if (file === 'workspace' || file.startsWith(WORKSPACE_PREFIX)) {
        refreshWorkspaceWatchers();
      }
    });
  } catch (err) {
    console.warn('[file-watcher] Failed to watch workspace root for new agent workspaces:', (err as Error).message);
  }
}

/**
 * Start watching workspace files for changes.
 * Call this during server startup.
 */
export function startFileWatcher(): void {
  stopFileWatcher();
  refreshWorkspaceWatchers();
  startRootWorkspaceWatcher();

  if (!config.workspaceWatchRecursive) {
    console.log('[file-watcher] Workspace recursive watch disabled (default). Set NERVE_WATCH_WORKSPACE_RECURSIVE=true to re-enable SSE file.changed events outside memory/.');
  }
}

/**
 * Stop watching files.
 * Call this during graceful shutdown.
 */
export function stopFileWatcher(): void {
  rootDirWatcher?.close();
  rootDirWatcher = null;
  closeWatchers(memoryWatchers);
  closeWatchers(memoryDirWatchers);
  closeWatchers(workspaceWatchers);
}
