/**
 * App.tsx - Main application layout component
 * 
 * This component focuses on layout and composition.
 * Connection management is handled by useConnectionManager.
 * Dashboard data fetching is handled by useDashboardData.
 */
import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { useGateway, loadConfig } from '@/contexts/GatewayContext';
import { useSessionContext } from '@/contexts/SessionContext';
import { useChat } from '@/contexts/ChatContext';
import { useSettings } from '@/contexts/SettingsContext';
import { getSessionKey } from '@/types';
import { useConnectionManager } from '@/hooks/useConnectionManager';
import { useDashboardData } from '@/hooks/useDashboardData';
import { ConnectDialog } from '@/features/connect/ConnectDialog';
import { TopBar } from '@/components/TopBar';
import { StatusBar } from '@/components/StatusBar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ChatPanel, type ChatPanelHandle } from '@/features/chat/ChatPanel';
import type { TTSProvider } from '@/features/tts/useTTS';
import type { ViewMode } from '@/features/command-palette/commands';
import { ResizablePanels } from '@/components/ResizablePanels';
import { getContextLimit, DEFAULT_GATEWAY_WS } from '@/lib/constants';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { createCommands } from '@/features/command-palette/commands';
import { PanelErrorBoundary } from '@/components/PanelErrorBoundary';
import { SpawnAgentDialog } from '@/features/sessions/SpawnAgentDialog';
import { FileTreePanel, TabbedContentArea, useOpenFiles } from '@/features/file-browser';

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

