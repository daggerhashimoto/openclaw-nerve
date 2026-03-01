import { useState, useCallback, useEffect, useRef } from 'react';
import { useInstancesOptional } from '@/contexts/InstanceContext';
import type { TreeEntry } from '../types';

interface FileTreeDebugState {
  instanceId: string | null;
  lastPath: string;
  status: number | null;
  ok: boolean;
  error: string | null;
  at: number;
}

const STORAGE_KEY_PREFIX = 'nerve-file-tree-expanded';

function storageKeyForInstance(instanceId: string | null): string {
  return `${STORAGE_KEY_PREFIX}:${instanceId || 'master'}`;
}

function loadExpandedPaths(instanceId: string | null): Set<string> {
  try {
    const stored = localStorage.getItem(storageKeyForInstance(instanceId));
    if (stored) return new Set(JSON.parse(stored));
  } catch { /* ignore */ }
  return new Set<string>();
}

function saveExpandedPaths(instanceId: string | null, paths: Set<string>) {
  try {
    localStorage.setItem(storageKeyForInstance(instanceId), JSON.stringify([...paths]));
  } catch { /* ignore */ }
}

/** Merge freshly loaded children into the tree (immutable update). */
function mergeChildren(
  entries: TreeEntry[],
  parentPath: string,
  children: TreeEntry[],
): TreeEntry[] {
  return entries.map((entry) => {
    if (entry.path === parentPath && entry.type === 'directory') {
      return { ...entry, children };
    }
    if (entry.children && entry.type === 'directory') {
      return { ...entry, children: mergeChildren(entry.children, parentPath, children) };
    }
    return entry;
  });
}

