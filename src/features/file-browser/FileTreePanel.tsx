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

interface FileTreePanelProps {
  onOpenFile: (path: string) => void;
  onRemapOpenPaths?: (fromPath: string, toPath: string) => void;
  onCloseOpenPaths?: (pathPrefix: string) => void;
  /** Called externally when a file changes (SSE) — refreshes affected directory */
  lastChangedPath?: string | null;
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

type FileTreeToast =
  | { type: 'success' | 'error'; message: string }
  | { type: 'undo'; message: string; trashPath: string; ttlMs: number };

export function FileTreePanel({
  onOpenFile,
  onRemapOpenPaths,
  onCloseOpenPaths,
  lastChangedPath,
  isCompactLayout = false,
  onCollapseChange,
  collapsed,
}: FileTreePanelProps) {
  const {
    entries, loading, error, expandedPaths, selectedPath,
    loadingPaths, workspaceInfo, toggleDirectory, selectFile, refresh, handleFileChange,
  } = useFileTree();

  // React to external file changes
  const prevChangedPath = useRef<string | null>(null);
  useEffect(() => {
    if (lastChangedPath && lastChangedPath !== prevChangedPath.current) {
      prevChangedPath.current = lastChangedPath;
      handleFileChange(lastChangedPath);
    }
  }, [lastChangedPath, handleFileChange]);

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

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: TreeEntry } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const [renameTargetPath, setRenameTargetPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInFlightRef = useRef(false);

  const [dragSource, setDragSource] = useState<TreeEntry | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);

