import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { Filter, Plus, X, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TaskStatus, TaskPriority } from './types';
import type { KanbanFilters } from './hooks/useKanban';
import { ProposalInbox } from './ProposalInbox';
import type { KanbanProposal } from './hooks/useProposals';

/* ── Stats chip ── */
function StatChip({ label, count, accent }: { label: string; count: number; accent: string }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium ${accent}`}>
      <span>{label}</span>
      <span className="rounded-full bg-black/12 px-1.5 py-0.5 font-mono text-[10px] tabular-nums">{count}</span>
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
      className={`h-8 rounded-full border px-3 text-[11px] font-medium transition-colors cursor-pointer ${
        active
          ? 'border-primary/40 bg-primary/14 text-primary'
          : 'border-border/70 bg-background/40 text-muted-foreground hover:border-primary/24 hover:text-foreground'
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
    <div className="shrink-0 space-y-3 border-b border-border/50 px-4 py-4">
      {/* Row 1: title + stats + actions */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Left: title + stats */}
        <div className="min-w-0 space-y-2">
          <div className="cockpit-kicker">
            <span className="text-primary">◆</span>
            Task board
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tracking-[-0.03em] text-foreground">Tasks</h1>
            <div className="hidden sm:flex items-center gap-1.5">
              <StatChip label="To Do" count={statusCounts.todo} accent="border-blue-400/20 bg-blue-400/8 text-blue-300" />
              <StatChip label="In Progress" count={statusCounts['in-progress']} accent="border-cyan-400/20 bg-cyan-400/8 text-cyan-300" />
              <StatChip label="Review" count={statusCounts.review} accent="border-amber-400/20 bg-amber-400/8 text-amber-300" />
              <StatChip label="Done" count={statusCounts.done} accent="border-green-400/20 bg-green-400/8 text-green-300" />
            </div>
          </div>
        </div>

        <div className="flex-1" />

        {/* Right: search + filter toggle + create */}
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
          {/* Search */}
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <input
              type="text"
              value={searchValue}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search tasks…"
              className="cockpit-input h-10 w-full min-w-0 px-4 pr-12 text-sm sm:w-[280px]"
            />
            {searchValue && (
              <button
                onClick={() => handleSearchChange('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground"
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
            className={showFilters ? 'border-primary/30 bg-primary/12 text-primary' : ''}
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
              className={showInbox ? 'border-primary/30 bg-primary/12 text-primary' : ''}
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
              <div className="shell-panel absolute right-0 top-full z-50 mt-2 w-[360px] overflow-hidden rounded-3xl">
                <div className="border-b border-border/50 bg-secondary/38 px-4 py-3">
                  <span className="cockpit-kicker text-[9px]">
                    <span className="text-primary">◆</span>
                    Agent proposals
                  </span>
                  {pendingProposalCount > 0 && (
                    <span className="ml-2 text-[11px] text-muted-foreground">{pendingProposalCount} pending</span>
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
        <div className="cockpit-note flex flex-wrap items-center gap-2" data-tone="primary">
          <span className="text-[11px] font-medium text-foreground">Priority</span>
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
              className="ml-2 text-[11px] text-muted-foreground underline hover:text-foreground"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
});
