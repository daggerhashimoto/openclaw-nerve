import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
} from 'react';
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

interface DirtyFileTarget extends SaveFileTarget {
  path: string;
}

function createSnapshotBackedOpenFile(filePath: string, snapshot: DirtyFileSnapshot): OpenFile {
  return {
    path: filePath,
    name: basename(filePath),
    content: snapshot.content,
    savedContent: snapshot.savedContent,
    dirty: snapshot.content !== snapshot.savedContent,
    locked: false,
    mtime: snapshot.mtime,
    loading: false,
  };
}

function mergeRestoredFiles(restoredFiles: OpenFile[], currentFiles: OpenFile[]): OpenFile[] {
  const currentFilesByPath = new Map(currentFiles.map((file) => [file.path, file]));
  const nextFiles = restoredFiles.map((restoredFile) => {
    const currentFile = currentFilesByPath.get(restoredFile.path);
    currentFilesByPath.delete(restoredFile.path);
    return currentFile?.dirty ? currentFile : restoredFile;
  });

  for (const file of currentFiles) {
    if (!currentFilesByPath.has(file.path)) continue;
    nextFiles.push(file);
  }

  return nextFiles;
}

function collectDirtyFilePaths(visibleFiles: OpenFile[], storedDirtyPaths: string[]): string[] {
  const dirtyPaths = new Set(storedDirtyPaths);

  for (const file of visibleFiles) {
    if (!file.dirty) continue;
    dirtyPaths.add(file.path);
  }

  return [...dirtyPaths];
}

function collectDirtyFileTargets(
  visibleFiles: OpenFile[],
  storedDirtyFiles?: Map<string, DirtyFileSnapshot>,
): DirtyFileTarget[] {
  const dirtyFiles = new Map<string, SaveFileTarget>();

  for (const [path, snapshot] of storedDirtyFiles ?? []) {
    dirtyFiles.set(path, {
      content: snapshot.content,
      mtime: snapshot.mtime,
    });
  }

  for (const file of visibleFiles) {
    if (!file.dirty || dirtyFiles.has(file.path)) continue;
    dirtyFiles.set(file.path, {
      content: file.content,
      mtime: file.mtime,
    });
  }

  return [...dirtyFiles.entries()].map(([path, target]) => ({
    path,
    ...target,
  }));
}

