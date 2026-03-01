/**
 * WorkspacePanel — Tabbed container replacing the standalone MemoryList.
 * Tabs: Memory, Crons, Kanban, Config (with Files/Skills sub-views)
 * Active tab persisted in localStorage. Content lazy-loaded per tab.
 * Tab action buttons (add, refresh) render in the tab bar header.
 */

import { useState, useCallback } from 'react';
import { WorkspaceTabs, type TabId } from './WorkspaceTabs';
import { MemoryTab, CronsTab, ConfigTab, SkillsTab } from './tabs';
import { useCrons } from './hooks/useCrons';
import { KanbanQuickView } from '@/features/kanban';
import type { Memory } from '@/types';

const CONFIG_VIEW_KEY = 'nerve-config-view';

/** Combined Config tab with Files/Skills sub-view toggle. */
function ConfigWithSkills() {
  const [view, setView] = useState<'files' | 'skills'>(() => {
    try {
      const stored = localStorage.getItem(CONFIG_VIEW_KEY);
      if (stored === 'skills') return 'skills';
    } catch { /* ignore */ }
    return 'files';
  });

  const switchView = useCallback((v: 'files' | 'skills') => {
    setView(v);
    try { localStorage.setItem(CONFIG_VIEW_KEY, v); } catch { /* ignore */ }
  }, []);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border/40">
        {(['files', 'skills'] as const).map(v => (
          <button
            key={v}
            onClick={() => switchView(v)}
            className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm border-0 cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0 ${
              view === v
                ? 'bg-purple/15 text-purple font-semibold'
                : 'bg-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {view === 'files' ? <ConfigTab /> : <SkillsTab />}
      </div>
    </div>
  );
}

const STORAGE_KEY = 'nerve-workspace-tab';

function getInitialTab(): TabId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && ['memory', 'crons', 'config', 'kanban'].includes(stored)) {
      return stored as TabId;
    }
  } catch { /* ignore */ }
  return 'memory';
}

interface WorkspacePanelProps {
  memories: Memory[];
  onRefreshMemories: (signal?: AbortSignal) => void | Promise<void>;
  memoriesLoading?: boolean;
  /** Render in compact dropdown mode (chat-first topbar panel). */
  compact?: boolean;
  /** Switch the app to full kanban board view. */
  onOpenBoard?: () => void;
  /** Open a specific task in the full board view. */
  onOpenTask?: (taskId: string) => void;
}

export function WorkspacePanel({ memories, onRefreshMemories, memoriesLoading, compact = false, onOpenBoard, onOpenTask }: WorkspacePanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>(getInitialTab);
  const { activeCount } = useCrons();

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

  return (
    <div className={compact ? 'h-[70vh] max-h-[70vh] flex flex-col min-h-0' : 'h-full flex flex-col min-h-0'}>
      <WorkspaceTabs
        activeTab={activeTab}
        onTabChange={handleTabChange}
        cronCount={activeCount || undefined}
        kanbanCount={undefined}
      />
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className={activeTab === 'memory' ? 'h-full' : 'hidden'} hidden={activeTab !== 'memory'} role="tabpanel" id="workspace-tabpanel-memory" aria-labelledby="workspace-tab-memory">
          {visitedTabs.has('memory') && (
            <MemoryTab
              memories={memories}
              onRefresh={onRefreshMemories}
              isLoading={memoriesLoading}
              compact={compact}
            />
          )}
        </div>
        <div className={activeTab === 'crons' ? 'h-full' : 'hidden'} hidden={activeTab !== 'crons'} role="tabpanel" id="workspace-tabpanel-crons" aria-labelledby="workspace-tab-crons">
          {visitedTabs.has('crons') && (
            <CronsTab />
          )}
        </div>
        <div className={activeTab === 'config' ? 'h-full' : 'hidden'} hidden={activeTab !== 'config'} role="tabpanel" id="workspace-tabpanel-config" aria-labelledby="workspace-tab-config">
          {visitedTabs.has('config') && <ConfigWithSkills />}
        </div>
        <div className={activeTab === 'kanban' ? 'h-full' : 'hidden'} hidden={activeTab !== 'kanban'} role="tabpanel" id="workspace-tabpanel-kanban" aria-labelledby="workspace-tab-kanban">
          {visitedTabs.has('kanban') && (
            <KanbanQuickView
              onOpenBoard={onOpenBoard ?? (() => {})}
              onOpenTask={(task) => onOpenTask ? onOpenTask(task.id) : onOpenBoard?.()}
            />
          )}
        </div>
      </div>
    </div>
  );
}
