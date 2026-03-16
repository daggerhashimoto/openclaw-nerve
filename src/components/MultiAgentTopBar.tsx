/**
 * Multi-Agent TopBar Component
 *
 * Extended TopBar that supports multiple agents with agent selection.
 */

import { useState, useCallback, useRef, useEffect, useMemo, lazy, Suspense, type ReactNode } from 'react';
import { Activity, BarChart3, Settings, Radio, Users, Brain, MessageSquare, LayoutGrid, ChevronDown } from 'lucide-react';
import type { ViewMode } from '@/features/command-palette/commands';
import type { AgentLogEntry, EventEntry, TokenData } from '@/types';
import { useAgentRegistry } from '@/contexts/AgentRegistryContext';
import NerveLogo from './NerveLogo';

const AgentLog = lazy(() => import('@/features/activity/AgentLog').then(m => ({ default: m.AgentLog })));
const EventLog = lazy(() => import('@/features/activity/EventLog').then(m => ({ default: m.EventLog })));
const TokenUsage = lazy(() => import('@/features/dashboard/TokenUsage').then(m => ({ default: m.TokenUsage })));
const AgentStatusDashboard = lazy(() => import('@/features/agent-dashboard/AgentStatusDashboard').then(m => ({ default: m.AgentStatusDashboard })));

type PanelId = 'agent-log' | 'usage' | 'events' | 'sessions' | 'workspace' | 'agents' | null;

interface MultiAgentTopBarProps {
  onSettings: () => void;
  agentLogEntries: AgentLogEntry[];
  tokenData: TokenData | null;
  logGlow: boolean;
  eventEntries: EventEntry[];
  eventsVisible: boolean;
  logVisible: boolean;
  mobilePanelButtonsVisible?: boolean;
  sessionsPanel?: ReactNode;
  workspacePanel?: ReactNode;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  currentAgent?: string;
  onAgentChange?: (agentName: string) => void;
}

