import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

type SaveResult = { ok: boolean; conflict?: boolean };
type SaveAllResult = { ok: boolean; failedPath?: string; conflict?: boolean };

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const {
  settingsContext,
  sessionContext,
  saveFileByAgent,
  saveAllDirtyFilesByAgent,
  discardAllDirtyFilesByAgent,
  dirtyStateByAgent,
  reloadCalls,
  topBarRenderSnapshots,
  tabRenderSnapshots,
  useOpenFilesMock,
} = vi.hoisted(() => {
  const settingsContext = {
    kanbanVisible: true,
  };

  const sessionContext = {
    sessions: [
      { key: 'agent:alpha:main', label: 'Alpha' },
      { key: 'agent:alpha:subagent:abc', label: 'Alpha helper' },
      { key: 'agent:bravo:main', label: 'Bravo' },
    ],
    sessionsLoading: false,
    currentSession: 'agent:alpha:main',
    setCurrentSession: vi.fn(),
    busyState: {},
    agentStatus: {},
    unreadSessions: new Set<string>(),
    refreshSessions: vi.fn(),
    deleteSession: vi.fn(),
    abortSession: vi.fn(),
    spawnSession: vi.fn(),
    renameSession: vi.fn(),
    agentLogEntries: [],
    eventEntries: [],
    agentName: 'Nerve',
  };

  const saveFileByAgent = {
    alpha: vi.fn<[string], Promise<SaveResult>>(),
    bravo: vi.fn<[string], Promise<SaveResult>>(),
  };
  const saveAllDirtyFilesByAgent = {
    alpha: vi.fn<[], Promise<SaveAllResult>>(),
    bravo: vi.fn<[], Promise<SaveAllResult>>(),
  };
  const discardAllDirtyFilesByAgent = {
    alpha: vi.fn<[], void>(),
    bravo: vi.fn<[], void>(),
  };
  const dirtyStateByAgent: Record<string, boolean> = {
    alpha: false,
    bravo: false,
  };
  const reloadCalls: Array<{ agentId: string; path: string }> = [];
  const topBarRenderSnapshots: Array<{ showKanbanView?: boolean; viewMode?: string }> = [];
  const tabRenderSnapshots: Array<{
    workspaceAgentId: string;
    hasSaveToast: boolean;
    saveToastPath: string | null;
  }> = [];

  const useOpenFilesMock = vi.fn((agentId: string) => ({
    openFiles: [{ path: 'shared.md', name: 'shared.md', content: 'draft', savedContent: 'draft', dirty: dirtyStateByAgent[agentId] ?? false }],
    activeTab: 'shared.md',
    setActiveTab: vi.fn(),
    openFile: vi.fn(),
    closeFile: vi.fn(),
    updateContent: vi.fn(),
    saveFile: saveFileByAgent[agentId as keyof typeof saveFileByAgent] ?? vi.fn().mockResolvedValue({ ok: true }),
    reloadFile: vi.fn((path: string) => {
      reloadCalls.push({ agentId, path });
    }),
    handleFileChanged: vi.fn(),
    remapOpenPaths: vi.fn(),
    closeOpenPathsByPrefix: vi.fn(),
    hasDirtyFiles: dirtyStateByAgent[agentId] ?? false,
    getDirtyFilePaths: vi.fn(() => (dirtyStateByAgent[agentId] ? ['shared.md'] : [])),
    saveAllDirtyFiles: saveAllDirtyFilesByAgent[agentId as keyof typeof saveAllDirtyFilesByAgent] ?? vi.fn().mockResolvedValue({ ok: true }),
    discardAllDirtyFiles: discardAllDirtyFilesByAgent[agentId as keyof typeof discardAllDirtyFilesByAgent] ?? vi.fn(),
  }));

  return {
    settingsContext,
    sessionContext,
    saveFileByAgent,
    saveAllDirtyFilesByAgent,
    discardAllDirtyFilesByAgent,
    dirtyStateByAgent,
    reloadCalls,
    topBarRenderSnapshots,
    tabRenderSnapshots,
    useOpenFilesMock,
  };
});

