/**
 * WorkspaceTabs — Tab bar styled like the Agents panel header.
 * Uses ◆ diamond + uppercase labels with accent color.
 */

import { useCallback } from 'react';
import { Brain, Clock, Settings, Columns3, type LucideIcon } from 'lucide-react';

export type TabId = 'memory' | 'crons' | 'config' | 'kanban';

interface Tab {
  id: TabId;
  label: string;
  icon: LucideIcon;
}

const TABS: Tab[] = [
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'crons', label: 'Crons', icon: Clock },
  { id: 'kanban', label: 'Tasks', icon: Columns3 },
  { id: 'config', label: 'Config', icon: Settings },
];

interface WorkspaceTabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  cronCount?: number;
  kanbanCount?: number;
  showKanban?: boolean;
}

/** Horizontal tab bar for workspace sections (Memory, Crons, Skills, Config). */
export function WorkspaceTabs({ activeTab, onTabChange, cronCount, kanbanCount, showKanban = true }: WorkspaceTabsProps) {
  const tabs = showKanban ? TABS : TABS.filter(tab => tab.id !== 'kanban');
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const currentIndex = tabs.findIndex(t => t.id === activeTab);
    const resolvedIndex = currentIndex === -1 ? 0 : currentIndex;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (resolvedIndex + 1) % tabs.length;
      onTabChange(tabs[next].id);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = (resolvedIndex - 1 + tabs.length) % tabs.length;
      onTabChange(tabs[prev].id);
    }
  }, [activeTab, onTabChange, tabs]);

  return (
    <div
      className="panel-header border-l-[3px] border-l-purple flex items-stretch gap-0 sm:items-center"
      role="tablist"
      aria-label="Workspace tabs"
      onKeyDown={handleKeyDown}
    >
      <div className="flex flex-1 min-w-0 flex-wrap items-stretch gap-1.5 sm:flex-nowrap sm:items-center sm:gap-0">
      {tabs.map((tab, i) => {
        const isActive = tab.id === activeTab;
        const badge = tab.id === 'crons' && cronCount ? cronCount
          : tab.id === 'kanban' && kanbanCount ? kanbanCount
          : undefined;
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
            className={`panel-label flex min-h-11 min-w-[calc(50%-0.375rem)] flex-1 items-center justify-center gap-1 rounded-md border border-border/60 bg-background/35 px-2.5 text-center transition-colors focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0 sm:min-h-0 sm:min-w-0 sm:flex-none sm:justify-start sm:border-0 sm:bg-transparent sm:px-0 ${
              i > 0 ? 'sm:ml-3' : ''
            } ${
              isActive
                ? 'border-purple/45 bg-purple/8 text-purple'
                : 'text-muted-foreground opacity-70 hover:text-foreground hover:opacity-100'
            }`}
            data-active={isActive}
          >
            <Icon size={11} />
            <span className="uppercase">{tab.label}</span>
            {badge !== undefined && (
              <span className="text-[0.6rem] opacity-70">({badge})</span>
            )}
          </button>
        );
      })}
      </div>
    </div>
  );
}
