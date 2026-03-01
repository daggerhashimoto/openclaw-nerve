import { useState, useCallback, useRef, useEffect, useMemo, lazy, Suspense, type ReactNode } from 'react';
import { Activity, BarChart3, Settings, Radio, Users, Brain, MessageSquare, LayoutGrid } from 'lucide-react';
import type { ViewMode } from '@/features/command-palette/commands';
import type { AgentLogEntry, EventEntry, TokenData } from '@/types';
import NerveLogo from './NerveLogo';

const AgentLog = lazy(() => import('@/features/activity/AgentLog').then(m => ({ default: m.AgentLog })));
const EventLog = lazy(() => import('@/features/activity/EventLog').then(m => ({ default: m.EventLog })));
const TokenUsage = lazy(() => import('@/features/dashboard/TokenUsage').then(m => ({ default: m.TokenUsage })));

/** Identifies which dropdown panel is currently open, or `null` for none. */
type PanelId = 'agent-log' | 'usage' | 'events' | 'sessions' | 'workspace' | null;

type PanelConfig = {
  boxClass: string;
  heightClass: string;
  contentClass: string;
};

const PANEL_CONFIG: Record<Exclude<PanelId, null> | 'default', PanelConfig> = {
  sessions: {
    boxClass: 'w-[420px] max-w-[calc(100vw-1rem)]',
    heightClass: 'max-h-[70vh] opacity-100',
    contentClass: 'max-h-[65vh] overflow-y-auto',
  },
  workspace: {
    boxClass: 'w-[560px] max-w-[calc(100vw-1rem)]',
    heightClass: 'max-h-[75vh] opacity-100',
    contentClass: 'h-[70vh] max-h-[70vh] overflow-hidden',
  },
  'agent-log': {
    boxClass: 'w-[480px] max-w-[calc(100vw-1rem)]',
    heightClass: 'max-h-[400px] opacity-100',
    contentClass: 'max-h-[400px] overflow-y-auto',
  },
  usage: {
    boxClass: 'w-[480px] max-w-[calc(100vw-1rem)]',
    heightClass: 'max-h-[400px] opacity-100',
    contentClass: 'max-h-[400px] overflow-y-auto',
  },
  events: {
    boxClass: 'w-[480px] max-w-[calc(100vw-1rem)]',
    heightClass: 'max-h-[400px] opacity-100',
    contentClass: 'max-h-[400px] overflow-y-auto',
  },
  default: {
    boxClass: 'w-[480px] max-w-[calc(100vw-1rem)]',
    heightClass: 'max-h-[400px] opacity-100',
    contentClass: 'max-h-[400px] overflow-y-auto',
  },
};

/** Props for {@link TopBar}. */
interface TopBarProps {
  /** Callback to open the settings modal. */
  onSettings: () => void;
  /** Agent log entries rendered in the dropdown log panel. */
  agentLogEntries: AgentLogEntry[];
  /** Token usage data for the usage panel (null while loading). */
  tokenData: TokenData | null;
  /** Whether the agent-log icon should pulse green to indicate recent activity. */
  logGlow: boolean;
  /** Event log entries for the events panel. */
  eventEntries: EventEntry[];
  /** Whether the Events button/panel should be shown (feature flag). */
  eventsVisible: boolean;
  /** Whether the Log button/panel should be shown (feature flag). */
  logVisible: boolean;
  /** Show compact-layout panel launchers (Sessions/Workspace). */
  mobilePanelButtonsVisible?: boolean;
  /** Renderable Sessions panel content (compact mode). */
  sessionsPanel?: ReactNode;
  /** Renderable Workspace panel content (compact mode). */
  workspacePanel?: ReactNode;
  /** Current view mode (chat or kanban). */
  viewMode?: ViewMode;
  /** Callback to change the view mode. */
  onViewModeChange?: (mode: ViewMode) => void;
}

/**
 * Top navigation bar for the Nerve cockpit.
 *
 * Displays the Nerve logo/brand, and provides toggle buttons for the
 * Agent Log, Events, Token Usage, and (in compact mode) Sessions +
 * Workspace panels.
 */
