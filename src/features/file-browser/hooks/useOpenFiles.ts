import { useState, useCallback, useRef, useEffect } from 'react';
import { getWorkspaceStorageKey } from '@/features/workspace/workspaceScope';
import { isImageFile } from '../utils/fileTypes';
import type { OpenFile } from '../types';

const DEFAULT_AGENT_ID = 'main';
const MAX_OPEN_TABS = 20;

function normalizeAgentId(agentId?: string): string {
  return agentId?.trim() || DEFAULT_AGENT_ID;
}

function getFilesStorageKey(agentId: string): string {
  return getWorkspaceStorageKey('open-files', normalizeAgentId(agentId));
}

function getActiveTabStorageKey(agentId: string): string {
  return getWorkspaceStorageKey('active-tab', normalizeAgentId(agentId));
}

function loadPersistedFiles(agentId: string): string[] {
  try {
    const stored = localStorage.getItem(getFilesStorageKey(agentId));
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function loadPersistedTab(agentId: string): string {
  try {
    return localStorage.getItem(getActiveTabStorageKey(agentId)) || 'chat';
  } catch {
    return 'chat';
  }
}

function persistFilePaths(agentId: string, filePaths: string[]) {
  try {
    localStorage.setItem(getFilesStorageKey(agentId), JSON.stringify(filePaths));
  } catch {
    // ignore storage errors
  }
}

function persistFiles(agentId: string, files: OpenFile[]) {
  persistFilePaths(agentId, files.map((file) => file.path));
}

function persistTab(agentId: string, tab: string) {
  try {
    localStorage.setItem(getActiveTabStorageKey(agentId), tab);
  } catch {
    // ignore storage errors
  }
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

function buildReadUrl(filePath: string, agentId: string): string {
  const params = new URLSearchParams({ path: filePath, agentId });
  return `/api/files/read?${params.toString()}`;
}

function getAgentScopedPathKey(agentId: string, filePath: string): string {
  return `${normalizeAgentId(agentId)}::${filePath}`;
}

function getRestoredActiveTab(persistedTab: string, files: OpenFile[]): string {
  if (persistedTab === 'chat') return 'chat';
  return files.some((file) => file.path === persistedTab)
    ? persistedTab
    : files.at(-1)?.path ?? 'chat';
}

interface DirtyFileSnapshot {
  content: string;
  savedContent: string;
  mtime: number;
}

interface SaveFileTarget {
  content: string;
  mtime: number;
}

export function useOpenFiles(agentId = DEFAULT_AGENT_ID) {
  const scopedAgentId = normalizeAgentId(agentId);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeTab, setActiveTabState] = useState<string>(() => loadPersistedTab(scopedAgentId));
  const restoreRequestRef = useRef(0);

  // Track mtimes from our own saves so we can ignore the SSE bounce-back.
  // Keys are agent-scoped so same relative paths in different workspaces stay isolated.
  const recentSaveMtimes = useRef<Map<string, number>>(new Map());
  /** Paths currently being saved, blocks lock overlay during the save round-trip. */
  const savingPaths = useRef<Set<string>>(new Set());

  const agentIdRef = useRef(scopedAgentId);
  const stateOwnerAgentRef = useRef(scopedAgentId);
  const restoringAgentIdRef = useRef<string | null>(null);
  const dirtyFilesByAgentRef = useRef<Map<string, Map<string, DirtyFileSnapshot>>>(new Map());
  agentIdRef.current = scopedAgentId;

  const ownsVisibleState = stateOwnerAgentRef.current === scopedAgentId;
  const visibleOpenFiles = ownsVisibleState ? openFiles : [];
  const visibleActiveTab = ownsVisibleState ? activeTab : loadPersistedTab(scopedAgentId);

  const openFilesRef = useRef<OpenFile[]>(visibleOpenFiles);
  // eslint-disable-next-line react-hooks/immutability
  openFilesRef.current = visibleOpenFiles;

  const unlockTimers = useRef<Map<string, number>>(new Map());

  const rememberDirtyFiles = useCallback((targetAgentId: string, files: OpenFile[]) => {
    const dirtyFiles = new Map<string, DirtyFileSnapshot>();

    for (const file of files) {
      if (!file.dirty) continue;
      dirtyFiles.set(file.path, {
        content: file.content,
        savedContent: file.savedContent,
        mtime: file.mtime,
      });
    }

    dirtyFilesByAgentRef.current.set(targetAgentId, dirtyFiles);
  }, []);

  const reconcileDirtyFileSnapshotAfterSave = useCallback((
    targetAgentId: string,
    filePath: string,
    savedContent: string,
    nextMtime: number,
  ) => {
    const dirtyFiles = new Map(dirtyFilesByAgentRef.current.get(targetAgentId) ?? []);
    const snapshot = dirtyFiles.get(filePath);

    if (!snapshot) {
      dirtyFilesByAgentRef.current.set(targetAgentId, dirtyFiles);
      return;
    }

    if (snapshot.content === savedContent) {
      dirtyFiles.delete(filePath);
    } else {
      dirtyFiles.set(filePath, {
        ...snapshot,
        savedContent,
        mtime: nextMtime,
      });
    }

    dirtyFilesByAgentRef.current.set(targetAgentId, dirtyFiles);
  }, []);

  const remapDirtyFiles = useCallback((targetAgentId: string, fromPath: string, toPath: string) => {
    const dirtyFiles = dirtyFilesByAgentRef.current.get(targetAgentId);
    if (!dirtyFiles) return;

    const nextDirtyFiles = new Map<string, DirtyFileSnapshot>();
    for (const [path, snapshot] of dirtyFiles.entries()) {
      const nextPath = matchesPathPrefix(path, fromPath)
        ? remapPathPrefix(path, fromPath, toPath)
        : path;
      nextDirtyFiles.set(nextPath, snapshot);
    }

    dirtyFilesByAgentRef.current.set(targetAgentId, nextDirtyFiles);
  }, []);

  const closeDirtyFilesByPrefix = useCallback((targetAgentId: string, pathPrefix: string) => {
    const dirtyFiles = dirtyFilesByAgentRef.current.get(targetAgentId);
    if (!dirtyFiles) return;

    const nextDirtyFiles = new Map<string, DirtyFileSnapshot>();
    for (const [path, snapshot] of dirtyFiles.entries()) {
      if (matchesPathPrefix(path, pathPrefix)) continue;
      nextDirtyFiles.set(path, snapshot);
    }

    dirtyFilesByAgentRef.current.set(targetAgentId, nextDirtyFiles);
  }, []);

  useEffect(() => {
    if (stateOwnerAgentRef.current !== scopedAgentId) return;
    if (restoringAgentIdRef.current === scopedAgentId) return;
    rememberDirtyFiles(scopedAgentId, openFiles);
  }, [openFiles, rememberDirtyFiles, scopedAgentId]);

  const restorePersistedFiles = useCallback(async (targetAgentId = scopedAgentId) => {
    const requestId = ++restoreRequestRef.current;
    const persistedPaths = loadPersistedFiles(targetAgentId);
    const persistedTab = loadPersistedTab(targetAgentId);
    const clearRestore = () => {
      if (restoringAgentIdRef.current === targetAgentId) {
        restoringAgentIdRef.current = null;
      }
    };

    stateOwnerAgentRef.current = targetAgentId;
    restoringAgentIdRef.current = targetAgentId;
    setOpenFiles([]);
    setActiveTabState(persistedTab);

    if (persistedPaths.length === 0) {
      dirtyFilesByAgentRef.current.set(targetAgentId, new Map());
      clearRestore();
      persistFiles(targetAgentId, []);
      persistTab(targetAgentId, 'chat');
      setActiveTabState('chat');
      return;
    }

    const files: OpenFile[] = [];
    for (const path of persistedPaths) {
      try {
        const res = await fetch(buildReadUrl(path, targetAgentId));
        if (!res.ok) continue;
        const data = await res.json();
        if (!data.ok) continue;

        const dirtySnapshot = dirtyFilesByAgentRef.current.get(targetAgentId)?.get(path);
        files.push({
          path,
          name: basename(path),
          content: dirtySnapshot?.content ?? data.content,
          savedContent: dirtySnapshot?.savedContent ?? data.content,
          dirty: dirtySnapshot ? dirtySnapshot.content !== dirtySnapshot.savedContent : false,
          locked: false,
          mtime: dirtySnapshot?.mtime ?? data.mtime,
          loading: false,
        });
      } catch {
        // Skip files that can't be loaded
      }

      if (restoreRequestRef.current !== requestId || agentIdRef.current !== targetAgentId) {
        clearRestore();
        return;
      }
    }

    if (restoreRequestRef.current !== requestId || agentIdRef.current !== targetAgentId) {
      clearRestore();
      return;
    }

    const nextActiveTab = getRestoredActiveTab(persistedTab, files);
    clearRestore();
    setOpenFiles(files);
    setActiveTabState(nextActiveTab);
    persistFiles(targetAgentId, files);
    persistTab(targetAgentId, nextActiveTab);
  }, [scopedAgentId]);

  useEffect(() => {
    for (const timer of unlockTimers.current.values()) {
      clearTimeout(timer);
    }
    unlockTimers.current.clear();
    void restorePersistedFiles(scopedAgentId);
  }, [restorePersistedFiles, scopedAgentId]);

  const setActiveTab = useCallback((tab: string) => {
    const requestAgentId = agentIdRef.current;
    setActiveTabState(tab);
    persistTab(requestAgentId, tab);
  }, []);

  const openFile = useCallback(async (filePath: string) => {
    if (openFilesRef.current.some((file) => file.path === filePath)) {
      setActiveTab(filePath);
      return;
    }

    const requestAgentId = agentIdRef.current;

    setOpenFiles((prev) => {
      const existing = prev.find((file) => file.path === filePath);
      if (existing) return prev;

      let base = prev;
      if (base.length >= MAX_OPEN_TABS) {
        const oldest = base.find((file) => !file.dirty);
        base = oldest ? base.filter((file) => file.path !== oldest.path) : base.slice(1);
      }

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
      persistFiles(requestAgentId, next);
      return next;
    });

    setActiveTab(filePath);

    if (isImageFile(basename(filePath))) {
      setOpenFiles((prev) => prev.map((file) => (
        file.path === filePath ? { ...file, loading: false } : file
      )));
      return;
    }

    try {
      const res = await fetch(buildReadUrl(filePath, requestAgentId));
      const data = await res.json();

      if (agentIdRef.current !== requestAgentId) {
        return;
      }

      setOpenFiles((prev) => prev.map((file) => {
        if (file.path !== filePath) return file;
        if (!data.ok) {
          return { ...file, loading: false, error: data.error || 'Failed to load' };
        }
        return {
          ...file,
          content: data.content,
          savedContent: data.content,
          mtime: data.mtime,
          loading: false,
          error: undefined,
        };
      }));
    } catch {
      if (agentIdRef.current !== requestAgentId) {
        return;
      }

      setOpenFiles((prev) => prev.map((file) => (
        file.path === filePath
          ? { ...file, loading: false, error: 'Network error' }
          : file
      )));
    }
  }, [setActiveTab]);

  const closeFile = useCallback((filePath: string) => {
    const requestAgentId = agentIdRef.current;

    setOpenFiles((prev) => {
      const next = prev.filter((file) => file.path !== filePath);
      persistFiles(requestAgentId, next);
      return next;
    });

    setActiveTabState((currentTab) => {
      if (currentTab !== filePath) return currentTab;
      persistTab(requestAgentId, 'chat');
      return 'chat';
    });
  }, []);

  const updateContent = useCallback((filePath: string, content: string) => {
    setOpenFiles((prev) => prev.map((file) => {
      if (file.path !== filePath) return file;
      return { ...file, content, dirty: content !== file.savedContent };
    }));
  }, []);

  const saveFileForAgent = useCallback(async (
    filePath: string,
    requestAgentId: string,
    target?: SaveFileTarget,
  ): Promise<{ ok: boolean; conflict?: boolean }> => {
    const file = target ?? openFilesRef.current.find((openFile) => openFile.path === filePath);
    if (!file) return { ok: false };

    const scopedPathKey = getAgentScopedPathKey(requestAgentId, filePath);

    try {
      savingPaths.current.add(scopedPathKey);

      const res = await fetch('/api/files/write', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: filePath,
          content: file.content,
          expectedMtime: file.mtime,
          agentId: requestAgentId,
        }),
      });
      const data = await res.json();

      if (data.ok) {
        const savedContent = file.content;

        recentSaveMtimes.current.set(scopedPathKey, data.mtime);
        setTimeout(() => recentSaveMtimes.current.delete(scopedPathKey), 2000);

        if (agentIdRef.current === requestAgentId) {
          setOpenFiles((prev) => {
            const next = prev.map((openFile) => {
              if (openFile.path !== filePath) return openFile;
              return {
                ...openFile,
                savedContent,
                dirty: openFile.content !== savedContent,
                mtime: data.mtime,
              };
            });
            rememberDirtyFiles(requestAgentId, next);
            return next;
          });
        } else {
          reconcileDirtyFileSnapshotAfterSave(requestAgentId, filePath, savedContent, data.mtime);
        }

        savingPaths.current.delete(scopedPathKey);
        return { ok: true };
      }

      if (res.status === 409) {
        savingPaths.current.delete(scopedPathKey);
        return { ok: false, conflict: true };
      }

      savingPaths.current.delete(scopedPathKey);
      return { ok: false };
    } catch {
      savingPaths.current.delete(scopedPathKey);
      return { ok: false };
    }
  }, [reconcileDirtyFileSnapshotAfterSave, rememberDirtyFiles]);

  const saveFile = useCallback(async (filePath: string): Promise<{ ok: boolean; conflict?: boolean }> => {
    const requestAgentId = agentIdRef.current;
    return saveFileForAgent(filePath, requestAgentId);
  }, [saveFileForAgent]);

  const reloadFile = useCallback(async (filePath: string) => {
    const requestAgentId = agentIdRef.current;

    try {
      const res = await fetch(buildReadUrl(filePath, requestAgentId));
      const data = await res.json();

      if (agentIdRef.current !== requestAgentId) {
        return;
      }

      if (!data.ok) {
        if (res.status === 404) {
          setOpenFiles((prev) => prev.map((file) => (
            file.path === filePath
              ? { ...file, error: 'File was deleted', locked: false, loading: false }
              : file
          )));
        }
        return;
      }

      setOpenFiles((prev) => prev.map((file) => (
        file.path === filePath
          ? {
              ...file,
              content: data.content,
              savedContent: data.content,
              dirty: false,
              mtime: data.mtime,
              error: undefined,
            }
          : file
      )));
    } catch {
      // ignore reload failures
    }
  }, []);

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

  /**
   * Handle an external file change event (from SSE `file.changed`).
   *
   * - If this was our own save, ignore it.
   * - If the file is open, lock it and reload content from disk.
   * - Lock clears automatically after a short delay.
   */
  const handleFileChanged = useCallback((changedPath: string) => {
    const requestAgentId = agentIdRef.current;
    const scopedPathKey = getAgentScopedPathKey(requestAgentId, changedPath);

    if (recentSaveMtimes.current.has(scopedPathKey)) return;
    if (savingPaths.current.has(scopedPathKey)) return;

    const isOpen = openFilesRef.current.some((file) => file.path === changedPath);
    if (!isOpen) return;

    setOpenFiles((prev) => prev.map((file) => (
      file.path === changedPath ? { ...file, locked: true } : file
    )));

    void reloadFile(changedPath).then(() => {
      if (agentIdRef.current !== requestAgentId) return;

      const existing = unlockTimers.current.get(scopedPathKey);
      if (existing) clearTimeout(existing);

      const timer = window.setTimeout(() => {
        unlockTimers.current.delete(scopedPathKey);
        if (agentIdRef.current !== requestAgentId) return;

        setOpenFiles((prev) => prev.map((file) => (
          file.path === changedPath ? { ...file, locked: false } : file
        )));
      }, 5000);
      unlockTimers.current.set(scopedPathKey, timer);
    });
  }, [reloadFile]);

  /**
   * Remap open editor tabs when a file/folder path changes.
   * Supports prefix remaps for directory moves.
   */
  const remapOpenPaths = useCallback((fromPath: string, toPath: string, targetAgentId = scopedAgentId) => {
    if (!fromPath || !toPath || fromPath === toPath) return;

    const requestAgentId = normalizeAgentId(targetAgentId);
    remapDirtyFiles(requestAgentId, fromPath, toPath);

    if (agentIdRef.current !== requestAgentId) {
      const nextPaths = loadPersistedFiles(requestAgentId).map((filePath) => (
        matchesPathPrefix(filePath, fromPath)
          ? remapPathPrefix(filePath, fromPath, toPath)
          : filePath
      ));
      persistFilePaths(requestAgentId, nextPaths);

      const currentTab = loadPersistedTab(requestAgentId);
      if (matchesPathPrefix(currentTab, fromPath)) {
        persistTab(requestAgentId, remapPathPrefix(currentTab, fromPath, toPath));
      }
      return;
    }

    setOpenFiles((prev) => {
      const next = prev.map((file) => {
        if (!matchesPathPrefix(file.path, fromPath)) return file;
        const nextPath = remapPathPrefix(file.path, fromPath, toPath);
        return {
          ...file,
          path: nextPath,
          name: basename(nextPath),
        };
      });
      rememberDirtyFiles(requestAgentId, next);
      persistFiles(requestAgentId, next);
      return next;
    });

    setActiveTabState((currentTab) => {
      if (!matchesPathPrefix(currentTab, fromPath)) return currentTab;
      const nextTab = remapPathPrefix(currentTab, fromPath, toPath);
      persistTab(requestAgentId, nextTab);
      return nextTab;
    });
  }, [rememberDirtyFiles, remapDirtyFiles, scopedAgentId]);

  /** Close any open tabs under a path prefix (file or folder). */
  const closeOpenPathsByPrefix = useCallback((pathPrefix: string, targetAgentId = scopedAgentId) => {
    if (!pathPrefix) return;

    const requestAgentId = normalizeAgentId(targetAgentId);
    closeDirtyFilesByPrefix(requestAgentId, pathPrefix);

    if (agentIdRef.current !== requestAgentId) {
      const nextPaths = loadPersistedFiles(requestAgentId).filter(
        (filePath) => !matchesPathPrefix(filePath, pathPrefix),
      );
      persistFilePaths(requestAgentId, nextPaths);

      if (matchesPathPrefix(loadPersistedTab(requestAgentId), pathPrefix)) {
        persistTab(requestAgentId, 'chat');
      }
      return;
    }

    setOpenFiles((prev) => {
      const next = prev.filter((file) => !matchesPathPrefix(file.path, pathPrefix));
      rememberDirtyFiles(requestAgentId, next);
      persistFiles(requestAgentId, next);
      return next;
    });

    setActiveTabState((currentTab) => {
      if (!matchesPathPrefix(currentTab, pathPrefix)) return currentTab;
      persistTab(requestAgentId, 'chat');
      return 'chat';
    });
  }, [closeDirtyFilesByPrefix, rememberDirtyFiles, scopedAgentId]);

  const getDirtyFilePaths = useCallback(() => (
    openFilesRef.current.filter((file) => file.dirty).map((file) => file.path)
  ), []);

  const discardAllDirtyFiles = useCallback(() => {
    const requestAgentId = agentIdRef.current;
    setOpenFiles((prev) => {
      const next = prev.map((file) => (
        file.dirty
          ? { ...file, content: file.savedContent, dirty: false, error: undefined }
          : file
      ));
      rememberDirtyFiles(requestAgentId, next);
      return next;
    });
  }, [rememberDirtyFiles]);

  const saveAllDirtyFiles = useCallback(async (): Promise<{ ok: boolean; failedPath?: string; conflict?: boolean }> => {
    const requestAgentId = agentIdRef.current;
    const dirtyFiles = openFilesRef.current
      .filter((file) => file.dirty)
      .map((file) => ({
        path: file.path,
        content: file.content,
        mtime: file.mtime,
      }));

    for (const dirtyFile of dirtyFiles) {
      const result = await saveFileForAgent(dirtyFile.path, requestAgentId, dirtyFile);
      if (!result.ok) {
        return { ok: false, failedPath: dirtyFile.path, conflict: result.conflict };
      }
    }
    return { ok: true };
  }, [saveFileForAgent]);

  return {
    openFiles: visibleOpenFiles,
    activeTab: visibleActiveTab,
    setActiveTab,
    openFile,
    closeFile,
    updateContent,
    saveFile,
    reloadFile,
    handleFileChanged,
    remapOpenPaths,
    closeOpenPathsByPrefix,
    hasDirtyFiles: visibleOpenFiles.some((file) => file.dirty),
    getDirtyFilePaths,
    saveAllDirtyFiles,
    discardAllDirtyFiles,
  };
}
