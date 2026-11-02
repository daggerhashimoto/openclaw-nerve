/**
 * FileTreePanel: Collapsible file tree sidebar on the far left.
 *
 * Shows workspace files in a tree structure. Directories lazy-load on expand.
 * Double-click a file to open it as an editor tab.
 */

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { PanelLeftClose, RefreshCw, X } from 'lucide-react';
import { FileTreeNode } from './FileTreeNode';
import { buildFileTreeMenuActions } from './fileTreeMenuActions';
import {
  FILE_TREE_OVERSCAN_ROWS,
  FILE_TREE_ROW_HEIGHT,
  flattenVisibleFileTree,
} from './fileTreeRows';
import { useFileTree } from './hooks/useFileTree';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useSettings } from '@/contexts/SettingsContext';
import type { TreeEntry } from './types';

const MIN_WIDTH = 160;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 248;
/** Sentinel value for width state when collapsed. */
const COLLAPSED_WIDTH = 0;

const WIDTH_STORAGE_KEY = 'nerve-file-tree-width';
const MENU_VIEWPORT_PADDING = 8;
const MENU_CURSOR_OFFSET = 6;
const MENU_ROW_TOP_OFFSET = 2;
const TOUCH_MENU_OFFSET_X = 0;
const TOUCH_MENU_OFFSET_Y = 0;
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

export interface FileTreeChangeEvent {
  path: string;
  agentId: string;
  sequence: number;
}