export function TopBar({
  onSettings,
  agentLogEntries,
  tokenData,
  logGlow,
  eventEntries,
  eventsVisible,
  logVisible,
  mobilePanelButtonsVisible = false,
  sessionsPanel,
  workspacePanel,
  viewMode = 'chat',
  onViewModeChange,
}: TopBarProps) {
  const [activePanel, setActivePanel] = useState<PanelId>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<HTMLDivElement>(null);

  const togglePanel = useCallback((panel: PanelId) => {
    setActivePanel(prev => prev === panel ? null : panel);
  }, []);

  const isPanelAvailable = useCallback((panel: PanelId) => {
    if (!panel) return true;
    if (panel === 'events') return eventsVisible;
    if (panel === 'agent-log') return logVisible;
    if (panel === 'sessions') return mobilePanelButtonsVisible && Boolean(sessionsPanel);
    if (panel === 'workspace') return mobilePanelButtonsVisible && Boolean(workspacePanel);
    return true;
  }, [eventsVisible, logVisible, mobilePanelButtonsVisible, sessionsPanel, workspacePanel]);

  const visiblePanel = useMemo<PanelId>(() => {
    if (!activePanel) return null;
    return isPanelAvailable(activePanel) ? activePanel : null;
  }, [activePanel, isPanelAvailable]);

  // Clear stale panel state asynchronously when panel availability changes.
  useEffect(() => {
    if (!activePanel || visiblePanel) return;
    const timer = window.setTimeout(() => setActivePanel(null), 0);
    return () => window.clearTimeout(timer);
  }, [activePanel, visiblePanel]);

  // Click outside to close
  useEffect(() => {
    if (!visiblePanel) return;
    function handleClick(e: MouseEvent) {
      const targetNode = e.target as Node;
      if (panelRef.current?.contains(targetNode) || buttonsRef.current?.contains(targetNode)) return;

      const targetElement = e.target instanceof Element ? e.target : null;
      // Keep topbar panel open while interacting with modal/portal content
      // launched from inside the panel (e.g., Spawn Agent, Add Memory dialogs).
      if (targetElement?.closest('[data-slot="dialog-content"], [data-slot="dialog-overlay"], [role="dialog"], [data-radix-popper-content-wrapper]')) {
        return;
      }

      setActivePanel(null);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [visiblePanel]);

  // Escape to close
  useEffect(() => {
    if (!visiblePanel) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setActivePanel(null);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [visiblePanel]);

  const totalCost = useMemo(() => {
    if (!tokenData) return null;
    const cost = tokenData.persistent?.totalCost ?? tokenData.totalCost ?? 0;
    return '$' + cost.toFixed(2);
  }, [tokenData]);

  const panelConfig = useMemo(() => {
    if (!visiblePanel) return PANEL_CONFIG.default;
    return PANEL_CONFIG[visiblePanel] ?? PANEL_CONFIG.default;
  }, [visiblePanel]);

  const panelBoxClass = panelConfig.boxClass;
  const panelHeightClass = visiblePanel ? panelConfig.heightClass : 'max-h-0 opacity-0 pointer-events-none';
  const panelContentClass = panelConfig.contentClass;

  const buttonBase = 'bg-transparent border border-border/60 text-muted-foreground text-sm h-7 px-1.5 sm:px-2 cursor-pointer flex items-center justify-center gap-1 sm:gap-1.5 hover:text-foreground hover:border-muted-foreground transition-colors';
  const buttonActive = 'text-primary border-primary/60 hover:text-primary';

  return (
    <div className="relative z-40">
      <header className="flex items-center justify-between px-2 sm:px-4 h-[42px] bg-card border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <NerveLogo size={24} />
          <span className="hidden sm:inline text-sm sm:text-base font-bold text-primary tracking-[2px] sm:tracking-[4px] [text-shadow:0_0_12px_rgba(232,168,56,0.5),0_0_24px_rgba(232,168,56,0.2)] uppercase truncate">
            NERVE
          </span>

          {/* View mode toggle */}
          {onViewModeChange && (
            <div className="flex items-center ml-3 border border-border/60 rounded-sm overflow-hidden">
              <button
                onClick={() => onViewModeChange('chat')}
                title="Chat View"
                aria-label="Switch to chat view"
                aria-pressed={viewMode === 'chat'}
                className={`flex items-center gap-1 px-2 h-6 text-[10px] transition-colors cursor-pointer ${
                  viewMode === 'chat'
                    ? 'bg-primary/15 text-primary border-r border-border/60'
                    : 'text-muted-foreground hover:text-foreground border-r border-border/60'
                }`}
              >
                <MessageSquare size={12} aria-hidden="true" />
                <span className="hidden sm:inline">Chat</span>
              </button>
              <button
                onClick={() => onViewModeChange('kanban')}
                title="Tasks View"
                aria-label="Switch to tasks view"
                aria-pressed={viewMode === 'kanban'}
                className={`flex items-center gap-1 px-2 h-6 text-[10px] transition-colors cursor-pointer ${
                  viewMode === 'kanban'
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <LayoutGrid size={12} aria-hidden="true" />
                <span className="hidden sm:inline">Tasks</span>
              </button>
            </div>
          )}
        </div>
        <div ref={buttonsRef} className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {/* Compact layout launchers (chat-first mode) */}
          {mobilePanelButtonsVisible && sessionsPanel && (
            <button
              onClick={() => togglePanel('sessions')}
              title="Sessions"
              aria-label="Toggle sessions panel"
              aria-expanded={visiblePanel === 'sessions'}
              aria-haspopup="true"
              aria-controls="topbar-panel"
              className={`${buttonBase} ${visiblePanel === 'sessions' ? buttonActive : ''}`}
            >
              <Users size={14} aria-hidden="true" />
              <span className="text-[10px] hidden sm:inline">Sessions</span>
            </button>
          )}

          {mobilePanelButtonsVisible && workspacePanel && (
            <button
              onClick={() => togglePanel('workspace')}
              title="Workspace"
              aria-label="Toggle workspace panel"
              aria-expanded={visiblePanel === 'workspace'}
              aria-haspopup="true"
              aria-controls="topbar-panel"
              className={`${buttonBase} ${visiblePanel === 'workspace' ? buttonActive : ''}`}
            >
              <Brain size={14} aria-hidden="true" />
              <span className="text-[10px] hidden sm:inline">Workspace</span>
            </button>
          )}

          {/* Agent Log button */}
          {logVisible && (
            <button
              onClick={() => togglePanel('agent-log')}
              title="Agent Log"
              aria-label="Toggle agent log panel"
              aria-expanded={visiblePanel === 'agent-log'}
              aria-haspopup="true"
              aria-controls="topbar-panel"
              className={`${buttonBase} ${visiblePanel === 'agent-log' ? buttonActive : ''}`}
            >
              <Activity size={14} className={logGlow ? 'text-green' : ''} aria-hidden="true" />
              <span className="text-[10px] hidden sm:inline">Log</span>
              {agentLogEntries.length > 0 && (
                <span className="text-[9px] bg-muted px-1 rounded-sm tabular-nums hidden md:inline-flex">{agentLogEntries.length}</span>
              )}
            </button>
          )}

          {/* Events button */}
          {eventsVisible && (
            <button
              onClick={() => togglePanel('events')}
              title="Events"
              aria-label="Toggle events panel"
              aria-expanded={visiblePanel === 'events'}
              aria-haspopup="true"
              aria-controls="topbar-panel"
              className={`${buttonBase} ${visiblePanel === 'events' ? buttonActive : ''}`}
            >
              <Radio size={14} aria-hidden="true" />
              <span className="text-[10px] hidden sm:inline">Events</span>
              {eventEntries.length > 0 && (
                <span className="text-[9px] bg-muted px-1 rounded-sm tabular-nums hidden md:inline-flex">{eventEntries.length}</span>
              )}
            </button>
          )}

          {/* Usage button */}
          <button
            onClick={() => togglePanel('usage')}
            title="Token Usage"
            aria-label="Toggle usage panel"
            aria-expanded={visiblePanel === 'usage'}
            aria-haspopup="true"
            aria-controls="topbar-panel"
            className={`${buttonBase} ${visiblePanel === 'usage' ? buttonActive : ''}`}
          >
            <BarChart3 size={14} aria-hidden="true" />
            <span className="text-[10px] hidden sm:inline">Usage</span>
            {totalCost && (
              <span className="text-[9px] bg-muted px-1 rounded-sm tabular-nums hidden lg:inline-flex">{totalCost}</span>
            )}
          </button>

          {/* Settings button */}
          <button
            onClick={onSettings}
            title="Settings"
            aria-label="Open settings"
            className={`${buttonBase} w-7`}
          >
            <Settings size={14} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Expandable dropdown panel */}
      <div
        ref={panelRef}
        id="topbar-panel"
        role="region"
        aria-label={visiblePanel ? `${visiblePanel} panel` : undefined}
        hidden={!visiblePanel}
        className={`absolute right-2 bg-card border border-border rounded-b-lg shadow-lg overflow-hidden transition-all duration-200 ease-out ${panelBoxClass} ${panelHeightClass}`}
        style={{ top: '100%' }}
      >
        <div className={panelContentClass}>
          <Suspense fallback={<div className="p-4 text-muted-foreground text-xs">Loading…</div>}>
            {visiblePanel === 'agent-log' && <AgentLog entries={agentLogEntries} glow={logGlow} />}
            {visiblePanel === 'events' && <EventLog entries={eventEntries} />}
            {visiblePanel === 'usage' && <TokenUsage data={tokenData} />}
            {visiblePanel === 'sessions' && sessionsPanel}
            {visiblePanel === 'workspace' && workspacePanel}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
