/**
 * File watcher for workspace files.
 *
 * Watches `MEMORY.md`, the `memory/` directory, and optionally the full
 * workspace directory for changes. Broadcasts SSE events so the UI can react:
 * - `memory.changed` — for backward compat (memory panel refresh)
 * - `file.changed` — for file browser (editor reload / AI lock)
 *
 * Per-source debouncing prevents duplicate events from a single save.
 * @module
 */

import path from 'node:path';
import { watch, type FSWatcher } from 'node:fs';
import { existsSync } from 'node:fs';
import { broadcast } from '../routes/events.js';
import { config } from './config.js';
import { isExcluded, isBinary } from './file-utils.js';

let memoryWatcher: FSWatcher | null = null;
let memoryDirWatcher: FSWatcher | null = null;
let workspaceWatcher: FSWatcher | null = null;

// Per-source debounce to avoid multiple events for single save
// (separate timers so MEMORY.md changes don't suppress daily file changes)
const lastBroadcastBySource = new Map<string, number>();
const DEBOUNCE_MS = 500;

const MAX_SOURCES = 500;

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

/**
 * Start watching workspace files for changes.
 * Call this during server startup.
 */
export function startFileWatcher(): void {
  const workspaceRoot = path.dirname(config.memoryPath);

  // Watch MEMORY.md
  if (existsSync(config.memoryPath)) {
    try {
      memoryWatcher = watch(config.memoryPath, (eventType) => {
        if (eventType === 'change' && shouldBroadcast('MEMORY.md')) {
          console.log('[file-watcher] MEMORY.md changed');
          broadcast('memory.changed', { 
            source: 'file', 
            file: 'MEMORY.md' 
          });
          broadcast('file.changed', { path: 'MEMORY.md' });
        }
      });
      console.log('[file-watcher] Watching MEMORY.md');
    } catch (err) {
      console.error('[file-watcher] Failed to watch MEMORY.md:', (err as Error).message);
    }
  }
  
  // Watch memory/ directory for daily files
  if (existsSync(config.memoryDir)) {
    try {
      memoryDirWatcher = watch(config.memoryDir, (eventType, filename) => {
        if (filename?.endsWith('.md') && shouldBroadcast(`daily:${filename}`)) {
          console.log(`[file-watcher] ${filename} changed`);
          broadcast('memory.changed', { 
            source: 'file', 
            file: filename 
          });
          broadcast('file.changed', { path: `memory/${filename}` });
        }
      });
      console.log('[file-watcher] Watching memory/ directory');
    } catch (err) {
      console.error('[file-watcher] Failed to watch memory/:', (err as Error).message);
    }
  }

  // Watch entire workspace directory only when explicitly enabled.
  // Default is off to avoid inotify watcher exhaustion (ENOSPC) on large Linux workspaces.
  if (config.workspaceWatchRecursive) {
    if (existsSync(workspaceRoot)) {
      try {
        workspaceWatcher = watch(workspaceRoot, { recursive: true }, (_eventType, filename) => {
          if (!filename) return;

          // Normalize path separators (Windows compat)
          const normalized = filename.replace(/\\/g, '/');

          // Skip excluded directories/files and binaries
          const segments = normalized.split('/');
          if (segments.some(seg => seg && (isExcluded(seg) || seg.startsWith('.')))) return;
          if (isBinary(normalized)) return;

          // Skip memory files — already handled by dedicated watchers above
          if (normalized === 'MEMORY.md' || normalized.startsWith('memory/')) return;

          if (shouldBroadcast(`workspace:${normalized}`)) {
            console.log(`[file-watcher] workspace: ${normalized} changed`);
            broadcast('file.changed', { path: normalized });
          }
        });
        console.log('[file-watcher] Watching workspace directory (recursive)');
      } catch (err) {
        // recursive: true may not be supported on all Linux kernels
        console.warn('[file-watcher] Recursive workspace watch failed:', (err as Error).message);
        console.warn('[file-watcher] File browser still works — use manual refresh for non-memory file updates.');
      }
    }
  } else {
    console.log('[file-watcher] Workspace recursive watch disabled (default). Set NERVE_WATCH_WORKSPACE_RECURSIVE=true to re-enable SSE file.changed events outside memory/.');
  }
}

/**
 * Stop watching files.
 * Call this during graceful shutdown.
 */
export function stopFileWatcher(): void {
  if (memoryWatcher) {
    memoryWatcher.close();
    memoryWatcher = null;
  }
  if (memoryDirWatcher) {
    memoryDirWatcher.close();
    memoryDirWatcher = null;
  }
  if (workspaceWatcher) {
    workspaceWatcher.close();
    workspaceWatcher = null;
  }
}
