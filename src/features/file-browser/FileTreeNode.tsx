import { ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import { FileIcon, FolderIcon } from './utils/fileIcons';
import { isImageFile } from './utils/fileTypes';
import type { TreeEntry } from './types';

interface FileTreeNodeProps {
  entry: TreeEntry;
  depth: number;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  loadingPaths: Set<string>;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
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
}

export function FileTreeNode({
  entry,
  depth,
  expandedPaths,
  selectedPath,
  loadingPaths,
  onToggleDir,
  onOpenFile,
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
}: FileTreeNodeProps) {
  const isDir = entry.type === 'directory';
  const isExpanded = expandedPaths.has(entry.path);
  const isSelected = selectedPath === entry.path;
  const isLoading = loadingPaths.has(entry.path);
  const isRenaming = renamingPath === entry.path;
  const canDrag = entry.path !== '.trash' && !isRenaming;
  const isDropTarget = isDir && dropTargetPath === entry.path;
  const isDragSource = dragSourcePath === entry.path;

  const handleClick = () => {
    if (isRenaming) return;
    onSelect(entry.path);
    if (isDir) {
      onToggleDir(entry.path);
    }
  };

  const canOpen = !isDir && (!entry.binary || isImageFile(entry.name));

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

  return (
    <div role="treeitem" aria-expanded={isDir ? isExpanded : undefined} aria-selected={isSelected}>
      <div
        className={`flex items-center gap-1 py-[2px] pr-2 cursor-pointer select-none text-[0.8rem] leading-5 hover:bg-muted/50 ${
          isSelected ? 'bg-muted/70 text-foreground' : 'text-muted-foreground'
        } ${entry.binary && !canOpen ? 'opacity-50' : ''} ${
          isDropTarget ? 'bg-primary/15 ring-1 ring-primary/40' : ''
        } ${isDragSource ? 'opacity-50' : ''}`}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={(e) => onContextMenu(entry, e)}
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
          <span className="truncate">{entry.name}</span>
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
