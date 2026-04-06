/**
 * WorkspacePanel — Tabbed container replacing the standalone MemoryList.
 * Tabs: Memory, Crons, Kanban, Config (with Files/Skills sub-views)
 * Active tab persisted in localStorage. Content lazy-loaded per tab.
 * Tab action buttons (add, refresh) render in the tab bar header.
 */

import { useState, useCallback, lazy, Suspense, useEffect } from 'react';
import { WorkspaceTabs, type TabId } from './WorkspaceTabs';
import { CronsTab, ConfigTab, SkillsTab } from './tabs';
import { useCrons } from './hooks/useCrons';
import { KanbanQuickView } from '@/features/kanban';
import { getWorkspaceStorageKey } from './workspaceScope';
import { useSettings } from '@/contexts/SettingsContext';
import type { Memory } from '@/types';

const MemoryList = lazy(() => import('@/features/dashboard/MemoryList').then(m => ({ default: m.MemoryList })));

const CONFIG_VIEW_KEY = 'nerve-config-view';

type ConfigView = 'files' | 'skills';

function getInitialConfigView(agentId: string): ConfigView {
  try {
    if (localStorage.getItem(CONFIG_VIEW_KEY) === 'skills') {
      return 'skills';
    }

    const stored = localStorage.getItem(getWorkspaceStorageKey('config-view', agentId));
    if (stored === 'files') {
      return 'files';
    }
  } catch {
    // ignore storage errors
  }

  return 'files';
}

function persistConfigView(view: ConfigView, agentId: string) {
  try {
    if (view === 'skills') {
      localStorage.setItem(CONFIG_VIEW_KEY, 'skills');
      return;
    }

    localStorage.removeItem(CONFIG_VIEW_KEY);
    localStorage.setItem(getWorkspaceStorageKey('config-view', agentId), 'files');
  } catch {
    // ignore storage errors
  }
}

interface ConfigWithSkillsProps {
  agentId: string;
  cronWarning?: string | null;
}

/** Combined Config tab with Files/Skills sub-view toggle. */
function ConfigWithSkills({ agentId, cronWarning = null }: ConfigWithSkillsProps) {
  const [view, setView] = useState<ConfigView>(() => getInitialConfigView(agentId));

  const switchView = useCallback((nextView: ConfigView) => {
    setView(nextView);
    persistConfigView(nextView, agentId);
  }, [agentId]);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border/40">
        {(['files', 'skills'] as const).map(nextView => (
          <button
            key={nextView}
            onClick={() => switchView(nextView)}
            className={`text-[0.667rem] uppercase tracking-wider px-2 py-0.5 rounded-sm border-0 cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0 ${
              view === nextView
                ? 'bg-purple/15 text-purple font-semibold'
                : 'bg-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {nextView}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {view === 'files' ? <ConfigTab key={agentId} agentId={agentId} cronWarning={cronWarning} /> : <SkillsTab key={agentId} agentId={agentId} />}
      </div>
    </div>
  );
}

const STORAGE_KEY = 'nerve-workspace-tab';

function getInitialTab(canShowKanban: boolean): TabId {
  const allowedTabs: TabId[] = canShowKanban
    ? ['memory', 'crons', 'config', 'kanban']
    : ['memory', 'crons', 'config'];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && allowedTabs.includes(stored as TabId)) {
      return stored as TabId;
    }
  } catch { /* ignore */ }
  return 'memory';
}

interface WorkspacePanelProps {
  workspaceAgentId: string;
  memories: Memory[];
  onRefreshMemories: (signal?: AbortSignal) => void | Promise<void>;
  memoriesLoading?: boolean;
  /** True when the workspace lives in a remote sandbox (gateway RPC mode). */
  remoteWorkspace?: boolean;
  /** Render in compact dropdown mode (chat-first topbar panel). */
  compact?: boolean;
  /** Switch the app to full kanban board view. */
  onOpenBoard?: () => void;
  /** Open a specific task in the full board view. */
  onOpenTask?: (taskId: string) => void;
}

export function WorkspacePanel({
  workspaceAgentId,
  memories,
  onRefreshMemories,
  memoriesLoading,
  remoteWorkspace = false,
  compact = false,
  onOpenBoard,
  onOpenTask,
}: WorkspacePanelProps) {
  const { kanbanVisible } = useSettings();
  const [activeTab, setActiveTab] = useState<TabId>(() => getInitialTab(kanbanVisible));
  const { activeCount, cronWarning } = useCrons();

  const [visitedTabs, setVisitedTabs] = useState<Set<TabId>>(() => new Set([activeTab]));

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
    setVisitedTabs(prev => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
    try {
      localStorage.setItem(STORAGE_KEY, tab);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (kanbanVisible) return;

    if (activeTab === 'kanban') {
      const timeoutId = window.setTimeout(() => {
        handleTabChange('memory');
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }

    try {
      if (localStorage.getItem(STORAGE_KEY) === 'kanban') {
        localStorage.setItem(STORAGE_KEY, activeTab);
      }
    } catch { /* ignore */ }
  }, [activeTab, kanbanVisible, handleTabChange]);

  return (
    <div className={compact ? 'h-[70vh] max-h-[70vh] flex flex-col min-h-0' : 'h-full flex flex-col min-h-0'}>
      <WorkspaceTabs
        activeTab={activeTab}
        onTabChange={handleTabChange}
        cronCount={activeCount || undefined}
        kanbanCount={undefined}
        showKanban={kanbanVisible}
      />
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className={activeTab === 'memory' ? 'h-full' : 'hidden'} hidden={activeTab !== 'memory'} role="tabpanel" id="workspace-tabpanel-memory" aria-labelledby="workspace-tab-memory">
          {visitedTabs.has('memory') && (
            <Suspense fallback={<div className="flex items-center justify-center text-muted-foreground text-xs p-4">Loading…</div>}>
              <MemoryList
                key={workspaceAgentId}
                agentId={workspaceAgentId}
                memories={memories}
                onRefresh={onRefreshMemories}
                isLoading={memoriesLoading}
                remoteWorkspace={remoteWorkspace}
                hideHeader
                compact={compact}
              />
            </Suspense>
          )}
        </div>
        <div className={activeTab === 'crons' ? 'h-full' : 'hidden'} hidden={activeTab !== 'crons'} role="tabpanel" id="workspace-tabpanel-crons" aria-labelledby="workspace-tab-crons">
          {visitedTabs.has('crons') && (
            <CronsTab />
          )}
        </div>
        <div className={activeTab === 'config' ? 'h-full' : 'hidden'} hidden={activeTab !== 'config'} role="tabpanel" id="workspace-tabpanel-config" aria-labelledby="workspace-tab-config">
          {visitedTabs.has('config') && <ConfigWithSkills key={workspaceAgentId} agentId={workspaceAgentId} cronWarning={cronWarning} />}
        </div>
        {kanbanVisible && (
          <div className={activeTab === 'kanban' ? 'h-full' : 'hidden'} hidden={activeTab !== 'kanban'} role="tabpanel" id="workspace-tabpanel-kanban" aria-labelledby="workspace-tab-kanban">
            {visitedTabs.has('kanban') && (
              <KanbanQuickView
                onOpenBoard={onOpenBoard ?? (() => {})}
                onOpenTask={(task) => onOpenTask ? onOpenTask(task.id) : onOpenBoard?.()}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
