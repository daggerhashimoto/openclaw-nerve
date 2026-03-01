import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { Search, Filter, Plus, X, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TaskStatus, TaskPriority } from './types';
import type { KanbanFilters } from './hooks/useKanban';
import { ProposalInbox } from './ProposalInbox';
import type { KanbanProposal } from './hooks/useProposals';

/* ── Stats chip ── */
function StatChip({ label, count, accent }: { label: string; count: number; accent: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-sm ${accent}`}>
      <span>{label}</span>
      <span className="bg-white/15 px-1 rounded-sm tabular-nums">{count}</span>
    </span>
  );
}

/* ── Priority filter pill ── */
function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-6 px-2 text-[10px] font-semibold rounded-full border transition-colors cursor-pointer ${
        active
          ? 'bg-primary/20 text-primary border-primary/40'
          : 'bg-transparent text-muted-foreground border-border/60 hover:text-foreground hover:border-muted-foreground'
      }`}
    >
      {label}
    </button>
  );
}

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

  /* Debounced search — reads filtersRef to avoid overwriting concurrent filter changes */
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

  return (
    <div className="shrink-0 px-4 pt-3 pb-2 space-y-2">
      {/* Row 1: title + stats + actions */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Left: title + stats */}
        <h1 className="text-sm font-bold text-foreground tracking-wide uppercase">Tasks</h1>
        <div className="hidden sm:flex items-center gap-1.5">
          <StatChip label="To Do" count={statusCounts.todo} accent="text-blue-400" />
          <StatChip label="In Progress" count={statusCounts['in-progress']} accent="text-cyan-400" />
          <StatChip label="Review" count={statusCounts.review} accent="text-amber-400" />
          <StatChip label="Done" count={statusCounts.done} accent="text-green-400" />
        </div>

        <div className="flex-1" />

        {/* Right: search + filter toggle + create */}
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={searchValue}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search tasks…"
              className="h-8 w-[180px] sm:w-[240px] pl-7 pr-2 text-xs rounded-md border border-input bg-transparent placeholder:text-muted-foreground text-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
            />
            {searchValue && (
              <button
                onClick={() => handleSearchChange('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Filter toggle */}
          <Button
            variant={showFilters ? 'secondary' : 'outline'}
            size="icon-sm"
            onClick={() => setShowFilters(!showFilters)}
            title="Toggle filters"
          >
            <Filter size={14} />
          </Button>

          {/* Proposal inbox */}
          <div className="relative" ref={inboxRef}>
            <Button
              variant={showInbox ? 'secondary' : 'outline'}
              size="icon-sm"
              onClick={() => setShowInbox(!showInbox)}
              title="Agent proposals"
            >
              <Inbox size={14} />
              {pendingProposalCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 text-[10px] font-bold bg-primary text-primary-foreground rounded-full flex items-center justify-center">
                  {pendingProposalCount}
                </span>
              )}
            </Button>

            {/* Inbox popover */}
            {showInbox && (
              <div className="absolute right-0 top-full mt-1 w-[340px] bg-popover border border-border rounded-lg shadow-lg z-50">
                <div className="px-3 py-2 border-b border-border/40">
                  <span className="text-xs font-semibold text-foreground">Agent Proposals</span>
                  {pendingProposalCount > 0 && (
                    <span className="ml-2 text-[10px] text-muted-foreground">{pendingProposalCount} pending</span>
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
          <Button size="sm" onClick={onCreateTask}>
            <Plus size={14} />
            <span className="hidden sm:inline">New Task</span>
          </Button>
        </div>
      </div>

      {/* Row 2: Filter controls (collapsible) */}
      {showFilters && (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Priority:</span>
          {(['critical', 'high', 'normal', 'low'] as TaskPriority[]).map(p => (
            <FilterPill
              key={p}
              label={p.charAt(0).toUpperCase() + p.slice(1)}
              active={filters.priority.includes(p)}
              onClick={() => togglePriority(p)}
            />
          ))}

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-[10px] text-muted-foreground hover:text-foreground underline ml-2"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
});