export function MultiAgentTopBar({
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
  currentAgent,
  onAgentChange,
}: MultiAgentTopBarProps) {
  const { agents, loading: agentsLoading } = useAgentRegistry();
  const [activePanel, setActivePanel] = useState<PanelId>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<HTMLDivElement>(null);
  const [agentSelectorOpen, setAgentSelectorOpen] = useState(false);

  const togglePanel = useCallback((panel: PanelId) => {
    setActivePanel(prev => prev === panel ? null : panel);
  }, []);

  const visibleAgents = useMemo(() => {
    return agents.filter(a => a.enabled).slice(0, 5); // Show first 5 for quick access
  }, [agents]);

  const currentAgentData = useMemo(() => {
    return agents.find(a => a.name === currentAgent) || agents[0];
  }, [agents, currentAgent]);

  // Click outside to close agent selector
  useEffect(() => {
    if (!agentSelectorOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (buttonsRef.current?.contains(target)) return;
      setAgentSelectorOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [agentSelectorOpen]);

  const totalCost = useMemo(() => {
    if (!tokenData) return null;
    const cost = tokenData.persistent?.totalCost ?? tokenData.totalCost ?? 0;
    return '$' + cost.toFixed(2);
  }, [tokenData]);

  const buttonBase = 'bg-transparent border border-border/60 text-muted-foreground text-sm h-7 px-1.5 sm:px-2 cursor-pointer flex items-center justify-center gap-1 sm:gap-1.5 hover:text-foreground hover:border-muted-foreground transition-colors';
  const buttonActive = 'text-primary border-primary/60 hover:text-primary';

  return (
    <div className="relative z-40">
      <header className="flex items-center justify-between px-2 sm:px-4 h-[42px] bg-card border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <NerveLogo size={24} />
          <span className="hidden sm:inline text-sm sm:text-base font-bold text-primary tracking-[2px] sm:tracking-[4px] [text-shadow:0_0_12px_rgba(232,168,56,0.5),0_0_24px_rgba(232,168,56,0.2)] uppercase">
            NERVE
          </span>

          {/* Agent Selector */}
          <div className="relative ml-2">
            <button
              onClick={() => setAgentSelectorOpen(!agentSelectorOpen)}
              className="flex items-center gap-2 px-3 py-1.5 bg-secondary/50 hover:bg-secondary border border-border rounded-md text-sm transition-colors"
              disabled={agentsLoading}
            >
              <Brain className="w-4 h-4 text-primary" />
              <span className="hidden sm:inline font-medium">
                {agentsLoading ? 'Loading...' : currentAgentData?.name || 'Select Agent'}
              </span>
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            </button>

            {agentSelectorOpen && (
              <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-md shadow-lg z-50 min-w-[200px] max-h-[400px] overflow-y-auto">
                <div className="p-2 space-y-1">
                  {visibleAgents.map(agent => (
                    <button
                      key={agent.name}
                      onClick={() => {
                        onAgentChange?.(agent.name);
                        setAgentSelectorOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between ${
                        agent.name === currentAgent
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-secondary'
                      }`}
                    >
                      <div>
                        <div className="font-medium">{agent.name}</div>
                        <div className="text-xs text-muted-foreground">{agent.role}</div>
                      </div>
                      <div className={`w-2 h-2 rounded-full ${
                        agent.connectionStatus === 'connected' ? 'bg-green-500' : 'bg-gray-500'
                      }`} />
                    </button>
                  ))}
                  {agents.length > 5 && (
                    <button
                      onClick={() => {
                        togglePanel('agents');
                        setAgentSelectorOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 text-xs text-primary hover:bg-secondary/50 rounded-md"
                    >
                      View all {agents.length} agents...
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

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
          {/* Compact layout launchers */}
          {mobilePanelButtonsVisible && sessionsPanel && (
            <button
              onClick={() => togglePanel('sessions')}
              title="Sessions"
              className={`${buttonBase} ${activePanel === 'sessions' ? buttonActive : ''}`}
            >
              <Users size={14} />
              <span className="text-[10px] hidden sm:inline">Sessions</span>
            </button>
          )}

          {mobilePanelButtonsVisible && workspacePanel && (
            <button
              onClick={() => togglePanel('workspace')}
              title="Workspace"
              className={`${buttonBase} ${activePanel === 'workspace' ? buttonActive : ''}`}
            >
              <Brain size={14} />
              <span className="text-[10px] hidden sm:inline">Workspace</span>
            </button>
          )}

          {/* Agent Log */}
          {logVisible && (
            <button
              onClick={() => togglePanel('agent-log')}
              title="Agent Log"
              className={`${buttonBase} ${activePanel === 'agent-log' ? buttonActive : ''}`}
            >
              <Activity size={14} className={logGlow ? 'text-green' : ''} />
              <span className="text-[10px] hidden sm:inline">Log</span>
              {agentLogEntries.length > 0 && (
                <span className="text-[9px] bg-muted px-1 rounded-sm tabular-nums hidden md:inline-flex">{agentLogEntries.length}</span>
              )}
            </button>
          )}

          {/* Events */}
          {eventsVisible && (
            <button
              onClick={() => togglePanel('events')}
              title="Events"
              className={`${buttonBase} ${activePanel === 'events' ? buttonActive : ''}`}
            >
              <Radio size={14} />
              <span className="text-[10px] hidden sm:inline">Events</span>
              {eventEntries.length > 0 && (
                <span className="text-[9px] bg-muted px-1 rounded-sm tabular-nums hidden md:inline-flex">{eventEntries.length}</span>
              )}
            </button>
          )}

          {/* Usage */}
          <button
            onClick={() => togglePanel('usage')}
            title="Token Usage"
            className={`${buttonBase} ${activePanel === 'usage' ? buttonActive : ''}`}
          >
            <BarChart3 size={14} />
            <span className="text-[10px] hidden sm:inline">Usage</span>
            {totalCost && (
              <span className="text-[9px] bg-muted px-1 rounded-sm tabular-nums hidden lg:inline-flex">{totalCost}</span>
            )}
          </button>

          {/* Agents Dashboard */}
          <button
            onClick={() => togglePanel('agents')}
            title="All Agents"
            className={`${buttonBase} ${activePanel === 'agents' ? buttonActive : ''}`}
          >
            <Users size={14} />
            <span className="text-[10px] hidden sm:inline">Agents</span>
            <span className="text-[9px] bg-primary/20 text-primary px-1 rounded-sm tabular-nums hidden lg:inline-flex">
              {agents.filter(a => a.connectionStatus === 'connected').length}/{agents.length}
            </span>
          </button>

          {/* Settings */}
          <button
            onClick={onSettings}
            title="Settings"
            className={`${buttonBase} w-7`}
          >
            <Settings size={14} />
          </button>
        </div>
      </header>

      {/* Dropdown panel */}
      <div
        ref={panelRef}
        className={`absolute right-2 bg-card border border-border rounded-b-lg shadow-lg overflow-hidden transition-all duration-200 ease-out w-[600px] max-w-[calc(100vw-1rem)] max-h-[70vh] opacity-100 ${
          activePanel ? 'max-h-[70vh] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'
        }`}
        style={{ top: '100%' }}
      >
        <div className="max-h-[65vh] overflow-y-auto">
          <Suspense fallback={<div className="p-4 text-muted-foreground text-xs">Loading…</div>}>
            {activePanel === 'agent-log' && <AgentLog entries={agentLogEntries} glow={logGlow} />}
            {activePanel === 'events' && <EventLog entries={eventEntries} />}
            {activePanel === 'usage' && <TokenUsage data={tokenData} />}
            {activePanel === 'agents' && <AgentStatusDashboard compact />}
            {activePanel === 'sessions' && sessionsPanel}
            {activePanel === 'workspace' && workspacePanel}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
