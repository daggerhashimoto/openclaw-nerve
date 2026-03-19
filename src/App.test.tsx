import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

type SaveResult = { ok: boolean; conflict?: boolean };

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const { sessionContext, saveFileByAgent, reloadCalls, useOpenFilesMock } = vi.hoisted(() => {
  const sessionContext = {
    sessions: [
      { key: 'agent:alpha:main', label: 'Alpha' },
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
  const reloadCalls: Array<{ agentId: string; path: string }> = [];

  const useOpenFilesMock = vi.fn((agentId: string) => ({
    openFiles: [{ path: 'shared.md', name: 'shared.md', content: 'draft', savedContent: 'draft', dirty: false }],
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
  }));

  return {
    sessionContext,
    saveFileByAgent,
    reloadCalls,
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
    saveToast?: { path: string; type: 'conflict' | 'error' } | null;
  }) => (
    <div>
      <div data-testid="workspace-agent">{workspaceAgentId}</div>
      <button type="button" onClick={() => onSaveFile('shared.md')}>Save shared.md</button>
      {saveToast && (
        <div>
          <span>{saveToast.type === 'conflict' ? 'File changed externally.' : 'Failed to save.'}</span>
          {saveToast.type === 'conflict' && onReloadFile && (
            <button type="button" onClick={() => onReloadFile(saveToast.path)}>Reload</button>
          )}
        </div>
      )}
    </div>
  ),
}));

vi.mock('@/features/connect/ConnectDialog', () => ({
  ConnectDialog: () => null,
}));

vi.mock('@/components/TopBar', () => ({
  TopBar: () => null,
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
  SessionList: () => null,
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
    Object.values(saveFileByAgent).forEach((mockFn) => mockFn.mockReset());
    reloadCalls.length = 0;

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
});
