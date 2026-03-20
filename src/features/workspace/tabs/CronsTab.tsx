/**
 * CronsTab — Visual cron job management.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Play, Plus, Trash2, Pencil, ChevronDown, ChevronRight, CheckCircle, XCircle, Circle, Loader2, Settings2, Clock3 } from 'lucide-react';
import { useCrons, type CronJob, type CronRun } from '../hooks/useCrons';
import { CronDialog } from './CronDialog';
import { useSessionContext } from '@/contexts/SessionContext';

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
  const targetTone = job.payloadKind === 'agentTurn' ? 'primary' : 'warning';

  return (
    <div className="cockpit-surface p-2.5 sm:p-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-start justify-between gap-2.5">
              <div className="min-w-0 flex items-start gap-2">
              <button
                onClick={() => onToggle(job.id, !job.enabled)}
                className="shell-chip min-h-8 shrink-0 rounded-lg px-2.5 text-[0.667rem]"
                data-active={job.enabled ? 'true' : 'false'}
                title={job.enabled ? 'Pause job' : 'Enable job'}
                aria-label={`${job.enabled ? 'Pause' : 'Enable'} ${name}`}
              >
                <Circle
                  size={8}
                  fill={job.enabled ? 'currentColor' : 'none'}
                  className={job.enabled ? 'text-green' : 'text-muted-foreground'}
                />
                <span>{job.enabled ? 'Live' : 'Off'}</span>
              </button>
                <div className="min-w-0 space-y-0.5">
                  <div className="text-[0.833rem] font-semibold leading-tight text-foreground break-words">{name}</div>
                  <div className="text-[0.7rem] leading-4.5 text-muted-foreground">{humanSchedule(job)}</div>
                </div>
              </div>
              <div className="flex items-center gap-1 self-start">
                <button
                  onClick={handleRun}
                  disabled={running}
                  className="shell-icon-button size-9 px-0 disabled:cursor-wait disabled:opacity-60"
                  data-active={running ? 'true' : 'false'}
                  title={running ? 'Running…' : 'Run now'}
                  aria-label={`Run ${name}`}
                >
                  {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                </button>
                <button
                  onClick={handleExpand}
                  className="shell-icon-button size-9 px-0"
                  title={expanded ? 'Hide history' : 'Show history'}
                  aria-label={expanded ? 'Hide history' : 'Show history'}
                >
                  {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                <div ref={actionsRef} className="relative">
                  <button
                    onClick={() => setActionsOpen((open) => !open)}
                    className="shell-icon-button size-9 px-0"
                    title="Cron settings"
                    aria-label={`Cron settings for ${name}`}
                    aria-expanded={actionsOpen}
                  >
                    <Settings2 size={13} />
                  </button>
                  {actionsOpen && (
                    <div className="shell-panel absolute right-0 top-full z-20 mt-1.5 min-w-[132px] rounded-xl p-1">
                      <button
                        onClick={() => {
                          setActionsOpen(false);
                          onEdit(job);
                        }}
                        className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[0.7rem] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
                        aria-label={`Edit ${name}`}
                      >
                        <Pencil size={12} />
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={handleDeleteClick}
                        className={`flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[0.7rem] font-medium transition-colors ${
                          confirmingDelete
                            ? 'text-red hover:bg-red/10 hover:text-red'
                            : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-red'
                        }`}
                        aria-label={confirmingDelete ? `Confirm delete ${name}` : `Delete ${name}`}
                      >
                        <Trash2 size={12} />
                        <span>{confirmingDelete ? 'Confirm delete' : 'Delete'}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="cockpit-badge min-h-6 px-2 text-[0.667rem]" data-tone={targetTone}>
                {executionLabel}
              </span>
              <span className="min-w-0 truncate text-right text-[0.667rem] text-muted-foreground">
                {job.lastRun ? `Last ${relativeTime(job.lastRun)}` : 'No runs yet'}
              </span>
            </div>

            <div aria-live="polite" aria-atomic="true" className="space-y-1">
              {running && (
                <div className="text-[0.7rem] text-primary flex items-center gap-1.5">
                  <Loader2 size={10} className="animate-spin" />
                  <span>Running now.</span>
                </div>
              )}
              {job.lastError && !taskSucceeded && !running && (
                <div className="text-[0.7rem] text-red/80 truncate" title={job.lastError}>
                  {job.lastError}
                </div>
              )}
              {isDeliveryFailure && !running && (
                <div className="text-[0.7rem] text-orange/80 truncate" title={job.lastError}>
                  Delivery failed. Check cron settings.
                </div>
              )}
            </div>
          </div>
        </div>
        {expanded && (
          <div className="space-y-1.5">
            <div className="cockpit-divider" />
            <div className="space-y-1.5">
              {!runs.length && (
                <div className="text-[0.7rem] text-muted-foreground">
                  No run history yet.
                </div>
              )}
              {runs.map((r, i) => {
                const runOk = r.status === 'success' || r.status === 'ok' || r.status === 'finished';
                return (
                  <div key={i} className="rounded-lg border border-border/60 bg-background/30 px-2.5 py-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-[0.667rem] text-muted-foreground">
                        <span className="tabular-nums">{r.timestamp ? new Date(r.timestamp).toLocaleString() : '—'}</span>
                        <span className="cockpit-badge min-h-6 px-2 text-[0.667rem]" data-tone={runOk ? 'success' : 'danger'}>
                          {runOk ? <CheckCircle size={10} /> : <XCircle size={10} />}
                          {r.status}
                        </span>
                        {r.duration !== undefined && (
                          <span className="cockpit-badge min-h-6 px-2 text-[0.667rem] tabular-nums">{Math.round(r.duration / 1000)}s</span>
                        )}
                      </div>
                      {r.error && (
                        <div className="text-[0.7rem] text-red/80 break-words" title={r.error}>{r.error}</div>
                      )}
                      {r.summary && (
                        <div className="text-[0.7rem] leading-4.5 text-foreground/70 line-clamp-2">{r.summary.slice(0, 150)}{r.summary.length > 150 ? '…' : ''}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Workspace tab listing cron jobs with create/edit/delete/toggle controls. */
