/**
 * WorkspaceTabs — Tab bar styled like the Agents panel header.
 * Uses ◆ diamond + uppercase labels with accent color.
 */

import { useCallback } from 'react';
import { Brain, Clock, Settings, Puzzle, type LucideIcon } from 'lucide-react';

export type TabId = 'memory' | 'crons' | 'skills' | 'config';

interface Tab {
  id: TabId;
  label: string;
  icon: LucideIcon;
}

const TABS: Tab[] = [
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'crons', label: 'Crons', icon: Clock },
  { id: 'skills', label: 'Skills', icon: Puzzle },
  { id: 'config', label: 'Config', icon: Settings },
];

interface WorkspaceTabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  cronCount?: number;
}

/** Horizontal tab bar for workspace sections (Memory, Crons, Skills, Config). */
export function WorkspaceTabs({ activeTab, onTabChange, cronCount }: WorkspaceTabsProps) {
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const currentIndex = TABS.findIndex(t => t.id === activeTab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (currentIndex + 1) % TABS.length;
      onTabChange(TABS[next].id);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = (currentIndex - 1 + TABS.length) % TABS.length;
      onTabChange(TABS[prev].id);
    }
  }, [activeTab, onTabChange]);

  return (
    <div
      className="panel-header border-l-[3px] border-l-purple flex items-center gap-0"
      role="tablist"
      aria-label="Workspace tabs"
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center gap-0 flex-1 min-w-0">
      {TABS.map((tab, i) => {
        const isActive = tab.id === activeTab;
        const badge = tab.id === 'crons' && cronCount ? cronCount : undefined;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            aria-controls={`workspace-tabpanel-${tab.id}`}
            id={`workspace-tab-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            className={`panel-label cursor-pointer transition-colors bg-transparent flex items-center gap-1 border-0 px-0 focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0 rounded-sm ${
              i > 0 ? 'ml-3' : ''
            } ${
              isActive
                ? 'text-purple'
                : 'text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100'
            }`}
            data-active={isActive}
          >
            <Icon size={11} />
            <span className="uppercase">{tab.label}</span>
            {badge !== undefined && (
              <span className="text-[9px] opacity-70">({badge})</span>
            )}
          </button>
        );
      })}
      </div>
    </div>
  );
}