export default function App({ onLogout }: AppProps) {
  // Gateway state
  const {
    connectionState, connectError, reconnectAttempt, model, sparkline,
  } = useGateway();

  // Session state
  const {
    sessions, sessionsLoading, currentSession, setCurrentSession,
    busyState, agentStatus, unreadSessions, refreshSessions, deleteSession, abortSession, spawnAgent, renameSession,
    agentLogEntries, eventEntries,
    agentName,
  } = useSessionContext();

  // Chat state
  const {
    messages, isGenerating, stream, processingStage,
    lastEventTimestamp, activityLog, currentToolDescription,
    handleSend, handleAbort, handleReset, loadHistory,
    loadMore, hasMore,
    showResetConfirm, confirmReset, cancelReset,
  } = useChat();

  // Settings state
  const {
    soundEnabled, toggleSound,
    ttsProvider, ttsModel, setTtsProvider, setTtsModel,
    sttProvider, setSttProvider, sttModel, setSttModel,
    wakeWordEnabled, handleToggleWakeWord, handleWakeWordState,
    panelRatio, setPanelRatio,
    eventsVisible, logVisible,
    toggleEvents, toggleLog, toggleTelemetry,
    setTheme, setFont,
  } = useSettings();

  // Connection management (extracted hook)
  const {
    dialogOpen,
    editableUrl, setEditableUrl,
    editableToken, setEditableToken,
    handleConnect, handleReconnect,
  } = useConnectionManager();

  // Track last changed file path for tree refresh
  const [lastChangedPath, setLastChangedPath] = useState<string | null>(null);

  // File browser state
  const {
    openFiles, activeTab, setActiveTab,
    openFile, closeFile, updateContent, saveFile, reloadFile, initializeFiles,
    handleFileChanged, remapOpenPaths, closeOpenPathsByPrefix,
  } = useOpenFiles();

  // Save with conflict toast
  const [saveToast, setSaveToast] = useState<{ path: string; type: 'conflict' | 'error' } | null>(null);
  const handleSaveFile = useCallback(async (filePath: string) => {
    const result = await saveFile(filePath);
    if (!result.ok) {
      if (result.conflict) {
        setSaveToast({ path: filePath, type: 'conflict' });
        // Auto-dismiss after 5s
        setTimeout(() => setSaveToast(null), 5000);
      }
    } else {
      setSaveToast(null);
    }
  }, [saveFile]);

  // Single file.changed handler — feeds both open files and tree refresh
  const onFileChanged = useCallback((path: string) => {
    handleFileChanged(path);
    setLastChangedPath(path);
  }, [handleFileChanged]);

  // Dashboard data (extracted hook) — single SSE connection handles all events
  const { memories, memoriesLoading, tokenData, refreshMemories } = useDashboardData({ onFileChanged });

  // UI state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [booted, setBooted] = useState(false);
  const [logGlow, setLogGlow] = useState(false);
  const prevLogCount = useRef(0);
  const chatPanelRef = useRef<ChatPanelHandle>(null);

  // Responsive layout state (chat-first on smaller viewports)
  const [isCompactLayout, setIsCompactLayout] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 900px)').matches;
  });

  // Command palette state
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false);

  // View mode state (chat | kanban), persisted to localStorage
  const [viewMode, setViewModeRaw] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem('nerve:viewMode');
      if (saved === 'kanban') return 'kanban';
    } catch { /* ignore */ }
    return 'chat';
  });
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeRaw(mode);
    try { localStorage.setItem('nerve:viewMode', mode); } catch { /* ignore */ }
  }, []);
  const openTaskInBoard = useCallback((taskId: string) => {
    setPendingTaskId(taskId);
    setViewMode('kanban');
  }, [setViewMode]);

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
  }), [openSpawnDialog, handleReset, toggleSound, handleAbort, openSettings, openSearch,
    setTheme, setFont, setTtsProvider, handleToggleWakeWord, toggleEvents, toggleLog, toggleTelemetry,
    refreshSessions, refreshMemories, setViewMode]);

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
    if (currentSession === 'agent:main:main') return agentName;
    return currentSessionData?.label || agentName;
  }, [currentSession, currentSessionData, agentName]);

  const contextTokens = currentSessionData?.totalTokens ?? 0;
  const contextLimit = currentSessionData?.contextTokens || getContextLimit(model);

  // Restore previously open file tabs
  useEffect(() => {
    if (connectionState === 'connected') {
      initializeFiles();
    }
  }, [connectionState, initializeFiles]);

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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- valid: UI feedback for external change
      setLogGlow(true);
      const timer = setTimeout(() => setLogGlow(false), 500);
      prevLogCount.current = currentCount;
      return () => clearTimeout(timer);
    }
    prevLogCount.current = currentCount;
  }, [agentLogEntries.length]);

  // Responsive mode: switch to chat-first layout on smaller screens
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mq = window.matchMedia('(max-width: 900px)');
    const onChange = (event: MediaQueryListEvent) => {
      setIsCompactLayout(event.matches);
    };

    if (mq.addEventListener) {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }

    // Safari fallback
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  // Handler for session changes
  const handleSessionChange = useCallback(async (key: string) => {
    setCurrentSession(key);
    await loadHistory(key);
  }, [setCurrentSession, loadHistory]);

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

  const handleSttModelChange = useCallback((model: string) => {
    setSttModel(model);
  }, [setSttModel]);

  const savedConfig = useMemo(() => loadConfig(), []);
  const defaultUrl = savedConfig.url || DEFAULT_GATEWAY_WS;

  const chatContent = (
    <TabbedContentArea
      activeTab={activeTab}
      openFiles={openFiles}
      onSelectTab={setActiveTab}
      onCloseTab={closeFile}
      onContentChange={updateContent}
      onSaveFile={handleSaveFile}
      saveToast={saveToast}
      onDismissToast={() => setSaveToast(null)}
      onReloadFile={reloadFile}
      onRetryFile={reloadFile}
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
          />
        </PanelErrorBoundary>
      }
    />
  );

  const renderRightPanels = (onSelect: (key: string) => Promise<void> | void) => (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center text-muted-foreground text-xs bg-background">Loading…</div>}>
      {/* Sessions + Memory stacked vertically */}
      <div className="flex-1 flex flex-col gap-px min-h-0">
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-background">
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
              onSpawn={spawnAgent}
              onRename={renameSession}
              onAbort={abortSession}
              isLoading={sessionsLoading}
              agentName={agentName}
            />
          </PanelErrorBoundary>
        </div>
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-background">
          <PanelErrorBoundary name="Workspace">
            <WorkspacePanel memories={memories} onRefreshMemories={refreshMemories} memoriesLoading={memoriesLoading} onOpenBoard={() => setViewMode('kanban')} onOpenTask={openTaskInBoard} />
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
          onSpawn={spawnAgent}
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
        <WorkspacePanel memories={memories} onRefreshMemories={refreshMemories} memoriesLoading={memoriesLoading} compact onOpenBoard={() => setViewMode('kanban')} onOpenTask={openTaskInBoard} />
      </PanelErrorBoundary>
    </Suspense>
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden scan-lines" data-booted={booted}>
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
        defaultUrl={defaultUrl}
        defaultToken={editableToken}
      />
      
      {/* Reconnecting banner — mission control style */}
      {connectionState === 'reconnecting' && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 z-50 bg-gradient-to-r from-red-900/90 to-orange-900/90 text-red-200 px-5 py-2 rounded-sm text-[11px] font-mono flex items-center gap-2 shadow-lg border border-red-700/60 uppercase tracking-wider">
          <span className="text-red-400">⚠</span>
          <span>SIGNAL LOST</span>
          <span className="text-red-600">·</span>
          <span>RECONNECTING{reconnectAttempt > 1 ? ` (ATTEMPT ${reconnectAttempt})` : ''}</span>
          <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
        </div>
      )}
      
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
      />
      
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
            sttModel={sttModel}
            onSttProviderChange={handleSttProviderChange}
            onSttModelChange={handleSttModelChange}
            wakeWordEnabled={wakeWordEnabled}
            onToggleWakeWord={handleToggleWakeWord}
            agentName={agentName}
            onLogout={onLogout}
          />
        </Suspense>
      </PanelErrorBoundary>
      
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* File tree — far left, collapsible (chat mode only) */}
        {viewMode === 'chat' && (
          <PanelErrorBoundary name="File Explorer">
            <FileTreePanel
              onOpenFile={openFile}
              lastChangedPath={lastChangedPath}
              onRemapOpenPaths={remapOpenPaths}
              onCloseOpenPaths={closeOpenPathsByPrefix}
            />
          </PanelErrorBoundary>
        )}

        {/* Main area: kanban or chat */}
        {viewMode === 'kanban' ? (
          <div className="flex-1 flex flex-col min-w-0 min-h-0 boot-panel">
            <Suspense fallback={<div className="flex-1 flex items-center justify-center text-muted-foreground text-xs bg-background">Loading…</div>}>
              <KanbanPanel initialTaskId={pendingTaskId} onInitialTaskConsumed={() => setPendingTaskId(null)} />
            </Suspense>
          </div>
        ) : isCompactLayout ? (
          <div className="flex-1 min-w-0 min-h-0 boot-panel">
            {chatContent}
          </div>
        ) : (
          <ResizablePanels
            leftPercent={panelRatio}
            onResize={setPanelRatio}
            minLeftPercent={30}
            maxLeftPercent={75}
            leftClassName="boot-panel"
            rightClassName="boot-panel flex flex-col gap-px bg-border"
            left={chatContent}
            right={renderRightPanels(handleSessionChange)}
          />
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

      {/* Spawn Agent Dialog (from command palette) */}
      <SpawnAgentDialog
        open={spawnDialogOpen}
        onOpenChange={setSpawnDialogOpen}
        onSpawn={spawnAgent}
      />
    </div>
  );
}
