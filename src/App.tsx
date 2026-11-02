/**
 * App.tsx - Main application layout component
 * 
 * This component focuses on layout and composition.
 * Connection management is handled by useConnectionManager.
 * Dashboard data fetching is handled by useDashboardData.
 */
import { flushSync } from 'react-dom';
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
import { Pane } from '@/components/ui/Pane';
import { getContextLimit } from '@/lib/constants';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useLiveFavicon } from '@/hooks/useLiveFavicon';
import { fleetActivity, fleetCounts, sessionPaneState } from '@/lib/paneState';
import { shadeFor, useAgentHues } from '@/lib/agentColors';
import { getRootAgentId, isSubagentSessionKey } from '@/features/sessions/sessionKeys';
import { createCommands, createSessionCommands } from '@/features/command-palette/commands';
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
    connectionState, connectError, reconnectAttempt, model,
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
    loadMore, hasMore, historyLoaded,
    showResetConfirm, confirmReset, cancelReset,
  } = useChat();

  // The whole fleet in one pane: drives the brand pane in the top bar and the tab icon.
  const shellActivity = useMemo(
    () => fleetActivity({ sessions, busyState, unreadSessions, agentStatus, generating: isGenerating }),
    [sessions, busyState, unreadSessions, agentStatus, isGenerating],
  );
  const shellFleet = useMemo(
    () => fleetCounts({ sessions, busyState, unreadSessions, agentStatus, generating: isGenerating }),
    [sessions, busyState, unreadSessions, agentStatus, isGenerating],
  );
  useLiveFavicon(shellActivity);

  // Identity hue of the open session's agent family, for the chat header and transcript panes.
  const currentRootAgentId = useMemo(() => getRootAgentId(currentSession), [currentSession]);
  const currentRootIds = useMemo(() => (currentRootAgentId ? [currentRootAgentId] : []), [currentRootAgentId]);
  const { hueFor } = useAgentHues(currentRootIds);
  const currentAgentHue = currentRootAgentId
    ? shadeFor(hueFor(currentRootAgentId), isSubagentSessionKey(currentSession) ? 1 : 0)
    : undefined;

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
    performanceMode,
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
  // Any room of the workspace's agent family at work lights the file it touches, not only the open chat.
  const workspaceAgentRunning = useMemo(
    () => isGenerating || sessions.some((session) => (
      getRootAgentId(getSessionKey(session)) === workspaceAgentId
      && sessionPaneState(session, { busyState, agentStatus }) === 'live'
    )),
    [isGenerating, sessions, workspaceAgentId, busyState, agentStatus],
  );

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
    // The view switch is a view transition (the lifted chip slides across its track, the room
    // cross-fades) where the browser supports it and the operator has not asked for reduced motion
    const doc = document as Document & { startViewTransition?: (update: () => void) => unknown };
    const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof doc.startViewTransition === 'function' && !reduceMotion) {
      doc.startViewTransition(() => { flushSync(() => setViewModeRaw(nextMode)); });
    } else {
      setViewModeRaw(nextMode);
    }

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

  const staticCommands = useMemo(() => createCommands({
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

  const sessionCommands = useMemo(
    () => createSessionCommands(sessions, currentSession, agentName, handleSessionChange),
    [sessions, currentSession, agentName, handleSessionChange],
  );

  const commands = useMemo(
    () => [...staticCommands, ...sessionCommands],
    [staticCommands, sessionCommands],
  );

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
            agentHue={currentAgentHue}
            loadMore={loadMore}
            hasMore={hasMore}
            historyLoaded={historyLoaded}
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
    <Suspense fallback={<div className="flex-1 flex items-center justify-center bg-card text-[0.8rem] text-muted-foreground">Loading…</div>}>
      {/* Sessions + Memory stacked vertically, split by a 1px rule */}
      <div className="nerve-right-stack flex-1 flex flex-col min-h-0 bg-background">
        <div className="nerve-right-pane flex-1 flex flex-col min-h-0 overflow-hidden border-b border-border">
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
        <div className="nerve-right-pane flex-1 flex flex-col min-h-0 overflow-hidden">
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
    <Suspense fallback={<div className="p-3 text-[0.8rem] text-muted-foreground">Loading sessions…</div>}>
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
    <Suspense fallback={<div className="p-3 text-[0.8rem] text-muted-foreground">Loading workspace…</div>}>
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
    <div className="nerve-shell relative h-screen flex flex-col overflow-hidden bg-background" data-booted={booted}>
      {/* Skip to main content link for keyboard navigation */}
      <a 
        href="#main-chat" 
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:rounded-[3px] focus:border focus:border-border focus:bg-popover focus:px-3 focus:py-1.5 focus:text-[0.867rem] focus:font-semibold focus:text-foreground"
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
       * Small flat notices under the top bar; the pane carries the state, the text names it.
       */}
      {connectionState === 'reconnecting' && !gatewayRestarting && (
        <div className="fixed left-1/2 top-14 z-50 flex max-w-[calc(100vw-1.067rem)] -translate-x-1/2 items-center gap-2 rounded-[3px] border border-border bg-popover px-3 py-1.5 text-[0.867rem] text-foreground shadow-[0_12px_32px_rgba(0,0,0,0.32)]">
          <Pane state="error" />
          <span className="min-w-0 text-left leading-5">
            Signal lost. Reconnecting{reconnectAttempt > 1 ? `, attempt ${reconnectAttempt}` : ''}.
          </span>
        </div>
      )}

      {gatewayRestarting && (
        <div className="fixed left-1/2 top-14 z-50 flex max-w-[calc(100vw-1.067rem)] -translate-x-1/2 items-center gap-2 rounded-[3px] border border-border bg-popover px-3 py-1.5 text-[0.867rem] text-foreground shadow-[0_12px_32px_rgba(0,0,0,0.32)]">
          <Pane state="live" />
          <span className="min-w-0 text-left leading-5">Gateway restarting…</span>
        </div>
      )}

      {!gatewayRestarting && gatewayRestartNotice && (
        <button
          type="button"
          onClick={dismissNotice}
          className="fixed left-1/2 top-14 z-50 flex max-w-[calc(100vw-1.067rem)] -translate-x-1/2 cursor-pointer items-center gap-2 rounded-[3px] border border-border bg-popover px-3 py-1.5 text-[0.867rem] text-foreground shadow-[0_12px_32px_rgba(0,0,0,0.32)] transition-colors duration-[120ms] hover:bg-raised"
        >
          <Pane state={gatewayRestartNotice.ok ? 'off' : 'error'} />
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
          performanceMode={performanceMode}
          activity={shellActivity}
          fleet={shellFleet}
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
      
      <div className="nerve-shell-main flex-1 flex overflow-hidden min-h-0">
        {/* File tree: desktop inline, mobile drawer */}
        {!isCompactLayout && (
          <div className={`nerve-col-left ${viewMode === 'kanban' ? 'hidden' : fileBrowserCollapsed ? 'contents' : 'h-full min-h-0 bg-background'}`}>
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
                agentRunning={workspaceAgentRunning}
              />
            </PanelErrorBoundary>
          </div>
        )}

        {showCompactFileBrowser && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-30 hidden bg-black/48 max-[900px]:block"
              onClick={() => setFileBrowserCollapsed(true)}
              aria-label="Close file explorer"
            />
            <div className={`nerve-mobile-drawer pointer-events-none fixed inset-0 z-40 hidden pb-[var(--row-unit)] max-[900px]:flex ${isMobileTopBarHidden ? 'pt-0' : 'pt-[2.933rem] max-[639px]:pt-[89px] max-[371px]:pt-[81px]'}`}>
              <div className="pointer-events-auto h-full w-[min(86vw,320px)] max-w-full border-r border-border bg-card shadow-[0_12px_32px_rgba(0,0,0,0.32)] animate-in slide-in-from-left-4 duration-200">
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
                agentRunning={workspaceAgentRunning}
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
          <div className="nerve-col-center boot-panel flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-background">
            <Suspense fallback={<div className="flex-1 flex items-center justify-center bg-background text-[0.8rem] text-muted-foreground">Loading…</div>}>
              <KanbanPanel initialTaskId={pendingTaskId} onInitialTaskConsumed={() => setPendingTaskId(null)} />
            </Suspense>
          </div>
        )}
        {isCompactLayout ? (
          <div className={`nerve-col-center flex-1 min-w-0 min-h-0 overflow-hidden bg-background boot-panel${viewMode === 'kanban' ? ' hidden' : ''}`}>
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
              leftClassName="nerve-col-center boot-panel overflow-hidden bg-background"
              rightClassName="nerve-col-right boot-panel flex flex-col bg-background"
              left={chatContent}
              right={renderRightPanels(handleSessionChange)}
            />
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="nerve-statusbar-slot boot-panel" style={{ transitionDelay: '200ms' }}>
        <StatusBar
          connectionState={connectionState}
          sessionCount={sessions.length}
          sessions={sessions}
          busyState={busyState}
          unreadSessions={unreadSessions}
          agentStatus={agentStatus}
          generating={isGenerating}
          contextTokens={contextTokens}
          contextLimit={contextLimit}
          performanceMode={performanceMode}
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
        title="Reset session"
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
        title="Restart OpenClaw gateway"
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
