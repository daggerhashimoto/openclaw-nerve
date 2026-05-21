import { useState, useCallback, useEffect, useRef } from 'react';
import { getWorkspaceStorageKey } from '@/features/workspace/workspaceScope';
import type { TreeEntry } from '../types';

const DEFAULT_AGENT_ID = 'main';
const MAX_RESTORED_EXPANDED_PATHS = 64;
const RESTORE_EXPANSION_CONCURRENCY = 4;

function normalizeAgentId(agentId?: string): string {
  return agentId?.trim() || DEFAULT_AGENT_ID;
}

function getExpandedStorageKey(agentId: string): string {
  return getWorkspaceStorageKey('file-tree-expanded', normalizeAgentId(agentId));
}

function getSelectedStorageKey(agentId: string): string {
  return getWorkspaceStorageKey('file-tree-selected', normalizeAgentId(agentId));
}

/** Load expanded paths from localStorage for persistence. */
function loadExpandedPaths(agentId: string): Set<string> {
  try {
    const stored = localStorage.getItem(getExpandedStorageKey(agentId));
    if (stored) return new Set(JSON.parse(stored));
  } catch {
    // ignore storage errors
  }
  return new Set<string>();
}

/** Save expanded paths to localStorage for persistence. */
function saveExpandedPaths(agentId: string, paths: Set<string>) {
  try {
    localStorage.setItem(getExpandedStorageKey(agentId), JSON.stringify([...paths]));
  } catch {
    // ignore storage errors
  }
}

function loadSelectedPath(agentId: string): string | null {
  try {
    return localStorage.getItem(getSelectedStorageKey(agentId));
  } catch {
    return null;
  }
}