export function useOpenFiles(agentId = DEFAULT_AGENT_ID) {
  const scopedAgentId = normalizeAgentId(agentId);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeTab, setActiveTabState] = useState<string>(() => loadPersistedTab(scopedAgentId));
  const [stateOwnerAgentId, setStateOwnerAgentId] = useState(scopedAgentId);
  const [dirtyFilePathsByAgent, setDirtyFilePathsByAgent] = useState<Record<string, string[]>>({});
  const restoreRequestRef = useRef(0);
  const restorePersistedFilesRef = useRef<(targetAgentId?: string) => Promise<void>>(async () => {});

  // Track mtimes from our own saves so we can ignore the SSE bounce-back.
  // Keys are agent-scoped so same relative paths in different workspaces stay isolated.
  const recentSaveMtimes = useRef<Map<string, number>>(new Map());
  /** Paths currently being saved, blocks lock overlay during the save round-trip. */
  const savingPaths = useRef<Set<string>>(new Set());
  /** Latest async read token per agent/path so older reads cannot patch newer state. */
  const readRequestTokensRef = useRef<Map<string, number>>(new Map());
  /** Structural offscreen mutations that must invalidate in-flight restores. */
  const backgroundMutationVersionsRef = useRef<Map<string, number>>(new Map());

  const agentIdRef = useRef(scopedAgentId);
  const stateOwnerAgentIdRef = useRef(scopedAgentId);
  const restoringAgentIdRef = useRef<string | null>(null);
  const dirtyFilesByAgentRef = useRef<Map<string, Map<string, DirtyFileSnapshot>>>(new Map());

  const ownsVisibleState = stateOwnerAgentId === scopedAgentId;
  const visibleOpenFiles = useMemo(() => (
    ownsVisibleState ? openFiles : []
  ), [openFiles, ownsVisibleState]);
  const visibleActiveTab = ownsVisibleState ? activeTab : loadPersistedTab(scopedAgentId);
  const visibleDirtyFilePaths = useMemo(() => (
    dirtyFilePathsByAgent[scopedAgentId] ?? []
  ), [dirtyFilePathsByAgent, scopedAgentId]);

  const openFilesRef = useRef<OpenFile[]>(visibleOpenFiles);

  useLayoutEffect(() => {
    agentIdRef.current = scopedAgentId;
    stateOwnerAgentIdRef.current = stateOwnerAgentId;
    openFilesRef.current = visibleOpenFiles;
  }, [scopedAgentId, stateOwnerAgentId, visibleOpenFiles]);

  const unlockTimers = useRef<Map<string, number>>(new Map());

  const setDirtyFilesForAgent = useCallback((targetAgentId: string, dirtyFiles: Map<string, DirtyFileSnapshot>) => {
    dirtyFilesByAgentRef.current.set(targetAgentId, dirtyFiles);

    const nextPaths = [...dirtyFiles.keys()];
    setDirtyFilePathsByAgent((prev) => {
      const currentPaths = prev[targetAgentId] ?? [];
      const pathsUnchanged = currentPaths.length === nextPaths.length
        && currentPaths.every((path, index) => path === nextPaths[index]);

      if (pathsUnchanged) return prev;
      return { ...prev, [targetAgentId]: nextPaths };
    });
  }, []);

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

    setDirtyFilesForAgent(targetAgentId, dirtyFiles);
  }, [setDirtyFilesForAgent]);

  const nextReadRequestToken = useCallback((targetAgentId: string, filePath: string) => {
    const scopedPathKey = getAgentScopedPathKey(targetAgentId, filePath);
    const token = (readRequestTokensRef.current.get(scopedPathKey) ?? 0) + 1;
    readRequestTokensRef.current.set(scopedPathKey, token);
    return { scopedPathKey, token };
  }, []);

  const isLatestReadRequest = useCallback((scopedPathKey: string, token: number) => (
    readRequestTokensRef.current.get(scopedPathKey) === token
  ), []);

  const getBackgroundMutationVersion = useCallback((targetAgentId: string) => (
    backgroundMutationVersionsRef.current.get(targetAgentId) ?? 0
  ), []);

  const bumpBackgroundMutationVersion = useCallback((targetAgentId: string) => {
    const nextVersion = getBackgroundMutationVersion(targetAgentId) + 1;
    backgroundMutationVersionsRef.current.set(targetAgentId, nextVersion);
    return nextVersion;
  }, [getBackgroundMutationVersion]);

  const claimStateOwnership = useCallback((targetAgentId: string) => {
    if (stateOwnerAgentIdRef.current === targetAgentId) return;
    stateOwnerAgentIdRef.current = targetAgentId;
    setStateOwnerAgentId(targetAgentId);
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
      setDirtyFilesForAgent(targetAgentId, dirtyFiles);
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

    setDirtyFilesForAgent(targetAgentId, dirtyFiles);
  }, [setDirtyFilesForAgent]);

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

    setDirtyFilesForAgent(targetAgentId, nextDirtyFiles);
  }, [setDirtyFilesForAgent]);

  const closeDirtyFilesByPrefix = useCallback((targetAgentId: string, pathPrefix: string) => {
    const dirtyFiles = dirtyFilesByAgentRef.current.get(targetAgentId);
    if (!dirtyFiles) return;

    const nextDirtyFiles = new Map<string, DirtyFileSnapshot>();
    for (const [path, snapshot] of dirtyFiles.entries()) {
      if (matchesPathPrefix(path, pathPrefix)) continue;
      nextDirtyFiles.set(path, snapshot);
    }

    setDirtyFilesForAgent(targetAgentId, nextDirtyFiles);
  }, [setDirtyFilesForAgent]);

  const restorePersistedFiles = useCallback(async (targetAgentId = scopedAgentId) => {
    const requestId = ++restoreRequestRef.current;
    const persistedPaths = loadPersistedFiles(targetAgentId);
    const persistedTab = loadPersistedTab(targetAgentId);
    const startBackgroundMutationVersion = getBackgroundMutationVersion(targetAgentId);
    const clearRestore = () => {
      if (restoringAgentIdRef.current === targetAgentId) {
        restoringAgentIdRef.current = null;
      }
    };
    const restartRestore = () => {
      clearRestore();
      if (restoreRequestRef.current !== requestId || agentIdRef.current !== targetAgentId) {
        return;
      }
      void restorePersistedFilesRef.current(targetAgentId);
    };

    restoringAgentIdRef.current = targetAgentId;
    await Promise.resolve();

    if (restoreRequestRef.current !== requestId || agentIdRef.current !== targetAgentId) {
      clearRestore();
      return;
    }

    const files: OpenFile[] = [];
    for (const path of persistedPaths) {
      const { scopedPathKey, token } = nextReadRequestToken(targetAgentId, path);
      const getDirtySnapshot = () => dirtyFilesByAgentRef.current.get(targetAgentId)?.get(path);
      const restoreDirtySnapshot = () => {
        const dirtySnapshot = getDirtySnapshot();
        if (!dirtySnapshot) return;
        files.push(createSnapshotBackedOpenFile(path, dirtySnapshot));
      };

      try {
        const res = await fetch(buildReadUrl(path, targetAgentId));
        if (!isLatestReadRequest(scopedPathKey, token)) {
          restartRestore();
          return;
        }
        if (!res.ok) {
          restoreDirtySnapshot();
          continue;
        }

        const data = await res.json();
        if (!isLatestReadRequest(scopedPathKey, token)) {
          restartRestore();
          return;
        }
        if (!data.ok) {
          restoreDirtySnapshot();
          continue;
        }

        const dirtySnapshot = getDirtySnapshot();
        files.push(dirtySnapshot
          ? createSnapshotBackedOpenFile(path, dirtySnapshot)
          : {
              path,
              name: basename(path),
              content: data.content,
              savedContent: data.content,
              dirty: false,
              locked: false,
              mtime: data.mtime,
              loading: false,
            });
      } catch {
        if (!isLatestReadRequest(scopedPathKey, token)) {
          restartRestore();
          return;
        }
        restoreDirtySnapshot();
      }

      if (restoreRequestRef.current !== requestId || agentIdRef.current !== targetAgentId) {
        clearRestore();
        return;
      }
      if (
        stateOwnerAgentIdRef.current !== targetAgentId
        && getBackgroundMutationVersion(targetAgentId) !== startBackgroundMutationVersion
      ) {
        restartRestore();
        return;
      }
    }

    if (restoreRequestRef.current !== requestId || agentIdRef.current !== targetAgentId) {
      clearRestore();
      return;
    }
    if (
      stateOwnerAgentIdRef.current !== targetAgentId
      && getBackgroundMutationVersion(targetAgentId) !== startBackgroundMutationVersion
    ) {
      restartRestore();
      return;
    }

    clearRestore();
    const ownsTargetState = stateOwnerAgentIdRef.current === targetAgentId;
    stateOwnerAgentIdRef.current = targetAgentId;
    setStateOwnerAgentId(targetAgentId);
    setOpenFiles((prev) => {
      const baseFiles = ownsTargetState ? prev : [];
      const next = mergeRestoredFiles(files, baseFiles);
      rememberDirtyFiles(targetAgentId, next);
      persistFiles(targetAgentId, next);
      return next;
    });
    setActiveTabState((currentTab) => {
      const nextTab = ownsTargetState && currentTab !== persistedTab
        ? currentTab
        : getRestoredActiveTab(persistedTab, files);
      persistTab(targetAgentId, nextTab);
      return nextTab;
    });
  }, [
    getBackgroundMutationVersion,
    isLatestReadRequest,
    nextReadRequestToken,
    rememberDirtyFiles,
    scopedAgentId,
  ]);

  useLayoutEffect(() => {
    restorePersistedFilesRef.current = restorePersistedFiles;
  }, [restorePersistedFiles]);

  useEffect(() => {
    for (const timer of unlockTimers.current.values()) {
      clearTimeout(timer);
    }
    unlockTimers.current.clear();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore orchestration intentionally rehydrates agent-scoped editor state from persisted storage
    void restorePersistedFiles(scopedAgentId);
  }, [restorePersistedFiles, scopedAgentId]);

  const setActiveTab = useCallback((tab: string) => {
    const requestAgentId = agentIdRef.current;
    claimStateOwnership(requestAgentId);
    setActiveTabState(tab);
    persistTab(requestAgentId, tab);
  }, [claimStateOwnership]);

  const openFile = useCallback(async (filePath: string) => {
    if (openFilesRef.current.some((file) => file.path === filePath)) {
      setActiveTab(filePath);
      return;
    }

    const requestAgentId = agentIdRef.current;
    const { scopedPathKey, token } = nextReadRequestToken(requestAgentId, filePath);
    claimStateOwnership(requestAgentId);

    setOpenFiles((prev) => {
      const baseFiles = stateOwnerAgentIdRef.current === requestAgentId ? prev : [];
      const existing = baseFiles.find((file) => file.path === filePath);
      if (existing) return baseFiles;

      let nextBase = baseFiles;
      if (nextBase.length >= MAX_OPEN_TABS) {
        const oldest = nextBase.find((file) => !file.dirty);
        nextBase = oldest ? nextBase.filter((file) => file.path !== oldest.path) : nextBase.slice(1);
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
      const next = [...nextBase, newFile];
      rememberDirtyFiles(requestAgentId, next);
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

      if (agentIdRef.current !== requestAgentId || !isLatestReadRequest(scopedPathKey, token)) {
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
      if (agentIdRef.current !== requestAgentId || !isLatestReadRequest(scopedPathKey, token)) {
        return;
      }

      setOpenFiles((prev) => prev.map((file) => (
        file.path === filePath
          ? { ...file, loading: false, error: 'Network error' }
          : file
      )));
    }
  }, [claimStateOwnership, isLatestReadRequest, nextReadRequestToken, rememberDirtyFiles, setActiveTab]);

  const closeFile = useCallback((filePath: string) => {
    const requestAgentId = agentIdRef.current;
    claimStateOwnership(requestAgentId);

    setOpenFiles((prev) => {
      const next = prev.filter((file) => file.path !== filePath);
      rememberDirtyFiles(requestAgentId, next);
      persistFiles(requestAgentId, next);
      return next;
    });

    setActiveTabState((currentTab) => {
      if (currentTab !== filePath) return currentTab;
      persistTab(requestAgentId, 'chat');
      return 'chat';
    });
  }, [claimStateOwnership, rememberDirtyFiles]);

  const updateContent = useCallback((filePath: string, content: string) => {
    const requestAgentId = agentIdRef.current;
    claimStateOwnership(requestAgentId);
    setOpenFiles((prev) => {
      const next = prev.map((file) => {
        if (file.path !== filePath) return file;
        return { ...file, content, dirty: content !== file.savedContent };
      });
      rememberDirtyFiles(requestAgentId, next);
      return next;
    });
  }, [claimStateOwnership, rememberDirtyFiles]);

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
        const ownsRequestState = stateOwnerAgentIdRef.current === requestAgentId;

        recentSaveMtimes.current.set(scopedPathKey, data.mtime);
        setTimeout(() => recentSaveMtimes.current.delete(scopedPathKey), 2000);

        if (ownsRequestState) {
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
    const { scopedPathKey, token } = nextReadRequestToken(requestAgentId, filePath);

    try {
      const res = await fetch(buildReadUrl(filePath, requestAgentId));
      const data = await res.json();

      if (agentIdRef.current !== requestAgentId || !isLatestReadRequest(scopedPathKey, token)) {
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

      setOpenFiles((prev) => {
        const next = prev.map((file) => (
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
        ));
        rememberDirtyFiles(requestAgentId, next);
        return next;
      });
    } catch {
      // ignore reload failures
    }
  }, [isLatestReadRequest, nextReadRequestToken, rememberDirtyFiles]);

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
   * - If the file is open in the targeted workspace, lock it and reload content from disk.
   * - Lock clears automatically after a short delay.
   */
  const handleFileChanged = useCallback((changedPath: string, targetAgentId?: string) => {
    const requestAgentId = normalizeAgentId(targetAgentId ?? agentIdRef.current);
    if (agentIdRef.current !== requestAgentId) return;

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

    if (stateOwnerAgentIdRef.current !== requestAgentId) {
      bumpBackgroundMutationVersion(requestAgentId);
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
  }, [bumpBackgroundMutationVersion, rememberDirtyFiles, remapDirtyFiles, scopedAgentId]);

  /** Close any open tabs under a path prefix (file or folder). */
  const closeOpenPathsByPrefix = useCallback((pathPrefix: string, targetAgentId = scopedAgentId) => {
    if (!pathPrefix) return;

    const requestAgentId = normalizeAgentId(targetAgentId);
    closeDirtyFilesByPrefix(requestAgentId, pathPrefix);

    if (stateOwnerAgentIdRef.current !== requestAgentId) {
      bumpBackgroundMutationVersion(requestAgentId);
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
  }, [bumpBackgroundMutationVersion, closeDirtyFilesByPrefix, rememberDirtyFiles, scopedAgentId]);

  const getDirtyFilePaths = useCallback(() => (
    collectDirtyFilePaths(visibleOpenFiles, visibleDirtyFilePaths)
  ), [visibleDirtyFilePaths, visibleOpenFiles]);

  const discardAllDirtyFiles = useCallback(() => {
    const requestAgentId = agentIdRef.current;
    const dirtyPaths = new Set(collectDirtyFilePaths(
      openFilesRef.current,
      [...(dirtyFilesByAgentRef.current.get(requestAgentId)?.keys() ?? [])],
    ));

    if (dirtyPaths.size === 0) return;

    if (stateOwnerAgentIdRef.current !== requestAgentId) {
      setDirtyFilesForAgent(requestAgentId, new Map());
      return;
    }

    setOpenFiles((prev) => {
      const next = prev.map((file) => (
        dirtyPaths.has(file.path)
          ? { ...file, content: file.savedContent, dirty: false, error: undefined }
          : file
      ));
      rememberDirtyFiles(requestAgentId, next);
      return next;
    });
  }, [rememberDirtyFiles, setDirtyFilesForAgent]);

  const saveAllDirtyFiles = useCallback(async (): Promise<{ ok: boolean; failedPath?: string; conflict?: boolean }> => {
    const requestAgentId = agentIdRef.current;
    const dirtyFiles = collectDirtyFileTargets(
      openFilesRef.current,
      dirtyFilesByAgentRef.current.get(requestAgentId),
    );

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
    hasDirtyFiles: visibleOpenFiles.some((file) => file.dirty) || visibleDirtyFilePaths.length > 0,
    getDirtyFilePaths,
    saveAllDirtyFiles,
    discardAllDirtyFiles,
  };
}
