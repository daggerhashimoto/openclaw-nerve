/**
 * FileTreePanel — Collapsible file tree sidebar on the far left.
 *
 * Shows workspace files in a tree structure. Directories lazy-load on expand.
 * Double-click a file to open it as an editor tab.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { PanelLeftClose, RefreshCw, Pencil, Trash2, RotateCcw, X } from 'lucide-react';
import { FileTreeNode } from './FileTreeNode';
import { useFileTree } from './hooks/useFileTree';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { TreeEntry } from './types';

const MIN_WIDTH = 160;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 220;
/** Sentinel value for width state when collapsed. */
const COLLAPSED_WIDTH = 0;

const WIDTH_STORAGE_KEY = 'nerve-file-tree-width';
const MENU_VIEWPORT_PADDING = 8;
const MENU_CURSOR_OFFSET = 6;
const MENU_ROW_TOP_OFFSET = 2;
const UNDO_TOAST_TTL_MS = 10_000;

/** Load persisted file tree width from localStorage. */
function loadWidth(): number {
  try {
    const v = localStorage.getItem(WIDTH_STORAGE_KEY);
    return v ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Number(v))) : DEFAULT_WIDTH;
  } catch { return DEFAULT_WIDTH; }
}

/** Get parent directory path from a file path. */
function getParentDir(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx === -1 ? '' : filePath.slice(0, idx);
}

/** Get basename (filename) from a file path. */
function basename(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx === -1 ? filePath : filePath.slice(idx + 1);
}

/** Check if a path points to a trash item. */
function isTrashItemPath(filePath: string): boolean {
  return filePath.startsWith('.trash/') && filePath !== '.trash';
}

export interface FileTreeChangeEvent {
  path: string;
  agentId: string;
  sequence: number;
}

interface FileTreePanelProps {
  workspaceAgentId: string;
  onOpenFile: (path: string) => void;
  onRemapOpenPaths?: (fromPath: string, toPath: string, targetAgentId?: string) => void;
  onCloseOpenPaths?: (pathPrefix: string, targetAgentId?: string) => void;
  /** Called externally when a file changes (SSE) — refreshes affected directory. */
  lastChangedEvent?: FileTreeChangeEvent | null;
  /** Layout hint retained for compatibility with existing callers. */
  isCompactLayout?: boolean;
  /** Callback to notify parent of collapse state changes */
  onCollapseChange: (collapsed: boolean) => void;
  /** External control of collapsed state */
  collapsed: boolean;
}

interface FileOpResult {
  ok: boolean;
  from: string;
  to: string;
  undoTtlMs?: number;
  error?: string;
}

type FileTreeToastPayload =
  | { type: 'success' | 'error'; message: string }
  | { type: 'undo'; message: string; trashPath: string; ttlMs: number };

type FileTreeToast = FileTreeToastPayload & { agentId: string };
type ScopedSessionState = { agentId: string; sessionId: number };
type ScopedContextMenu = ScopedSessionState & { x: number; y: number; entry: TreeEntry };
type ScopedDeleteConfirmation = ScopedSessionState & { entry: TreeEntry };
type ScopedRenameState = ScopedSessionState & { path: string; value: string };
type ScopedDragSource = { agentId: string; entry: TreeEntry };
type ScopedPathState = { agentId: string; path: string };

function isSameScopedSession<T extends ScopedSessionState>(current: T | null, target: T | null): boolean {
  return Boolean(current && target && current.agentId === target.agentId && current.sessionId === target.sessionId);
}