function saveSelectedPath(agentId: string, path: string | null) {
  try {
    const storageKey = getSelectedStorageKey(agentId);
    if (path) {
      localStorage.setItem(storageKey, path);
      return;
    }
    localStorage.removeItem(storageKey);
  } catch {
    // ignore storage errors
  }
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

/** Clear cached children for a directory entry and reset to unloaded state */
function clearEntryFromTree(entries: TreeEntry[], targetPath: string): TreeEntry[] {
  return entries.map((entry) => {
    if (entry.path === targetPath && entry.type === 'directory') {
      return { ...entry, children: null };
    }
    if (entry.children && entry.type === 'directory') {
      return { ...entry, children: clearEntryFromTree(entry.children, targetPath) };
    }
    return entry;
  });
}

function buildTreeUrl(dirPath: string, agentId: string, showHiddenEntries: boolean): string {
  const params = new URLSearchParams({ depth: '1', agentId });
  if (showHiddenEntries) params.set('showHidden', 'true');
  if (dirPath) params.set('path', dirPath);
  return `/api/files/tree?${params.toString()}`;
}

function pathDepth(path: string): number {
  return path.split('/').filter(Boolean).length;
}

function orderedExpansionPaths(paths: Set<string>): string[] {
  return [...paths]
    .map((path, index) => ({ path, index }))
    .sort((a, b) => {
      const depthDiff = pathDepth(a.path) - pathDepth(b.path);
      return depthDiff || a.index - b.index;
    })
    .map((entry) => entry.path);
}

function limitRestoredExpandedPaths(paths: Set<string>): Set<string> {
  if (paths.size <= MAX_RESTORED_EXPANDED_PATHS) return paths;
  return new Set(orderedExpansionPaths(paths).slice(0, MAX_RESTORED_EXPANDED_PATHS));
}

function indexEntries(entries: TreeEntry[]): Map<string, TreeEntry> {
  const index = new Map<string, TreeEntry>();
  const stack = [...entries];

  while (stack.length > 0) {
    const entry = stack.pop()!;
    index.set(entry.path, entry);
    if (entry.type === 'directory' && entry.children) {
      stack.push(...entry.children);
    }
  }

  return index;
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

/** Hook for managing file tree state with workspace info and persistence. */
export function useFileTree(agentId = DEFAULT_AGENT_ID, showHiddenEntries = false) {
  const scopedAgentId = normalizeAgentId(agentId);
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const entriesRef = useRef<TreeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => loadExpandedPaths(scopedAgentId));
  const [selectedPath, setSelectedPathState] = useState<string | null>(() => loadSelectedPath(scopedAgentId));
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [workspaceInfo, setWorkspaceInfo] = useState<{ isCustomWorkspace: boolean; rootPath: string } | null>(null);
  const entryIndexRef = useRef<Map<string, TreeEntry>>(new Map());
  const mountedRef = useRef(true);
  const agentIdRef = useRef(scopedAgentId);
  const stateOwnerAgentRef = useRef(scopedAgentId);
  const requestVersionRef = useRef(0);
  agentIdRef.current = scopedAgentId;

  const ownsVisibleState = stateOwnerAgentRef.current === scopedAgentId;
  const visibleEntries = ownsVisibleState ? entries : [];
  const visibleExpandedPaths = ownsVisibleState
    ? expandedPaths
    : limitRestoredExpandedPaths(loadExpandedPaths(scopedAgentId));
  const visibleSelectedPath = ownsVisibleState ? selectedPath : loadSelectedPath(scopedAgentId);
  const visibleLoadingPaths = ownsVisibleState ? loadingPaths : new Set<string>();
  const visibleWorkspaceInfo = ownsVisibleState ? workspaceInfo : null;
  const visibleLoading = ownsVisibleState ? loading : true;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    entriesRef.current = entries;
    entryIndexRef.current = indexEntries(entries);
  }, [entries]);

  // Persist expanded paths
  useEffect(() => {
    if (stateOwnerAgentRef.current !== scopedAgentId) return;
    saveExpandedPaths(scopedAgentId, expandedPaths);
  }, [expandedPaths, scopedAgentId]);

  // Persist selected path
  useEffect(() => {
    if (stateOwnerAgentRef.current !== scopedAgentId) return;
    saveSelectedPath(scopedAgentId, selectedPath);
  }, [scopedAgentId, selectedPath]);

  // Fetch a directory's children
  const fetchChildren = useCallback(async (
    dirPath: string,
    requestAgentId = agentIdRef.current,
  ): Promise<TreeEntry[] | null> => {
    try {
      const res = await fetch(buildTreeUrl(dirPath, requestAgentId, showHiddenEntries));
      if (!res.ok) {
        if (dirPath && (res.status === 400 || res.status === 404) && agentIdRef.current === requestAgentId) {
          setExpandedPaths((prev) => {
            const next = new Set(prev);
            for (const path of next) {
              if (path === dirPath || path.startsWith(`${dirPath}/`)) {
                next.delete(path);
              }
            }
            return next;
          });

          setEntries((prev) => {
            const next = clearEntryFromTree(prev, dirPath);
            entriesRef.current = next;
            entryIndexRef.current = indexEntries(next);
            return next;
          });
        }
        return null;
      }

      const data = await res.json();
      if (data.ok && data.workspaceInfo && mountedRef.current && agentIdRef.current === requestAgentId) {
        setWorkspaceInfo(data.workspaceInfo);
      }
      return data.ok ? data.entries : null;
    } catch {
      return null;
    }
  }, [showHiddenEntries]);

  // Initial load and agent changes
  const loadRoot = useCallback(async (targetAgentId = scopedAgentId) => {
    const requestAgentId = normalizeAgentId(targetAgentId);
    if (agentIdRef.current !== requestAgentId) return;

    const requestVersion = ++requestVersionRef.current;
    const persistedExpandedPaths = limitRestoredExpandedPaths(loadExpandedPaths(requestAgentId));
    const persistedSelectedPath = loadSelectedPath(requestAgentId);

    stateOwnerAgentRef.current = requestAgentId;
    setLoading(true);
    setError(null);
    entriesRef.current = [];
    entryIndexRef.current = new Map();
    setEntries([]);
    setLoadingPaths(new Set());
    setWorkspaceInfo(null);
    setExpandedPaths(persistedExpandedPaths);
    setSelectedPathState(persistedSelectedPath);

    const children = await fetchChildren('', requestAgentId);
    if (!mountedRef.current || requestVersionRef.current !== requestVersion || agentIdRef.current !== requestAgentId) return;

    if (children) {
      let tree = children;

      if (persistedExpandedPaths.size > 0) {
        const hydrationPaths = orderedExpansionPaths(persistedExpandedPaths);
        const results = await mapWithConcurrency(hydrationPaths, RESTORE_EXPANSION_CONCURRENCY, async (path) => {
          const dirChildren = await fetchChildren(path, requestAgentId);
          return dirChildren ? { path, children: dirChildren } : null;
        });
        if (!mountedRef.current || requestVersionRef.current !== requestVersion || agentIdRef.current !== requestAgentId) return;

        for (const result of results) {
          if (result) {
            tree = mergeChildren(tree, result.path, result.children);
          }
        }
      }

      entriesRef.current = tree;
      entryIndexRef.current = indexEntries(tree);
      setEntries(tree);
    } else {
      setError('Failed to load file tree');
    }

    setLoading(false);
  }, [fetchChildren, scopedAgentId]);

  useEffect(() => {
    void loadRoot();
  }, [loadRoot]);

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

    if (expandedPaths.has(dirPath)) return;

    const entry = entryIndexRef.current.get(dirPath);
    if (entry?.children !== null && entry?.children !== undefined) return;

    const requestAgentId = agentIdRef.current;
    setLoadingPaths((prev) => new Set([...prev, dirPath]));
    const children = await fetchChildren(dirPath, requestAgentId);
    if (!mountedRef.current || agentIdRef.current !== requestAgentId) return;

    setLoadingPaths((prev) => {
      const next = new Set(prev);
      next.delete(dirPath);
      return next;
    });

    if (children) {
      setEntries((prev) => {
        const next = mergeChildren(prev, dirPath, children);
        entriesRef.current = next;
        entryIndexRef.current = indexEntries(next);
        return next;
      });
    }
  }, [expandedPaths, fetchChildren]);

  const selectFile = useCallback((filePath: string, targetAgentId = scopedAgentId) => {
    const requestAgentId = normalizeAgentId(targetAgentId);
    if (agentIdRef.current !== requestAgentId) {
      saveSelectedPath(requestAgentId, filePath);
      return;
    }

    setSelectedPathState(filePath);
  }, [scopedAgentId]);

  const refresh = useCallback((targetAgentId = scopedAgentId) => {
    void loadRoot(targetAgentId);
  }, [loadRoot, scopedAgentId]);

  /** Refresh a specific directory (or root) when a file changes externally. */
  const refreshDirectory = useCallback(async (dirPath: string) => {
    const requestAgentId = agentIdRef.current;
    const children = await fetchChildren(dirPath, requestAgentId);
    if (!mountedRef.current || !children || agentIdRef.current !== requestAgentId) return;

    if (!dirPath) {
      setEntries((prev) => {
        const next = children.map((fresh) => {
          const existing = prev.find((entry) => entry.path === fresh.path);
          if (existing?.children && fresh.type === 'directory') {
            return { ...fresh, children: existing.children };
          }
          return fresh;
        });
        entriesRef.current = next;
        entryIndexRef.current = indexEntries(next);
        return next;
      });
      return;
    }

    setEntries((prev) => {
      const next = mergeChildren(prev, dirPath, children);
      entriesRef.current = next;
      entryIndexRef.current = indexEntries(next);
      return next;
    });
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
    if (!parentDir || expandedPaths.has(parentDir)) {
      void refreshDirectory(parentDir);
    }
  }, [expandedPaths, refreshDirectory]);

  const ensureDirectoryLoaded = useCallback(async (dirPath: string, requestAgentId = agentIdRef.current) => {
    const entry = entryIndexRef.current.get(dirPath);
    if (entry?.type !== 'directory') return;
    if (entry.children !== null && entry.children !== undefined) return;

    setLoadingPaths((prev) => new Set([...prev, dirPath]));
    const children = await fetchChildren(dirPath, requestAgentId);
    if (!mountedRef.current || agentIdRef.current !== requestAgentId) return;

    setLoadingPaths((prev) => {
      const next = new Set(prev);
      next.delete(dirPath);
      return next;
    });

    if (children) {
      setEntries((prev) => {
        const next = mergeChildren(prev, dirPath, children);
        entriesRef.current = next;
        entryIndexRef.current = indexEntries(next);
        return next;
      });
    }
  }, [fetchChildren]);

  const revealPath = useCallback(async (
    targetPath: string,
    kind: 'file' | 'directory',
    targetAgentId = scopedAgentId,
  ) => {
    const requestAgentId = normalizeAgentId(targetAgentId);
    if (agentIdRef.current !== requestAgentId) {
      if (kind === 'file') {
        saveSelectedPath(requestAgentId, targetPath);
      }
      return;
    }

    const normalized = targetPath.replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
    if (!normalized) return;

    const segments = normalized.split('/').filter(Boolean);
    const ancestors = kind === 'directory'
      ? segments.map((_, index) => segments.slice(0, index + 1).join('/'))
      : segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));

    for (const dirPath of ancestors) {
      setExpandedPaths((prev) => {
        if (prev.has(dirPath)) return prev;
        const next = new Set(prev);
        next.add(dirPath);
        return next;
      });
      await ensureDirectoryLoaded(dirPath, requestAgentId);
    }

    if (kind === 'file') {
      setSelectedPathState(normalized);
    }
  }, [ensureDirectoryLoaded, scopedAgentId]);

  return {
    entries: visibleEntries,
    loading: visibleLoading,
    error,
    expandedPaths: visibleExpandedPaths,
    selectedPath: visibleSelectedPath,
    loadingPaths: visibleLoadingPaths,
    workspaceInfo: visibleWorkspaceInfo,
    toggleDirectory,
    selectFile,
    refresh,
    handleFileChange,
    revealPath,
  };
}
