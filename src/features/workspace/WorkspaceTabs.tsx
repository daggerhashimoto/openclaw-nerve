/**
 * WorkspaceTabs: one row-unit strip of sentence-case text tabs.
 * The active tab is neutral: foreground text over a 2px foreground rule.
 */

import { useCallback } from 'react';

export type TabId = 'memory' | 'crons' | 'config' | 'kanban';

interface Tab {
  id: TabId;
  label: string;
}

const TABS: Tab[] = [
  { id: 'memory', label: 'Memory' },
  { id: 'crons', label: 'Crons' },
  { id: 'kanban', label: 'Tasks' },
  { id: 'config', label: 'Config' },
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
      className="@container flex shrink-0 items-stretch border-b border-border bg-card"
      role="tablist"
      aria-label="Workspace tabs"
      onKeyDown={handleKeyDown}
    >
      {/* Tabs follow the panel width, not the window: they wrap when the column is dragged narrow. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-stretch sm:flex-nowrap sm:@max-[18rem]:flex-wrap">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        const badge = tab.id === 'crons' && cronCount ? cronCount
          : tab.id === 'kanban' && kanbanCount ? kanbanCount
          : undefined;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            aria-controls={`workspace-tabpanel-${tab.id}`}
            id={`workspace-tab-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            className={`flex min-h-11 min-w-[50%] flex-1 items-center justify-center gap-1.5 border-b-2 px-3 text-[0.867rem] transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:-mb-px sm:min-h-[var(--row-unit)] sm:min-w-0 sm:flex-none sm:justify-start sm:@max-[22rem]:px-2 ${
              isActive
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            data-active={isActive}
          >
            <span>{tab.label}</span>
            {badge !== undefined && (
              <span className="rounded-sm bg-raised px-1 font-mono text-[0.733rem] leading-4 text-muted-foreground tabular">{badge}</span>
            )}
          </button>
        );
      })}
      </div>
    </div>
  );
}
