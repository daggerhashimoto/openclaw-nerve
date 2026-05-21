/**
 * App.tsx - Main application layout component
 * 
 * This component focuses on layout and composition.
 * Connection management is handled by useConnectionManager.
 * Dashboard data fetching is handled by useDashboardData.
 */
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useReducer,
  lazy,
  Suspense,
} from 'react';
import { AlertTriangle, CheckCircle2, RotateCw } from 'lucide-react';
import { useGateway } from '@/contexts/GatewayContext';
import { useSessionContext, type SpawnSessionOpts } from '@/contexts/SessionContext';
import { useChat } from '@/contexts/ChatContext';
import { useSettings, type STTInputMode } from '@/contexts/SettingsContext';
import { getSessionKey } from '@/types';
import { useConnectionManager } from '@/hooks/useConnectionManager';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useGatewayRestart } from '@/hooks/useGatewayRestart';
import { ConnectDialog } from '@/features/connect/ConnectDialog';
import { TopBar } from '@/components/TopBar';
import { StatusBar } from '@/components/StatusBar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { WorkspaceSwitchDialog } from '@/components/WorkspaceSwitchDialog';
import { ChatPanel, type ChatPanelHandle } from '@/features/chat/ChatPanel';
import type { TTSProvider } from '@/features/tts/useTTS';
import type { ViewMode } from '@/features/command-palette/commands';
import { ResizablePanels } from '@/components/ResizablePanels';
import { getContextLimit } from '@/lib/constants';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { createCommands } from '@/features/command-palette/commands';
import { PanelErrorBoundary } from '@/components/PanelErrorBoundary';
import { SpawnAgentDialog } from '@/features/sessions/SpawnAgentDialog';
import { DEFAULT_CHAT_PATH_LINKS_CONFIG, parseChatPathLinksConfig } from '@/features/chat/chatPathLinks';
import { FileTreePanel, TabbedContentArea, useOpenFiles, type FileTreeChangeEvent } from '@/features/file-browser';
import { type BeadLinkTarget, type OpenBeadTab, buildBeadTabId } from '@/features/beads';
import { isImageFile } from '@/features/file-browser/utils/fileTypes';
import { buildAgentRootSessionKey, getSessionDisplayLabel } from '@/features/sessions/sessionKeys';
import { shouldGuardWorkspaceSwitch } from '@/features/workspace/workspaceSwitchGuard';
import { getWorkspaceAgentId, getWorkspaceRootSessionKey } from '@/features/workspace/workspaceScope';

// Lazy-loaded features (not needed in initial bundle)
const SettingsDrawer = lazy(() => import('@/features/settings/SettingsDrawer').then(m => ({ default: m.SettingsDrawer })));
const CommandPalette = lazy(() => import('@/features/command-palette/CommandPalette').then(m => ({ default: m.CommandPalette })));

// Lazy-loaded side panels
const SessionList = lazy(() => import('@/features/sessions/SessionList').then(m => ({ default: m.SessionList })));
const WorkspacePanel = lazy(() => import('@/features/workspace/WorkspacePanel').then(m => ({ default: m.WorkspacePanel })));

// Lazy-loaded view modes
const KanbanPanel = lazy(() => import('@/features/kanban/KanbanPanel').then(m => ({ default: m.KanbanPanel })));

interface AppProps {
  onLogout?: () => void;
}

interface PendingWorkspaceSwitch {
  targetLabel: string;
  execute: () => Promise<void>;
  resolve: (didSwitch: boolean) => void;
  reject: (error: unknown) => void;
}

function buildWorkspaceSwitchErrorMessage(result: {
  failedPath?: string;
  conflict?: boolean;
}): string {
  const fileLabel = result.failedPath || 'a dirty file';
  if (result.conflict) {
    return `${fileLabel} changed on disk. Resolve it before switching agents.`;
  }
  return `Could not save ${fileLabel}. Resolve it before switching agents.`;
}

function getInitialViewMode(canShowKanban: boolean): ViewMode {
  try {
    const saved = localStorage.getItem('nerve:viewMode');
    if (saved === 'kanban' && canShowKanban) return 'kanban';
  } catch {
    // ignore storage errors
  }

  return 'chat';
}

