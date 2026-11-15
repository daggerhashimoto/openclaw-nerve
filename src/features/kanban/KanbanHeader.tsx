import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { Filter, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Pane } from '@/components/ui/Pane';
import type { TaskStatus, TaskPriority } from './types';
import type { KanbanFilters } from './hooks/useKanban';
import { ProposalInbox } from './ProposalInbox';
import type { KanbanProposal } from './hooks/useProposals';
import { boardWords } from './tone';

const PRIORITY_FILTERS: { value: TaskPriority; label: string }[] = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

interface KanbanHeaderProps {
  filters: KanbanFilters;
  onFiltersChange: (filters: KanbanFilters) => void;
  statusCounts: Record<TaskStatus, number>;
  onCreateTask: () => void;
  proposals?: KanbanProposal[];
  pendingProposalCount?: number;
  onApproveProposal?: (id: string) => void;
  onRejectProposal?: (id: string) => void;
}

/**
 * The board's header row: the Tasks nameplate with the board in words, then search, the
 * priority filter, agent proposals (a pane that lights cantaloupe while any wait on you)
 * and New task. The priority filter opens as a second hairline row.
 */
export const KanbanHeader = memo(function KanbanHeader({
  filters,
  onFiltersChange,
  statusCounts,
  onCreateTask,
  proposals = [],
  pendingProposalCount = 0,
  onApproveProposal,
  onRejectProposal,
}: KanbanHeaderProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [showInbox, setShowInbox] = useState(false);
  const [searchValue, setSearchValue] = useState(filters.q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const filtersRef = useRef(filters);
  const inboxRef = useRef<HTMLDivElement>(null);

  /* Keep filtersRef in sync (avoids stale closures in debounced search) */
  useEffect(() => { filtersRef.current = filters; });

  /* Close inbox popover when clicking outside */
  useEffect(() => {
    if (!showInbox) return;
    const handler = (e: MouseEvent) => {
      if (inboxRef.current && !inboxRef.current.contains(e.target as Node)) {
        setShowInbox(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showInbox]);

  /* Debounced search: reads filtersRef to avoid overwriting concurrent filter changes */
  const handleSearchChange = useCallback((value: string) => {
    setSearchValue(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onFiltersChange({ ...filtersRef.current, q: value });
    }, 300);
  }, [onFiltersChange]);

  /* Cleanup debounce on unmount */
  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  const togglePriority = useCallback((p: TaskPriority) => {
    const current = filters.priority;
    const next = current.includes(p) ? current.filter(x => x !== p) : [...current, p];
    onFiltersChange({ ...filters, priority: next });
  }, [filters, onFiltersChange]);

  const clearFilters = useCallback(() => {
    clearTimeout(debounceRef.current);
    setSearchValue('');
    onFiltersChange({ q: '', priority: [], assignee: '', labels: [] });
  }, [onFiltersChange]);

  const hasActiveFilters = filters.q || filters.priority.length > 0 || filters.assignee || filters.labels.length > 0;
  const words = boardWords(statusCounts);
  const proposalsWaiting = pendingProposalCount > 0;

  return (
    <div className="shrink-0 border-b border-border">
      {/* Row 1: nameplate, words, actions */}
      <div className="flex min-h-[2.933rem] flex-wrap items-center gap-x-3 gap-y-2 py-1.5 pl-4 pr-2">
        <div className="flex min-w-0 items-center">
          <h1 className="nerve-nameplate text-foreground">Tasks</h1>
          {words && (
            <span className="nerve-fleet-words hidden sm:inline-flex" data-testid="board-words">{words}</span>
          )}
        </div>

        <div className="flex-1" />

        <div className="flex w-full flex-wrap items-center justify-end gap-1.5 sm:w-auto sm:flex-nowrap">
          {/* Search */}
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <input
              type="search"
              value={searchValue}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search tasks"
              aria-label="Search tasks"
              className="cockpit-input h-11 w-full min-w-0 pr-8 sm:h-[var(--row-unit)] sm:w-[220px]"
            />
            {searchValue && (
              <button
                type="button"
                onClick={() => handleSearchChange('')}
                className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-[3px] text-muted-foreground hover:bg-raised hover:text-foreground"
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Priority filter */}
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className="shell-icon-button shrink-0"
            data-active={showFilters || filters.priority.length > 0 ? 'true' : 'false'}
            title="Filter by priority"
            aria-label="Filter by priority"
            aria-pressed={showFilters}
          >
            <Filter size={14} />
          </button>

          {/* Agent proposals: the pane lights cantaloupe while any wait on you */}
          <div className="relative shrink-0" ref={inboxRef}>
            <button
              type="button"
              onClick={() => setShowInbox(!showInbox)}
              className="shell-chip"
              data-active={showInbox ? 'true' : 'false'}
              title="Agent proposals"
              aria-label={proposalsWaiting ? `Agent proposals, ${pendingProposalCount} waiting on you` : 'Agent proposals'}
              aria-expanded={showInbox}
            >
              <Pane state={proposalsWaiting ? 'operator' : 'off'} size="sm" />
              {proposalsWaiting && <span className="font-mono text-[0.8rem] tabular">{pendingProposalCount}</span>}
              <span className="hidden sm:inline">Proposals</span>
            </button>

            {showInbox && (
              <div className="absolute right-0 top-full z-50 mt-1 w-[min(380px,calc(100vw-1.067rem))] overflow-hidden rounded-[3px] border border-border bg-popover shadow-[0_12px_32px_rgba(0,0,0,0.32)]">
                <div className="flex min-h-[var(--row-unit)] items-center gap-2 border-b border-border px-3 text-[0.867rem] font-medium text-foreground">
                  <span>Agent proposals</span>
                  {proposalsWaiting && (
                    <span className="font-mono text-[0.8rem] font-normal text-muted-foreground tabular">{pendingProposalCount} waiting</span>
                  )}
                </div>
                <ProposalInbox
                  proposals={proposals}
                  onApprove={(id) => onApproveProposal?.(id)}
                  onReject={(id) => onRejectProposal?.(id)}
                />
              </div>
            )}
          </div>

          {/* Create */}
          <Button size="sm" onClick={onCreateTask} className="shrink-0">
            <Plus size={14} />
            <span className="hidden sm:inline">New task</span>
          </Button>
        </div>
      </div>

      {/* Row 2: priority filter */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-1 border-t border-border px-3 py-1">
          <span className="mr-1 text-[0.8rem] text-muted-foreground">Priority</span>
          {PRIORITY_FILTERS.map(p => (
            <button
              key={p.value}
              type="button"
              onClick={() => togglePriority(p.value)}
              className="shell-chip"
              data-active={filters.priority.includes(p.value) ? 'true' : 'false'}
              aria-pressed={filters.priority.includes(p.value)}
            >
              {p.label}
            </button>
          ))}
          {hasActiveFilters && (
            <button type="button" onClick={clearFilters} className="shell-chip ml-1">
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
});
