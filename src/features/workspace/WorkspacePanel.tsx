/**
 * WorkspacePanel — Tabbed container replacing the standalone MemoryList.
 * Tabs: Memory, Crons, Skills, Config
 * Active tab persisted in localStorage. Content lazy-loaded per tab.
 * Tab action buttons (add, refresh) render in the tab bar header.
 */

import { useState, useCallback } from 'react';
import { WorkspaceTabs, type TabId } from './WorkspaceTabs';
import { MemoryTab, CronsTab, ConfigTab, SkillsTab } from './tabs';
import { useCrons } from './hooks/useCrons';
import type { Memory } from '@/types';

const STORAGE_KEY = 'nerve-workspace-tab';

function getInitialTab(): TabId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && ['memory', 'crons', 'skills', 'config'].includes(stored)) {
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
}

export function WorkspacePanel({ memories, onRefreshMemories, memoriesLoading, compact = false }: WorkspacePanelProps) {
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
        <div className={activeTab === 'skills' ? 'h-full' : 'hidden'} hidden={activeTab !== 'skills'} role="tabpanel" id="workspace-tabpanel-skills" aria-labelledby="workspace-tab-skills">
          {visitedTabs.has('skills') && (
            <SkillsTab />
          )}
        </div>
        <div className={activeTab === 'config' ? 'h-full' : 'hidden'} hidden={activeTab !== 'config'} role="tabpanel" id="workspace-tabpanel-config" aria-labelledby="workspace-tab-config">
          {visitedTabs.has('config') && <ConfigTab />}
        </div>
      </div>
    </div>
  );
}