/** Hook for managing file tree state with workspace info and persistence. */
export function useFileTree() {
  const instances = useInstancesOptional();
  const activeInstanceId = instances?.activeInstanceId ?? null;
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => loadExpandedPaths(activeInstanceId));
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [workspaceInfo, setWorkspaceInfo] = useState<{ isCustomWorkspace: boolean; rootPath: string } | null>(null);
  const [debug, setDebug] = useState<FileTreeDebugState>({
    instanceId: activeInstanceId,
    lastPath: '',
    status: null,
    ok: true,
    error: null,
    at: Date.now(),
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Persist expanded paths per instance
  useEffect(() => {
    saveExpandedPaths(activeInstanceId, expandedPaths);
  }, [activeInstanceId, expandedPaths]);

  // Fetch a directory's children
  const fetchChildren = useCallback(async (dirPath: string): Promise<TreeEntry[] | null> => {
    try {
      const params = dirPath ? `?path=${encodeURIComponent(dirPath)}&depth=1` : '?depth=1';
      const requestPath = `/api/files/tree${params}`;
      const res = await fetch(requestPath);
      if (!res.ok) {
        setDebug({
          instanceId: activeInstanceId,
          lastPath: requestPath,
          status: res.status,
          ok: false,
          error: `HTTP ${res.status}`,
          at: Date.now(),
        });
        return null;
      }
      const data = await res.json();
      const ok = Boolean(data?.ok);
      if (ok && data.workspaceInfo) {
        setWorkspaceInfo(data.workspaceInfo);
      }
      setDebug({
        instanceId: activeInstanceId,
        lastPath: requestPath,
        status: res.status,
        ok,
        error: ok ? null : String(data?.error || 'Unknown error'),
        at: Date.now(),
      });
      return ok ? data.entries : null;
    } catch (err) {
      setDebug({
        instanceId: activeInstanceId,
        lastPath: dirPath || '/',
        status: null,
        ok: false,
        error: err instanceof Error ? err.message : 'Fetch failed',
        at: Date.now(),
      });
      return null;
    }
  }, [activeInstanceId]);

  // Initial load
  const loadRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    let children = await fetchChildren('');
    if (!children) {
      // Instance switch can race with transport reconnect; retry once quickly.
      await new Promise((resolve) => setTimeout(resolve, 200));
      children = await fetchChildren('');
    }
    if (!mountedRef.current) return;

    if (children) {
      setEntries(children);

      // Re-expand previously expanded directories
      const expanded = loadExpandedPaths(activeInstanceId);
      if (expanded.size > 0) {
        // Fetch children for each expanded path (in parallel)
        const promises = [...expanded].map(async (p) => {
          const ch = await fetchChildren(p);
          return ch ? { path: p, children: ch } : null;
        });
        const results = await Promise.all(promises);
        if (!mountedRef.current) return;

        let tree = children;
        for (const r of results) {
          if (r) tree = mergeChildren(tree, r.path, r.children);
        }
        setEntries(tree);
      }
    } else {
      setError('Failed to load file tree');
    }
    setLoading(false);
  }, [fetchChildren, activeInstanceId]);

  // Reload file tree whenever instance context changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on instance switch
  useEffect(() => {
    setExpandedPaths(loadExpandedPaths(activeInstanceId));
    setEntries([]);
    setSelectedPath(null);
    setError(null);
    setLoading(true);
    void loadRoot();
  }, [loadRoot, activeInstanceId]);

  const toggleDirectory = useCallback(async (dirPath: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
        return next;
      }
      next.add(dirPath);
      return next;
    });

    // If collapsing or children already loaded, just toggle
    if (expandedPaths.has(dirPath)) return;

    // Check if children are already loaded in the tree
    const findEntry = (es: TreeEntry[], target: string): TreeEntry | null => {
      for (const e of es) {
        if (e.path === target) return e;
        if (e.children) {
          const found = findEntry(e.children, target);
          if (found) return found;
        }
      }
      return null;
    };
    const entry = findEntry(entries, dirPath);
    if (entry?.children !== null && entry?.children !== undefined) return;

    // Fetch children
    setLoadingPaths((prev) => new Set([...prev, dirPath]));
    const children = await fetchChildren(dirPath);
    if (!mountedRef.current) return;
    setLoadingPaths((prev) => {
      const next = new Set(prev);
      next.delete(dirPath);
      return next;
    });

    if (children) {
      setEntries((prev) => mergeChildren(prev, dirPath, children));
    }
  }, [expandedPaths, entries, fetchChildren]);

  const selectFile = useCallback((filePath: string) => {
    setSelectedPath(filePath);
  }, []);

  const refresh = useCallback(() => {
    // Clear cached children so everything re-fetches
    setEntries([]);
    loadRoot();
  }, [loadRoot]);

  /** Refresh a specific directory (or root) when a file changes externally. */
  const refreshDirectory = useCallback(async (dirPath: string) => {
    const children = await fetchChildren(dirPath);
    if (!mountedRef.current || !children) return;

    if (!dirPath) {
      // Root — just replace top-level entries (preserve expanded subdirs)
      setEntries((prev) => {
        // Keep expanded children from prev, merge with fresh top-level
        return children.map(fresh => {
          const existing = prev.find(e => e.path === fresh.path);
          if (existing?.children && fresh.type === 'directory') {
            return { ...fresh, children: existing.children };
          }
          return fresh;
        });
      });
    } else {
      setEntries((prev) => mergeChildren(prev, dirPath, children));
    }
  }, [fetchChildren]);

  /**
   * Handle an external file change event.
   * Refreshes the parent directory of the changed file so the tree
   * picks up new/deleted files.
   */
  const handleFileChange = useCallback((changedPath: string) => {
    const parentDir = changedPath.includes('/')
      ? changedPath.substring(0, changedPath.lastIndexOf('/'))
      : '';
    // Only refresh if the parent is expanded (or is root)
    if (!parentDir || expandedPaths.has(parentDir)) {
      refreshDirectory(parentDir);
    }
  }, [expandedPaths, refreshDirectory]);

  return {
    entries,
    loading,
    error,
    expandedPaths,
    selectedPath,
    loadingPaths,
    workspaceInfo,
    debug,
    toggleDirectory,
    selectFile,
    refresh,
    handleFileChange,
  };
}