vi.mock('@/contexts/GatewayContext', () => ({
  useGateway: () => ({
    connectionState: 'connected',
    connectError: null,
    reconnectAttempt: 0,
    model: 'gpt-test',
    sparkline: [],
  }),
}));

vi.mock('@/contexts/SessionContext', () => ({
  useSessionContext: () => sessionContext,
}));

vi.mock('@/contexts/ChatContext', () => ({
  useChat: () => ({
    messages: [],
    isGenerating: false,
    stream: null,
    processingStage: null,
    lastEventTimestamp: null,
    activityLog: [],
    currentToolDescription: null,
    handleSend: vi.fn(),
    handleAbort: vi.fn(),
    handleReset: vi.fn(),
    loadMore: vi.fn(),
    hasMore: false,
    showResetConfirm: false,
    confirmReset: vi.fn(),
    cancelReset: vi.fn(),
  }),
}));

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    soundEnabled: false,
    toggleSound: vi.fn(),
    ttsProvider: 'off',
    ttsModel: 'none',
    setTtsProvider: vi.fn(),
    setTtsModel: vi.fn(),
    sttProvider: 'local',
    setSttProvider: vi.fn(),
    sttInputMode: 'push-to-talk',
    setSttInputMode: vi.fn(),
    sttModel: 'whisper',
    setSttModel: vi.fn(),
    wakeWordEnabled: false,
    handleToggleWakeWord: vi.fn(),
    handleWakeWordState: vi.fn(),
    liveTranscriptionPreview: false,
    toggleLiveTranscriptionPreview: vi.fn(),
    panelRatio: 60,
    setPanelRatio: vi.fn(),
    eventsVisible: false,
    logVisible: false,
    toggleEvents: vi.fn(),
    toggleLog: vi.fn(),
    toggleTelemetry: vi.fn(),
    setTheme: vi.fn(),
    setFont: vi.fn(),
    kanbanVisible: settingsContext.kanbanVisible,
  }),
}));

vi.mock('@/hooks/useConnectionManager', () => ({
  useConnectionManager: () => ({
    dialogOpen: false,
    editableUrl: 'ws://localhost:18789/ws',
    setEditableUrl: vi.fn(),
    officialUrl: 'ws://localhost:18789/ws',
    editableToken: '',
    setEditableToken: vi.fn(),
    handleConnect: vi.fn(),
    handleReconnect: vi.fn(),
    serverSideAuth: true,
  }),
}));

vi.mock('@/hooks/useDashboardData', () => ({
  useDashboardData: () => ({
    memories: [],
    memoriesLoading: false,
    tokenData: null,
    refreshMemories: vi.fn(),
  }),
}));

vi.mock('@/hooks/useGatewayRestart', () => ({
  useGatewayRestart: () => ({
    showGatewayRestartConfirm: false,
    gatewayRestarting: false,
    gatewayRestartNotice: null,
    handleGatewayRestart: vi.fn(),
    cancelGatewayRestart: vi.fn(),
    confirmGatewayRestart: vi.fn(),
    dismissNotice: vi.fn(),
  }),
}));

vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
}));

vi.mock('@/features/command-palette/commands', () => ({
  createCommands: () => [],
}));

vi.mock('@/features/file-browser', () => ({
  useOpenFiles: useOpenFilesMock,
  FileTreePanel: () => <div data-testid="file-tree-panel" />,
  TabbedContentArea: ({ workspaceAgentId, onSaveFile, onReloadFile, saveToast }: {
    workspaceAgentId: string;
    onSaveFile: (path: string) => void;
    onReloadFile?: (path: string) => void;
    saveToast?: { path: string; type: 'conflict' } | null;
  }) => {
    tabRenderSnapshots.push({
      workspaceAgentId,
      hasSaveToast: Boolean(saveToast),
      saveToastPath: saveToast?.path ?? null,
    });

    return (
      <div>
        <div data-testid="workspace-agent">{workspaceAgentId}</div>
        <button type="button" onClick={() => onSaveFile('shared.md')}>Save shared.md</button>
        {saveToast && (
          <div>
            <span>File changed externally.</span>
            {onReloadFile && (
              <button type="button" onClick={() => onReloadFile(saveToast.path)}>Reload</button>
            )}
          </div>
        )}
      </div>
    );
  },
}));