export function FileTreePanel({
  workspaceAgentId = 'main',
  onOpenFile,
  onRemapOpenPaths,
  onCloseOpenPaths,
  lastChangedEvent,
  isCompactLayout = false,
  onCollapseChange,
  collapsed,
}: FileTreePanelProps) {
  const {
    entries, loading, error, expandedPaths, selectedPath,
    loadingPaths, workspaceInfo, toggleDirectory, selectFile, refresh, handleFileChange,
  } = useFileTree(workspaceAgentId);

  // React to external file changes. Sequence keeps repeated same-path events distinct,
  // and agentId prevents a stale event from one workspace from replaying in another.
  const lastHandledChangeSequenceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!lastChangedEvent) return;
    if (lastChangedEvent.agentId !== workspaceAgentId) return;
    if (lastHandledChangeSequenceRef.current === lastChangedEvent.sequence) return;

    lastHandledChangeSequenceRef.current = lastChangedEvent.sequence;
    handleFileChange(lastChangedEvent.path);
  }, [handleFileChange, lastChangedEvent, workspaceAgentId]);

  const panelRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(loadWidth());
  const draggingRef = useRef(false);
  const [width, setWidth] = useState(() => {
    return collapsed ? COLLAPSED_WIDTH : loadWidth();
  });

  // Handle external collapsed state changes (e.g., from mobile button)
  useEffect(() => {
    const targetWidth = collapsed ? COLLAPSED_WIDTH : widthRef.current;
    setWidth(targetWidth);
  }, [collapsed]);

  const [contextMenu, setContextMenu] = useState<ScopedContextMenu | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuSessionIdRef = useRef(0);

  const [renameState, setRenameState] = useState<ScopedRenameState | null>(null);
  const renameSessionIdRef = useRef(0);
  const renameInFlightRef = useRef<Set<string>>(new Set());

  const [dragSource, setDragSource] = useState<ScopedDragSource | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<ScopedPathState | null>(null);

  const [toast, setToast] = useState<FileTreeToast | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const workspaceAgentIdRef = useRef(workspaceAgentId);

  // Permanent delete confirmation state
  const [deleteConfirmation, setDeleteConfirmation] = useState<ScopedDeleteConfirmation | null>(null);
  const deleteConfirmationSessionIdRef = useRef(0);

  const clearToastTimer = useCallback(() => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, []);

  const dismissToast = useCallback(() => {
    clearToastTimer();
    setToast(null);
  }, [clearToastTimer]);

  const clearContextMenuIfCurrent = useCallback((targetContextMenu: ScopedContextMenu | null) => {
    setContextMenu((currentContextMenu) => (
      isSameScopedSession(currentContextMenu, targetContextMenu) ? null : currentContextMenu
    ));
  }, []);

  const clearRenameIfCurrent = useCallback((targetRenameState: ScopedRenameState | null) => {
    setRenameState((currentRenameState) => (
      isSameScopedSession(currentRenameState, targetRenameState) ? null : currentRenameState
    ));
  }, []);

  const clearDeleteConfirmationIfCurrent = useCallback((targetDeleteConfirmation: ScopedDeleteConfirmation | null) => {
    setDeleteConfirmation((currentDeleteConfirmation) => (
      isSameScopedSession(currentDeleteConfirmation, targetDeleteConfirmation)
        ? null
        : currentDeleteConfirmation
    ));
  }, []);

  const showToastForAgent = useCallback((
    targetAgentId: string,
    nextToast: FileTreeToastPayload,
    timeoutMs?: number,
  ) => {
    if (workspaceAgentIdRef.current !== targetAgentId) return;

    clearToastTimer();
    const toastWithAgentId = { ...nextToast, agentId: targetAgentId } as FileTreeToast;
    setToast(toastWithAgentId);

    if (timeoutMs && timeoutMs > 0) {
      toastTimerRef.current = window.setTimeout(() => {
        setToast((currentToast) => (currentToast === toastWithAgentId ? null : currentToast));
        toastTimerRef.current = null;
      }, timeoutMs);
    }
  }, [clearToastTimer]);

  const visibleToast = toast?.agentId === workspaceAgentId ? toast : null;
  const visibleContextMenu = contextMenu?.agentId === workspaceAgentId ? contextMenu : null;
  const visibleDeleteConfirmation = deleteConfirmation?.agentId === workspaceAgentId
    ? deleteConfirmation
    : null;
  const visibleRenameState = renameState?.agentId === workspaceAgentId ? renameState : null;
  const visibleDragSource = dragSource?.agentId === workspaceAgentId ? dragSource.entry : null;
  const visibleDropTargetPath = dropTargetPath?.agentId === workspaceAgentId ? dropTargetPath.path : null;

  useEffect(() => {
    workspaceAgentIdRef.current = workspaceAgentId;
    if (toast && toast.agentId !== workspaceAgentId) {
      dismissToast();
    }
    if (contextMenu && contextMenu.agentId !== workspaceAgentId) {
      setContextMenu(null);
    }
    if (deleteConfirmation && deleteConfirmation.agentId !== workspaceAgentId) {
      setDeleteConfirmation(null);
    }
    if (renameState && renameState.agentId !== workspaceAgentId) {
      setRenameState(null);
    }
    if (dragSource && dragSource.agentId !== workspaceAgentId) {
      setDragSource(null);
    }
    if (dropTargetPath && dropTargetPath.agentId !== workspaceAgentId) {
      setDropTargetPath(null);
    }
  }, [contextMenu, deleteConfirmation, dismissToast, dragSource, dropTargetPath, renameState, toast, workspaceAgentId]);

  useEffect(() => () => clearToastTimer(), [clearToastTimer]);

  // Close context menu on outside click / escape
  useEffect(() => {
    if (!visibleContextMenu) return;

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (contextMenuRef.current?.contains(target)) return;
      setContextMenu(null);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [visibleContextMenu]);

  // Clamp context menu within the file explorer bounds after render.
  useEffect(() => {
    if (!visibleContextMenu || !contextMenuRef.current) return;

    const menuEl = contextMenuRef.current;
    const width = menuEl.offsetWidth;
    const height = menuEl.offsetHeight;
    const panelRect = panelRef.current?.getBoundingClientRect();

    const minX = panelRect ? panelRect.left + MENU_VIEWPORT_PADDING : MENU_VIEWPORT_PADDING;
    const minY = panelRect ? panelRect.top + MENU_VIEWPORT_PADDING : MENU_VIEWPORT_PADDING;
    const maxX = panelRect
      ? Math.max(minX, panelRect.right - width - MENU_VIEWPORT_PADDING)
      : Math.max(MENU_VIEWPORT_PADDING, window.innerWidth - width - MENU_VIEWPORT_PADDING);
    const maxY = panelRect
      ? Math.max(minY, panelRect.bottom - height - MENU_VIEWPORT_PADDING)
      : Math.max(MENU_VIEWPORT_PADDING, window.innerHeight - height - MENU_VIEWPORT_PADDING);

    const nextX = Math.min(Math.max(visibleContextMenu.x, minX), maxX);
    const nextY = Math.min(Math.max(visibleContextMenu.y, minY), maxY);

    if (nextX !== visibleContextMenu.x || nextY !== visibleContextMenu.y) {
      setContextMenu((prev) => (prev ? { ...prev, x: nextX, y: nextY } : prev));
    }
  }, [visibleContextMenu]);

  const toggleCollapsed = useCallback(() => {
    onCollapseChange(!collapsed);
  }, [collapsed, onCollapseChange]);

  // Resize drag handling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const startX = e.clientX;
    const startWidth = widthRef.current;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta));
      widthRef.current = newWidth;
      if (panelRef.current) {
        panelRef.current.style.width = `${newWidth}px`;
      }
    };

    const onMouseUp = () => {
      draggingRef.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem(WIDTH_STORAGE_KEY, String(widthRef.current)); } catch { /* ignore */ }
      setWidth(widthRef.current);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const handleDoubleClickResize = useCallback(() => {
    widthRef.current = DEFAULT_WIDTH;
    if (panelRef.current) panelRef.current.style.width = `${DEFAULT_WIDTH}px`;
    try { localStorage.setItem(WIDTH_STORAGE_KEY, String(DEFAULT_WIDTH)); } catch { /* ignore */ }
    setWidth(DEFAULT_WIDTH);
  }, []);

  const postFileOp = useCallback(async <T extends { ok?: boolean; error?: string }>(
    endpoint: string,
    body: Record<string, unknown>,
    targetAgentId = workspaceAgentId,
  ): Promise<T> => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, agentId: targetAgentId }),
    });

    let data: T;
    try {
      data = await res.json() as T;
    } catch {
      throw new Error('Invalid server response');
    }

    if (!res.ok || data.ok === false) {
      throw new Error(data.error || 'Operation failed');
    }

    return data;
  }, [workspaceAgentId]);

  const runMove = useCallback(async (sourcePath: string, targetDirPath: string) => {
    try {
      // Dragging onto .trash behaves like explicit trash action.
      if (targetDirPath === '.trash' && !sourcePath.startsWith('.trash/')) {
        // In custom workspaces, treat drag-to-trash as regular move since undo system doesn't exist
        if (workspaceInfo?.isCustomWorkspace) {
          const result = await postFileOp<FileOpResult>('/api/files/move', {
            sourcePath,
            targetDirPath: '.trash',
          });
          refresh(workspaceAgentId);
          onRemapOpenPaths?.(result.from, result.to, workspaceAgentId);
          selectFile(result.to, workspaceAgentId);
          showToastForAgent(workspaceAgentId, { type: 'success', message: `Moved ${basename(result.from)} to .trash` }, 3000);
          return;
        }

        const result = await postFileOp<FileOpResult>('/api/files/trash', { path: sourcePath });
        onCloseOpenPaths?.(result.from, workspaceAgentId);
        refresh(workspaceAgentId);
        showToastForAgent(
          workspaceAgentId,
          {
            type: 'undo',
            message: `Moved ${basename(result.from)} to Trash`,
            trashPath: result.to,
            ttlMs: result.undoTtlMs ?? UNDO_TOAST_TTL_MS,
          },
          result.undoTtlMs ?? UNDO_TOAST_TTL_MS,
        );
        return;
      }

      const result = await postFileOp<FileOpResult>('/api/files/move', {
        sourcePath,
        targetDirPath,
      });
      refresh(workspaceAgentId);
      onRemapOpenPaths?.(result.from, result.to, workspaceAgentId);
      selectFile(result.to, workspaceAgentId);
      showToastForAgent(workspaceAgentId, { type: 'success', message: `Moved ${basename(result.from)}` }, 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Move failed';
      showToastForAgent(workspaceAgentId, { type: 'error', message }, 4500);
    }
  }, [onCloseOpenPaths, onRemapOpenPaths, postFileOp, refresh, selectFile, showToastForAgent, workspaceAgentId, workspaceInfo]);

  const canDropToTarget = useCallback((source: TreeEntry, targetDirPath: string): boolean => {
    if (source.path === '.trash') return false;

    // No-op move to same parent
    if (getParentDir(source.path) === targetDirPath) return false;

    // Drag to trash allowed (soft-delete flow), unless already in trash.
    if (targetDirPath === '.trash') {
      return !source.path.startsWith('.trash/');
    }

    if (source.type === 'directory') {
      if (targetDirPath === source.path) return false;
      if (targetDirPath.startsWith(`${source.path}/`)) return false;
    }

    return true;
  }, []);

  const handleContextMenu = useCallback((entry: TreeEntry, event: React.MouseEvent) => {
    event.preventDefault();
    selectFile(entry.path);
    const targetRect = event.currentTarget.getBoundingClientRect();
    const nextX = Math.min(event.clientX + MENU_CURSOR_OFFSET, targetRect.right - MENU_VIEWPORT_PADDING);
    const nextY = targetRect.top + MENU_ROW_TOP_OFFSET;
    contextMenuSessionIdRef.current += 1;
    setContextMenu({
      agentId: workspaceAgentId,
      sessionId: contextMenuSessionIdRef.current,
      x: nextX,
      y: nextY,
      entry,
    });
  }, [selectFile, workspaceAgentId]);

  const startRename = useCallback((entry: TreeEntry) => {
    if (entry.path === '.trash') {
      showToastForAgent(workspaceAgentId, { type: 'error', message: 'Cannot rename .trash root' }, 3500);
      return;
    }
    renameSessionIdRef.current += 1;
    setRenameState({
      agentId: workspaceAgentId,
      sessionId: renameSessionIdRef.current,
      path: entry.path,
      value: entry.name,
    });
    setContextMenu(null);
  }, [showToastForAgent, workspaceAgentId]);

  const handleRenameChange = useCallback((value: string) => {
    setRenameState((currentRenameState) => {
      if (!currentRenameState || currentRenameState.agentId !== workspaceAgentId) return currentRenameState;
      return { ...currentRenameState, value };
    });
  }, [workspaceAgentId]);

  const cancelRename = useCallback(() => {
    setRenameState(null);
  }, []);

  const commitRename = useCallback(async () => {
    if (!renameState) return;

    const renameSession = renameState;
    const renameSessionKey = `${renameSession.agentId}:${renameSession.sessionId}`;
    if (renameInFlightRef.current.has(renameSessionKey)) return;

    const targetAgentId = renameSession.agentId;
    const nextName = renameSession.value.trim();
    if (!nextName) {
      showToastForAgent(targetAgentId, { type: 'error', message: 'Name cannot be empty' }, 3000);
      clearRenameIfCurrent(renameSession);
      return;
    }

    renameInFlightRef.current.add(renameSessionKey);
    try {
      const result = await postFileOp<FileOpResult>('/api/files/rename', {
        path: renameSession.path,
        newName: nextName,
      }, targetAgentId);
      clearRenameIfCurrent(renameSession);
      refresh(targetAgentId);
      onRemapOpenPaths?.(result.from, result.to, targetAgentId);
      selectFile(result.to, targetAgentId);
      showToastForAgent(targetAgentId, { type: 'success', message: `Renamed to ${basename(result.to)}` }, 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Rename failed';
      showToastForAgent(targetAgentId, { type: 'error', message }, 4500);
      clearRenameIfCurrent(renameSession);
    } finally {
      renameInFlightRef.current.delete(renameSessionKey);
    }
  }, [clearRenameIfCurrent, onRemapOpenPaths, postFileOp, refresh, renameState, selectFile, showToastForAgent]);

  const moveToTrash = useCallback(async (entry: TreeEntry) => {
    const targetAgentId = workspaceAgentId;
    const originatingContextMenu = visibleContextMenu?.entry.path === entry.path
      ? visibleContextMenu
      : null;

    if (entry.path === '.trash' || entry.path.startsWith('.trash/')) {
      showToastForAgent(targetAgentId, { type: 'error', message: 'Item is already in Trash' }, 3000);
      setContextMenu(null);
      return;
    }

    // Show confirmation for permanent deletion
    if (workspaceInfo?.isCustomWorkspace) {
      deleteConfirmationSessionIdRef.current += 1;
      setDeleteConfirmation({
        agentId: targetAgentId,
        sessionId: deleteConfirmationSessionIdRef.current,
        entry,
      });
      setContextMenu(null);
      return;
    }

    // Normal trash behavior (no confirmation)
    try {
      const result = await postFileOp<FileOpResult>('/api/files/trash', { path: entry.path }, targetAgentId);
      onCloseOpenPaths?.(result.from, targetAgentId);
      refresh(targetAgentId);
      clearContextMenuIfCurrent(originatingContextMenu);
      showToastForAgent(
        targetAgentId,
        {
          type: 'undo',
          message: `Moved ${basename(result.from)} to Trash`,
          trashPath: result.to,
          ttlMs: result.undoTtlMs ?? UNDO_TOAST_TTL_MS,
        },
        result.undoTtlMs ?? UNDO_TOAST_TTL_MS,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Move to Trash failed';
      showToastForAgent(targetAgentId, { type: 'error', message }, 4500);
      clearContextMenuIfCurrent(originatingContextMenu);
    }
  }, [clearContextMenuIfCurrent, onCloseOpenPaths, postFileOp, refresh, showToastForAgent, visibleContextMenu, workspaceAgentId, workspaceInfo]);

  const confirmPermanentDelete = useCallback(async (confirmation: ScopedDeleteConfirmation) => {
    const targetAgentId = confirmation.agentId;
    try {
      const result = await postFileOp<FileOpResult>('/api/files/trash', { path: confirmation.entry.path }, targetAgentId);
      onCloseOpenPaths?.(result.from, targetAgentId);
      refresh(targetAgentId);
      showToastForAgent(
        targetAgentId,
        { type: 'success', message: `Permanently deleted ${basename(result.from)}` },
        3000,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Permanent deletion failed';
      showToastForAgent(targetAgentId, { type: 'error', message }, 4500);
    } finally {
      clearDeleteConfirmationIfCurrent(confirmation);
    }
  }, [clearDeleteConfirmationIfCurrent, onCloseOpenPaths, postFileOp, refresh, showToastForAgent]);

  const restoreEntry = useCallback(async (entryPath: string, targetAgentId = workspaceAgentId) => {
    try {
      const result = await postFileOp<FileOpResult>('/api/files/restore', { path: entryPath }, targetAgentId);
      refresh(targetAgentId);
      onRemapOpenPaths?.(result.from, result.to, targetAgentId);
      selectFile(result.to, targetAgentId);
      showToastForAgent(targetAgentId, { type: 'success', message: `Restored ${basename(result.to)}` }, 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Restore failed';
      showToastForAgent(targetAgentId, { type: 'error', message }, 4500);
    }
  }, [onRemapOpenPaths, postFileOp, refresh, selectFile, showToastForAgent, workspaceAgentId]);

  const handleUndoToast = useCallback(async () => {
    if (!visibleToast || visibleToast.type !== 'undo') return;
    const { trashPath, agentId: targetAgentId } = visibleToast;
    dismissToast();
    await restoreEntry(trashPath, targetAgentId);
  }, [dismissToast, restoreEntry, visibleToast]);

  const handleDragStart = useCallback((entry: TreeEntry, event: React.DragEvent) => {
    if (entry.path === '.trash') return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', entry.path);
    setDragSource({ agentId: workspaceAgentId, entry });
    selectFile(entry.path);
  }, [selectFile, workspaceAgentId]);

  const handleDragEnd = useCallback(() => {
    setDragSource(null);
    setDropTargetPath(null);
  }, []);

  const handleDragOverDirectory = useCallback((entry: TreeEntry, event: React.DragEvent) => {
    if (!visibleDragSource) return;
    if (!canDropToTarget(visibleDragSource, entry.path)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetPath({ agentId: workspaceAgentId, path: entry.path });
  }, [canDropToTarget, visibleDragSource, workspaceAgentId]);

  const handleDragLeaveDirectory = useCallback((entry: TreeEntry, event: React.DragEvent) => {
    if (visibleDropTargetPath !== entry.path) return;
    const relatedTarget = event.relatedTarget as Node | null;
    if (relatedTarget && event.currentTarget.contains(relatedTarget)) return;
    setDropTargetPath(null);
  }, [visibleDropTargetPath]);

  const handleDropDirectory = useCallback((entry: TreeEntry, event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!visibleDragSource) return;

    const source = visibleDragSource;
    setDragSource(null);
    setDropTargetPath(null);

    if (!canDropToTarget(source, entry.path)) return;
    void runMove(source.path, entry.path);
  }, [canDropToTarget, runMove, visibleDragSource]);

  const handleRootDragOver = useCallback((event: React.DragEvent) => {
    if (!visibleDragSource) return;
    if (!canDropToTarget(visibleDragSource, '')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetPath({ agentId: workspaceAgentId, path: '.' });
  }, [canDropToTarget, visibleDragSource, workspaceAgentId]);

  const handleRootDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    if (!visibleDragSource) return;

    const source = visibleDragSource;
    setDragSource(null);
    setDropTargetPath(null);

    if (!canDropToTarget(source, '')) return;
    void runMove(source.path, '');
  }, [canDropToTarget, runMove, visibleDragSource]);

  // Collapsed state - hide the panel and let the chat header host the reopen control.
  if (collapsed) {
    return null;
  }

  const menuEntry = visibleContextMenu?.entry;
  const menuPath = menuEntry?.path || '';
  const menuInTrash = isTrashItemPath(menuPath);
  const showRestore = menuInTrash;
  const showRename = Boolean(menuEntry && menuPath !== '.trash');
  const showTrashAction = Boolean(menuEntry && !menuPath.startsWith('.trash') && menuPath !== '.trash');

  return (
    <div
      ref={panelRef}
      className="relative flex h-full min-h-0 w-full shrink-0 flex-col overflow-visible"
      style={isCompactLayout ? undefined : { width }}
    >
      <div
        className="shell-panel flex h-full min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-[28px]"
        onContextMenu={(e) => {
          // Right-click on empty panel area closes any open context menu.
          if (e.target === e.currentTarget) {
            e.preventDefault();
            setContextMenu(null);
          }
        }}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between border-b border-border/70 px-4 py-3 ${visibleDropTargetPath === '.' ? 'bg-primary/12 ring-1 ring-inset ring-primary/35' : 'bg-gradient-to-r from-secondary/90 to-card/85'}`}
          onDragOver={handleRootDragOver}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            if (visibleDropTargetPath === '.') setDropTargetPath(null);
          }}
          onDrop={handleRootDrop}
        >
          <span className="text-[10px] font-mono font-semibold uppercase tracking-[0.26em] text-muted-foreground">
            {workspaceInfo?.isCustomWorkspace ? workspaceInfo.rootPath : 'Workspace'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refresh(workspaceAgentId)}
              className="shell-icon-button size-10 px-0"
              title="Refresh file tree"
              aria-label="Refresh file tree"
            >
              <RefreshCw size={16} />
            </button>
            <button
              onClick={toggleCollapsed}
              className="shell-icon-button size-10 px-0"
              title="Close file explorer (Ctrl+B)"
              aria-label="Close file explorer"
            >
              <PanelLeftClose size={16} />
            </button>
          </div>
        </div>

        {/* Tree content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-1" role="tree" aria-label="File explorer">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
              <RefreshCw className="animate-spin" size={12} />
              Loading...
            </div>
          ) : error ? (
            <div className="px-3 py-4 text-xs text-destructive">
              {error}
              <button
                onClick={() => refresh(workspaceAgentId)}
                className="block mt-2 text-primary hover:underline"
              >
                Retry
              </button>
            </div>
          ) : entries.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">
              Empty workspace
            </div>
          ) : (
            entries.map((entry) => (
              <FileTreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                expandedPaths={expandedPaths}
                selectedPath={selectedPath}
                loadingPaths={loadingPaths}
                onToggleDir={toggleDirectory}
                onOpenFile={onOpenFile}
                onSelect={selectFile}
                onContextMenu={handleContextMenu}
                dragSourcePath={visibleDragSource?.path || null}
                dropTargetPath={visibleDropTargetPath}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOverDirectory={handleDragOverDirectory}
                onDragLeaveDirectory={handleDragLeaveDirectory}
                onDropDirectory={handleDropDirectory}
                renamingPath={visibleRenameState?.path || null}
                renameValue={visibleRenameState?.value || ''}
                onRenameChange={handleRenameChange}
                onRenameCommit={() => { void commitRename(); }}
                onRenameCancel={cancelRename}
              />
            ))
          )}
        </div>
      </div>

      {/* Context menu */}
      {visibleContextMenu && menuEntry && (
        <div
          ref={contextMenuRef}
          className="shell-panel fixed z-50 min-w-[180px] rounded-2xl py-1.5"
          style={{ left: visibleContextMenu.x, top: visibleContextMenu.y }}
        >
          {showRestore && (
            <button
              className="w-full px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted/60 flex items-center gap-2"
              onClick={() => {
                setContextMenu(null);
                void restoreEntry(menuEntry.path);
              }}
            >
              <RotateCcw size={12} />
              Restore
            </button>
          )}

          {showRename && (
            <button
              className="w-full px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted/60 flex items-center gap-2"
              onClick={() => startRename(menuEntry)}
            >
              <Pencil size={12} />
              Rename
            </button>
          )}

          {showTrashAction && (
            <button
              className="w-full px-3 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10 flex items-center gap-2"
              onClick={() => { void moveToTrash(menuEntry); }}
            >
              <Trash2 size={12} />
              {workspaceInfo?.isCustomWorkspace ? 'Permanently Delete' : 'Move to Trash'}
            </button>
          )}

          {!showRestore && !showRename && !showTrashAction && (
            <div className="px-3 py-1.5 text-xs text-muted-foreground">
              No actions
            </div>
          )}
        </div>
      )}

      {/* Toast */}
      {visibleToast && (
        <div className="shell-panel fixed bottom-4 left-2 right-2 z-[70] flex w-auto min-w-0 max-w-[min(92vw,680px)] items-center gap-3 rounded-2xl px-4 py-3 text-xs sm:left-4 sm:right-auto sm:min-w-[320px]">
          <span className={`flex-1 ${visibleToast.type === 'error' ? 'text-destructive' : 'text-foreground'}`}>
            {visibleToast.message}
          </span>
          {visibleToast.type === 'undo' && (
            <button
              className="text-primary hover:underline shrink-0"
              onClick={() => { void handleUndoToast(); }}
            >
              Undo
            </button>
          )}
          <button
            className="ml-1 text-muted-foreground hover:text-foreground shrink-0"
            onClick={dismissToast}
            aria-label="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Resize handle */}
      {!isCompactLayout && (
        <div
          className="absolute top-0 -right-3 z-20 flex h-full w-3 cursor-col-resize items-stretch justify-center"
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClickResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize file explorer"
        >
          <div className="pointer-events-none my-3 w-px rounded-full bg-border transition-colors hover:bg-primary/55" />
        </div>
      )}

      {/* Permanent delete confirmation dialog */}
      {visibleDeleteConfirmation && (
        <ConfirmDialog
          open={true}
          title="Permanently Delete"
          message={`Are you sure you want to permanently delete "${visibleDeleteConfirmation.entry.name}"? This action cannot be undone.`}
          confirmLabel="Permanently Delete"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={() => { void confirmPermanentDelete(visibleDeleteConfirmation); }}
          onCancel={() => setDeleteConfirmation(null)}
        />
      )}
    </div>
  );
}
