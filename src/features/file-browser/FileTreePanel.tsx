/**
 * FileTreePanel — Collapsible file tree sidebar on the far left.
 *
 * Shows workspace files in a tree structure. Directories lazy-load on expand.
 * Double-click a file to open it as an editor tab.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { PanelLeftClose, PanelLeftOpen, RefreshCw, Pencil, Trash2, RotateCcw, X } from 'lucide-react';
import { FileTreeNode } from './FileTreeNode';
import { useFileTree } from './hooks/useFileTree';
import type { TreeEntry } from './types';

const MIN_WIDTH = 160;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 220;
const COLLAPSED_WIDTH = 0;

const WIDTH_STORAGE_KEY = 'nerve-file-tree-width';
const COLLAPSED_STORAGE_KEY = 'nerve-file-tree-collapsed';
const MENU_VIEWPORT_PADDING = 8;
const UNDO_TOAST_TTL_MS = 10_000;

function loadWidth(): number {
  try {
    const v = localStorage.getItem(WIDTH_STORAGE_KEY);
    return v ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Number(v))) : DEFAULT_WIDTH;
  } catch { return DEFAULT_WIDTH; }
}

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true';
  } catch { return false; }
}

function getParentDir(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx === -1 ? '' : filePath.slice(0, idx);
}

function basename(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx === -1 ? filePath : filePath.slice(idx + 1);
}

function isTrashItemPath(filePath: string): boolean {
  return filePath.startsWith('.trash/') && filePath !== '.trash';
}

interface FileTreePanelProps {
  onOpenFile: (path: string) => void;
  onRemapOpenPaths?: (fromPath: string, toPath: string) => void;
  onCloseOpenPaths?: (pathPrefix: string) => void;
  /** Called externally when a file changes (SSE) — refreshes affected directory */
  lastChangedPath?: string | null;
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
}: FileTreePanelProps) {
  const {
    entries, loading, error, expandedPaths, selectedPath,
    loadingPaths, toggleDirectory, selectFile, refresh, handleFileChange,
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
  const collapsedRef = useRef(loadCollapsed());
  const draggingRef = useRef(false);

  // State-driven rendering (refs hold source of truth, state triggers re-render)
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [width, setWidth] = useState(() => {
    const c = loadCollapsed();
    return c ? COLLAPSED_WIDTH : loadWidth();
  });

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: TreeEntry } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const [renameTargetPath, setRenameTargetPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInFlightRef = useRef(false);

  const [dragSource, setDragSource] = useState<TreeEntry | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);

  const [toast, setToast] = useState<FileTreeToast | null>(null);
  const toastTimerRef = useRef<number | null>(null);

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

  // Clamp context menu within viewport after render.
  useEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;

    const menuEl = contextMenuRef.current;
    const width = menuEl.offsetWidth;
    const height = menuEl.offsetHeight;

    const maxX = Math.max(MENU_VIEWPORT_PADDING, window.innerWidth - width - MENU_VIEWPORT_PADDING);
    const maxY = Math.max(MENU_VIEWPORT_PADDING, window.innerHeight - height - MENU_VIEWPORT_PADDING);

    const nextX = Math.min(Math.max(contextMenu.x, MENU_VIEWPORT_PADDING), maxX);
    const nextY = Math.min(Math.max(contextMenu.y, MENU_VIEWPORT_PADDING), maxY);

    if (nextX !== contextMenu.x || nextY !== contextMenu.y) {
      setContextMenu((prev) => (prev ? { ...prev, x: nextX, y: nextY } : prev));
    }
  }, [contextMenu]);

  const toggleCollapsed = useCallback(() => {
    collapsedRef.current = !collapsedRef.current;
    setCollapsed(collapsedRef.current);
    setWidth(collapsedRef.current ? COLLAPSED_WIDTH : widthRef.current);
    try { localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsedRef.current)); } catch { /* ignore */ }
  }, []);

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
  }, [onCloseOpenPaths, onRemapOpenPaths, postFileOp, refresh, selectFile, showToast]);

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
    setContextMenu({ x: event.clientX, y: event.clientY, entry });
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

  if (collapsed) {
    return (
      <div className="shrink-0 border-r border-border bg-background flex flex-col items-center pt-2 w-9">
        <button
          onClick={toggleCollapsed}
          className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          title="Open file explorer (Ctrl+B)"
          aria-label="Open file explorer"
        >
          <PanelLeftOpen size={16} />
        </button>
      </div>
    );
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
      className="shrink-0 border-r border-border bg-background flex flex-col min-h-0 relative"
      style={{ width }}
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
        className={`flex items-center justify-between px-3 py-2 border-b border-border ${dropTargetPath === '.' ? 'bg-primary/15 ring-1 ring-primary/40' : ''}`}
        onDragOver={handleRootDragOver}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          if (dropTargetPath === '.') setDropTargetPath(null);
        }}
        onDrop={handleRootDrop}
      >
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          Workspace
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={refresh}
            className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh file tree"
            aria-label="Refresh file tree"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={toggleCollapsed}
            className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            title="Close file explorer (Ctrl+B)"
            aria-label="Close file explorer"
          >
            <PanelLeftClose size={12} />
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

      {/* Context menu */}
      {contextMenu && menuEntry && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[160px] bg-card border border-border shadow-lg rounded-md py-1"
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
              Move to Trash
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
        <div className="fixed bottom-4 left-4 z-[70] w-fit min-w-[320px] max-w-[min(92vw,680px)] px-4 py-2.5 rounded-md border text-xs shadow-lg bg-card flex items-center gap-3">
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
      <div
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/50 active:bg-primary/50 transition-colors z-10"
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClickResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file explorer"
      />
    </div>
  );
}
