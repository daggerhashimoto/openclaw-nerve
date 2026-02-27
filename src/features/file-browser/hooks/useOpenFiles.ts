import { useState, useCallback, useRef, useEffect } from 'react';
import { isImageFile } from '../utils/fileTypes';
import type { OpenFile } from '../types';

const STORAGE_KEY_FILES = 'nerve-open-files';
const STORAGE_KEY_TAB = 'nerve-active-tab';
const MAX_OPEN_TABS = 20;

function loadPersistedFiles(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_FILES);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function loadPersistedTab(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_TAB) || 'chat';
  } catch { return 'chat'; }
}

function persistFiles(files: OpenFile[]) {
  try {
    localStorage.setItem(STORAGE_KEY_FILES, JSON.stringify(files.map(f => f.path)));
  } catch { /* ignore */ }
}

function persistTab(tab: string) {
  try {
    localStorage.setItem(STORAGE_KEY_TAB, tab);
  } catch { /* ignore */ }
}

function basename(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

function matchesPathPrefix(candidatePath: string, prefix: string): boolean {
  return candidatePath === prefix || candidatePath.startsWith(`${prefix}/`);
}

function remapPathPrefix(candidatePath: string, fromPrefix: string, toPrefix: string): string {
  if (candidatePath === fromPrefix) return toPrefix;
  if (!candidatePath.startsWith(`${fromPrefix}/`)) return candidatePath;
  return `${toPrefix}${candidatePath.slice(fromPrefix.length)}`;
}

export function useOpenFiles() {
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeTab, setActiveTabState] = useState<string>(loadPersistedTab);
  const initializedRef = useRef(false);

  // Track mtimes from our own saves so we can ignore the SSE bounce-back
  const recentSaveMtimes = useRef<Map<string, number>>(new Map());
  /** Paths currently being saved — blocks lock overlay during the save round-trip */
  const savingPaths = useRef<Set<string>>(new Set());

  // Restore previously open files on first render
  const initializeFiles = useCallback(async () => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const paths = loadPersistedFiles();
    if (paths.length === 0) return;

    const files: OpenFile[] = [];
    for (const p of paths) {
      try {
        const res = await fetch(`/api/files/read?path=${encodeURIComponent(p)}`);
        if (!res.ok) continue;
        const data = await res.json();
        if (!data.ok) continue;
        files.push({
          path: p,
          name: basename(p),
          content: data.content,
          savedContent: data.content,
          dirty: false,
          locked: false,
          mtime: data.mtime,
          loading: false,
        });
      } catch {
        // Skip files that can't be loaded
      }
    }

    if (files.length > 0) {
      setOpenFiles(files);
    }
  }, []);

  const setActiveTab = useCallback((tab: string) => {
    setActiveTabState(tab);
    persistTab(tab);
  }, []);

  const openFile = useCallback(async (filePath: string) => {
    // If already open, just switch tab
    setOpenFiles((prev) => {
      const existing = prev.find(f => f.path === filePath);
      if (existing) return prev;

      // Enforce tab limit — close oldest non-dirty tab to make room
      let base = prev;
      if (base.length >= MAX_OPEN_TABS) {
        const oldest = base.find(f => !f.dirty);
        if (oldest) {
          base = base.filter(f => f.path !== oldest.path);
        } else {
          // All dirty — close oldest anyway
          base = base.slice(1);
        }
      }

      // Add placeholder while loading
      const newFile: OpenFile = {
        path: filePath,
        name: basename(filePath),
        content: '',
        savedContent: '',
        dirty: false,
        locked: false,
        mtime: 0,
        loading: true,
      };
      const next = [...base, newFile];
      persistFiles(next);
      return next;
    });

    setActiveTab(filePath);

    // Images don't need content — just mark as loaded
    if (isImageFile(basename(filePath))) {
      setOpenFiles((prev) =>
        prev.map((f) =>
          f.path === filePath ? { ...f, loading: false } : f,
        ),
      );
      return;
    }

    // Fetch content for text files
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();

      setOpenFiles((prev) =>
        prev.map((f) => {
          if (f.path !== filePath) return f;
          if (!data.ok) {
            return { ...f, loading: false, error: data.error || 'Failed to load' };
          }
          return {
            ...f,
            content: data.content,
            savedContent: data.content,
            mtime: data.mtime,
            loading: false,
            error: undefined,
          };
        }),
      );
    } catch {
      setOpenFiles((prev) =>
        prev.map((f) =>
          f.path === filePath
            ? { ...f, loading: false, error: 'Network error' }
            : f,
        ),
      );
    }
  }, [setActiveTab]);

  const closeFile = useCallback((filePath: string) => {
    setOpenFiles((prev) => {
      const next = prev.filter(f => f.path !== filePath);
      persistFiles(next);
      return next;
    });

    // If closing the active tab, switch to chat or previous tab
    setActiveTabState((currentTab) => {
      if (currentTab !== filePath) return currentTab;
      const tab = 'chat';
      persistTab(tab);
      return tab;
    });
  }, []);

  const updateContent = useCallback((filePath: string, content: string) => {
    setOpenFiles((prev) =>
      prev.map((f) => {
        if (f.path !== filePath) return f;
        return { ...f, content, dirty: content !== f.savedContent };
      }),
    );
  }, []);

  // Ref to always have current openFiles for saveFile (avoids stale closure)
  const openFilesRef = useRef(openFiles);
  useEffect(() => { openFilesRef.current = openFiles; });

  const saveFile = useCallback(async (filePath: string): Promise<{ ok: boolean; conflict?: boolean }> => {
    const file = openFilesRef.current.find(f => f.path === filePath);
    if (!file) return { ok: false };

    try {
      // Mark as saving BEFORE the request — prevents the SSE bounce-back
      // from triggering the lock overlay while we wait for the response
      savingPaths.current.add(filePath);

      const res = await fetch('/api/files/write', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: filePath,
          content: file.content,
          expectedMtime: file.mtime,
        }),
      });
      const data = await res.json();

      if (data.ok) {
        // Track this mtime so we ignore the SSE bounce-back from our own save
        recentSaveMtimes.current.set(filePath, data.mtime);
        setTimeout(() => recentSaveMtimes.current.delete(filePath), 2000);

        setOpenFiles((prev) =>
          prev.map((f) =>
            f.path === filePath
              ? { ...f, savedContent: f.content, dirty: false, mtime: data.mtime }
              : f,
          ),
        );
        savingPaths.current.delete(filePath);
        return { ok: true };
      }

      // 409 Conflict — file was modified externally
      if (res.status === 409) {
        return { ok: false, conflict: true };
      }

      savingPaths.current.delete(filePath);
      return { ok: false };
    } catch {
      savingPaths.current.delete(filePath);
      return { ok: false };
    }
  }, []);

  const reloadFile = useCallback(async (filePath: string) => {
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();

      if (!data.ok) {
        // File was deleted or became inaccessible
        if (res.status === 404) {
          setOpenFiles((prev) =>
            prev.map((f) =>
              f.path === filePath
                ? { ...f, error: 'File was deleted', locked: false, loading: false }
                : f,
            ),
          );
        }
        return;
      }

      setOpenFiles((prev) =>
        prev.map((f) =>
          f.path === filePath
            ? {
                ...f,
                content: data.content,
                savedContent: data.content,
                dirty: false,
                // Preserve locked state — handleFileChanged manages lock lifecycle
                mtime: data.mtime,
                error: undefined,
              }
            : f,
        ),
      );
    } catch { /* ignore */ }
  }, []);

  /**
   * Handle an external file change event (from SSE `file.changed`).
   *
   * - If this was our own save → ignore (bounce-back dedup).
   * - If the file is open → lock it and reload content from disk.
   * - Lock clears automatically after a short delay (debounce rapid edits).
   */
  const unlockTimers = useRef<Map<string, number>>(new Map());

  // Clean up pending unlock timers on unmount
  useEffect(() => {
    const timers = unlockTimers.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const handleFileChanged = useCallback((changedPath: string) => {
    // Ignore bounce-back from our own saves
    if (recentSaveMtimes.current.has(changedPath)) return;
    if (savingPaths.current.has(changedPath)) return;

    // Check if file is open (use ref to avoid stale closure)
    const isOpen = openFilesRef.current.some(f => f.path === changedPath);
    if (!isOpen) return;

    // Lock the file immediately
    setOpenFiles((prev) =>
      prev.map(f =>
        f.path === changedPath ? { ...f, locked: true } : f,
      ),
    );

    // Reload content from disk
    reloadFile(changedPath).then(() => {
      // Clear any existing unlock timer (debounce rapid sequential edits)
      const existing = unlockTimers.current.get(changedPath);
      if (existing) clearTimeout(existing);

      // Unlock after 5s of no further changes — gives slow models time
      const timer = window.setTimeout(() => {
        unlockTimers.current.delete(changedPath);
        setOpenFiles((prev) =>
          prev.map(f =>
            f.path === changedPath ? { ...f, locked: false } : f,
          ),
        );
      }, 5000);
      unlockTimers.current.set(changedPath, timer);
    });
  }, [reloadFile]);

  /**
   * Remap open editor tabs when a file/folder path changes.
   * Supports prefix remaps for directory moves.
   */
  const remapOpenPaths = useCallback((fromPath: string, toPath: string) => {
    if (!fromPath || !toPath || fromPath === toPath) return;

    setOpenFiles((prev) => {
      const next = prev.map((f) => {
        if (!matchesPathPrefix(f.path, fromPath)) return f;
        const nextPath = remapPathPrefix(f.path, fromPath, toPath);
        return {
          ...f,
          path: nextPath,
          name: basename(nextPath),
        };
      });
      persistFiles(next);
      return next;
    });

    setActiveTabState((currentTab) => {
      if (!matchesPathPrefix(currentTab, fromPath)) return currentTab;
      const nextTab = remapPathPrefix(currentTab, fromPath, toPath);
      persistTab(nextTab);
      return nextTab;
    });
  }, []);

  /** Close any open tabs under a path prefix (file or folder). */
  const closeOpenPathsByPrefix = useCallback((pathPrefix: string) => {
    if (!pathPrefix) return;

    setOpenFiles((prev) => {
      const next = prev.filter((f) => !matchesPathPrefix(f.path, pathPrefix));
      persistFiles(next);
      return next;
    });

    setActiveTabState((currentTab) => {
      if (!matchesPathPrefix(currentTab, pathPrefix)) return currentTab;
      persistTab('chat');
      return 'chat';
    });
  }, []);

  return {
    openFiles,
    activeTab,
    setActiveTab,
    openFile,
    closeFile,
    updateContent,
    saveFile,
    reloadFile,
    initializeFiles,
    handleFileChanged,
    remapOpenPaths,
    closeOpenPathsByPrefix,
  };
}
