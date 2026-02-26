import { useState, useCallback, useRef, useEffect, useMemo, lazy, Suspense, type ReactNode } from 'react';
import { Activity, BarChart3, Settings, Radio, Users, Brain } from 'lucide-react';
import type { AgentLogEntry, EventEntry, TokenData } from '@/types';
import NerveLogo from './NerveLogo';

const AgentLog = lazy(() => import('@/features/activity/AgentLog').then(m => ({ default: m.AgentLog })));
const EventLog = lazy(() => import('@/features/activity/EventLog').then(m => ({ default: m.EventLog })));
const TokenUsage = lazy(() => import('@/features/dashboard/TokenUsage').then(m => ({ default: m.TokenUsage })));

/** Identifies which dropdown panel is currently open, or `null` for none. */
type PanelId = 'agent-log' | 'usage' | 'events' | 'sessions' | 'workspace' | null;

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
}: TopBarProps) {
  const [activePanel, setActivePanel] = useState<PanelId>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<HTMLDivElement>(null);

  const togglePanel = useCallback((panel: PanelId) => {
    setActivePanel(prev => prev === panel ? null : panel);
  }, []);

  // Close active panel if its visibility source is turned off / unavailable
  useEffect(() => {
    if (activePanel === 'events' && !eventsVisible) {
      setActivePanel(null);
      return;
    }
    if (activePanel === 'agent-log' && !logVisible) {
      setActivePanel(null);
      return;
    }
    if ((activePanel === 'sessions' || activePanel === 'workspace') && !mobilePanelButtonsVisible) {
      setActivePanel(null);
      return;
    }
    if (activePanel === 'sessions' && !sessionsPanel) {
      setActivePanel(null);
      return;
    }
    if (activePanel === 'workspace' && !workspacePanel) {
      setActivePanel(null);
    }
  }, [activePanel, eventsVisible, logVisible, mobilePanelButtonsVisible, sessionsPanel, workspacePanel]);

  // Click outside to close
  useEffect(() => {
    if (!activePanel) return;
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
  }, [activePanel]);

  // Escape to close
  useEffect(() => {
    if (!activePanel) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setActivePanel(null);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [activePanel]);

  const totalCost = useMemo(() => {
    if (!tokenData) return null;
    const cost = tokenData.persistent?.totalCost ?? tokenData.totalCost ?? 0;
    return '$' + cost.toFixed(2);
  }, [tokenData]);

  const panelBoxClass = useMemo(() => {
    switch (activePanel) {
      case 'sessions':
        return 'w-[420px] max-w-[calc(100vw-1rem)]';
      case 'workspace':
        return 'w-[560px] max-w-[calc(100vw-1rem)]';
      default:
        return 'w-[480px] max-w-[calc(100vw-1rem)]';
    }
  }, [activePanel]);

  const panelHeightClass = useMemo(() => {
    if (!activePanel) return 'max-h-0 opacity-0 pointer-events-none';
    switch (activePanel) {
      case 'sessions':
        return 'max-h-[70vh] opacity-100';
      case 'workspace':
        return 'max-h-[75vh] opacity-100';
      default:
        return 'max-h-[400px] opacity-100';
    }
  }, [activePanel]);

  const panelContentClass = useMemo(() => {
    switch (activePanel) {
      case 'sessions':
        return 'max-h-[65vh] overflow-y-auto';
      case 'workspace':
        return 'h-[70vh] max-h-[70vh] overflow-hidden';
      default:
        return 'max-h-[400px] overflow-y-auto';
    }
  }, [activePanel]);

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
        </div>
        <div ref={buttonsRef} className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {/* Compact layout launchers (chat-first mode) */}
          {mobilePanelButtonsVisible && sessionsPanel && (
            <button
              onClick={() => togglePanel('sessions')}
              title="Sessions"
              aria-label="Toggle sessions panel"
              aria-expanded={activePanel === 'sessions'}
              aria-haspopup="true"
              aria-controls="topbar-panel"
              className={`${buttonBase} ${activePanel === 'sessions' ? buttonActive : ''}`}
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
              aria-expanded={activePanel === 'workspace'}
              aria-haspopup="true"
              aria-controls="topbar-panel"
              className={`${buttonBase} ${activePanel === 'workspace' ? buttonActive : ''}`}
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
              aria-expanded={activePanel === 'agent-log'}
              aria-haspopup="true"
              aria-controls="topbar-panel"
              className={`${buttonBase} ${activePanel === 'agent-log' ? buttonActive : ''}`}
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
              aria-expanded={activePanel === 'events'}
              aria-haspopup="true"
              aria-controls="topbar-panel"
              className={`${buttonBase} ${activePanel === 'events' ? buttonActive : ''}`}
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
            aria-expanded={activePanel === 'usage'}
            aria-haspopup="true"
            aria-controls="topbar-panel"
            className={`${buttonBase} ${activePanel === 'usage' ? buttonActive : ''}`}
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
        aria-label={activePanel ? `${activePanel} panel` : undefined}
        hidden={!activePanel}
        className={`absolute right-2 bg-card border border-border rounded-b-lg shadow-lg overflow-hidden transition-all duration-200 ease-out ${panelBoxClass} ${panelHeightClass}`}
        style={{ top: '100%' }}
      >
        <div className={panelContentClass}>
          <Suspense fallback={<div className="p-4 text-muted-foreground text-xs">Loading…</div>}>
            {activePanel === 'agent-log' && <AgentLog entries={agentLogEntries} glow={logGlow} />}
            {activePanel === 'events' && <EventLog entries={eventEntries} />}
            {activePanel === 'usage' && <TokenUsage data={tokenData} />}
            {activePanel === 'sessions' && sessionsPanel}
            {activePanel === 'workspace' && workspacePanel}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
