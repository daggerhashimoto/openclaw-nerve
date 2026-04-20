import { useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown, EllipsisVertical, Loader2 } from 'lucide-react';
import { FileIcon, FolderIcon } from './utils/fileIcons';
import { isImageFile, isPdfFile } from './utils/fileTypes';
import type { TreeEntry } from './types';

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

interface FileTreeNodeProps {
  entry: TreeEntry;
  depth: number;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  loadingPaths: Set<string>;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
  onTouchLongPress?: (entry: TreeEntry, touchPoint: { x: number; y: number }) => void;
  onSelect: (path: string) => void;
  onContextMenu: (entry: TreeEntry, event: React.MouseEvent) => void;
  dragSourcePath: string | null;
  dropTargetPath: string | null;
  onDragStart: (entry: TreeEntry, event: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOverDirectory: (entry: TreeEntry, event: React.DragEvent) => void;
  onDragLeaveDirectory: (entry: TreeEntry, event: React.DragEvent) => void;
  onDropDirectory: (entry: TreeEntry, event: React.DragEvent) => void;
  renamingPath: string | null;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  compact?: boolean;
  onOpenActions?: (entry: TreeEntry, anchorRect: DOMRect) => void;
}

export function FileTreeNode({
  entry,
  depth,
  expandedPaths,
  selectedPath,
  loadingPaths,
  onToggleDir,
  onOpenFile,
  onTouchLongPress,
  onSelect,
  onContextMenu,
  dragSourcePath,
  dropTargetPath,
  onDragStart,
  onDragEnd,
  onDragOverDirectory,
  onDragLeaveDirectory,
  onDropDirectory,
  renamingPath,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  compact,
  onOpenActions,
}: FileTreeNodeProps) {
  const longPressTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const activeTouchPointerIdRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);