vi.mock('@/features/connect/ConnectDialog', () => ({
  ConnectDialog: () => null,
}));

vi.mock('@/components/TopBar', () => ({
  TopBar: ({ showKanbanView, viewMode }: { showKanbanView?: boolean; viewMode?: string }) => {
    topBarRenderSnapshots.push({ showKanbanView, viewMode });
    return (
      <div>
        <div data-testid="topbar-show-kanban">{String(showKanbanView ?? true)}</div>
        <div data-testid="topbar-view-mode">{viewMode ?? 'chat'}</div>
      </div>
    );
  },
}));

vi.mock('@/components/StatusBar', () => ({
  StatusBar: () => null,
}));

vi.mock('@/components/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}));

vi.mock('@/features/chat/ChatPanel', () => ({
  ChatPanel: () => null,
}));

vi.mock('@/components/ResizablePanels', () => ({
  ResizablePanels: ({ left, right }: { left: ReactNode; right: ReactNode }) => (
    <div>
      <div>{left}</div>
      <div>{right}</div>
    </div>
  ),
}));

vi.mock('@/components/PanelErrorBoundary', () => ({
  PanelErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/sessions/SpawnAgentDialog', () => ({
  SpawnAgentDialog: () => null,
}));

vi.mock('@/features/settings/SettingsDrawer', () => ({
  SettingsDrawer: () => null,
}));

vi.mock('@/features/command-palette/CommandPalette', () => ({
  CommandPalette: () => null,
}));

vi.mock('@/features/sessions/SessionList', () => ({
  SessionList: ({ onSelect, onSpawn }: {
    onSelect: (key: string) => void;
    onSpawn?: (opts: { kind: 'root' | 'subagent'; agentName?: string; parentSessionKey?: string; task: string; model: string; thinking: string; cleanup?: string }) => Promise<void>;
  }) => (
    <div>
      <button type="button" onClick={() => onSelect('agent:bravo:main')}>Select Bravo</button>
      <button type="button" onClick={() => onSelect('agent:alpha:subagent:abc')}>Select Alpha Subagent</button>
      {onSpawn && (
        <button
          type="button"
          onClick={() => onSpawn({
            kind: 'root',
            agentName: 'Charlie',
            task: 'Investigate workspace guard',
            model: 'test-model',
            thinking: 'medium',
          })}
        >
          Spawn Root Charlie
        </button>
      )}
      {onSpawn && (
        <button
          type="button"
          onClick={() => onSpawn({
            kind: 'subagent',
            parentSessionKey: 'agent:bravo:main',
            task: 'Help bravo',
            model: 'test-model',
            thinking: 'medium',
            cleanup: 'keep',
          })}
        >
          Spawn Bravo Subagent
        </button>
      )}
    </div>
  ),
}));

vi.mock('@/features/workspace/WorkspacePanel', () => ({
  WorkspacePanel: () => null,
}));

vi.mock('@/features/kanban/KanbanPanel', () => ({
  KanbanPanel: () => null,
}));

describe('App save toast workspace scoping', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionContext.currentSession = 'agent:alpha:main';
    sessionContext.setCurrentSession.mockReset();
    sessionContext.spawnSession.mockReset();
    Object.values(saveFileByAgent).forEach((mockFn) => mockFn.mockReset());
    Object.values(saveAllDirtyFilesByAgent).forEach((mockFn) => mockFn.mockReset());
    Object.values(discardAllDirtyFilesByAgent).forEach((mockFn) => mockFn.mockReset());
    dirtyStateByAgent.alpha = false;
    dirtyStateByAgent.bravo = false;
    settingsContext.kanbanVisible = true;
    reloadCalls.length = 0;
    topBarRenderSnapshots.length = 0;
    tabRenderSnapshots.length = 0;
    useOpenFilesMock.mockClear();

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('drops a late save conflict toast after switching workspaces before the save resolves', async () => {
    const alphaSave = createDeferred<SaveResult>();
    saveFileByAgent.alpha.mockReturnValue(alphaSave.promise);
    saveFileByAgent.bravo.mockResolvedValue({ ok: true });

    const { rerender } = render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Save shared.md' }));

    sessionContext.currentSession = 'agent:bravo:main';
    rerender(<App />);

    expect(screen.getByTestId('workspace-agent')).toHaveTextContent('bravo');

    await act(async () => {
      alphaSave.resolve({ ok: false, conflict: true });
      await Promise.resolve();
    });

    expect(screen.queryByText('File changed externally.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
  });

  it('never passes a stale save conflict toast into the first render after a workspace switch', async () => {
    saveFileByAgent.alpha.mockResolvedValue({ ok: false, conflict: true });
    saveFileByAgent.bravo.mockResolvedValue({ ok: true });

    const { rerender } = render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Save shared.md' }));

    expect(await screen.findByText('File changed externally.')).toBeInTheDocument();

    const snapshotsBeforeSwitch = tabRenderSnapshots.length;
    sessionContext.currentSession = 'agent:bravo:main';
    rerender(<App />);

    const switchSnapshots = tabRenderSnapshots.slice(snapshotsBeforeSwitch);
    expect(switchSnapshots[0]).toMatchObject({
      workspaceAgentId: 'bravo',
      hasSaveToast: false,
      saveToastPath: null,
    });
  });

  it('dismisses an active save conflict toast on workspace switch so reload cannot target the wrong workspace', async () => {
    saveFileByAgent.alpha.mockResolvedValue({ ok: false, conflict: true });
    saveFileByAgent.bravo.mockResolvedValue({ ok: true });

    const { rerender } = render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Save shared.md' }));

    expect(await screen.findByText('File changed externally.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();

    sessionContext.currentSession = 'agent:bravo:main';
    rerender(<App />);

    expect(screen.getByTestId('workspace-agent')).toHaveTextContent('bravo');
    expect(screen.queryByText('File changed externally.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
    expect(reloadCalls).toEqual([]);
  });

  it('does not resurface a stale save conflict toast after switching away and back', async () => {
    saveFileByAgent.alpha.mockResolvedValue({ ok: false, conflict: true });
    saveFileByAgent.bravo.mockResolvedValue({ ok: true });

    const { rerender } = render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Save shared.md' }));

    expect(await screen.findByText('File changed externally.')).toBeInTheDocument();

    sessionContext.currentSession = 'agent:bravo:main';
    rerender(<App />);

    expect(screen.queryByText('File changed externally.')).not.toBeInTheDocument();

    sessionContext.currentSession = 'agent:alpha:main';
    rerender(<App />);

    expect(screen.getByTestId('workspace-agent')).toHaveTextContent('alpha');
    expect(screen.queryByText('File changed externally.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
  });
});

describe('App workspace switch guard', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionContext.currentSession = 'agent:alpha:main';
    sessionContext.setCurrentSession.mockReset();
    sessionContext.spawnSession.mockReset();
    Object.values(saveAllDirtyFilesByAgent).forEach((mockFn) => mockFn.mockReset());
    Object.values(discardAllDirtyFilesByAgent).forEach((mockFn) => mockFn.mockReset());
    dirtyStateByAgent.alpha = true;
    dirtyStateByAgent.bravo = false;
    saveAllDirtyFilesByAgent.alpha.mockResolvedValue({ ok: true });
    discardAllDirtyFilesByAgent.alpha.mockImplementation(() => {});
  });

  it('does not guard same-agent subagent navigation', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Select Alpha Subagent' }));

    expect(sessionContext.setCurrentSession).toHaveBeenCalledWith('agent:alpha:subagent:abc');
    expect(screen.queryByText('Unsaved workspace edits')).not.toBeInTheDocument();
  });

  it('guards cross-agent session selection until save and switch completes', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Select Bravo' }));

    expect(sessionContext.setCurrentSession).not.toHaveBeenCalled();
    expect(screen.getByText('Unsaved workspace edits')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save and switch' }));

    await waitFor(() => {
      expect(saveAllDirtyFilesByAgent.alpha).toHaveBeenCalledTimes(1);
      expect(sessionContext.setCurrentSession).toHaveBeenCalledWith('agent:bravo:main');
    });
  });

  it('lets the user cancel a guarded switch without mutating anything', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Select Bravo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(saveAllDirtyFilesByAgent.alpha).not.toHaveBeenCalled();
    expect(discardAllDirtyFilesByAgent.alpha).not.toHaveBeenCalled();
    expect(sessionContext.setCurrentSession).not.toHaveBeenCalled();
  });

  it('discards dirty files before switching when requested', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Select Bravo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard and switch' }));

    await waitFor(() => {
      expect(discardAllDirtyFilesByAgent.alpha).toHaveBeenCalledTimes(1);
      expect(sessionContext.setCurrentSession).toHaveBeenCalledWith('agent:bravo:main');
    });
  });

  it('stays on the current agent and surfaces an error when save and switch fails', async () => {
    saveAllDirtyFilesByAgent.alpha.mockResolvedValue({ ok: false, failedPath: 'shared.md', conflict: true });

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Select Bravo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and switch' }));

    await waitFor(() => {
      expect(saveAllDirtyFilesByAgent.alpha).toHaveBeenCalledTimes(1);
    });

    expect(sessionContext.setCurrentSession).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('shared.md');
  });

  it('guards root-agent creation until the user confirms the switch', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Spawn Root Charlie' }));

    expect(sessionContext.spawnSession).not.toHaveBeenCalled();
    expect(screen.getByText('Unsaved workspace edits')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Discard and switch' }));

    await waitFor(() => {
      expect(discardAllDirtyFilesByAgent.alpha).toHaveBeenCalledTimes(1);
      expect(sessionContext.spawnSession).toHaveBeenCalledWith({
        kind: 'root',
        agentName: 'Charlie',
        task: 'Investigate workspace guard',
        model: 'test-model',
        thinking: 'medium',
      });
    });
  });

  it('guards cross-agent subagent creation too', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Spawn Bravo Subagent' }));

    expect(sessionContext.spawnSession).not.toHaveBeenCalled();
    expect(screen.getByText('Unsaved workspace edits')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save and switch' }));

    await waitFor(() => {
      expect(saveAllDirtyFilesByAgent.alpha).toHaveBeenCalledTimes(1);
      expect(sessionContext.spawnSession).toHaveBeenCalledWith({
        kind: 'subagent',
        parentSessionKey: 'agent:bravo:main',
        task: 'Help bravo',
        model: 'test-model',
        thinking: 'medium',
        cleanup: 'keep',
      });
    });
  });
});

describe('App kanban visibility gating', () => {
  beforeEach(() => {
    localStorage.clear();
    settingsContext.kanbanVisible = true;
    topBarRenderSnapshots.length = 0;
  });

  it('passes the kanban visibility flag through to the top bar', () => {
    settingsContext.kanbanVisible = false;

    render(<App />);

    expect(screen.getByTestId('topbar-show-kanban')).toHaveTextContent('false');
    expect(topBarRenderSnapshots.at(-1)).toMatchObject({ showKanbanView: false });
  });

  it('falls back to chat when kanban is persisted but hidden', () => {
    localStorage.setItem('nerve:viewMode', 'kanban');
    settingsContext.kanbanVisible = false;

    render(<App />);

    expect(screen.getByTestId('topbar-view-mode')).toHaveTextContent('chat');
  });
});