export function CronsTab() {
  const { jobs, isLoading, error, fetchJobs, toggleJob, runJob, fetchRuns, addJob, updateJob, deleteJob } = useCrons();
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
        <div className="space-y-2 px-2.5 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-1.5 overflow-hidden">
              {hasToolbarMeta ? (
                <>
                  {toolbarSummary.failedCount > 0 && (
                    <span className="cockpit-badge min-h-6 px-2 text-[0.667rem]" data-tone="danger">
                      {toolbarSummary.failedCount} failed
                    </span>
                  )}
                  {toolbarSummary.nextRelative ? (
                    <div className="shell-panel flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1">
                      <span className="cockpit-kicker shrink-0 text-[0.5rem] tracking-[0.16em]">
                        <Clock3 size={10} className="text-primary" />
                        Next run
                      </span>
                      <span className="cockpit-badge min-h-5 shrink-0 px-1.5 text-[0.6rem]" data-tone="primary">
                        {toolbarSummary.nextRelative}
                      </span>
                    </div>
                  ) : toolbarSummary.enabledCount > 0 ? (
                    <span className="cockpit-badge min-h-6 px-2 text-[0.667rem]" data-tone="success">
                      {toolbarSummary.enabledCount} live
                    </span>
                  ) : (
                    <span className="text-[0.7rem] text-muted-foreground">
                      No live crons
                    </span>
                  )}
                </>
              ) : null}
            </div>
            <div className="shell-panel inline-flex items-center gap-1 rounded-xl px-1 py-1">
              <button
                type="button"
                onClick={handleAdd}
                aria-label="Add cron job"
                title="Add cron job"
                className="shell-chip min-h-8 rounded-lg px-2.5 text-[0.7rem] font-medium"
              >
                <Plus size={13} />
                <span>New cron</span>
              </button>
              <button
                type="button"
                onClick={fetchJobs}
                disabled={isLoading}
                aria-label="Refresh crons"
                title="Refresh crons"
                className="shell-icon-button size-8 px-0 disabled:opacity-60"
              >
                <RefreshCw size={13} className={isLoading ? 'animate-spin' : undefined} />
              </button>
            </div>
          </div>

          <div aria-live="polite" aria-atomic="true">
            {error && (
              <div className="cockpit-note px-3 py-2 text-[0.733rem]" data-tone="danger">{error}</div>
            )}
          </div>

          {isLoading && !jobs.length && !error && (
            <div className="space-y-2">
              <div className="cockpit-surface h-20 animate-pulse" />
              <div className="cockpit-surface h-20 animate-pulse" />
              <div className="cockpit-surface h-20 animate-pulse" />
            </div>
          )}

          {!isLoading && !jobs.length && !error && (
            <div className="cockpit-surface px-4 py-5 text-center">
              <div className="space-y-1">
                <div className="text-[0.833rem] font-medium text-foreground">No scheduled tasks yet</div>
                <p className="text-[0.733rem] leading-4.5 text-muted-foreground">
                  Create one to schedule a private task or a main-thread reminder.
                </p>
              </div>
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
