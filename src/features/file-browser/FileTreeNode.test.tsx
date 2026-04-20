import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FileTreeNode } from './FileTreeNode';
import type { TreeEntry } from './types';

vi.mock('./utils/fileIcons', () => ({
  FileIcon: ({ name }: { name: string }) => <div data-testid={`file-icon-${name}`} />,
  FolderIcon: ({ open }: { open: boolean }) => <div data-testid={`folder-icon-${open ? 'open' : 'closed'}`} />,
}));

vi.mock('./utils/fileTypes', () => ({
  isImageFile: () => false,
  isPdfFile: () => false,
}));

const entry: TreeEntry = {
  name: 'package.json',
  path: 'package.json',
  type: 'file',
  children: null,
};

const directoryEntry: TreeEntry = {
  ...entry,
  type: 'directory',
  children: [],
};

type RenderNodeOverrides = Partial<{
  entry: TreeEntry;
  compact: boolean;
  onOpenActions: (entry: TreeEntry, anchorRect: DOMRect) => void;
  onContextMenu: (entry: TreeEntry, event: React.MouseEvent) => void;
  onSelect: (path: string) => void;
  onToggleDir: (path: string) => void;
}>;

function renderNode(overrides: RenderNodeOverrides = {}) {
  return render(
    <FileTreeNode
      entry={entry}
      depth={0}
      expandedPaths={new Set()}
      selectedPath={null}
      loadingPaths={new Set()}
      onToggleDir={vi.fn()}
      onOpenFile={vi.fn()}
      onTouchLongPress={vi.fn()}
      onSelect={vi.fn()}
      onContextMenu={vi.fn()}
      dragSourcePath={null}
      dropTargetPath={null}
      onDragStart={vi.fn()}
      onDragEnd={vi.fn()}
      onDragOverDirectory={vi.fn()}
      onDragLeaveDirectory={vi.fn()}
      onDropDirectory={vi.fn()}
      renamingPath={null}
      renameValue=""
      onRenameChange={vi.fn()}
      onRenameCommit={vi.fn()}
      onRenameCancel={vi.fn()}
      {...overrides}
    />,
  );
}

describe('FileTreeNode', () => {
  it('captures the touch pointer when starting a long press', () => {
    renderNode();

    const row = screen.getByTitle('package.json') as HTMLDivElement & {
      setPointerCapture?: (pointerId: number) => void;
    };
    row.setPointerCapture = vi.fn();

    fireEvent.pointerDown(row, {
      pointerType: 'touch',
      pointerId: 7,
      clientX: 20,
      clientY: 30,
    });

    expect(row.setPointerCapture).toHaveBeenCalledWith(7);
  });

  it('does not try to capture non-touch pointers', () => {
    renderNode();

    const row = screen.getByTitle('package.json') as HTMLDivElement & {
      setPointerCapture?: (pointerId: number) => void;
    };
    row.setPointerCapture = vi.fn();

    fireEvent.pointerDown(row, {
      pointerType: 'mouse',
      pointerId: 9,
      clientX: 20,
      clientY: 30,
    });

    expect(row.setPointerCapture).not.toHaveBeenCalled();
  });

  it('renders compact actions button that opens actions without selecting the row', () => {
    const onSelect = vi.fn();
    const onToggleDir = vi.fn();
    const onOpenActions = vi.fn();
    renderNode({
      entry: directoryEntry,
      compact: true,
      onSelect,
      onToggleDir,
      onOpenActions,
    });

    const label = `Open actions for ${directoryEntry.name}`;
    const button = screen.getByRole('button', { name: label });
    const anchorRect = {
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      top: 1,
      left: 2,
      bottom: 5,
      right: 6,
      toJSON: () => ({}),
    } as DOMRect;
    Object.defineProperty(button, 'getBoundingClientRect', {
      value: () => anchorRect,
    });

    fireEvent.click(button);

    expect(onOpenActions).toHaveBeenCalledWith(directoryEntry, anchorRect);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onToggleDir).not.toHaveBeenCalled();
  });

  it('does not render compact actions button outside compact mode', () => {
    const onOpenActions = vi.fn();
    renderNode({ onOpenActions });

    const label = `Open actions for ${entry.name}`;
    expect(screen.queryByRole('button', { name: label })).toBeNull();
  });

  it('suppresses the browser context menu on the compact actions button', () => {
    const onContextMenu = vi.fn();
    renderNode({
      compact: true,
      onOpenActions: vi.fn(),
      onContextMenu,
    });

    const button = screen.getByRole('button', { name: `Open actions for ${entry.name}` });

    expect(fireEvent.contextMenu(button)).toBe(false);
    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it('does not let Enter on the compact actions button trigger the row key handler', () => {
    const onToggleDir = vi.fn();
    renderNode({
      entry: directoryEntry,
      compact: true,
      onOpenActions: vi.fn(),
      onToggleDir,
    });

    const button = screen.getByRole('button', { name: `Open actions for ${directoryEntry.name}` });

    fireEvent.keyDown(button, { key: 'Enter' });

    expect(onToggleDir).not.toHaveBeenCalled();
  });

  it('uses a shrinkable filename region so compact actions remain accessible on narrow rows', () => {
    renderNode({
      compact: true,
      onOpenActions: vi.fn(),
    });

    expect(screen.getByText(entry.name)).toHaveClass('flex-1', 'min-w-0', 'truncate');
  });
});