  const [toast, setToast] = useState<FileTreeToast | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // Permanent delete confirmation state
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ entry: TreeEntry } | null>(null);

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

  const showToast = useCallback((nextToast: FileTreeToast, timeoutMs?: number) => {
    clearToastTimer();
    setToast(nextToast);
    if (timeoutMs && timeoutMs > 0) {
      toastTimerRef.current = window.setTimeout(() => {
        setToast(null);
        toastTimerRef.current = null;
      }, timeoutMs);
    }
  }, [clearToastTimer]);

  useEffect(() => () => clearToastTimer(), [clearToastTimer]);

  // Close context menu on outside click / escape
  useEffect(() => {
    if (!contextMenu) return;

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
  }, [contextMenu]);

  // Clamp context menu within the file explorer bounds after render.
  useEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;

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

    const nextX = Math.min(Math.max(contextMenu.x, minX), maxX);
    const nextY = Math.min(Math.max(contextMenu.y, minY), maxY);

    if (nextX !== contextMenu.x || nextY !== contextMenu.y) {
      setContextMenu((prev) => (prev ? { ...prev, x: nextX, y: nextY } : prev));
    }
  }, [contextMenu]);

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
    body: unknown,
  ): Promise<T> => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
  }, []);

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
          refresh();
          onRemapOpenPaths?.(result.from, result.to);
          selectFile(result.to);
          showToast({ type: 'success', message: `Moved ${basename(result.from)} to .trash` }, 3000);
          return;
        }

        const result = await postFileOp<FileOpResult>('/api/files/trash', { path: sourcePath });
        onCloseOpenPaths?.(result.from);
        refresh();
        showToast(
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
      refresh();
      onRemapOpenPaths?.(result.from, result.to);
      selectFile(result.to);
      showToast({ type: 'success', message: `Moved ${basename(result.from)}` }, 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Move failed';
      showToast({ type: 'error', message }, 4500);
    }
  }, [onCloseOpenPaths, onRemapOpenPaths, postFileOp, refresh, selectFile, showToast, workspaceInfo]);

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
    setContextMenu({ x: nextX, y: nextY, entry });
  }, [selectFile]);

  const startRename = useCallback((entry: TreeEntry) => {
    if (entry.path === '.trash') {
      showToast({ type: 'error', message: 'Cannot rename .trash root' }, 3500);
      return;
    }
    setRenameTargetPath(entry.path);
    setRenameValue(entry.name);
    setContextMenu(null);
  }, [showToast]);

  const cancelRename = useCallback(() => {
    setRenameTargetPath(null);
    setRenameValue('');
  }, []);

  const commitRename = useCallback(async () => {
    if (!renameTargetPath || renameInFlightRef.current) return;

    const nextName = renameValue.trim();
    if (!nextName) {
      showToast({ type: 'error', message: 'Name cannot be empty' }, 3000);
      cancelRename();
      return;
    }

    renameInFlightRef.current = true;
    try {
      const result = await postFileOp<FileOpResult>('/api/files/rename', {
        path: renameTargetPath,
        newName: nextName,
      });
      cancelRename();
      refresh();
      onRemapOpenPaths?.(result.from, result.to);
      selectFile(result.to);
      showToast({ type: 'success', message: `Renamed to ${basename(result.to)}` }, 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Rename failed';
      showToast({ type: 'error', message }, 4500);
      cancelRename();
    } finally {
      renameInFlightRef.current = false;
    }
  }, [cancelRename, onRemapOpenPaths, postFileOp, refresh, renameTargetPath, renameValue, selectFile, showToast]);

  const moveToTrash = useCallback(async (entry: TreeEntry) => {
    if (entry.path === '.trash' || entry.path.startsWith('.trash/')) {
      showToast({ type: 'error', message: 'Item is already in Trash' }, 3000);
      setContextMenu(null);
      return;
    }

    // Show confirmation for permanent deletion
    if (workspaceInfo?.isCustomWorkspace) {
      setDeleteConfirmation({ entry });
      setContextMenu(null);
      return;
    }

    // Normal trash behavior (no confirmation)
    try {
      const result = await postFileOp<FileOpResult>('/api/files/trash', { path: entry.path });
      onCloseOpenPaths?.(result.from);
      refresh();
      setContextMenu(null);
      showToast(
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
      showToast({ type: 'error', message }, 4500);
      setContextMenu(null);
    }
  }, [onCloseOpenPaths, postFileOp, refresh, showToast, workspaceInfo]);

  const confirmPermanentDelete = useCallback(async (entry: TreeEntry) => {
    try {
      const result = await postFileOp<FileOpResult>('/api/files/trash', { path: entry.path });
      onCloseOpenPaths?.(result.from);
      refresh();
      showToast(
        { type: 'success', message: `Permanently deleted ${basename(result.from)}` },
        3000
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Permanent deletion failed';
      showToast({ type: 'error', message }, 4500);
    } finally {
      setDeleteConfirmation(null);
    }
  }, [onCloseOpenPaths, postFileOp, refresh, showToast]);

  const restoreEntry = useCallback(async (entryPath: string) => {
    try {
      const result = await postFileOp<FileOpResult>('/api/files/restore', { path: entryPath });
      refresh();
      onRemapOpenPaths?.(result.from, result.to);
      selectFile(result.to);
      showToast({ type: 'success', message: `Restored ${basename(result.to)}` }, 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Restore failed';
      showToast({ type: 'error', message }, 4500);
    }
  }, [onRemapOpenPaths, postFileOp, refresh, selectFile, showToast]);

  const handleUndoToast = useCallback(async () => {
    if (!toast || toast.type !== 'undo') return;
    const trashPath = toast.trashPath;
    dismissToast();
    await restoreEntry(trashPath);
  }, [dismissToast, restoreEntry, toast]);

  const handleDragStart = useCallback((entry: TreeEntry, event: React.DragEvent) => {
    if (entry.path === '.trash') return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', entry.path);
    setDragSource(entry);
    selectFile(entry.path);
  }, [selectFile]);

  const handleDragEnd = useCallback(() => {
    setDragSource(null);
    setDropTargetPath(null);
  }, []);

  const handleDragOverDirectory = useCallback((entry: TreeEntry, event: React.DragEvent) => {
    if (!dragSource) return;
    if (!canDropToTarget(dragSource, entry.path)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetPath(entry.path);
  }, [canDropToTarget, dragSource]);

  const handleDragLeaveDirectory = useCallback((entry: TreeEntry, event: React.DragEvent) => {
    if (dropTargetPath !== entry.path) return;
    const relatedTarget = event.relatedTarget as Node | null;
    if (relatedTarget && event.currentTarget.contains(relatedTarget)) return;
    setDropTargetPath(null);
  }, [dropTargetPath]);

  const handleDropDirectory = useCallback((entry: TreeEntry, event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!dragSource) return;

    const source = dragSource;
    setDragSource(null);
    setDropTargetPath(null);

    if (!canDropToTarget(source, entry.path)) return;
    void runMove(source.path, entry.path);
  }, [canDropToTarget, dragSource, runMove]);

  const handleRootDragOver = useCallback((event: React.DragEvent) => {
    if (!dragSource) return;
    if (!canDropToTarget(dragSource, '')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetPath('.');
  }, [canDropToTarget, dragSource]);

  const handleRootDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    if (!dragSource) return;

    const source = dragSource;
    setDragSource(null);
    setDropTargetPath(null);

    if (!canDropToTarget(source, '')) return;
    void runMove(source.path, '');
  }, [canDropToTarget, dragSource, runMove]);

  // Collapsed state - hide the panel and let the chat header host the reopen control.
  if (collapsed) {
    return null;
  }

  const menuEntry = contextMenu?.entry;
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
          className={`flex items-center justify-between border-b border-border/70 px-4 py-3 ${dropTargetPath === '.' ? 'bg-primary/12 ring-1 ring-inset ring-primary/35' : 'bg-gradient-to-r from-secondary/90 to-card/85'}`}
          onDragOver={handleRootDragOver}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            if (dropTargetPath === '.') setDropTargetPath(null);
          }}
          onDrop={handleRootDrop}
        >
          <span className="text-[10px] font-mono font-semibold uppercase tracking-[0.26em] text-muted-foreground">
            {workspaceInfo?.isCustomWorkspace ? workspaceInfo.rootPath : 'Workspace'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
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
                onClick={refresh}
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
                dragSourcePath={dragSource?.path || null}
                dropTargetPath={dropTargetPath}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOverDirectory={handleDragOverDirectory}
                onDragLeaveDirectory={handleDragLeaveDirectory}
                onDropDirectory={handleDropDirectory}
                renamingPath={renameTargetPath}
                renameValue={renameValue}
                onRenameChange={setRenameValue}
                onRenameCommit={() => { void commitRename(); }}
                onRenameCancel={cancelRename}
              />
            ))
          )}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && menuEntry && (
        <div
          ref={contextMenuRef}
          className="shell-panel fixed z-50 min-w-[180px] rounded-2xl py-1.5"
          style={{ left: contextMenu.x, top: contextMenu.y }}
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
      {toast && (
        <div className="shell-panel fixed bottom-4 left-2 right-2 z-[70] flex w-auto min-w-0 max-w-[min(92vw,680px)] items-center gap-3 rounded-2xl px-4 py-3 text-xs sm:left-4 sm:right-auto sm:min-w-[320px]">
          <span className={`flex-1 ${toast.type === 'error' ? 'text-destructive' : 'text-foreground'}`}>
            {toast.message}
          </span>
          {toast.type === 'undo' && (
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
      {deleteConfirmation && (
        <ConfirmDialog
          open={true}
          title="Permanently Delete"
          message={`Are you sure you want to permanently delete "${deleteConfirmation.entry.name}"? This action cannot be undone.`}
          confirmLabel="Permanently Delete"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={() => confirmPermanentDelete(deleteConfirmation.entry)}
          onCancel={() => setDeleteConfirmation(null)}
        />
      )}
    </div>
  );
}
