import { useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown, EllipsisVertical, Loader2 } from 'lucide-react';
import { isImageFile, isPdfFile } from './utils/fileTypes';
import type { TreeEntry } from './types';
import { Pane } from '@/components/ui/Pane';

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
  renderChildren?: boolean;
  compact?: boolean;
  onOpenActions?: (entry: TreeEntry, anchorRect: DOMRect) => void;
  /** Path the running agent last changed; that row carries a live pane. */
  livePath?: string | null;
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
  renderChildren = true,
  compact,
  onOpenActions,
  livePath = null,
}: FileTreeNodeProps) {
  const longPressTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const activeTouchPointerIdRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);

  const isDir = entry.type === 'directory';
  const isExpanded = expandedPaths.has(entry.path);
  const isSelected = selectedPath === entry.path;
  // The live pane sits on the changed file, or on the nearest visible ancestor:
  // a collapsed folder lights when the changed file is somewhere inside it.
  const isLiveFile = livePath === entry.path;
  const isLiveFolder = isDir && !isExpanded && livePath !== null && livePath.startsWith(`${entry.path}/`);
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
    <div
      role="treeitem"
      aria-expanded={isDir ? isExpanded : undefined}
      aria-selected={isSelected}
      className={renderChildren ? undefined : 'h-full'}
    >
      <div
        className={`flex h-full min-h-[28px] items-center gap-1.5 pr-2 cursor-pointer select-none text-[0.867rem] leading-5 text-foreground transition-colors duration-[120ms] hover:bg-raised focus-visible:outline-offset-[-2px] ${
          isSelected ? 'bg-raised font-medium' : ''
        } ${entry.binary && !canOpen ? 'opacity-50' : ''} ${
          isDropTarget ? 'bg-raised ring-1 ring-inset ring-muted-foreground' : ''
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
            <Loader2 className="shrink-0 animate-spin text-muted-foreground" size={14} />
          ) : isExpanded ? (
            <ChevronDown className="shrink-0 text-muted-foreground" size={14} />
          ) : (
            <ChevronRight className="shrink-0 text-muted-foreground" size={14} />
          )
        ) : (
          <span className="shrink-0 w-3.5" /> /* spacer for alignment */
        )}

        {/* No type icons: the chevron says folder, weight says folder, and the name does the rest */}

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
            className="flex-1 min-w-0 rounded-sm border border-input bg-background px-1 py-0 text-[0.867rem] leading-5 text-foreground focus:outline-none focus:border-ring"
          />
        ) : (
          <span className={`flex-1 min-w-0 truncate${isDir ? ' font-medium' : ''}`}>{entry.name}</span>
        )}
        {(isLiveFile || isLiveFolder) && (
          <Pane
            state="live"
            size="sm"
            label={isLiveFile ? 'Changed by the running agent' : 'Contains a file changed by the running agent'}
          />
        )}
        {showCompactActions && (
          <button
            type="button"
            className="ml-auto flex-shrink-0 rounded-[3px] p-0 text-muted-foreground transition-colors duration-[120ms] hover:text-foreground"
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
      {renderChildren && isDir && isExpanded && entry.children && (
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
              livePath={livePath}
            />
          ))}
        </div>
      )}
    </div>
  );
}