export default function App({ onLogout }: AppProps) {
  // Gateway state
  const {
    connectionState, connectError, reconnectAttempt, model, sparkline,
  } = useGateway();

  // Session state
  const {
    sessions, sessionsLoading, currentSession, setCurrentSession,
    busyState, agentStatus, unreadSessions, refreshSessions, deleteSession, abortSession, spawnSession, renameSession,
    agentLogEntries, eventEntries,
    agentName,
  } = useSessionContext();

  // Chat state
  const {
    messages, isGenerating, stream, processingStage,
    lastEventTimestamp, activityLog, currentToolDescription,
    handleSend, handleAbort, handleReset,
    loadMore, hasMore,
    showResetConfirm, confirmReset, cancelReset,
  } = useChat();

  // Settings state
  const {
    soundEnabled, toggleSound,
    ttsProvider, ttsModel, setTtsProvider, setTtsModel,
    sttProvider, setSttProvider, sttInputMode, setSttInputMode, sttModel, setSttModel,
    wakeWordEnabled, handleToggleWakeWord, handleWakeWordState,
    liveTranscriptionPreview, toggleLiveTranscriptionPreview,
    panelRatio, setPanelRatio,
    eventsVisible, logVisible,
    toggleEvents, toggleLog, toggleTelemetry,
    setTheme, setFont,
    kanbanVisible,
    commandPaletteButtonVisible,
  } = useSettings();

  // Connection management (extracted hook)
  const {
    dialogOpen,
    editableUrl, setEditableUrl,
    officialUrl,
    editableToken, setEditableToken,
    handleConnect, handleReconnect,
    serverSideAuth,
  } = useConnectionManager();

  // Track file change events for tree refresh. Sequence keeps repeated same-path updates visible.
  const [lastChangedEvent, setLastChangedEvent] = useState<FileTreeChangeEvent | null>(null);
  const [revealRequest, setRevealRequest] = useState<{
    id: number;
    path: string;
    kind: 'file' | 'directory';
    agentId: string;
  } | null>(null);
  const fileTreeChangeSequenceRef = useRef(0);

  const initialCompactLayout = typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;
  const initialDesktopFileBrowserCollapsed = (() => {
    try {
      const saved = localStorage.getItem('nerve-file-tree-collapsed');
      if (saved !== null) return saved === 'true';
    } catch {
      // ignore storage errors and fall back to desktop default
    }

    return false;
  })();

  // File browser collapse state for mobile optimization
  const [fileBrowserCollapsed, setFileBrowserCollapsedState] = useState(() => (
    initialCompactLayout ? true : initialDesktopFileBrowserCollapsed
  ));
  const [desktopFileBrowserCollapsed, setDesktopFileBrowserCollapsed] = useState(initialDesktopFileBrowserCollapsed);

  // Responsive layout state (chat-first on smaller viewports)
  const [isCompactLayout, setIsCompactLayout] = useState(initialCompactLayout);

  const persistDesktopFileBrowserCollapsed = useCallback((collapsed: boolean) => {
    setDesktopFileBrowserCollapsed(collapsed);

    try {
      localStorage.setItem('nerve-file-tree-collapsed', String(collapsed));
    } catch {
      // ignore storage errors
    }
  }, []);

  const setFileBrowserCollapsed = useCallback((nextCollapsed: boolean | ((prev: boolean) => boolean)) => {
    setFileBrowserCollapsedState(prevCollapsed => {
      const resolvedCollapsed = typeof nextCollapsed === 'function'
        ? nextCollapsed(prevCollapsed)
        : nextCollapsed;

      if (!isCompactLayout) {
        persistDesktopFileBrowserCollapsed(resolvedCollapsed);
      }

      return resolvedCollapsed;
    });
  }, [isCompactLayout, persistDesktopFileBrowserCollapsed]);

  /** Toggle file browser collapse state (mobile). */
  const handleToggleFileBrowser = useCallback(() => {
    setFileBrowserCollapsed(prev => !prev);
  }, [setFileBrowserCollapsed]);

  const workspaceAgentId = useMemo(() => getWorkspaceAgentId(currentSession), [currentSession]);

  // File browser state
  const {
    openFiles, activeTab, setActiveTab,
    openFile, closeFile, updateContent, saveFile, reloadFile,
    handleFileChanged, remapOpenPaths, closeOpenPathsByPrefix,
    hasDirtyFiles, saveAllDirtyFiles, discardAllDirtyFiles,
  } = useOpenFiles(workspaceAgentId);

  // Save with workspace-scoped conflict toast
  const [saveToast, setSaveToast] = useState<{
    agentId: string;
    path: string;
    type: 'conflict';
    workspaceVersion: number;
  } | null>(null);
  const [workspaceVersion, bumpWorkspaceVersion] = useReducer((version: number) => version + 1, 0);
  const saveToastTimerRef = useRef<number | null>(null);
  const workspaceAgentIdRef = useRef(workspaceAgentId);
  const [pendingWorkspaceSwitch, setPendingWorkspaceSwitch] = useState<PendingWorkspaceSwitch | null>(null);
  const [workspaceSwitchAction, setWorkspaceSwitchAction] = useState<'save' | 'discard' | null>(null);
  const [workspaceSwitchError, setWorkspaceSwitchError] = useState<string | null>(null);

  const clearSaveToastTimer = useCallback(() => {
    if (saveToastTimerRef.current !== null) {
      window.clearTimeout(saveToastTimerRef.current);
      saveToastTimerRef.current = null;
    }
  }, []);

  const dismissSaveToast = useCallback(() => {
    clearSaveToastTimer();
    setSaveToast(null);
  }, [clearSaveToastTimer]);

  const showSaveToastForAgent = useCallback((
    targetAgentId: string,
    nextToast: { path: string; type: 'conflict' },
  ) => {
    if (workspaceAgentIdRef.current !== targetAgentId) return;

    clearSaveToastTimer();
    const toastForAgent = {
      ...nextToast,
      agentId: targetAgentId,
      workspaceVersion,
    };
    setSaveToast(toastForAgent);
    saveToastTimerRef.current = window.setTimeout(() => {
      setSaveToast((currentToast) => (currentToast === toastForAgent ? null : currentToast));
      saveToastTimerRef.current = null;
    }, 5000);
  }, [clearSaveToastTimer, workspaceVersion]);

  useEffect(() => {
    workspaceAgentIdRef.current = workspaceAgentId;
    bumpWorkspaceVersion();
    clearSaveToastTimer();
  }, [clearSaveToastTimer, workspaceAgentId]);

  useEffect(() => () => clearSaveToastTimer(), [clearSaveToastTimer]);

  const handleSaveFile = useCallback(async (filePath: string) => {
    const requestAgentId = workspaceAgentId;
    const result = await saveFile(filePath);

    if (workspaceAgentIdRef.current !== requestAgentId) {
      return;
    }

    if (!result.ok) {
      if (result.conflict) {
        showSaveToastForAgent(requestAgentId, { path: filePath, type: 'conflict' });
      }
      return;
    }

    dismissSaveToast();
  }, [dismissSaveToast, saveFile, showSaveToastForAgent, workspaceAgentId]);

  // Single file.changed handler, feeds both open files and tree refresh.
  const onFileChanged = useCallback((path: string, targetAgentId: string) => {
    handleFileChanged(path, targetAgentId);
    setLastChangedEvent({
      path,
      agentId: targetAgentId,
      sequence: ++fileTreeChangeSequenceRef.current,
    });
  }, [handleFileChanged]);

  // Dashboard data (extracted hook) — single SSE connection handles all events
  const { memories, memoriesLoading, tokenData, remoteWorkspace, refreshMemories } = useDashboardData({
    agentId: workspaceAgentId,
    onFileChanged,
  });

  // UI state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [booted, setBooted] = useState(false);
  const [logGlow, setLogGlow] = useState(false);
  const [isMobileTopBarHidden, setIsMobileTopBarHidden] = useState(false);
  const [desktopRightPanelWidth, setDesktopRightPanelWidth] = useState<number | null>(null);
  const prevLogCount = useRef(0);
  const chatPanelRef = useRef<ChatPanelHandle>(null);

  // Gateway restart
  const {
    showGatewayRestartConfirm,
    gatewayRestarting,
    gatewayRestartNotice,
    handleGatewayRestart,
    cancelGatewayRestart,
    confirmGatewayRestart,
    dismissNotice,
  } = useGatewayRestart();

  // Command palette state
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false);

  // View mode state (chat | kanban), persisted to localStorage
  const [viewMode, setViewModeRaw] = useState<ViewMode>(() => getInitialViewMode(kanbanVisible));
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [openBeads, setOpenBeads] = useState<OpenBeadTab[]>([]);
  const setViewMode = useCallback((mode: ViewMode) => {
    const nextMode = mode === 'kanban' && !kanbanVisible ? 'chat' : mode;
    setViewModeRaw(nextMode);

    if (nextMode === 'kanban' && isCompactLayout) {
      setFileBrowserCollapsed(true);
    }

    try { localStorage.setItem('nerve:viewMode', nextMode); } catch { /* ignore */ }
  }, [isCompactLayout, kanbanVisible, setFileBrowserCollapsed]);
  const openTaskInBoard = useCallback((taskId: string) => {
    setPendingTaskId(taskId);
    setViewMode('kanban');
  }, [setViewMode]);
  const [chatPathLinkPrefixes, setChatPathLinkPrefixes] = useState<string[]>(
    DEFAULT_CHAT_PATH_LINKS_CONFIG.prefixes,
  );
  const [chatPathLinkAliases, setChatPathLinkAliases] = useState<Record<string, string>>(
    DEFAULT_CHAT_PATH_LINKS_CONFIG.aliases,
  );
  const [addToChatEnabled, setAddToChatEnabled] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({ agentId: workspaceAgentId });
    const controller = new AbortController();

    void fetch(`/api/workspace/chatPathLinks?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (res.status === 404) {
          setChatPathLinkPrefixes(DEFAULT_CHAT_PATH_LINKS_CONFIG.prefixes);
          setChatPathLinkAliases(DEFAULT_CHAT_PATH_LINKS_CONFIG.aliases);
          return;
        }
        const data = await res.json() as { ok: boolean; content?: string };
        if (!data.ok || !data.content) {
          setChatPathLinkPrefixes(DEFAULT_CHAT_PATH_LINKS_CONFIG.prefixes);
          setChatPathLinkAliases(DEFAULT_CHAT_PATH_LINKS_CONFIG.aliases);
          return;
        }
        const parsed = parseChatPathLinksConfig(data.content);
        setChatPathLinkPrefixes(parsed.prefixes);
        setChatPathLinkAliases(parsed.aliases);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setChatPathLinkPrefixes(DEFAULT_CHAT_PATH_LINKS_CONFIG.prefixes);
          setChatPathLinkAliases(DEFAULT_CHAT_PATH_LINKS_CONFIG.aliases);
        }
      });

    return () => controller.abort();
  }, [workspaceAgentId]);

  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: number | null = null;
    let attempts = 0;
    const maxAttempts = 3;

    const loadUploadConfig = () => {
      attempts += 1;

      void fetch('/api/upload-config', { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (controller.signal.aborted) return;

          if (data) {
            setAddToChatEnabled(Boolean(data.fileReferenceEnabled));
            return;
          }

          if (attempts >= maxAttempts) {
            setAddToChatEnabled(false);
            return;
          }

          retryTimer = window.setTimeout(loadUploadConfig, 1000);
        })
        .catch(() => {
          if (controller.signal.aborted) return;

          if (attempts >= maxAttempts) {
            setAddToChatEnabled(false);
            return;
          }

          retryTimer = window.setTimeout(loadUploadConfig, 1000);
        });
    };

    loadUploadConfig();

    return () => {
      controller.abort();
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, []);

  useEffect(() => {
    if (kanbanVisible || viewMode !== 'kanban') return;
    setViewMode('chat');
  }, [kanbanVisible, setViewMode, viewMode]);

  const openBeadId = useCallback((target: BeadLinkTarget) => {
    const normalizedBeadId = target.beadId.trim();
    if (!normalizedBeadId) return;

    const normalizedTarget: BeadLinkTarget = {
      beadId: normalizedBeadId,
      explicitTargetPath: target.explicitTargetPath?.trim() || undefined,
      currentDocumentPath: target.currentDocumentPath?.trim() || undefined,
      workspaceAgentId: target.workspaceAgentId?.trim() || workspaceAgentId,
    };

    const tabId = buildBeadTabId(normalizedTarget);
    setOpenBeads((prev) => {
      if (prev.some((bead) => bead.id === tabId)) return prev;
      return [...prev, {
        id: tabId,
        beadId: normalizedBeadId,
        name: normalizedBeadId,
        explicitTargetPath: normalizedTarget.explicitTargetPath,
        currentDocumentPath: normalizedTarget.currentDocumentPath,
        workspaceAgentId: normalizedTarget.workspaceAgentId,
      }];
    });
    setActiveTab(tabId);
  }, [setActiveTab, workspaceAgentId]);

  const visibleOpenBeads = useMemo(() => openBeads.filter((bead) => {
    const beadWorkspaceAgentId = bead.workspaceAgentId?.trim() || workspaceAgentId;
    return beadWorkspaceAgentId === workspaceAgentId;
  }), [openBeads, workspaceAgentId]);

  useEffect(() => {
    if (!activeTab.startsWith('bead:')) return;
    if (visibleOpenBeads.some((bead) => bead.id === activeTab)) return;
    setActiveTab('chat');
  }, [activeTab, setActiveTab, visibleOpenBeads]);

  const closeWorkspaceTab = useCallback((tabId: string) => {
    if (tabId.startsWith('bead:')) {
      setOpenBeads((prev) => prev.filter((bead) => bead.id !== tabId));
      if (activeTab === tabId) {
        setActiveTab('chat');
      }
      return;
    }

    closeFile(tabId);
  }, [activeTab, closeFile, setActiveTab]);

  const openWorkspacePath = useCallback(async (targetPath: string, basePath?: string) => {
    const params = new URLSearchParams({ path: targetPath, agentId: workspaceAgentId });
    if (basePath) {
      params.set('relativeTo', basePath);
    }
    const res = await fetch(`/api/files/resolve?${params.toString()}`);
    const data = await res.json().catch(() => null) as {
      ok?: boolean;
      path?: string;
      type?: 'file' | 'directory';
      binary?: boolean;
    } | null;

    if (!res.ok || !data?.ok || !data.path || !data.type) return;

    setFileBrowserCollapsed(false);
    setRevealRequest({ id: Date.now(), path: data.path, kind: data.type, agentId: workspaceAgentId });

    if (data.type === 'file' && (!data.binary || isImageFile(data.path))) {
      await openFile(data.path);
    }
  }, [openFile, setFileBrowserCollapsed, workspaceAgentId]);

  const toggleMobileTopBar = useCallback(() => {
    setIsMobileTopBarHidden((prev) => !prev);
  }, []);

  // Build command list with stable references
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const openSpawnDialog = useCallback(() => setSpawnDialogOpen(true), []);

  const commands = useMemo(() => createCommands({
    onNewSession: openSpawnDialog,
    onResetSession: handleReset,
    onToggleSound: toggleSound,
    onSettings: openSettings,
    onSearch: openSearch,
    onAbort: handleAbort,
    onSetTheme: setTheme,
    onSetFont: setFont,
    onTtsProviderChange: setTtsProvider,
    onToggleWakeWord: handleToggleWakeWord,
    onToggleEvents: toggleEvents,
    onToggleLog: toggleLog,
    onToggleTelemetry: toggleTelemetry,
    onOpenSettings: openSettings,
    onRefreshSessions: refreshSessions,
    onRefreshMemory: refreshMemories,
    onSetViewMode: setViewMode,
    canShowKanban: kanbanVisible,
  }), [openSpawnDialog, handleReset, toggleSound, handleAbort, openSettings, openSearch,
    setTheme, setFont, setTtsProvider, handleToggleWakeWord, toggleEvents, toggleLog, toggleTelemetry,
    refreshSessions, refreshMemories, setViewMode, kanbanVisible]);

  // Keyboard shortcut handlers with useCallback
  const handleOpenPalette = useCallback(() => setPaletteOpen(true), []);
  const handleCtrlC = useCallback(() => {
    if (isGenerating) {
      handleAbort();
    }
  }, [isGenerating, handleAbort]);
  const toggleSearch = useCallback(() => setSearchOpen(prev => !prev), []);
  const handleEscape = useCallback(() => {
    if (paletteOpen) {
      setPaletteOpen(false);
    } else if (searchOpen) {
      setSearchOpen(false);
    } else if (isGenerating) {
      handleAbort();
    }
  }, [paletteOpen, searchOpen, isGenerating, handleAbort]);

  // Global keyboard shortcuts
  useKeyboardShortcuts([
    { key: 'k', meta: true, handler: handleOpenPalette },
    { key: 'b', meta: true, handler: handleToggleFileBrowser },  // Cmd+B → toggle file browser
    { key: 'f', meta: true, handler: toggleSearch, skipInEditor: true },  // Cmd+F → chat search (yields to CodeMirror search in editor)
    { key: 'c', ctrl: true, handler: handleCtrlC, preventDefault: false },  // Ctrl+C → abort (when generating), allow copy to still work
    { key: 'Escape', handler: handleEscape, skipInEditor: true },
  ]);

  // Get current session's context usage for StatusBar
  const currentSessionData = useMemo(() => {
    return sessions.find(s => getSessionKey(s) === currentSession);
  }, [sessions, currentSession]);

  // Get display name for current session (agent name for main, label for subagents)
  const currentSessionDisplayName = useMemo(() => {
    if (currentSessionData) return getSessionDisplayLabel(currentSessionData, agentName);
    return agentName;
  }, [currentSessionData, agentName]);

  const contextTokens = currentSessionData?.totalTokens ?? 0;
  const contextLimit = currentSessionData?.contextTokens || getContextLimit(model);

  const getWorkspaceSwitchLabel = useCallback((sessionKey: string) => {
    const targetSession = sessions.find((session) => getSessionKey(session) === sessionKey);
    if (targetSession) {
      return getSessionDisplayLabel(targetSession, agentName);
    }

    const targetAgentId = getWorkspaceAgentId(sessionKey);
    return targetAgentId === 'main' ? `${agentName} (main)` : `Agent ${targetAgentId}`;
  }, [agentName, sessions]);

  const requestWorkspaceTransition = useCallback((
    targetSessionKey: string,
    targetLabel: string,
    execute: () => Promise<void>,
  ) => {
    if (!shouldGuardWorkspaceSwitch(currentSession, targetSessionKey, hasDirtyFiles)) {
      return execute().then(() => true);
    }

    setWorkspaceSwitchAction(null);
    setWorkspaceSwitchError(null);

    return new Promise<boolean>((resolve, reject) => {
      setPendingWorkspaceSwitch({
        targetLabel,
        execute,
        resolve,
        reject,
      });
    });
  }, [currentSession, hasDirtyFiles]);

  const handleCancelWorkspaceSwitch = useCallback(() => {
    if (workspaceSwitchAction || !pendingWorkspaceSwitch) return;

    pendingWorkspaceSwitch.resolve(false);
    setPendingWorkspaceSwitch(null);
    setWorkspaceSwitchAction(null);
    setWorkspaceSwitchError(null);
  }, [pendingWorkspaceSwitch, workspaceSwitchAction]);

  const handleSaveAndSwitch = useCallback(async () => {
    if (!pendingWorkspaceSwitch || workspaceSwitchAction) return;

    const pendingSwitch = pendingWorkspaceSwitch;
    setWorkspaceSwitchAction('save');
    setWorkspaceSwitchError(null);

    const result = await saveAllDirtyFiles();
    if (!result.ok) {
      setWorkspaceSwitchAction(null);
      setWorkspaceSwitchError(buildWorkspaceSwitchErrorMessage(result));
      return;
    }

    try {
      await pendingSwitch.execute();
      pendingSwitch.resolve(true);
      setPendingWorkspaceSwitch(null);
      setWorkspaceSwitchError(null);
    } catch (error) {
      pendingSwitch.reject(error);
      setPendingWorkspaceSwitch(null);
      setWorkspaceSwitchError(null);
    } finally {
      setWorkspaceSwitchAction(null);
    }
  }, [pendingWorkspaceSwitch, saveAllDirtyFiles, workspaceSwitchAction]);

  const handleDiscardAndSwitch = useCallback(async () => {
    if (!pendingWorkspaceSwitch || workspaceSwitchAction) return;

    const pendingSwitch = pendingWorkspaceSwitch;
    setWorkspaceSwitchAction('discard');
    setWorkspaceSwitchError(null);
    discardAllDirtyFiles();

    try {
      await pendingSwitch.execute();
      pendingSwitch.resolve(true);
      setPendingWorkspaceSwitch(null);
      setWorkspaceSwitchError(null);
    } catch (error) {
      pendingSwitch.reject(error);
      setPendingWorkspaceSwitch(null);
      setWorkspaceSwitchError(null);
    } finally {
      setWorkspaceSwitchAction(null);
    }
  }, [discardAllDirtyFiles, pendingWorkspaceSwitch, workspaceSwitchAction]);

  const handleSessionChange = useCallback((key: string) => {
    void requestWorkspaceTransition(key, getWorkspaceSwitchLabel(key), async () => {
      setCurrentSession(key);
    });
  }, [getWorkspaceSwitchLabel, requestWorkspaceTransition, setCurrentSession]);

  const handleSpawnSession = useCallback((opts: SpawnSessionOpts) => {
    const targetSessionKey = opts.kind === 'root'
      ? buildAgentRootSessionKey(opts.agentName?.trim() || 'agent', sessions.map(getSessionKey))
      : opts.parentSessionKey?.trim() || getWorkspaceRootSessionKey(currentSession) || currentSession;
    const targetLabel = opts.kind === 'root'
      ? opts.agentName?.trim() || 'New agent'
      : getWorkspaceSwitchLabel(targetSessionKey);

    return requestWorkspaceTransition(targetSessionKey, targetLabel, async () => {
      await spawnSession(opts);
    });
  }, [currentSession, getWorkspaceSwitchLabel, requestWorkspaceTransition, sessions, spawnSession]);

  // Boot sequence: fade in panels when connected
  useEffect(() => {
    if (connectionState === 'connected' && !booted) {
      const timer = setTimeout(() => setBooted(true), 50);
      return () => clearTimeout(timer);
    }
  }, [connectionState, booted]);

  // Log header glow when new entries arrive
  // This effect legitimately needs to set state in response to prop changes
  // (visual feedback for new log entries)
  useEffect(() => {
    const currentCount = agentLogEntries.length;
    if (currentCount > prevLogCount.current) {
      setLogGlow(true);
      const timer = setTimeout(() => setLogGlow(false), 500);
      prevLogCount.current = currentCount;
      return () => clearTimeout(timer);
    }
    prevLogCount.current = currentCount;
  }, [agentLogEntries.length]);

  const handleCompactLayoutChange = useCallback((nextIsCompactLayout: boolean) => {
    setIsCompactLayout(nextIsCompactLayout);
    if (!nextIsCompactLayout) {
      setIsMobileTopBarHidden(false);
    }
    setFileBrowserCollapsedState(prevCollapsed => {
      if (nextIsCompactLayout) {
        persistDesktopFileBrowserCollapsed(prevCollapsed);
        return true;
      }

      return desktopFileBrowserCollapsed;
    });
  }, [desktopFileBrowserCollapsed, persistDesktopFileBrowserCollapsed]);

  // Responsive mode: switch to chat-first layout on smaller screens
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mq = window.matchMedia('(max-width: 900px)');
    const onChange = (event: MediaQueryListEvent) => {
      handleCompactLayoutChange(event.matches);
    };

    if (mq.addEventListener) {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }

    // Safari fallback
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, [handleCompactLayoutChange]);

  // Handlers for TTS provider/model changes
  const handleTtsProviderChange = useCallback((provider: TTSProvider) => {
    setTtsProvider(provider);
  }, [setTtsProvider]);

  const handleTtsModelChange = useCallback((model: string) => {
    setTtsModel(model);
  }, [setTtsModel]);

  const handleSttProviderChange = useCallback((provider: 'local' | 'openai') => {
    setSttProvider(provider);
  }, [setSttProvider]);

  const handleSttInputModeChange = useCallback((mode: STTInputMode) => {
    setSttInputMode(mode);
  }, [setSttInputMode]);

  const handleSttModelChange = useCallback((model: string) => {
    setSttModel(model);
  }, [setSttModel]);

  const visibleSaveToast = saveToast?.agentId === workspaceAgentId
    && saveToast.workspaceVersion === workspaceVersion
    ? saveToast
    : null;

  const chatContent = (
    <TabbedContentArea
      activeTab={activeTab}
      openFiles={openFiles}
      openBeads={visibleOpenBeads}
      workspaceAgentId={workspaceAgentId}
      onSelectTab={setActiveTab}
      onCloseTab={closeWorkspaceTab}
      onContentChange={updateContent}
      onSaveFile={handleSaveFile}
      saveToast={visibleSaveToast}
      onDismissToast={dismissSaveToast}
      onReloadFile={reloadFile}
      onRetryFile={reloadFile}
      onOpenWorkspacePath={openWorkspacePath}
      onOpenBeadId={openBeadId}
      pathLinkPrefixes={chatPathLinkPrefixes}
      pathLinkAliases={chatPathLinkAliases}
      chatPanel={
        <PanelErrorBoundary name="Chat">
          <ChatPanel
            ref={chatPanelRef}
            id="main-chat"
            messages={messages}
            onSend={handleSend}
            onAbort={handleAbort}
            isGenerating={isGenerating}
            stream={stream}
            processingStage={processingStage}
            lastEventTimestamp={lastEventTimestamp}
            currentToolDescription={currentToolDescription}
            activityLog={activityLog}
            onWakeWordState={handleWakeWordState}
            onReset={handleReset}
            searchOpen={searchOpen}
            onSearchClose={closeSearch}
            agentName={currentSessionDisplayName}
            loadMore={loadMore}
            hasMore={hasMore}
            onToggleFileBrowser={isCompactLayout ? handleToggleFileBrowser : fileBrowserCollapsed ? handleToggleFileBrowser : undefined}
            isFileBrowserCollapsed={fileBrowserCollapsed}
            onToggleMobileTopBar={isCompactLayout ? toggleMobileTopBar : undefined}
            isMobileTopBarHidden={isMobileTopBarHidden}
            onOpenWorkspacePath={openWorkspacePath}
            pathLinkPrefixes={chatPathLinkPrefixes}
            pathLinkAliases={chatPathLinkAliases}
            onOpenBeadId={openBeadId}
            showCommandPaletteButton={commandPaletteButtonVisible && !paletteOpen && !settingsOpen && viewMode === 'chat'}
            onOpenCommandPalette={handleOpenPalette}
          />
        </PanelErrorBoundary>
      }
    />
  );

  const renderRightPanels = (onSelect: (key: string) => Promise<void> | void) => (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center text-muted-foreground text-xs bg-background">Loading…</div>}>
      {/* Sessions + Memory stacked vertically */}
      <div className="flex-1 flex flex-col gap-3 min-h-0">
        <div className="shell-panel flex-1 flex flex-col min-h-0 overflow-hidden rounded-[28px]">
          <PanelErrorBoundary name="Sessions">
            <SessionList
              sessions={sessions}
              currentSession={currentSession}
              busyState={busyState}
              agentStatus={agentStatus}
              unreadSessions={unreadSessions}
              onSelect={onSelect}
              onRefresh={refreshSessions}
              onDelete={deleteSession}
              onSpawn={handleSpawnSession}
              onRename={renameSession}
              onAbort={abortSession}
              isLoading={sessionsLoading}
              agentName={agentName}
            />
          </PanelErrorBoundary>
        </div>
        <div className="shell-panel flex-1 flex flex-col min-h-0 overflow-hidden rounded-[28px]">
          <PanelErrorBoundary name="Workspace">
            <WorkspacePanel
              workspaceAgentId={workspaceAgentId}
              memories={memories}
              onRefreshMemories={refreshMemories}
              memoriesLoading={memoriesLoading}
              remoteWorkspace={remoteWorkspace}
              onOpenBoard={() => setViewMode('kanban')}
              onOpenTask={openTaskInBoard}
            />
          </PanelErrorBoundary>
        </div>
      </div>
    </Suspense>
  );

  const compactSessionsPanel = (
    <Suspense fallback={<div className="p-4 text-muted-foreground text-xs">Loading sessions…</div>}>
      <PanelErrorBoundary name="Sessions">
        <SessionList
          sessions={sessions}
          currentSession={currentSession}
          busyState={busyState}
          agentStatus={agentStatus}
          unreadSessions={unreadSessions}
          onSelect={handleSessionChange}
          onRefresh={refreshSessions}
          onDelete={deleteSession}
          onSpawn={handleSpawnSession}
          onRename={renameSession}
          onAbort={abortSession}
          isLoading={sessionsLoading}
          agentName={agentName}
          compact
        />
      </PanelErrorBoundary>
    </Suspense>
  );

  const compactWorkspacePanel = (
    <Suspense fallback={<div className="p-4 text-muted-foreground text-xs">Loading workspace…</div>}>
      <PanelErrorBoundary name="Workspace">
        <WorkspacePanel
          workspaceAgentId={workspaceAgentId}
          memories={memories}
          onRefreshMemories={refreshMemories}
          memoriesLoading={memoriesLoading}
          remoteWorkspace={remoteWorkspace}
          compact
          onOpenBoard={() => setViewMode('kanban')}
          onOpenTask={openTaskInBoard}
        />
      </PanelErrorBoundary>
    </Suspense>
  );

  const showCompactFileBrowser = isCompactLayout && viewMode !== 'kanban' && !fileBrowserCollapsed;

  return (
    <div className="scan-lines relative h-screen flex flex-col overflow-hidden" data-booted={booted}>
      {/* Skip to main content link for keyboard navigation */}
      <a 
        href="#main-chat" 
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:font-bold focus:text-sm"
      >
        Skip to chat
      </a>
      <ConnectDialog
        open={dialogOpen && connectionState !== 'connected' && connectionState !== 'reconnecting'}
        onConnect={handleConnect}
        error={connectError}
        defaultUrl={editableUrl}
        defaultToken={editableToken}
        officialUrl={officialUrl}
        serverSideAuth={serverSideAuth}
      />

      {/*
       * Gateway state banners.
       * Kept compact and centered so they read as transient shell notices instead of old alarm strips.
       */}
      {connectionState === 'reconnecting' && !gatewayRestarting && (
        <div className="fixed left-1/2 top-12 z-50 flex max-w-[calc(100vw-1.067rem)] -translate-x-1/2 items-start gap-2 rounded-2xl border border-destructive/25 bg-card/94 px-4 py-2 text-xs font-medium text-foreground shadow-[0_20px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl">
          <span className="inline-flex size-7 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <AlertTriangle size={14} aria-hidden="true" />
          </span>
          <span className="min-w-0 text-left leading-5">
            Signal lost. Reconnecting{reconnectAttempt > 1 ? `, attempt ${reconnectAttempt}` : ''}.
          </span>
          <span className="size-2 rounded-full bg-destructive animate-pulse" aria-hidden="true" />
        </div>
      )}

      {gatewayRestarting && (
        <div className="fixed left-1/2 top-12 z-50 flex max-w-[calc(100vw-1.067rem)] -translate-x-1/2 items-start gap-2 rounded-2xl border border-orange/25 bg-card/94 px-4 py-2 text-xs font-medium text-foreground shadow-[0_20px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl">
          <span className="inline-flex size-7 items-center justify-center rounded-xl bg-orange/10 text-orange">
            <RotateCw size={14} className="animate-spin" aria-hidden="true" />
          </span>
          <span className="min-w-0 text-left leading-5">Gateway restarting…</span>
        </div>
      )}

      {!gatewayRestarting && gatewayRestartNotice && (
        <button
          type="button"
          onClick={dismissNotice}
          className={`fixed left-1/2 top-12 z-50 flex max-w-[calc(100vw-1.067rem)] -translate-x-1/2 cursor-pointer items-start gap-2 rounded-2xl border px-4 py-2 text-xs font-medium shadow-[0_20px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-transform hover:-translate-x-1/2 hover:-translate-y-px ${
            gatewayRestartNotice.ok
              ? 'border-green/25 bg-card/94 text-foreground'
              : 'border-destructive/25 bg-card/94 text-foreground'
          }`}
        >
          <span className={`inline-flex size-7 items-center justify-center rounded-xl ${
            gatewayRestartNotice.ok ? 'bg-green/10 text-green' : 'bg-destructive/10 text-destructive'
          }`}>
            {gatewayRestartNotice.ok ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
          </span>
          <span className="min-w-0 text-left leading-5">{gatewayRestartNotice.message}</span>
        </button>
      )}
      
      {(!isCompactLayout || !isMobileTopBarHidden) && (
        <TopBar
          onSettings={openSettings}
          agentLogEntries={agentLogEntries}
          tokenData={tokenData}
          logGlow={logGlow}
          eventEntries={eventEntries}
          eventsVisible={eventsVisible}
          logVisible={logVisible}
          mobilePanelButtonsVisible={isCompactLayout}
          sessionsPanel={compactSessionsPanel}
          workspacePanel={compactWorkspacePanel}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          showKanbanView={kanbanVisible}
        />
      )}

      <PanelErrorBoundary name="Settings">
        <Suspense fallback={null}>
          <SettingsDrawer
            open={settingsOpen}
            onClose={closeSettings}
            gatewayUrl={editableUrl}
            gatewayToken={editableToken}
            onUrlChange={setEditableUrl}
            onTokenChange={setEditableToken}
            onReconnect={handleReconnect}
            connectionState={connectionState}
            soundEnabled={soundEnabled}
            onToggleSound={toggleSound}
            ttsProvider={ttsProvider}
            ttsModel={ttsModel}
            onTtsProviderChange={handleTtsProviderChange}
            onTtsModelChange={handleTtsModelChange}
            sttProvider={sttProvider}
            sttInputMode={sttInputMode}
            sttModel={sttModel}
            onSttProviderChange={handleSttProviderChange}
            onSttInputModeChange={handleSttInputModeChange}
            onSttModelChange={handleSttModelChange}
            wakeWordEnabled={wakeWordEnabled}
            onToggleWakeWord={handleToggleWakeWord}
            liveTranscriptionPreview={liveTranscriptionPreview}
            onToggleLiveTranscriptionPreview={toggleLiveTranscriptionPreview}
            agentName={agentName}
            onLogout={onLogout}
            onGatewayRestart={handleGatewayRestart}
            gatewayRestarting={gatewayRestarting}
          />
        </Suspense>
      </PanelErrorBoundary>
      
      <div className="flex-1 flex gap-3 overflow-hidden min-h-0 px-2 pt-1.5 pb-2 sm:px-4 sm:pt-2 sm:pb-2">
        {/* File tree — desktop inline, mobile drawer */}
        {!isCompactLayout && (
          <div className={viewMode === 'kanban' ? 'hidden' : fileBrowserCollapsed ? 'contents' : 'h-full min-h-0'}>
            <PanelErrorBoundary name="File Explorer">
              <FileTreePanel
                workspaceAgentId={workspaceAgentId}
                onOpenFile={openFile}
                onAddToChat={(path, kind, agentId) => chatPanelRef.current?.addWorkspacePath(path, kind, agentId ?? workspaceAgentId)}
                addToChatEnabled={addToChatEnabled}
                lastChangedEvent={lastChangedEvent}
                revealRequest={revealRequest}
                onRemapOpenPaths={remapOpenPaths}
                onCloseOpenPaths={closeOpenPathsByPrefix}
                isCompactLayout={false}
                collapsed={fileBrowserCollapsed}
                onCollapseChange={setFileBrowserCollapsed}
              />
            </PanelErrorBoundary>
          </div>
        )}

        {showCompactFileBrowser && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-30 hidden bg-black/48 backdrop-blur-sm max-[900px]:block"
              onClick={() => setFileBrowserCollapsed(true)}
              aria-label="Close file explorer"
            />
            <div className={`pointer-events-none fixed inset-0 z-40 hidden px-2 pb-[4.25rem] max-[900px]:flex ${isMobileTopBarHidden ? 'pt-2' : 'pt-[4.5rem]'}`}>
              <div className="pointer-events-auto h-full w-[min(86vw,320px)] max-w-full animate-in slide-in-from-left-4 duration-200">
                <PanelErrorBoundary name="File Explorer">
                  <FileTreePanel
                    workspaceAgentId={workspaceAgentId}
                    onOpenFile={openFile}
                    onAddToChat={(path, kind, agentId) => chatPanelRef.current?.addWorkspacePath(path, kind, agentId ?? workspaceAgentId)}
                    addToChatEnabled={addToChatEnabled}
                    lastChangedEvent={lastChangedEvent}
                    revealRequest={revealRequest}
                    onRemapOpenPaths={remapOpenPaths}
                    onCloseOpenPaths={closeOpenPathsByPrefix}
                    isCompactLayout={true}
                    collapsed={false}
                    onCollapseChange={setFileBrowserCollapsed}
                  />
                </PanelErrorBoundary>
              </div>
            </div>
          </>
        )}

        {/*
         * Chat panel is always rendered but hidden when kanban is active.
         * This keeps ChatPanel → InputBar → useVoiceInput mounted so that
         * in-progress voice recording / STT transcription survives tab switches.
         * See: https://github.com/.../issues/64
         */}
        {viewMode === 'kanban' && (
          <div className="shell-panel boot-panel flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden rounded-[28px]">
            <Suspense fallback={<div className="flex-1 flex items-center justify-center text-muted-foreground text-xs bg-background">Loading…</div>}>
              <KanbanPanel initialTaskId={pendingTaskId} onInitialTaskConsumed={() => setPendingTaskId(null)} />
            </Suspense>
          </div>
        )}
        {isCompactLayout ? (
          <div className={`shell-panel flex-1 min-w-0 min-h-0 overflow-hidden rounded-[28px] boot-panel${viewMode === 'kanban' ? ' hidden' : ''}`}>
            {chatContent}
          </div>
        ) : (
          <div style={{ display: viewMode === 'kanban' ? 'none' : 'contents' }}>
            <ResizablePanels
              leftPercent={panelRatio}
              onResize={setPanelRatio}
              minLeftPercent={30}
              maxLeftPercent={85}
              rightWidthPx={fileBrowserCollapsed ? desktopRightPanelWidth : null}
              onRightWidthChange={fileBrowserCollapsed ? undefined : setDesktopRightPanelWidth}
              leftClassName="shell-panel boot-panel rounded-[28px] overflow-hidden"
              rightClassName="boot-panel flex flex-col"
              left={chatContent}
              right={renderRightPanels(handleSessionChange)}
            />
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="boot-panel" style={{ transitionDelay: '200ms' }}>
        <StatusBar
          connectionState={connectionState}
          sessionCount={sessions.length}
          sparkline={sparkline}
          contextTokens={contextTokens}
          contextLimit={contextLimit}
        />
      </div>

      {/* Command Palette */}
      <PanelErrorBoundary name="Command Palette">
        <Suspense fallback={null}>
          <CommandPalette
            open={paletteOpen}
            onClose={closePalette}
            commands={commands}
          />
        </Suspense>
      </PanelErrorBoundary>

      {/* Reset Session Confirmation */}
      <ConfirmDialog
        open={showResetConfirm}
        title="Reset Session"
        message="This will start fresh and clear all context."
        confirmLabel="Reset"
        cancelLabel="Cancel"
        onConfirm={confirmReset}
        onCancel={cancelReset}
        variant="danger"
      />

      {/* Gateway Restart Confirmation */}
      <ConfirmDialog
        open={showGatewayRestartConfirm}
        title="Restart OpenClaw Gateway"
        message="This will briefly interrupt gateway connectivity. Continue?"
        confirmLabel="Restart"
        cancelLabel="Cancel"
        onConfirm={confirmGatewayRestart}
        onCancel={cancelGatewayRestart}
        variant="warning"
      />

      <WorkspaceSwitchDialog
        open={pendingWorkspaceSwitch !== null}
        targetLabel={pendingWorkspaceSwitch?.targetLabel || 'the other agent'}
        pendingAction={workspaceSwitchAction}
        error={workspaceSwitchError}
        onSaveAndSwitch={handleSaveAndSwitch}
        onDiscardAndSwitch={handleDiscardAndSwitch}
        onCancel={handleCancelWorkspaceSwitch}
      />

      {/* Spawn Agent Dialog (from command palette) */}
      <SpawnAgentDialog
        open={spawnDialogOpen}
        onOpenChange={setSpawnDialogOpen}
        onSpawn={handleSpawnSession}
      />
    </div>
  );
}
