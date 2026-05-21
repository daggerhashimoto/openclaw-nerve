/** Tests for FileTreePanel component - custom workspace UI and confirmation modal. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileTreePanel } from './FileTreePanel';
import { useFileTree } from './hooks/useFileTree';

// Mock the useFileTree hook
vi.mock('./hooks/useFileTree', () => ({
  useFileTree: vi.fn(),
}));

// Mock settings context
vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    showHiddenWorkspaceEntries: false,
  }),
}));

// Mock the ConfirmDialog component
vi.mock('../../components/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, title, message, onConfirm, onCancel }: {
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) => {
    if (!open) return null;
    return (
      <div data-testid="confirm-dialog">
        <h2>{title}</h2>
        <p>{message}</p>
        <button onClick={onConfirm} data-testid="confirm-button">
          Confirm
        </button>
        <button onClick={onCancel} data-testid="cancel-button">
          Cancel
        </button>
      </div>
    );
  },
}));

// Mock file icons
vi.mock('./utils/fileIcons', () => ({
  FileIcon: ({ name }: { name: string }) => <div data-testid={`file-icon-${name}`} />,
  FolderIcon: ({ open }: { open: boolean }) => <div data-testid={`folder-icon-${open ? 'open' : 'closed'}`} />,
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

const mockOnOpenFile = vi.fn();
const mockOnAddToChat = vi.fn();
const mockOnRemapOpenPaths = vi.fn();
const mockOnCloseOpenPaths = vi.fn();

const defaultMockHook = {
  entries: [
    { name: 'src', path: 'src', type: 'directory' as const, children: null },
    { name: 'package.json', path: 'package.json', type: 'file' as const, children: null },
  ],
  loading: false,
  error: null,
  expandedPaths: new Set(),
  selectedPath: null,
  loadingPaths: new Set(),
  workspaceInfo: null,
  toggleDirectory: vi.fn(),
  selectFile: vi.fn(),
  refresh: vi.fn(),
  handleFileChange: vi.fn(),
  revealPath: vi.fn(),
};

describe('FileTreePanel', () => {
  let mockUseFileTree: vi.MockedFunction<typeof useFileTree>;
  const originalVisualViewportDescriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    // Use the statically imported mocked hook
    mockUseFileTree = vi.mocked(useFileTree);

    // Mock localStorage
    const localStorageMock = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
    vi.stubGlobal('localStorage', localStorageMock);
    mockUseFileTree.mockReturnValue(defaultMockHook);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalVisualViewportDescriptor) {
      Object.defineProperty(window, 'visualViewport', originalVisualViewportDescriptor);
    } else {
      // @ts-expect-error test cleanup for ad-hoc property definition
      delete window.visualViewport;
    }
    vi.restoreAllMocks();
  });

  describe('reveal requests', () => {
    it('reveals the requested path once for the active workspace', () => {
      const revealPath = vi.fn();
      mockUseFileTree.mockReturnValue({
        ...defaultMockHook,
        revealPath,
      });

      const { rerender } = render(
        <FileTreePanel
          workspaceAgentId="main"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          revealRequest={{ id: 1, path: 'src/index.ts', kind: 'file', agentId: 'main' }}
          collapsed={false}
        />,
      );

      expect(revealPath).toHaveBeenCalledWith('src/index.ts', 'file', 'main');

      rerender(
        <FileTreePanel
          workspaceAgentId="main"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          revealRequest={{ id: 1, path: 'src/index.ts', kind: 'file', agentId: 'main' }}
          collapsed={false}
        />,
      );

      expect(revealPath).toHaveBeenCalledTimes(1);
    });
  });

  describe('header display', () => {
    it('shows "Workspace" when not using custom workspace', () => {
      render(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
        />
      );

      expect(screen.getByText('Workspace')).toBeInTheDocument();
    });

    it('shows custom root path when using custom workspace', () => {
      mockUseFileTree.mockReturnValue({
        ...defaultMockHook,
        workspaceInfo: {
          isCustomWorkspace: true,
          rootPath: '/home/user/custom-workspace',
        },
      });

      render(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
        />
      );

      expect(screen.getByText('/home/user/custom-workspace')).toBeInTheDocument();
      expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
    });

    it('shows custom root path for different custom workspaces', () => {
      mockUseFileTree.mockReturnValue({
        ...defaultMockHook,
        workspaceInfo: {
          isCustomWorkspace: true,
          rootPath: '/var/www/project',
        },
      });

      render(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
        />
      );

      expect(screen.getByText('/var/www/project')).toBeInTheDocument();
    });
  });

  describe('context menu add to chat', () => {
    it('opens the shared row menu from a compact actions button without selecting the row', async () => {
      render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onAddToChat={mockOnAddToChat}
          addToChatEnabled={true}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          isCompactLayout={true}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Open actions for package.json' }));

      expect(await screen.findByText('Rename')).toBeInTheDocument();
      expect(defaultMockHook.selectFile).not.toHaveBeenCalled();
    });

    it('does not toggle a directory when its compact actions button is clicked', async () => {
      render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onAddToChat={mockOnAddToChat}
          addToChatEnabled={true}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          isCompactLayout={true}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Open actions for src' }));

      expect(await screen.findByText('Rename')).toBeInTheDocument();
      expect(defaultMockHook.toggleDirectory).not.toHaveBeenCalled();
    });

    it('does not open the shared row menu from touch long press in compact layout', async () => {
      vi.useFakeTimers();

      render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onAddToChat={mockOnAddToChat}
          addToChatEnabled={true}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          isCompactLayout={true}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      const row = screen.getByTitle('package.json');
      fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 24, clientY: 32, pointerId: 11 });
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      fireEvent.pointerUp(row, { pointerType: 'touch', clientX: 24, clientY: 32, pointerId: 11 });

      expect(screen.queryByText('Add to chat')).not.toBeInTheDocument();
      expect(screen.queryByText('Rename')).not.toBeInTheDocument();
    });

    it('closes the shared row menu when the same compact actions button is clicked again', async () => {
      render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onAddToChat={mockOnAddToChat}
          addToChatEnabled={true}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          isCompactLayout={true}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      const button = screen.getByRole('button', { name: 'Open actions for package.json' });

      fireEvent.click(button);
      expect(await screen.findByText('Rename')).toBeInTheDocument();

      fireEvent.mouseDown(button);
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.queryByText('Rename')).not.toBeInTheDocument();
      });
    });

    it('opens the shared row menu on touch release after a long press without triggering file open', async () => {
      vi.useFakeTimers();

      render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onAddToChat={mockOnAddToChat}
          addToChatEnabled={true}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      const row = screen.getByTitle('package.json');
      fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 24, clientY: 32, pointerId: 0 });
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.queryByText('Add to chat')).not.toBeInTheDocument();

      fireEvent.pointerUp(row, { pointerType: 'touch', clientX: 24, clientY: 32, pointerId: 0 });

      expect(screen.getByText('Add to chat')).toBeInTheDocument();
      expect(mockOnOpenFile).not.toHaveBeenCalled();
    });

    it('anchors the touch menu with its bottom-left corner at the touch point', async () => {
      vi.useFakeTimers();
      const visualViewportMock = {
        width: 220,
        height: 280,
        offsetLeft: 40,
        offsetTop: 80,
      };
      const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: visualViewportMock,
      });
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get() {
          return this.classList.contains('shell-panel') ? 40 : 0;
        },
      });

      try {
        render(
          <FileTreePanel
            workspaceAgentId="agent-a"
            onOpenFile={mockOnOpenFile}
            onAddToChat={mockOnAddToChat}
            addToChatEnabled={true}
            onRemapOpenPaths={mockOnRemapOpenPaths}
            onCloseOpenPaths={mockOnCloseOpenPaths}
            collapsed={false}
            onCollapseChange={vi.fn()}
          />
        );

        const row = screen.getByTitle('package.json');
        fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 210, clientY: 300, pointerId: 1 });
        await act(async () => {
          vi.advanceTimersByTime(500);
        });
        fireEvent.pointerUp(row, { pointerType: 'touch', clientX: 210, clientY: 300, pointerId: 1 });

        const menu = screen.getByText('Add to chat').closest('.shell-panel') as HTMLElement;
        expect(menu).toHaveStyle({ left: '210px', top: '260px' });
      } finally {
        if (originalOffsetHeight) {
          Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
        } else {
          // @ts-expect-error test cleanup for ad-hoc property definition
          delete HTMLElement.prototype.offsetHeight;
        }
      }
    });

    it('keeps a touch-opened menu visible when the browser emits a synthetic mousedown after release', async () => {
      vi.useFakeTimers();

      render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onAddToChat={mockOnAddToChat}
          addToChatEnabled={true}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      const row = screen.getByTitle('package.json');
      fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 24, clientY: 32, pointerId: 7 });
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      fireEvent.pointerUp(row, { pointerType: 'touch', clientX: 24, clientY: 32, pointerId: 7 });
      fireEvent.mouseDown(document.body);

      expect(screen.getByText('Add to chat')).toBeInTheDocument();
    });

    it('keeps the follow-up click suppressed after a touch long press on a directory', async () => {
      vi.useFakeTimers();

      render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onAddToChat={mockOnAddToChat}
          addToChatEnabled={true}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      const row = screen.getByTitle('src');
      fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 24, clientY: 32, pointerId: 2 });
      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      fireEvent.pointerUp(row, { pointerType: 'touch', clientX: 24, clientY: 32, pointerId: 2 });
      fireEvent.contextMenu(row, new MouseEvent('contextmenu', { bubbles: true }));
      fireEvent.click(row);

      expect(screen.getByText('Add to chat')).toBeInTheDocument();
      expect(defaultMockHook.toggleDirectory).not.toHaveBeenCalled();
    });

    it('clears stale long-press suppression on the next non-touch pointerdown', async () => {
      vi.useFakeTimers();

      render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onAddToChat={mockOnAddToChat}
          addToChatEnabled={true}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      const row = screen.getByTitle('src');
      fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 24, clientY: 32, pointerId: 3 });
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      fireEvent.pointerCancel(row, { pointerType: 'touch', pointerId: 3 });

      fireEvent.pointerDown(row, { pointerType: 'mouse', clientX: 24, clientY: 32 });
      fireEvent.click(row);

      expect(defaultMockHook.toggleDirectory).toHaveBeenCalledTimes(1);
    });

    it('does not leave the next interaction suppressed when contextmenu fires without a follow-up click', async () => {
      vi.useFakeTimers();

      render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onAddToChat={mockOnAddToChat}
          addToChatEnabled={true}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      const row = screen.getByTitle('src');
      fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 24, clientY: 32, pointerId: 5 });
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      fireEvent.pointerUp(row, { pointerType: 'touch', clientX: 24, clientY: 32, pointerId: 5 });
      fireEvent.contextMenu(row, new MouseEvent('contextmenu', { bubbles: true }));

      fireEvent.pointerDown(row, { pointerType: 'mouse', clientX: 24, clientY: 32 });
      fireEvent.click(row);

      expect(defaultMockHook.toggleDirectory).toHaveBeenCalledTimes(1);
    });

    it('cancels touch long press when the pointer moves beyond tolerance', () => {
      vi.useFakeTimers();

      render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onAddToChat={mockOnAddToChat}
          addToChatEnabled={true}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      const row = screen.getByTitle('package.json');
      fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 4 });
      fireEvent.pointerMove(row, { pointerType: 'touch', clientX: 40, clientY: 40, pointerId: 4 });
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(screen.queryByText('Add to chat')).not.toBeInTheDocument();
    });

    it('cancels a triggered long press if the finger moves beyond tolerance before release', async () => {
      vi.useFakeTimers();

      render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onAddToChat={mockOnAddToChat}
          addToChatEnabled={true}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      const row = screen.getByTitle('package.json');
      fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 20, clientY: 20, pointerId: 6 });
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      fireEvent.pointerMove(row, { pointerType: 'touch', clientX: 40, clientY: 45, pointerId: 6 });
      fireEvent.pointerUp(row, { pointerType: 'touch', clientX: 40, clientY: 45, pointerId: 6 });

      expect(screen.queryByText('Add to chat')).not.toBeInTheDocument();
    });

    it('does not open the menu from a mouse pointer long hold', () => {
      vi.useFakeTimers();

      render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onAddToChat={mockOnAddToChat}
          addToChatEnabled={true}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      const row = screen.getByTitle('package.json');
      fireEvent.pointerDown(row, { pointerType: 'mouse', clientX: 24, clientY: 32 });
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(screen.queryByText('Add to chat')).not.toBeInTheDocument();
    });

    it('renders menu actions from the shared action builder for files', async () => {
      render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onAddToChat={mockOnAddToChat}
          addToChatEnabled={true}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      fireEvent.contextMenu(screen.getByText('package.json'), new MouseEvent('contextmenu', { bubbles: true }));

      expect(await screen.findByText('Add to chat')).toBeInTheDocument();
      expect(screen.getByText('Rename')).toBeInTheDocument();
      expect(screen.getByText('Move to Trash')).toBeInTheDocument();
    });

    it('shows "Add to chat" for files when file references are enabled, and calls the callback with the workspace agent', async () => {
      render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onAddToChat={mockOnAddToChat}
          addToChatEnabled={true}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      fireEvent.contextMenu(screen.getByText('package.json'), new MouseEvent('contextmenu', { bubbles: true }));

      await waitFor(() => {
        expect(screen.getByText('Add to chat')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Add to chat'));

      await waitFor(() => {
        expect(mockOnAddToChat).toHaveBeenCalledWith('package.json', 'file', 'agent-a');
      });
    });

    it('shows an error toast when file add to chat fails', async () => {
      mockOnAddToChat.mockRejectedValueOnce(new Error('Failed to add file to chat'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onAddToChat={mockOnAddToChat}
          addToChatEnabled={true}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      fireEvent.contextMenu(screen.getByText('package.json'), new MouseEvent('contextmenu', { bubbles: true }));

      const addToChatButton = await screen.findByText('Add to chat');
      fireEvent.click(addToChatButton);

      expect(await screen.findByText('Failed to add file to chat')).toBeInTheDocument();
      expect(mockOnAddToChat).toHaveBeenCalledWith('package.json', 'file', 'agent-a');
    });

    it('shows "Add to chat" for directories even when file references are disabled, and calls the callback with directory kind', async () => {
      render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onAddToChat={mockOnAddToChat}
          addToChatEnabled={false}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      fireEvent.contextMenu(screen.getByText('src'), new MouseEvent('contextmenu', { bubbles: true }));

      await waitFor(() => {
        expect(screen.getByText('Add to chat')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Add to chat'));

      await waitFor(() => {
        expect(mockOnAddToChat).toHaveBeenCalledWith('src', 'directory', 'agent-a');
      });
    });

    it('does not show "Add to chat" when workspace path attachments are disabled', async () => {
      render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onAddToChat={mockOnAddToChat}
          addToChatEnabled={false}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      fireEvent.contextMenu(screen.getByText('package.json'), new MouseEvent('contextmenu', { bubbles: true }));

      await waitFor(() => {
        expect(screen.queryByText('Add to chat')).not.toBeInTheDocument();
      });
    });
  });

  describe('context menu for deletion', () => {
    it('shows "Move to Trash" for default workspace', async () => {
      render(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
        />
      );

      // Simulate context menu
      const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true });
      fireEvent.contextMenu(screen.getByText('src'), contextMenuEvent);

      await waitFor(() => {
        expect(screen.getByText('Move to Trash')).toBeInTheDocument();
        expect(screen.queryByText('Permanently Delete')).not.toBeInTheDocument();
      });
    });

    it('shows "Permanently Delete" for custom workspace', async () => {
      mockUseFileTree.mockReturnValue({
        ...defaultMockHook,
        workspaceInfo: {
          isCustomWorkspace: true,
          rootPath: '/custom/workspace',
        },
      });

      render(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
        />
      );

      // Simulate context menu
      const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true });
      fireEvent.contextMenu(screen.getByText('src'), contextMenuEvent);

      await waitFor(() => {
        expect(screen.getByText('Permanently Delete')).toBeInTheDocument();
        expect(screen.queryByText('Move to Trash')).not.toBeInTheDocument();
      });
    });

    it('shows confirmation modal when clicking "Permanently Delete"', async () => {
      mockUseFileTree.mockReturnValue({
        ...defaultMockHook,
        workspaceInfo: {
          isCustomWorkspace: true,
          rootPath: '/custom/workspace',
        },
      });

      // Mock fetch for the delete operation
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, from: 'test.txt', to: '' }),
      } as Response);

      render(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
        />
      );

      // Open context menu
      const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true });
      fireEvent.contextMenu(screen.getByText('src'), contextMenuEvent);

      // Click "Permanently Delete"
      const deleteButton = await screen.findByText('Permanently Delete');
      fireEvent.click(deleteButton);

      // Should show confirmation modal
      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
        expect(screen.getByText('Permanently Delete')).toBeInTheDocument();
        expect(screen.getByText(/Are you sure you want to permanently delete/)).toBeInTheDocument();
      });
    });

    it('drops an open context menu immediately when the workspace changes', async () => {
      const { rerender } = render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      fireEvent.contextMenu(screen.getByText('package.json'), new MouseEvent('contextmenu', { bubbles: true }));

      expect(await screen.findByText('Move to Trash')).toBeInTheDocument();

      rerender(
        <FileTreePanel
          workspaceAgentId="agent-b"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      expect(screen.queryByText('Move to Trash')).not.toBeInTheDocument();
      expect(screen.queryByText('Rename')).not.toBeInTheDocument();
    });

    it('does not show confirmation modal for "Move to Trash"', async () => {
      // Mock fetch for trash operation
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, from: 'test.txt', to: '.trash/test.txt', undoTtlMs: 10000 }),
      } as Response);

      render(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
        />
      );

      // Open context menu
      const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true });
      fireEvent.contextMenu(screen.getByText('src'), contextMenuEvent);

      // Click "Move to Trash"
      const trashButton = await screen.findByText('Move to Trash');
      await act(async () => {
        fireEvent.click(trashButton);
      });

      // Should NOT show confirmation modal
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    });
  });

  describe('confirmation modal interactions', () => {
    it('closes modal when clicking cancel', async () => {
      mockUseFileTree.mockReturnValue({
        ...defaultMockHook,
        workspaceInfo: {
          isCustomWorkspace: true,
          rootPath: '/custom/workspace',
        },
      });

      render(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
        />
      );

      // Open context menu and click "Permanently Delete"
      const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true });
      fireEvent.contextMenu(screen.getByText('src'), contextMenuEvent);

      const deleteButton = await screen.findByText('Permanently Delete');
      fireEvent.click(deleteButton);

      // Modal should be open
      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      // Click cancel
      const cancelButton = screen.getByTestId('cancel-button');
      fireEvent.click(cancelButton);

      // Modal should be closed
      await waitFor(() => {
        expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
      });
    });

    it('drops an open delete confirmation immediately when the workspace changes', async () => {
      mockUseFileTree.mockReturnValue({
        ...defaultMockHook,
        workspaceInfo: {
          isCustomWorkspace: true,
          rootPath: '/custom/workspace',
        },
      });

      const { rerender } = render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      fireEvent.contextMenu(screen.getByText('src'), new MouseEvent('contextmenu', { bubbles: true }));
      fireEvent.click(await screen.findByText('Permanently Delete'));

      expect(await screen.findByTestId('confirm-dialog')).toBeInTheDocument();

      rerender(
        <FileTreePanel
          workspaceAgentId="agent-b"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
      expect(screen.queryByText(/Are you sure you want to permanently delete/)).not.toBeInTheDocument();
    });

    it('performs deletion when clicking confirm', async () => {
      mockUseFileTree.mockReturnValue({
        ...defaultMockHook,
        workspaceInfo: {
          isCustomWorkspace: true,
          rootPath: '/custom/workspace',
        },
      });

      // Mock fetch for the delete operation
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, from: 'test.txt', to: '' }),
      } as Response);

      render(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
        />
      );

      // Open context menu and click "Permanently Delete"
      const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true });
      fireEvent.contextMenu(screen.getByText('src'), contextMenuEvent);

      const deleteButton = await screen.findByText('Permanently Delete');
      fireEvent.click(deleteButton);

      // Click confirm
      const confirmButton = await screen.findByTestId('confirm-button');
      fireEvent.click(confirmButton);

      // Wait for modal to close
      await waitFor(() => {
        expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
      });
    });
  });

  describe('toast messages', () => {
    it('shows success toast for permanent deletion', async () => {
      mockUseFileTree.mockReturnValue({
        ...defaultMockHook,
        workspaceInfo: {
          isCustomWorkspace: true,
          rootPath: '/custom/workspace',
        },
      });

      // Mock fetch for successful deletion
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, from: 'test.txt', to: '' }),
      } as Response);

      render(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
        />
      );

      // Trigger permanent deletion
      const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true });
      fireEvent.contextMenu(screen.getByText('src'), contextMenuEvent);

      const deleteButton = await screen.findByText('Permanently Delete');
      fireEvent.click(deleteButton);

      const confirmButton = await screen.findByTestId('confirm-button');
      fireEvent.click(confirmButton);

      expect(await screen.findByText('Permanently deleted test.txt')).toBeInTheDocument();
    });

    it('shows error toast for failed permanent deletion', async () => {
      mockUseFileTree.mockReturnValue({
        ...defaultMockHook,
        workspaceInfo: {
          isCustomWorkspace: true,
          rootPath: '/custom/workspace',
        },
      });

      // Mock fetch for failed deletion
      global.fetch = vi.fn().mockRejectedValue(new Error('Delete failed'));

      render(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
        />
      );

      // Trigger permanent deletion
      const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true });
      fireEvent.contextMenu(screen.getByText('src'), contextMenuEvent);

      const deleteButton = await screen.findByText('Permanently Delete');
      fireEvent.click(deleteButton);

      const confirmButton = await screen.findByTestId('confirm-button');
      fireEvent.click(confirmButton);

      expect(await screen.findByText('Delete failed')).toBeInTheDocument();
    });

    it('drops a late trash undo toast after switching to another agent', async () => {
      const trashRequest = createDeferred<Response>();
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url === '/api/files/trash') {
          return trashRequest.promise;
        }

        return {
          ok: true,
          json: async () => ({ ok: true }),
        } as Response;
      });

      const { rerender } = render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true });
      fireEvent.contextMenu(screen.getByText('package.json'), contextMenuEvent);

      const trashButton = await screen.findByText('Move to Trash');
      fireEvent.click(trashButton);

      rerender(
        <FileTreePanel
          workspaceAgentId="agent-b"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      await act(async () => {
        trashRequest.resolve({
          ok: true,
          json: async () => ({ ok: true, from: 'package.json', to: '.trash/package.json', undoTtlMs: 10000 }),
        } as Response);
        await Promise.resolve();
      });

      expect(screen.queryByText('Moved package.json to Trash')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    });

    it('renders correctly in custom workspace mode', async () => {
      mockUseFileTree.mockReturnValue({
        ...defaultMockHook,
        workspaceInfo: {
          isCustomWorkspace: true,
          rootPath: '/custom/workspace',
        },
      });

      render(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
        />
      );

      // Verify custom workspace header is shown
      expect(screen.getByText('/custom/workspace')).toBeInTheDocument();

      // Verify context menu shows permanent delete options
      const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true });
      fireEvent.contextMenu(screen.getByText('src'), contextMenuEvent);

      expect(screen.getByText('Permanently Delete')).toBeInTheDocument();
      expect(screen.queryByText('Move to Trash')).not.toBeInTheDocument();

      // Close the context menu
      fireEvent.click(document.body);
    });
  });

  describe('integration with useFileTree hook', () => {
    it('passes workspaceInfo from hook to UI', () => {
      const customWorkspaceInfo = {
        isCustomWorkspace: true,
        rootPath: '/home/user/project',
      };

      mockUseFileTree.mockReturnValue({
        ...defaultMockHook,
        workspaceInfo: customWorkspaceInfo,
      });

      render(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
        />
      );

      expect(screen.getByText('/home/user/project')).toBeInTheDocument();
    });

    it('updates UI when workspaceInfo changes', async () => {
      const { rerender } = render(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
        />
      );

      // Initially shows "Workspace"
      expect(screen.getByText('Workspace')).toBeInTheDocument();

      // Update hook to return custom workspace
      mockUseFileTree.mockReturnValue({
        ...defaultMockHook,
        workspaceInfo: {
          isCustomWorkspace: true,
          rootPath: '/new/custom/path',
        },
      });

      rerender(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
        />
      );

      expect(screen.getByText('/new/custom/path')).toBeInTheDocument();
      expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
    });
  });

  describe('external file change refreshes', () => {
    it('refreshes the same relative path again when the agent changes', () => {
      const { rerender } = render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
          lastChangedEvent={{ path: 'docs/shared.md', agentId: 'agent-a', sequence: 1 }}
        />
      );

      expect(defaultMockHook.handleFileChange).toHaveBeenCalledTimes(1);
      expect(defaultMockHook.handleFileChange).toHaveBeenLastCalledWith('docs/shared.md');

      rerender(
        <FileTreePanel
          workspaceAgentId="agent-b"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
          lastChangedEvent={{ path: 'docs/shared.md', agentId: 'agent-b', sequence: 2 }}
        />
      );

      expect(defaultMockHook.handleFileChange).toHaveBeenCalledTimes(2);
      expect(defaultMockHook.handleFileChange).toHaveBeenLastCalledWith('docs/shared.md');
    });

    it('refreshes repeated same-path events for the same agent when the sequence changes', () => {
      const { rerender } = render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
          lastChangedEvent={{ path: 'docs/shared.md', agentId: 'agent-a', sequence: 1 }}
        />
      );

      expect(defaultMockHook.handleFileChange).toHaveBeenCalledTimes(1);
      expect(defaultMockHook.handleFileChange).toHaveBeenLastCalledWith('docs/shared.md');

      rerender(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
          lastChangedEvent={{ path: 'docs/shared.md', agentId: 'agent-a', sequence: 2 }}
        />
      );

      expect(defaultMockHook.handleFileChange).toHaveBeenCalledTimes(2);
      expect(defaultMockHook.handleFileChange).toHaveBeenLastCalledWith('docs/shared.md');
    });

    it('ignores stale file change events from another agent after a switch', () => {
      const { rerender } = render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
          lastChangedEvent={{ path: 'docs/shared.md', agentId: 'agent-a', sequence: 1 }}
        />
      );

      expect(defaultMockHook.handleFileChange).toHaveBeenCalledTimes(1);

      rerender(
        <FileTreePanel
          workspaceAgentId="agent-b"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
          lastChangedEvent={{ path: 'docs/shared.md', agentId: 'agent-a', sequence: 1 }}
        />
      );

      expect(defaultMockHook.handleFileChange).toHaveBeenCalledTimes(1);
    });
  });

  describe('workspace-scoped ephemeral state', () => {
    it('drops an in-progress rename immediately when switching to another workspace with the same path', async () => {
      mockUseFileTree.mockReturnValue({
        ...defaultMockHook,
        entries: [
          { name: 'README.md', path: 'README.md', type: 'file', children: null },
          { name: 'src', path: 'src', type: 'directory', children: null },
        ],
      });

      const { rerender } = render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      fireEvent.contextMenu(screen.getByText('README.md'), new MouseEvent('contextmenu', { bubbles: true }));
      fireEvent.click(await screen.findByText('Rename'));

      const renameInput = screen.getByDisplayValue('README.md');
      fireEvent.change(renameInput, { target: { value: 'workspace-a.md' } });
      expect(screen.getByDisplayValue('workspace-a.md')).toBeInTheDocument();

      rerender(
        <FileTreePanel
          workspaceAgentId="agent-b"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.getByText('README.md')).toBeInTheDocument();
    });

    it('clears drag source and drop target styling when the workspace changes', () => {
      mockUseFileTree.mockReturnValue({
        ...defaultMockHook,
        entries: [
          { name: 'src', path: 'src', type: 'directory', children: null },
          { name: 'README.md', path: 'README.md', type: 'file', children: null },
        ],
      });

      const dataTransfer = {
        effectAllowed: 'all',
        dropEffect: 'none',
        setData: vi.fn(),
      };

      const { rerender } = render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      const sourceRow = screen.getByTitle('README.md');
      const targetRow = screen.getByTitle('src');

      fireEvent.dragStart(sourceRow, { dataTransfer });
      fireEvent.dragOver(targetRow, { dataTransfer });

      expect(sourceRow.className).toContain('opacity-50');
      expect(targetRow.className).toContain('bg-primary/15');

      rerender(
        <FileTreePanel
          workspaceAgentId="agent-b"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      expect(screen.getByTitle('README.md').className).not.toContain('opacity-50');
      expect(screen.getByTitle('src').className).not.toContain('bg-primary/15');
    });
  });

  describe('workspace-scoped async completions', () => {
    it('keeps a newer workspace rename session active when an older rename resolves', async () => {
      mockUseFileTree.mockReturnValue({
        ...defaultMockHook,
        entries: [
          { name: 'README.md', path: 'README.md', type: 'file', children: null },
          { name: 'src', path: 'src', type: 'directory', children: null },
        ],
      });

      const renameRequestA = createDeferred<Response>();
      const renameRequestB = createDeferred<Response>();
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url === '/api/files/rename') {
          const body = JSON.parse(String(init?.body ?? '{}')) as { agentId?: string };
          return body.agentId === 'agent-a' ? renameRequestA.promise : renameRequestB.promise;
        }

        return {
          ok: true,
          json: async () => ({ ok: true }),
        } as Response;
      });

      const { rerender } = render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      fireEvent.contextMenu(screen.getByText('README.md'), new MouseEvent('contextmenu', { bubbles: true }));
      fireEvent.click(await screen.findByText('Rename'));

      const renameInputA = screen.getByDisplayValue('README.md');
      fireEvent.change(renameInputA, { target: { value: 'workspace-a.md' } });
      fireEvent.keyDown(renameInputA, { key: 'Enter' });

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      expect(JSON.parse(String((mockFetch.mock.calls[0]?.[1] as RequestInit)?.body ?? '{}'))).toMatchObject({
        agentId: 'agent-a',
        path: 'README.md',
        newName: 'workspace-a.md',
      });

      rerender(
        <FileTreePanel
          workspaceAgentId="agent-b"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      fireEvent.contextMenu(screen.getByText('README.md'), new MouseEvent('contextmenu', { bubbles: true }));
      fireEvent.click(await screen.findByText('Rename'));

      const renameInputB = screen.getByDisplayValue('README.md');
      fireEvent.change(renameInputB, { target: { value: 'workspace-b.md' } });
      fireEvent.keyDown(renameInputB, { key: 'Enter' });

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
      expect(JSON.parse(String((mockFetch.mock.calls[1]?.[1] as RequestInit)?.body ?? '{}'))).toMatchObject({
        agentId: 'agent-b',
        path: 'README.md',
        newName: 'workspace-b.md',
      });

      await act(async () => {
        renameRequestA.resolve({
          ok: true,
          json: async () => ({ ok: true, from: 'README.md', to: 'workspace-a.md' }),
        } as Response);
        await Promise.resolve();
      });

      expect(screen.getByDisplayValue('workspace-b.md')).toBeInTheDocument();
    });

    it('keeps a newer workspace context menu open when an older trash request resolves', async () => {
      const trashRequestA = createDeferred<Response>();
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url === '/api/files/trash') {
          const body = JSON.parse(String(init?.body ?? '{}')) as { agentId?: string };
          if (body.agentId === 'agent-a') {
            return trashRequestA.promise;
          }
        }

        return {
          ok: true,
          json: async () => ({ ok: true }),
        } as Response;
      });

      const { rerender } = render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      fireEvent.contextMenu(screen.getByText('package.json'), new MouseEvent('contextmenu', { bubbles: true }));
      fireEvent.click(await screen.findByText('Move to Trash'));

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

      rerender(
        <FileTreePanel
          workspaceAgentId="agent-b"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      fireEvent.contextMenu(screen.getByText('src'), new MouseEvent('contextmenu', { bubbles: true }));
      expect(await screen.findByText('Rename')).toBeInTheDocument();

      await act(async () => {
        trashRequestA.resolve({
          ok: true,
          json: async () => ({ ok: true, from: 'package.json', to: '.trash/package.json', undoTtlMs: 10000 }),
        } as Response);
        await Promise.resolve();
      });

      expect(screen.getByText('Rename')).toBeInTheDocument();
      expect(screen.getByText('Move to Trash')).toBeInTheDocument();
    });

    it('keeps a newer workspace delete confirmation open when an older delete resolves', async () => {
      mockUseFileTree.mockReturnValue({
        ...defaultMockHook,
        workspaceInfo: {
          isCustomWorkspace: true,
          rootPath: '/custom/workspace',
        },
      });

      const deleteRequestA = createDeferred<Response>();
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url === '/api/files/trash') {
          const body = JSON.parse(String(init?.body ?? '{}')) as { agentId?: string };
          if (body.agentId === 'agent-a') {
            return deleteRequestA.promise;
          }
        }

        return {
          ok: true,
          json: async () => ({ ok: true }),
        } as Response;
      });

      const { rerender } = render(
        <FileTreePanel
          workspaceAgentId="agent-a"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      fireEvent.contextMenu(screen.getByText('package.json'), new MouseEvent('contextmenu', { bubbles: true }));
      fireEvent.click(await screen.findByText('Permanently Delete'));
      fireEvent.click(await screen.findByTestId('confirm-button'));

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

      rerender(
        <FileTreePanel
          workspaceAgentId="agent-b"
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={vi.fn()}
        />
      );

      fireEvent.contextMenu(screen.getByText('src'), new MouseEvent('contextmenu', { bubbles: true }));
      fireEvent.click(await screen.findByText('Permanently Delete'));

      expect(await screen.findByText(/permanently delete "src"/i)).toBeInTheDocument();

      await act(async () => {
        deleteRequestA.resolve({
          ok: true,
          json: async () => ({ ok: true, from: 'package.json', to: '' }),
        } as Response);
        await Promise.resolve();
      });

      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      expect(screen.getByText(/permanently delete "src"/i)).toBeInTheDocument();
    });
  });

  describe('Mobile collapse behavior', () => {
    const mockOnCollapseChange = vi.fn();

    beforeEach(() => {
      mockOnCollapseChange.mockClear();
    });

    it('renders normally when not collapsed', () => {
      mockUseFileTree.mockReturnValue(defaultMockHook);

      render(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={mockOnCollapseChange}
          isCompactLayout={false}
        />
      );

      expect(screen.getByText('src')).toBeInTheDocument();
      expect(screen.getByText('package.json')).toBeInTheDocument();
    });

    it('hides completely on desktop when collapsed', () => {
      mockUseFileTree.mockReturnValue(defaultMockHook);

      const { container } = render(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={true}
          onCollapseChange={mockOnCollapseChange}
          isCompactLayout={false}
        />
      );

      // Reopen control lives in the chat header, so the panel itself should disappear.
      expect(screen.queryByText('src')).not.toBeInTheDocument();
      expect(screen.queryByText('package.json')).not.toBeInTheDocument();
      expect(container.firstChild).toBeNull();
    });

    it('hides completely on mobile when collapsed', () => {
      mockUseFileTree.mockReturnValue(defaultMockHook);

      const { container } = render(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={true}
          onCollapseChange={mockOnCollapseChange}
          isCompactLayout={true}
        />
      );

      // Should render nothing (completely hidden)
      expect(screen.queryByText('src')).not.toBeInTheDocument();
      expect(screen.queryByText('package.json')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /open file explorer/i })).not.toBeInTheDocument();
      expect(container.firstChild).toBeNull();
    });

    it('renders normally on mobile when expanded', () => {
      mockUseFileTree.mockReturnValue(defaultMockHook);

      render(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={mockOnCollapseChange}
          isCompactLayout={true}
        />
      );

      // Should show file entries even on mobile when expanded
      expect(screen.getByText('src')).toBeInTheDocument();
      expect(screen.getByText('package.json')).toBeInTheDocument();
    });

    it('calls onCollapseChange when the close button is clicked', () => {
      mockUseFileTree.mockReturnValue(defaultMockHook);

      render(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={mockOnCollapseChange}
          isCompactLayout={false}
        />
      );

      const collapseButton = screen.getByRole('button', { name: /close file explorer/i });
      fireEvent.click(collapseButton);

      expect(mockOnCollapseChange).toHaveBeenCalledWith(true);
    });

    it('hides completely on desktop when collapsed prop changes', () => {
      mockUseFileTree.mockReturnValue(defaultMockHook);

      const { container, rerender } = render(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={false}
          onCollapseChange={mockOnCollapseChange}
          isCompactLayout={false}
        />
      );

      // Initially should show normal width
      expect(screen.getByText('src')).toBeInTheDocument();

      // Collapse should fully hide the panel. Reopen lives in the chat header.
      rerender(
        <FileTreePanel
          onOpenFile={mockOnOpenFile}
          onRemapOpenPaths={mockOnRemapOpenPaths}
          onCloseOpenPaths={mockOnCloseOpenPaths}
          collapsed={true}
          onCollapseChange={mockOnCollapseChange}
          isCompactLayout={false}
        />
      );

      expect(screen.queryByText('src')).not.toBeInTheDocument();
      expect(container.firstChild).toBeNull();
    });
  });
});