  const isDir = entry.type === 'directory';
  const isExpanded = expandedPaths.has(entry.path);
  const isSelected = selectedPath === entry.path;
  const isLoading = loadingPaths.has(entry.path);
  const isRenaming = renamingPath === entry.path;
  const canDrag = entry.path !== '.trash' && !isRenaming;
  const isDropTarget = isDir && dropTargetPath === entry.path;
  const isDragSource = dragSourcePath === entry.path;
  const showCompactActions = compact && onOpenActions && !isRenaming;

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartRef.current = null;
    activeTouchPointerIdRef.current = null;
  };

  useEffect(() => () => clearLongPress(), []);

  const handleClick = () => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    if (isRenaming) return;
    onSelect(entry.path);
    if (isDir) {
      onToggleDir(entry.path);
    }
  };

  const canOpen = !isDir && (!entry.binary || isImageFile(entry.name) || isPdfFile(entry.name));

  const handleDoubleClick = () => {
    if (canOpen && !isRenaming) {
      onOpenFile(entry.path);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isRenaming) return;
    if (e.key === 'Enter') {
      if (isDir) {
        onToggleDir(entry.path);
      } else if (canOpen) {
        onOpenFile(entry.path);
      }
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    longPressTriggeredRef.current = false;
    clearLongPress();
    if (event.pointerType !== 'touch' || isRenaming || !onTouchLongPress) return;
    activeTouchPointerIdRef.current = event.pointerId;
    touchStartRef.current = { x: event.clientX, y: event.clientY };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is unavailable in some test environments.
    }
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      longPressTimerRef.current = null;
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' || !touchStartRef.current || activeTouchPointerIdRef.current !== event.pointerId) return;
    const dx = Math.abs(event.clientX - touchStartRef.current.x);
    const dy = Math.abs(event.clientY - touchStartRef.current.y);
    if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) {
      longPressTriggeredRef.current = false;
      clearLongPress();
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' || activeTouchPointerIdRef.current !== event.pointerId) return;
    if (longPressTriggeredRef.current && onTouchLongPress) {
      onTouchLongPress(entry, { x: event.clientX, y: event.clientY });
    }
    clearLongPress();
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' && activeTouchPointerIdRef.current === event.pointerId) {
      longPressTriggeredRef.current = false;
      clearLongPress();
    }
  };

  const handleActionsClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onOpenActions?.(entry, event.currentTarget.getBoundingClientRect());
  };

  const handleActionsPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  const handleActionsMouseDown = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  const handleActionsKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  const handleActionsContextMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div role="treeitem" aria-expanded={isDir ? isExpanded : undefined} aria-selected={isSelected}>
      <div
        className={`flex items-center gap-1 py-[2px] pr-2 cursor-pointer select-none text-[0.8rem] leading-5 hover:bg-muted/50 ${
          isSelected ? 'bg-muted/70 text-foreground' : 'text-muted-foreground'
        } ${entry.binary && !canOpen ? 'opacity-50' : ''} ${
          isDropTarget ? 'bg-primary/15 ring-1 ring-primary/40' : ''
        } ${isDragSource ? 'opacity-50' : ''}`}
        style={{
          paddingLeft: depth * 16 + 8,
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none' as const,
        }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={(e) => {
          if (longPressTriggeredRef.current) {
            // Keep the flag set here so a follow-up synthetic click is still swallowed.
            // The next pointerdown or the real click handler clears stale suppression.
            e.preventDefault();
            return;
          }
          onContextMenu(entry, e);
        }}
        onDragStart={(e) => onDragStart(entry, e)}
        onDragEnd={onDragEnd}
        onDragOver={isDir ? (e) => onDragOverDirectory(entry, e) : undefined}
        onDragLeave={isDir ? (e) => onDragLeaveDirectory(entry, e) : undefined}
        onDrop={isDir ? (e) => onDropDirectory(entry, e) : undefined}
        draggable={canDrag}
        tabIndex={0}
        title={entry.path}
      >
        {/* Expand/collapse chevron for directories */}
        {isDir ? (
          isLoading ? (
            <Loader2 className="shrink-0 animate-spin text-muted-foreground" size={12} />
          ) : isExpanded ? (
            <ChevronDown className="shrink-0 text-muted-foreground" size={12} />
          ) : (
            <ChevronRight className="shrink-0 text-muted-foreground" size={12} />
          )
        ) : (
          <span className="shrink-0 w-3" /> /* spacer for alignment */
        )}

        {/* Icon */}
        {isDir ? (
          <FolderIcon open={isExpanded} />
        ) : (
          <FileIcon name={entry.name} />
        )}

        {/* Name */}
        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameCommit();
              if (e.key === 'Escape') onRenameCancel();
            }}
            onBlur={onRenameCommit}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-background border border-border/60 px-1 py-0 text-[0.8rem] leading-5 text-foreground focus:outline-none focus:border-primary"
          />
        ) : (
          <span className="flex-1 min-w-0 truncate">{entry.name}</span>
        )}
        {showCompactActions && (
          <button
            type="button"
            className="ml-auto flex-shrink-0 p-0 text-muted-foreground hover:text-foreground"
            aria-label={`Open actions for ${entry.name}`}
            title={`Open actions for ${entry.name}`}
            draggable={false}
            onClick={handleActionsClick}
            onPointerDown={handleActionsPointerDown}
            onMouseDown={handleActionsMouseDown}
            onKeyDown={handleActionsKeyDown}
            onContextMenu={handleActionsContextMenu}
          >
            <EllipsisVertical size={16} />
          </button>
        )}
      </div>

      {/* Children */}
      {isDir && isExpanded && entry.children && (
        <div role="group">
          {entry.children.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              loadingPaths={loadingPaths}
              onToggleDir={onToggleDir}
              onOpenFile={onOpenFile}
              onTouchLongPress={onTouchLongPress}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              dragSourcePath={dragSourcePath}
              dropTargetPath={dropTargetPath}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragOverDirectory={onDragOverDirectory}
              onDragLeaveDirectory={onDragLeaveDirectory}
              onDropDirectory={onDropDirectory}
              renamingPath={renamingPath}
              renameValue={renameValue}
              onRenameChange={onRenameChange}
              onRenameCommit={onRenameCommit}
              onRenameCancel={onRenameCancel}
              compact={compact}
              onOpenActions={onOpenActions}
            />
          ))}
        </div>
      )}
    </div>
  );
}
