/**
 * CronsTab: visual cron job management.
 *
 * Each job is a row in the Night light world: its pane is blue while a run is in
 * flight, red when the last run of an enabled job broke, and off otherwise. The
 * name takes the row; Run and History surface on hover, and the settings menu
 * carries every action so touch devices reach them too.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Play, Plus, Trash2, Pencil, History, Loader2, Settings2 } from 'lucide-react';
import { useCrons, type CronJob, type CronRun } from '../hooks/useCrons';
import { CronDialog } from './CronDialog';
import { useSessionContext } from '@/contexts/SessionContext';
import { Pane } from '@/components/ui/Pane';
import { paneStateLabel, type PaneState } from '@/lib/paneState';
import { isFailedCronStatus, isOkCronStatus } from '../cronStatus';

type CronRowJob = CronJob;

function everyPhrase(count: number, unit: string): string {
  return count === 1 ? `Every ${unit}` : `Every ${count} ${unit}s`;
}

/** Convert cron-like schedule to human-readable string */
function humanSchedule(job: CronJob): string {
  if (job.scheduleKind === 'at' && job.at) {
    try {
      return `Once on ${new Date(job.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
    } catch {
      return `At: ${job.at}`;
    }
  }
  if (job.scheduleKind === 'every' && job.everyMs) {
    const mins = job.everyMs / 60000;
    if (mins < 60) return everyPhrase(mins, 'minute');
    const hours = mins / 60;
    if (hours < 24) return everyPhrase(hours, 'hour');
    return everyPhrase(hours / 24, 'day');
  }
  if (job.scheduleKind === 'cron' && job.schedule) {
    return parseCronExpression(job.schedule);
  }
  return 'Unknown schedule';
}

function parseCronExpression(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;
  const [min, hour, dom, , dow] = parts;

  if (min === '0' && hour !== '*' && dom === '*' && dow === '*') {
    return `Every day at ${hour}:00`;
  }
  if (min === '0' && hour !== '*' && dom === '*' && dow === '1') {
    return `Every Monday at ${hour}:00`;
  }
  if (min.startsWith('*/')) {
    return `Every ${min.slice(2)} minutes`;
  }
  if (hour.startsWith('*/')) {
    return `Every ${hour.slice(2)} hours`;
  }
  return expr;
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function relativeUntil(ts: string): string {
  const diff = new Date(ts).getTime() - Date.now();
  if (Number.isNaN(diff)) return 'unknown';
  if (diff <= 0) return 'due now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'in <1m';
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const remMins = mins % 60;
    return remMins === 0 ? `in ${hours}h` : `in ${hours}h ${remMins}m`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours === 0 ? `in ${days}d` : `in ${days}d ${remHours}h`;
}

function fullTime(ts?: string): string | undefined {
  if (!ts) return undefined;
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? ts : date.toLocaleString();
}

const menuItemClass =
  'flex min-h-[var(--row-unit)] w-full items-center gap-2 px-2.5 text-[0.867rem] text-foreground transition-colors duration-[120ms] hover:bg-raised max-sm:min-h-11';

function CronRow({ job, focused, focusKey, onToggle, onRun, onDelete, onEdit, onFetchRuns }: {
  job: CronRowJob;
  /** True while this row is the one asked for from outside the tab. */
  focused: boolean;
  /** Changes with each request for this row, so asking again re-opens and re-scrolls it. */
  focusKey?: number;
  onToggle: (id: string, enabled: boolean) => void;
  onRun: (id: string) => Promise<boolean | undefined>;
  onDelete: (id: string) => void;
  onEdit: (job: CronJob) => void;
  onFetchRuns: (id: string) => Promise<CronRun[]>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [runs, setRuns] = useState<CronRun[]>([]);
  const [running, setRunning] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const actionsRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  // Cleanup delete confirmation timer
  useEffect(() => () => clearTimeout(deleteTimerRef.current), []);

  useEffect(() => {
    if (!actionsOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) {
        setActionsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActionsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [actionsOpen]);

  const showRuns = useCallback(async () => {
    const r = await onFetchRuns(job.id);
    setRuns(r);
    setExpanded(true);
  }, [job.id, onFetchRuns]);

  const handleExpand = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    await showRuns();
  }, [expanded, showRuns]);

  // Asked for from outside the tab: bring the row into view and open its history, once per request
  useEffect(() => {
    if (!focused) return;
    rowRef.current?.scrollIntoView?.({ block: 'start' });
    void showRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires when a request lands on this row, not when showRuns changes
  }, [focused, focusKey]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    try {
      const ok = await onRun(job.id);
      if (ok && expanded) {
        const r = await onFetchRuns(job.id);
        setRuns(r);
      }
    } finally {
      setRunning(false);
    }
  }, [expanded, job.id, onFetchRuns, onRun]);

  const handleDeleteClick = useCallback(() => {
    if (confirmingDelete) {
      clearTimeout(deleteTimerRef.current);
      setConfirmingDelete(false);
      setActionsOpen(false);
      onDelete(job.id);
    } else {
      setConfirmingDelete(true);
      deleteTimerRef.current = setTimeout(() => setConfirmingDelete(false), 3000);
    }
  }, [confirmingDelete, job.id, onDelete]);

  const name = job.name || job.label || job.id;
  const lastOk = isOkCronStatus(job.lastStatus);
  // Detect delivery-only failures: task ran but delivery failed
  const errorLower = job.lastError?.toLowerCase() ?? '';
  const isDeliveryFailure = !lastOk && (
    errorLower.includes('channel is required')
    || (job.lastDeliveryStatus === 'error' && errorLower.includes('channel'))
    || errorLower.includes('delivery')
  );
  const taskSucceeded = lastOk || isDeliveryFailure;
  // Light temperature: an enabled job whose last run broke keeps a red pane until it runs clean
  const broken = job.enabled && (isFailedCronStatus(job.lastStatus) || isDeliveryFailure);
  const executionLabel = job.payloadKind === 'agentTurn' ? 'Private session' : 'Main thread event';
  const paneState: PaneState = running ? 'live' : broken ? 'error' : 'off';
  const schedule = humanSchedule(job);
  const historyLabel = expanded ? 'Hide run history' : 'Show run history';

  return (
    <div ref={rowRef} className="group relative transition-colors duration-[120ms] hover:bg-raised">
      <div className="flex min-h-[var(--row-unit)] items-center gap-2 pl-3 pr-1">
        <Pane state={paneState} label={paneStateLabel(paneState)} />
        <button
          type="button"
          onClick={handleExpand}
          aria-expanded={expanded}
          title={historyLabel}
          className={`min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent text-left text-[0.867rem] transition-colors duration-[120ms] ${
            job.enabled ? 'text-foreground' : 'text-muted-foreground'
          }`}
        >
          {name}
        </button>
        <div className="relative flex shrink-0 items-center gap-0.5">
          {/* Desktop shortcuts: Run and History come forward on hover or focus, over the end of the name.
              The settings menu below carries the same actions for touch and keyboard. */}
          <div
            className={`absolute bottom-0 right-full top-0 flex items-center gap-0.5 bg-raised pl-2 pr-0.5 transition-opacity duration-[120ms] group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 ${
              running ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            <button
              type="button"
              onClick={handleRun}
              disabled={running}
              className="shell-icon-button disabled:cursor-wait disabled:opacity-60"
              title={running ? 'Running…' : 'Run now'}
              aria-label={`Run ${name}`}
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            </button>
            <button
              type="button"
              onClick={handleExpand}
              className="shell-icon-button"
              data-active={expanded ? 'true' : 'false'}
              title={historyLabel}
              aria-label={historyLabel}
              aria-expanded={expanded}
            >
              <History size={14} />
            </button>
          </div>
          <button
            type="button"
            onClick={() => onToggle(job.id, !job.enabled)}
            className="shell-chip min-w-[2.6rem]"
            data-active={job.enabled ? 'true' : 'false'}
            title={job.enabled ? 'Pause job' : 'Enable job'}
            aria-label={`${job.enabled ? 'Pause' : 'Enable'} ${name}`}
          >
            {job.enabled ? 'On' : 'Off'}
          </button>
          <div ref={actionsRef} className="relative">
            <button
              type="button"
              onClick={() => setActionsOpen((open) => !open)}
              className="shell-icon-button"
              data-active={actionsOpen ? 'true' : 'false'}
              title="Cron settings"
              aria-label={`Cron settings for ${name}`}
              aria-expanded={actionsOpen}
            >
              <Settings2 size={14} />
            </button>
            {actionsOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-[3px] border border-border bg-popover py-1 nerve-menu-shadow">
                <button
                  type="button"
                  onClick={() => { setActionsOpen(false); void handleRun(); }}
                  disabled={running}
                  className={`${menuItemClass} disabled:opacity-60`}
                >
                  <Play size={14} className="text-muted-foreground" />
                  <span>Run now</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setActionsOpen(false); void handleExpand(); }}
                  className={menuItemClass}
                >
                  <History size={14} className="text-muted-foreground" />
                  <span>{expanded ? 'Hide history' : 'Show history'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActionsOpen(false);
                    onEdit(job);
                  }}
                  className={menuItemClass}
                  aria-label={`Edit ${name}`}
                >
                  <Pencil size={14} className="text-muted-foreground" />
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  className={`${menuItemClass} ${
                    confirmingDelete ? 'text-destructive' : 'hover:text-destructive'
                  }`}
                  aria-label={confirmingDelete ? `Confirm delete ${name}` : `Delete ${name}`}
                >
                  <Trash2 size={14} className={confirmingDelete ? undefined : 'text-muted-foreground'} />
                  <span>{confirmingDelete ? 'Confirm delete' : 'Delete'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-0.5 pb-2 pl-[1.917rem] pr-3 text-[0.8rem] leading-5 text-muted-foreground">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 truncate" title={schedule}>{schedule}</span>
          {job.enabled && job.nextRun && (
            <span className="shrink-0 font-mono tabular" title={fullTime(job.nextRun)}>next {relativeUntil(job.nextRun)}</span>
          )}
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 truncate">{executionLabel}</span>
          <span className="shrink-0 font-mono tabular" title={fullTime(job.lastRun)}>
            {job.lastRun ? `last ${relativeTime(job.lastRun)}` : 'no runs yet'}
          </span>
        </div>

        <div aria-live="polite" aria-atomic="true">
          {running && (
            <div className="text-live-text">Running now.</div>
          )}
          {job.lastError && !taskSucceeded && !running && (
            <div className={`line-clamp-2 break-words ${broken ? 'text-destructive' : ''}`} title={job.lastError}>
              {job.lastError}
            </div>
          )}
          {isDeliveryFailure && !running && (
            <div className={`line-clamp-2 break-words ${broken ? 'text-destructive' : ''}`} title={job.lastError}>
              Delivery failed. Check cron settings.
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div className="pb-1 pl-[1.917rem] pr-3 text-[0.8rem]">
          {!runs.length && (
            <div className="flex min-h-[var(--row-unit)] items-center text-muted-foreground">
              No run history yet.
            </div>
          )}
          {runs.map((r, i) => {
            const runPane: PaneState = isFailedCronStatus(r.status) ? 'error' : 'off';
            return (
              <div key={i}>
                <div className="flex min-h-[var(--row-unit)] min-w-0 items-center gap-2 text-muted-foreground">
                  <Pane state={runPane} size="sm" />
                  <span className="min-w-0 flex-1 truncate font-mono tabular" title={fullTime(r.timestamp)}>
                    {r.timestamp ? relativeTime(r.timestamp) : 'unknown time'}
                  </span>
                  <span className={runPane === 'error' ? 'shrink-0 text-destructive' : 'shrink-0'}>{r.status}</span>
                  {r.duration !== undefined && (
                    <span className="shrink-0 font-mono tabular">{Math.round(r.duration / 1000)}s</span>
                  )}
                </div>
                {r.error && (
                  <div className="pb-1 pl-[1.033rem] break-words text-destructive" title={r.error}>{r.error}</div>
                )}
                {r.summary && (
                  <div className="line-clamp-2 pb-1 pl-[1.033rem] text-foreground/80">{r.summary.slice(0, 150)}{r.summary.length > 150 ? '…' : ''}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface CronsTabProps {
  /** Expand and scroll to this cron row when it changes (the tab was opened from outside). */
  focusCronId?: string | null;
  /** Changes with each request, so asking for the same cron again expands and scrolls to it again. */
  focusNonce?: number;
}

/** Workspace tab listing cron jobs with create/edit/delete/toggle controls. */
export function CronsTab({ focusCronId = null, focusNonce }: CronsTabProps = {}) {
  const { jobs, isLoading, error, fetchJobs, toggleJob, runJob, fetchRuns, addJob, updateJob, deleteJob } = useCrons();
  const { refreshSessions } = useSessionContext();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);

  const toolbarSummary = useMemo(() => {
    const enabledJobs = jobs.filter((job) => job.enabled);
    const failedCount = enabledJobs.filter((job) => isFailedCronStatus(job.lastStatus)).length;
    const nextJob = enabledJobs
      .filter((job) => job.nextRun)
      .sort((a, b) => new Date(a.nextRun as string).getTime() - new Date(b.nextRun as string).getTime())[0];

    const nextRelative = nextJob?.nextRun ? relativeUntil(nextJob.nextRun) : null;

    return {
      failedCount,
      enabledCount: enabledJobs.length,
      nextRelative,
    };
  }, [jobs]);

  const handleAdd = useCallback(() => {
    setDialogMode('create');
    setEditingJob(null);
    setDialogOpen(true);
  }, []);

  const handleEdit = useCallback((job: CronJob) => {
    setDialogMode('edit');
    setEditingJob(job);
    setDialogOpen(true);
  }, []);

  const handleDialogSubmit = useCallback(async (jobData: Record<string, unknown>) => {
    if (dialogMode === 'edit' && editingJob) {
      return updateJob(editingJob.id, jobData);
    }
    return addJob(jobData);
  }, [dialogMode, editingJob, addJob, updateJob]);

  const handleRun = useCallback(async (id: string) => {
    const ok = await runJob(id);
    if (ok) {
      await Promise.all([refreshSessions(), fetchJobs()]);
    }
    return ok;
  }, [fetchJobs, refreshSessions, runJob]);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto">
        <div className="flex min-h-[var(--row-unit)] items-center gap-2 border-b border-border pl-3 pr-1">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-[0.8rem] text-muted-foreground">
            {toolbarSummary.failedCount > 0 && (
              <span className="shrink-0 text-destructive">
                {toolbarSummary.failedCount} failed
              </span>
            )}
            {toolbarSummary.nextRelative ? (
              <span className="truncate font-mono tabular">next {toolbarSummary.nextRelative}</span>
            ) : toolbarSummary.enabledCount > 0 ? (
              <span className="truncate">
                <span className="font-mono tabular">{toolbarSummary.enabledCount}</span> enabled
              </span>
            ) : jobs.length > 0 ? (
              <span className="truncate">No enabled crons</span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleAdd}
            aria-label="Add cron job"
            title="Add cron job"
            className="shell-chip shrink-0"
          >
            <Plus size={14} />
            <span>New cron</span>
          </button>
          <button
            type="button"
            onClick={fetchJobs}
            disabled={isLoading}
            aria-label="Refresh crons"
            title="Refresh crons"
            className="shell-icon-button shrink-0 disabled:opacity-60"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : undefined} />
          </button>
        </div>

        <div aria-live="polite" aria-atomic="true">
          {error && (
            <div className="px-3 py-2">
              <div className="cockpit-note" data-tone="danger">{error}</div>
            </div>
          )}
        </div>

        {isLoading && !jobs.length && !error && (
          <div className="flex min-h-[var(--row-unit)] items-center px-3 text-[0.8rem] text-muted-foreground">
            Loading crons…
          </div>
        )}

        {!isLoading && !jobs.length && !error && (
          <div className="space-y-1 px-3 py-4 text-center">
            <div className="text-[0.867rem] font-medium text-foreground">No scheduled tasks yet</div>
            <p className="text-[0.8rem] leading-relaxed text-muted-foreground">
              Create one to schedule a private task or a main-thread reminder.
            </p>
          </div>
        )}

        {jobs.map(job => {
        return (
          <CronRow
            key={job.id}
            job={job}
            focused={job.id === focusCronId}
            focusKey={focusCronId === job.id ? focusNonce : undefined}
            onToggle={toggleJob}
            onRun={handleRun}
            onDelete={deleteJob}
            onEdit={handleEdit}
            onFetchRuns={fetchRuns}
          />
        );
        })}
      </div>

      <CronDialog
        key={`${dialogMode}-${editingJob?.id ?? 'new'}`}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleDialogSubmit}
        mode={dialogMode}
        initialData={editingJob}
      />
    </div>
  );
}