interface FileTreePanelProps {
  workspaceAgentId: string;
  onOpenFile: (path: string) => void;
  onAddToChat?: (path: string, kind: 'file' | 'directory', agentId?: string) => Promise<void> | void;
  addToChatEnabled?: boolean;
  onRemapOpenPaths?: (fromPath: string, toPath: string, targetAgentId?: string) => void;
  onCloseOpenPaths?: (pathPrefix: string, targetAgentId?: string) => void;
  /** Called externally when a file changes (SSE); refreshes affected directory. */
  lastChangedEvent?: FileTreeChangeEvent | null;
  /** Ask the tree to reveal and select a workspace path. */
  revealRequest?: { id: number; path: string; kind: 'file' | 'directory'; agentId: string } | null;
  /** Layout hint retained for compatibility with existing callers. */
  isCompactLayout?: boolean;
  /** Callback to notify parent of collapse state changes */
  onCollapseChange: (collapsed: boolean) => void;
  /** External control of collapsed state */
  collapsed: boolean;
  /** Whether the agent is running now; files changed during a run are lit as live work. */
  agentRunning?: boolean;
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
type ScopedContextMenu = ScopedSessionState & {
  x: number;
  y: number;
  entry: TreeEntry;
  source: 'mouse' | 'touch';
  touchAnchorX?: number;
  touchAnchorY?: number;
};
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
  onAddToChat,
  addToChatEnabled = false,
  onRemapOpenPaths,
  onCloseOpenPaths,
  lastChangedEvent,
  revealRequest,
  isCompactLayout = false,
  onCollapseChange,
  collapsed,
  agentRunning = false,
}: FileTreePanelProps) {
  const { showHiddenWorkspaceEntries } = useSettings();
  const {
    entries, loading, error, expandedPaths, selectedPath,
    loadingPaths, workspaceInfo, toggleDirectory, selectFile, refresh, handleFileChange, revealPath,
  } = useFileTree(workspaceAgentId, showHiddenWorkspaceEntries);

  // React to external file changes. Sequence keeps repeated same-path events distinct,
  // and agentId prevents a stale event from one workspace from replaying in another.
  const lastHandledChangeSequenceRef = useRef<number | null>(null);
  // The file the running agent last changed: lit with a live pane until the run ends.
  const [livePath, setLivePath] = useState<string | null>(null);
  useEffect(() => {
    if (!lastChangedEvent) return;
    if (lastChangedEvent.agentId !== workspaceAgentId) return;
    if (lastHandledChangeSequenceRef.current === lastChangedEvent.sequence) return;

    lastHandledChangeSequenceRef.current = lastChangedEvent.sequence;
    handleFileChange(lastChangedEvent.path);
    if (agentRunning) setLivePath(lastChangedEvent.path);
  }, [agentRunning, handleFileChange, lastChangedEvent, workspaceAgentId]);

  // The pane goes dark when the run ends or the workspace changes. Mounting the panel
  // (the compact drawer opens) is not a workspace change, so a live file stays lit.
  useEffect(() => {
    if (!agentRunning) setLivePath(null);
  }, [agentRunning]);
  const previousWorkspaceRef = useRef(workspaceAgentId);
  useEffect(() => {
    if (previousWorkspaceRef.current === workspaceAgentId) return;
    previousWorkspaceRef.current = workspaceAgentId;
    setLivePath(null);
  }, [workspaceAgentId]);

  const lastHandledRevealIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!revealRequest) return;
    if (revealRequest.agentId !== workspaceAgentId) return;
    if (lastHandledRevealIdRef.current === revealRequest.id) return;

    lastHandledRevealIdRef.current = revealRequest.id;
    void revealPath(revealRequest.path, revealRequest.kind, workspaceAgentId);
  }, [revealPath, revealRequest, workspaceAgentId]);

  const panelRef = useRef<HTMLDivElement>(null);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(loadWidth());
  const draggingRef = useRef(false);
  const [width, setWidth] = useState(() => {
    return collapsed ? COLLAPSED_WIDTH : loadWidth();
  });
  const [treeScrollTop, setTreeScrollTop] = useState(0);
  const [treeViewportHeight, setTreeViewportHeight] = useState(0);

  // Handle external collapsed state changes (e.g., from mobile button)
  useEffect(() => {
    const targetWidth = collapsed ? COLLAPSED_WIDTH : widthRef.current;
    setWidth(targetWidth);
  }, [collapsed]);

  useEffect(() => {
    const scrollEl = treeScrollRef.current;
    if (!scrollEl) return undefined;

    const updateViewport = () => {
      setTreeViewportHeight(scrollEl.clientHeight);
    };

    updateViewport();

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateViewport)
      : null;
    resizeObserver?.observe(scrollEl);
    window.addEventListener('resize', updateViewport);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateViewport);
    };
  }, [collapsed]);

  const [contextMenu, setContextMenu] = useState<ScopedContextMenu | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuSessionIdRef = useRef(0);
  const suppressMouseDownUntilRef = useRef(0);

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
  const flatRows = useMemo(() => flattenVisibleFileTree(entries, expandedPaths), [entries, expandedPaths]);
  const rawStartIndex = Math.floor(treeScrollTop / FILE_TREE_ROW_HEIGHT) - FILE_TREE_OVERSCAN_ROWS;
  const maxStartIndex = Math.max(0, flatRows.length - 1);
  const visibleStartIndex = Math.min(maxStartIndex, Math.max(0, rawStartIndex));
  const visibleCapacity = treeViewportHeight > 0
    ? Math.ceil(treeViewportHeight / FILE_TREE_ROW_HEIGHT) + FILE_TREE_OVERSCAN_ROWS * 2
    : 80;
  const visibleEndIndex = Math.min(flatRows.length, visibleStartIndex + visibleCapacity);
  const virtualRows = flatRows.slice(visibleStartIndex, visibleEndIndex);
  const virtualTreeHeight = flatRows.length * FILE_TREE_ROW_HEIGHT;

  useEffect(() => {
    if (!selectedPath) return;
    const scrollEl = treeScrollRef.current;
    if (!scrollEl) return;

    const selectedIndex = flatRows.findIndex((row) => row.entry.path === selectedPath);
    if (selectedIndex < 0) return;

    const viewportHeight = scrollEl.clientHeight || treeViewportHeight;
    if (viewportHeight <= 0) return;

    const rowTop = selectedIndex * FILE_TREE_ROW_HEIGHT;
    const rowBottom = rowTop + FILE_TREE_ROW_HEIGHT;
    const currentTop = scrollEl.scrollTop;
    const currentBottom = currentTop + viewportHeight;

    if (rowTop < currentTop) {
      scrollEl.scrollTop = rowTop;
      setTreeScrollTop(rowTop);
    } else if (rowBottom > currentBottom) {
      const nextTop = rowBottom - viewportHeight;
      scrollEl.scrollTop = nextTop;
      setTreeScrollTop(nextTop);
    }
  }, [flatRows, selectedPath, treeViewportHeight]);

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
      if (visibleContextMenu.source === 'touch' && Date.now() < suppressMouseDownUntilRef.current) return;
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
    const visualViewport = window.visualViewport;
    const viewportLeft = visualViewport?.offsetLeft ?? 0;
    const viewportTop = visualViewport?.offsetTop ?? 0;
    const viewportWidth = visualViewport?.width ?? window.innerWidth;
    const viewportHeight = visualViewport?.height ?? window.innerHeight;

    const minX = visibleContextMenu.source === 'touch'
      ? viewportLeft + MENU_VIEWPORT_PADDING
      : (panelRect ? panelRect.left + MENU_VIEWPORT_PADDING : MENU_VIEWPORT_PADDING);
    const minY = visibleContextMenu.source === 'touch'
      ? viewportTop + MENU_VIEWPORT_PADDING
      : (panelRect ? panelRect.top + MENU_VIEWPORT_PADDING : MENU_VIEWPORT_PADDING);
    const maxX = visibleContextMenu.source === 'touch'
      ? Math.max(minX, viewportLeft + viewportWidth - width - MENU_VIEWPORT_PADDING)
      : (panelRect
        ? Math.max(minX, panelRect.right - width - MENU_VIEWPORT_PADDING)
        : Math.max(MENU_VIEWPORT_PADDING, window.innerWidth - width - MENU_VIEWPORT_PADDING));
    const maxY = visibleContextMenu.source === 'touch'
      ? Math.max(minY, viewportTop + viewportHeight - height - MENU_VIEWPORT_PADDING)
      : (panelRect
        ? Math.max(minY, panelRect.bottom - height - MENU_VIEWPORT_PADDING)
        : Math.max(MENU_VIEWPORT_PADDING, window.innerHeight - height - MENU_VIEWPORT_PADDING));

    const targetX = visibleContextMenu.source === 'touch'
      ? (visibleContextMenu.touchAnchorX ?? visibleContextMenu.x)
      : visibleContextMenu.x;
    const targetY = visibleContextMenu.source === 'touch'
      ? ((visibleContextMenu.touchAnchorY ?? visibleContextMenu.y) - height)
      : visibleContextMenu.y;

    const nextX = Math.min(Math.max(targetX, minX), maxX);
    const nextY = Math.min(Math.max(targetY, minY), maxY);

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
      source: 'mouse',
    });
  }, [selectFile, workspaceAgentId]);

  const openTouchContextMenu = useCallback((entry: TreeEntry, touchPoint: { x: number; y: number }) => {
    selectFile(entry.path);
    contextMenuSessionIdRef.current += 1;
    suppressMouseDownUntilRef.current = Date.now() + 500;
    setContextMenu({
      agentId: workspaceAgentId,
      sessionId: contextMenuSessionIdRef.current,
      x: touchPoint.x + TOUCH_MENU_OFFSET_X,
      y: touchPoint.y + TOUCH_MENU_OFFSET_Y,
      entry,
      source: 'touch',
      touchAnchorX: touchPoint.x,
      touchAnchorY: touchPoint.y,
    });
  }, [selectFile, workspaceAgentId]);

  const openCompactActionsMenu = useCallback((entry: TreeEntry, anchorRect: DOMRect) => {
    setContextMenu((currentContextMenu) => {
      if (
        currentContextMenu
        && currentContextMenu.agentId === workspaceAgentId
        && currentContextMenu.source === 'mouse'
        && currentContextMenu.entry.path === entry.path
      ) {
        return null;
      }

      contextMenuSessionIdRef.current += 1;
      return {
        agentId: workspaceAgentId,
        sessionId: contextMenuSessionIdRef.current,
        x: anchorRect.right - MENU_CURSOR_OFFSET,
        y: anchorRect.bottom + MENU_VIEWPORT_PADDING,
        entry,
        source: 'mouse',
      };
    });
  }, [workspaceAgentId]);

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
      const message = err instanceof Error ? err.message : 'Move to trash failed';
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

  const menuEntry = visibleContextMenu?.entry ?? null;
  const menuActions = menuEntry
    ? buildFileTreeMenuActions(menuEntry, {
        addToChatEnabled,
        canAddToChat: Boolean(onAddToChat),
        isCustomWorkspace: Boolean(workspaceInfo?.isCustomWorkspace),
        onRestore: () => { void restoreEntry(menuEntry.path); },
        onAddToChat: () => {
          const itemKind = menuEntry.type === 'directory' ? 'directory' : 'file';
          void Promise
            .resolve(onAddToChat?.(menuEntry.path, itemKind, workspaceAgentId))
            .catch((error: unknown) => {
              const fallbackMessage = itemKind === 'directory'
                ? 'Failed to add directory to chat'
                : 'Failed to add file to chat';
              const message = error instanceof Error ? error.message : fallbackMessage;
              console.error('[FileTreePanel] add-to-chat failed:', error);
              showToastForAgent(workspaceAgentId, { type: 'error', message }, 4500);
            });
        },
        onRename: () => startRename(menuEntry),
        onTrash: () => { void moveToTrash(menuEntry); },
      })
    : [];

  return (
    <div
      ref={panelRef}
      className="relative flex h-full min-h-0 w-full shrink-0 flex-col overflow-visible"
      style={isCompactLayout ? undefined : { width }}
    >
      <div
        className="shell-panel flex h-full min-h-0 w-full shrink-0 flex-col overflow-hidden"
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
          className={`panel-header justify-between ${visibleDropTargetPath === '.' ? 'bg-raised! ring-1 ring-inset ring-muted-foreground' : ''}`}
          onDragOver={handleRootDragOver}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            if (visibleDropTargetPath === '.') setDropTargetPath(null);
          }}
          onDrop={handleRootDrop}
        >
          <span className="panel-label min-w-0">
            {workspaceInfo?.isCustomWorkspace ? (
              <span className="truncate font-mono text-[0.8rem] font-normal" title={workspaceInfo.rootPath}>
                {workspaceInfo.rootPath}
              </span>
            ) : 'Workspace'}
          </span>
          <div className="flex shrink-0 items-center">
            <button
              onClick={() => refresh(workspaceAgentId)}
              className="shell-icon-button px-0"
              title="Refresh file tree"
              aria-label="Refresh file tree"
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={toggleCollapsed}
              className="shell-icon-button px-0"
              title="Close file explorer (Ctrl+B)"
              aria-label="Close file explorer"
            >
              <PanelLeftClose size={14} />
            </button>
          </div>
        </div>

        {/* Tree content */}
        <div
          ref={treeScrollRef}
          className="flex-1 overflow-y-auto overflow-x-hidden"
          role="tree"
          aria-label="File explorer"
          onScroll={(event) => setTreeScrollTop(event.currentTarget.scrollTop)}
        >
          {loading ? (
            <div className="flex min-h-[var(--row-unit)] items-center gap-2 px-3 text-[0.8rem] text-muted-foreground">
              <RefreshCw className="animate-spin" size={14} />
              Loading...
            </div>
          ) : error ? (
            <div className="px-3 py-2 text-[0.8rem] text-destructive">
              {error}
              <button
                onClick={() => refresh(workspaceAgentId)}
                className="mt-1 -ml-2 flex min-h-[var(--row-unit)] items-center rounded-[3px] px-2 text-[0.867rem] text-foreground transition-colors duration-[120ms] hover:bg-raised"
              >
                Retry
              </button>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex min-h-[var(--row-unit)] items-center px-3 text-[0.8rem] text-muted-foreground">
              Empty workspace
            </div>
          ) : (
            <div className="relative" style={{ height: virtualTreeHeight }}>
              {virtualRows.map((row) => (
                <div
                  key={row.entry.path}
                  className="absolute left-0 right-0"
                  style={{
                    top: row.index * FILE_TREE_ROW_HEIGHT,
                    height: FILE_TREE_ROW_HEIGHT,
                  }}
                >
                  <FileTreeNode
                    entry={row.entry}
                    depth={row.depth}
                    expandedPaths={expandedPaths}
                    selectedPath={selectedPath}
                    loadingPaths={loadingPaths}
                    onToggleDir={toggleDirectory}
                    onOpenFile={onOpenFile}
                    onTouchLongPress={isCompactLayout ? undefined : openTouchContextMenu}
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
                    renderChildren={false}
                    compact={isCompactLayout}
                    onOpenActions={openCompactActionsMenu}
                    livePath={livePath}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Context menu */}
      {visibleContextMenu && menuEntry && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[180px] rounded-[3px] border border-border bg-popover py-1 text-popover-foreground shadow-[0_12px_32px_rgba(0,0,0,0.32)] select-none touch-manipulation"
          style={{
            left: visibleContextMenu.x,
            top: visibleContextMenu.y,
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
          }}
        >
          {menuActions.length > 0 ? (
            menuActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  className={`flex min-h-[var(--row-unit)] w-full items-center gap-2 px-3 text-left text-[0.867rem] transition-colors duration-[120ms] ${
                    action.destructive
                      ? 'text-destructive hover:bg-destructive/10'
                      : 'text-foreground hover:bg-raised'
                  }`}
                  onClick={() => {
                    setContextMenu(null);
                    action.onSelect();
                  }}
                >
                  <Icon size={14} />
                  {action.label}
                </button>
              );
            })
          ) : (
            <div className="flex min-h-[var(--row-unit)] items-center px-3 text-[0.8rem] text-muted-foreground">
              No actions
            </div>
          )}
        </div>
      )}

      {/* Toast */}
      {visibleToast && (
        <div className="fixed bottom-4 left-2 right-2 z-[70] flex w-auto min-w-0 max-w-[min(92vw,680px)] items-center gap-2 rounded-[3px] border border-border bg-popover py-1 pl-3 pr-1 text-[0.867rem] text-popover-foreground shadow-[0_12px_32px_rgba(0,0,0,0.32)] sm:left-4 sm:right-auto sm:min-w-[320px]">
          <span className={`flex-1 ${visibleToast.type === 'error' ? 'text-destructive' : 'text-foreground'}`}>
            {visibleToast.message}
          </span>
          {visibleToast.type === 'undo' && (
            <button
              className="flex min-h-[var(--row-unit)] shrink-0 items-center rounded-[3px] px-2 font-medium text-foreground transition-colors duration-[120ms] hover:bg-raised"
              onClick={() => { void handleUndoToast(); }}
            >
              Undo
            </button>
          )}
          <button
            className="shell-icon-button shrink-0"
            onClick={dismissToast}
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Resize handle */}
      {!isCompactLayout && (
        <div
          className="group absolute top-0 -right-1 z-20 h-full w-2 cursor-col-resize"
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClickResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize file explorer"
        >
          {/* Invisible hit area centred on the column rule; the rule itself is drawn by the column border */}
          <div className="pointer-events-none absolute inset-y-0 right-1 w-px bg-transparent transition-colors duration-[120ms] group-hover:bg-pane-edge group-active:bg-pane-edge" />
        </div>
      )}

      {/* Permanent delete confirmation dialog */}
      {visibleDeleteConfirmation && (
        <ConfirmDialog
          open={true}
          title="Permanently delete"
          message={`Are you sure you want to permanently delete "${visibleDeleteConfirmation.entry.name}"? This action cannot be undone.`}
          confirmLabel="Delete permanently"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={() => { void confirmPermanentDelete(visibleDeleteConfirmation); }}
          onCancel={() => setDeleteConfirmation(null)}
        />
      )}
    </div>
  );
}
