/**
 * CronsTab: visual cron job management.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Play, Plus, Trash2, Pencil, ChevronDown, ChevronRight, Loader2, Settings2 } from 'lucide-react';
import { useCrons, type CronJob, type CronRun, CRON_GATEWAY_TOOL_ALLOWLIST } from '../hooks/useCrons';
import { CronDialog } from './CronDialog';
import { useSessionContext } from '@/contexts/SessionContext';
import { Pane } from '@/components/ui/Pane';
import { paneStateLabel, type PaneState } from '@/lib/paneState';

type CronRowJob = CronJob;

/** Convert cron-like schedule to human-readable string */
function humanSchedule(job: CronJob): string {
  if (job.scheduleKind === 'at' && job.at) {
    try {
      return `One-shot: ${new Date(job.at).toLocaleString()}`;
    } catch {
      return `At: ${job.at}`;
    }
  }
  if (job.scheduleKind === 'every' && job.everyMs) {
    const mins = job.everyMs / 60000;
    if (mins < 60) return `Every ${mins} minutes`;
    const hours = mins / 60;
    if (hours < 24) return `Every ${hours} hours`;
    return `Every ${hours / 24} days`;
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

function CronRow({ job, onToggle, onRun, onDelete, onEdit, onFetchRuns }: {
  job: CronRowJob;
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

  const handleExpand = useCallback(async () => {
    if (!expanded) {
      const r = await onFetchRuns(job.id);
      setRuns(r);
    }
    setExpanded(!expanded);
  }, [expanded, job.id, onFetchRuns]);

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
  const isSuccess = job.lastStatus === 'success' || job.lastStatus === 'ok' || job.lastStatus === 'finished';
  // Detect delivery-only failures: task ran but delivery failed
  const errorLower = job.lastError?.toLowerCase() ?? '';
  const isDeliveryFailure = !isSuccess && (
    errorLower.includes('channel is required')
    || (job.lastDeliveryStatus === 'error' && errorLower.includes('channel'))
    || errorLower.includes('delivery')
  );
  const taskSucceeded = isSuccess || isDeliveryFailure;
  const executionLabel = job.payloadKind === 'agentTurn' ? 'Private session' : 'Main thread event';
  const paneState: PaneState = running ? 'live' : 'off';

  return (
    <div className="border-b border-border">
      <div className="flex min-h-[var(--row-unit)] items-center gap-2 pl-3 pr-1">
        <Pane state={paneState} label={paneStateLabel(paneState)} />
        <span className="min-w-0 flex-1 truncate text-[0.867rem] text-foreground" title={name}>{name}</span>
        <button
          onClick={() => onToggle(job.id, !job.enabled)}
          className="shell-chip shrink-0"
          data-active={job.enabled ? 'true' : 'false'}
          title={job.enabled ? 'Pause job' : 'Enable job'}
          aria-label={`${job.enabled ? 'Pause' : 'Enable'} ${name}`}
        >
          {job.enabled ? 'On' : 'Off'}
        </button>
        <button
          onClick={handleRun}
          disabled={running}
          className="shell-icon-button shrink-0 disabled:cursor-wait disabled:opacity-60"
          title={running ? 'Running…' : 'Run now'}
          aria-label={`Run ${name}`}
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
        </button>
        <button
          onClick={handleExpand}
          className="shell-icon-button shrink-0"
          data-active={expanded ? 'true' : 'false'}
          title={expanded ? 'Hide history' : 'Show history'}
          aria-label={expanded ? 'Hide history' : 'Show history'}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div ref={actionsRef} className="relative shrink-0">
          <button
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
            <div className="absolute right-0 top-full z-20 mt-1 min-w-[140px] rounded-[3px] border border-border bg-popover py-1 shadow-[0_12px_32px_rgba(0,0,0,0.32)]">
              <button
                onClick={() => {
                  setActionsOpen(false);
                  onEdit(job);
                }}
                className="flex min-h-[var(--row-unit)] w-full items-center gap-2 px-2.5 text-[0.867rem] text-foreground transition-colors duration-[120ms] hover:bg-raised max-sm:min-h-11"
                aria-label={`Edit ${name}`}
              >
                <Pencil size={14} className="text-muted-foreground" />
                <span>Edit</span>
              </button>
              <button
                onClick={handleDeleteClick}
                className={`flex min-h-[var(--row-unit)] w-full items-center gap-2 px-2.5 text-[0.867rem] transition-colors duration-[120ms] hover:bg-raised max-sm:min-h-11 ${
                  confirmingDelete ? 'text-destructive' : 'text-foreground hover:text-destructive'
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

      <div className="space-y-0.5 pb-2 pl-[1.917rem] pr-3 text-[0.8rem] leading-5 text-muted-foreground">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 truncate font-mono tabular" title={humanSchedule(job)}>{humanSchedule(job)}</span>
          {job.enabled && job.nextRun && (
            <span className="shrink-0 font-mono tabular">next {relativeUntil(job.nextRun)}</span>
          )}
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 truncate">{executionLabel}</span>
          <span className="shrink-0 font-mono tabular">
            {job.lastRun ? `Last ${relativeTime(job.lastRun)}` : 'No runs yet'}
          </span>
        </div>

        <div aria-live="polite" aria-atomic="true">
          {running && (
            <div className="text-live-text">Running now.</div>
          )}
          {job.lastError && !taskSucceeded && !running && (
            <div className="line-clamp-2 break-words text-destructive" title={job.lastError}>
              {job.lastError}
            </div>
          )}
          {isDeliveryFailure && !running && (
            <div className="line-clamp-2 break-words text-destructive" title={job.lastError}>
              Delivery failed. Check cron settings.
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border pb-1">
          {!runs.length && (
            <div className="flex min-h-[var(--row-unit)] items-center pl-[1.917rem] pr-3 text-[0.8rem] text-muted-foreground">
              No run history yet.
            </div>
          )}
          {runs.map((r, i) => {
            const runOk = r.status === 'success' || r.status === 'ok' || r.status === 'finished';
            const runPane: PaneState = runOk ? 'off' : 'error';
            return (
              <div key={i} className="pl-3 pr-3 text-[0.8rem]">
                <div className="flex min-h-[var(--row-unit)] min-w-0 items-center gap-2 text-muted-foreground">
                  <span className="grid w-[0.667rem] shrink-0 place-items-center">
                    <Pane state={runPane} size="sm" />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono tabular">{r.timestamp ? new Date(r.timestamp).toLocaleString() : 'Unknown time'}</span>
                  <span className={runOk ? 'shrink-0' : 'shrink-0 text-destructive'}>{r.status}</span>
                  {r.duration !== undefined && (
                    <span className="shrink-0 font-mono tabular">{Math.round(r.duration / 1000)}s</span>
                  )}
                </div>
                {r.error && (
                  <div className="pb-1 pl-[1.167rem] break-words text-destructive" title={r.error}>{r.error}</div>
                )}
                {r.summary && (
                  <div className="line-clamp-2 pb-1 pl-[1.167rem] text-foreground/80">{r.summary.slice(0, 150)}{r.summary.length > 150 ? '…' : ''}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Workspace tab listing cron jobs with create/edit/delete/toggle controls. */
export function CronsTab() {
  const { jobs, isLoading, error, cronWarning, fetchJobs, toggleJob, runJob, fetchRuns, addJob, updateJob, deleteJob } = useCrons();
  const { refreshSessions } = useSessionContext();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);

  const toolbarSummary = useMemo(() => {
    const enabledJobs = jobs.filter((job) => job.enabled);
    const failedCount = enabledJobs.filter((job) => {
      const status = job.lastStatus?.toLowerCase();
      return Boolean(status) && !['success', 'ok', 'finished'].includes(status!);
    }).length;
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

  const hasToolbarMeta = toolbarSummary.failedCount > 0
    || Boolean(toolbarSummary.nextRelative)
    || toolbarSummary.enabledCount > 0;

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
            {hasToolbarMeta ? (
              <>
                {toolbarSummary.failedCount > 0 && (
                  <span className="shrink-0 text-destructive">
                    {toolbarSummary.failedCount} failed
                  </span>
                )}
                {toolbarSummary.nextRelative ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0">Next run</span>
                    <span className="truncate font-mono tabular text-foreground">
                      {toolbarSummary.nextRelative}
                    </span>
                  </span>
                ) : toolbarSummary.enabledCount > 0 ? (
                  <span className="truncate">
                    <span className="font-mono tabular">{toolbarSummary.enabledCount}</span> enabled
                  </span>
                ) : (
                  <span className="truncate">
                    No enabled crons
                  </span>
                )}
              </>
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
          {error && !cronWarning && (
            <div className="px-3 py-2">
              <div className="cockpit-note" data-tone="danger">{error}</div>
            </div>
          )}
        </div>

        {cronWarning && (
          <div className="space-y-4 px-3 py-3 text-left text-[0.867rem] leading-relaxed">
            <div className="space-y-1">
              <div className="font-medium text-foreground">Cron unavailable</div>
              <p className="text-muted-foreground">
                {cronWarning}
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="font-medium text-foreground">Recommended fix</div>
              <p className="text-muted-foreground">
                Ask your agent to update your OpenClaw config (<code>openclaw.json</code>) so <code>gateway.tools.allow</code> includes:
              </p>
              <ul className="ml-5 list-disc space-y-1 text-muted-foreground">
                {CRON_GATEWAY_TOOL_ALLOWLIST.map((tool) => (
                  <li key={`recommended-${tool}`}><code>{tool}</code></li>
                ))}
              </ul>
              <p className="text-muted-foreground">Then restart the gateway.</p>
            </div>

            <div className="space-y-1.5">
              <div className="font-medium text-foreground">Manual fix</div>
              <p className="text-muted-foreground">
                Edit <code>openclaw.json</code> and add these entries to <code>gateway.tools.allow</code>:
              </p>
              <ul className="ml-5 list-disc space-y-1 text-muted-foreground">
                {CRON_GATEWAY_TOOL_ALLOWLIST.map((tool) => (
                  <li key={`manual-${tool}`}><code>{tool}</code></li>
                ))}
              </ul>
              <p className="text-muted-foreground">Then restart the gateway.</p>
            </div>

            <div className="space-y-1">
              <div className="font-medium text-foreground">Local install shortcut</div>
              <p className="text-muted-foreground">
                If this is a local install, rerun <code>npm run setup</code> to restore the missing entries.
              </p>
            </div>
          </div>
        )}

        {isLoading && !jobs.length && !error && !cronWarning && (
          <div className="flex min-h-[var(--row-unit)] items-center px-3 text-[0.8rem] text-muted-foreground">
            Loading crons…
          </div>
        )}

        {!isLoading && !jobs.length && !error && !cronWarning && (
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
