/**
 * CronsTab — Visual cron job management.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw, Play, Plus, Trash2, Pencil, ChevronDown, ChevronRight, CheckCircle, XCircle, AlertTriangle, Circle, Loader2 } from 'lucide-react';
import { useCrons, type CronJob, type CronRun } from '../hooks/useCrons';
import { CronDialog } from './CronDialog';
import { useSessionContext } from '@/contexts/SessionContext';
import { getRootAgentId, getSessionDisplayLabel } from '@/features/sessions/sessionKeys';
import { getSessionKey } from '@/types';

type CronRowJob = CronJob & { targetLabel?: string };

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
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Cleanup delete confirmation timer
  useEffect(() => () => clearTimeout(deleteTimerRef.current), []);

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
      await onRun(job.id);
    } finally {
      setRunning(false);
    }
  }, [job.id, onRun]);

  const handleDeleteClick = useCallback(() => {
    if (confirmingDelete) {
      clearTimeout(deleteTimerRef.current);
      setConfirmingDelete(false);
      onDelete(job.id);
    } else {
      setConfirmingDelete(true);
      deleteTimerRef.current = setTimeout(() => setConfirmingDelete(false), 3000);
    }
  }, [confirmingDelete, job.id, onDelete]);

  const name = job.name || job.label || job.id;
  const targetLabel = job.targetLabel;
  const isSuccess = job.lastStatus === 'success' || job.lastStatus === 'ok' || job.lastStatus === 'finished';
  // Detect delivery-only failures: task ran but delivery failed
  const errorLower = job.lastError?.toLowerCase() ?? '';
  const isDeliveryFailure = !isSuccess && (
    errorLower.includes('channel is required')
    || (job.lastDeliveryStatus === 'error' && errorLower.includes('channel'))
    || errorLower.includes('delivery')
  );
  const taskSucceeded = isSuccess || isDeliveryFailure;

  return (
    <div className="border-b border-border/40">
      <div className="px-3 py-2 flex items-start gap-2">
        <button
          onClick={() => onToggle(job.id, !job.enabled)}
          className="flex-shrink-0 mt-1 bg-transparent border-0 cursor-pointer p-0 focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0 rounded-sm"
          title={job.enabled ? 'Disable' : 'Enable'}
          aria-label={`${job.enabled ? 'Disable' : 'Enable'} ${name}`}
        >
          {job.enabled
            ? <Circle size={8} fill="currentColor" className="text-green" />
            : <Circle size={8} className="text-muted-foreground" />
          }
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-foreground leading-tight truncate">{name}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">{humanSchedule(job)}</div>
          {targetLabel && (
            <div className="text-[10px] text-muted-foreground mt-0.5">
              Target: {targetLabel} · {job.payloadKind === 'agentTurn' ? 'private run' : 'root event'}
            </div>
          )}
          {job.lastRun && (
            <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
              <span>Last run: {relativeTime(job.lastRun)}</span>
              {job.lastStatus && (
                isDeliveryFailure ? (
                  <span className="flex items-center gap-0.5 text-orange" title="Task completed but delivery failed">
                    — <CheckCircle size={9} className="text-green" /> <AlertTriangle size={9} /> delivery failed
                  </span>
                ) : (
                  <span className={`flex items-center gap-0.5 ${isSuccess ? 'text-green' : 'text-red'}`}>
                    — {isSuccess ? <CheckCircle size={9} /> : <XCircle size={9} />} {job.lastStatus}
                  </span>
                )
              )}
            </div>
          )}
          {/* aria-live region for running status and errors */}
          <div aria-live="polite" aria-atomic="true">
            {running && (
              <div className="text-[10px] text-purple mt-0.5 flex items-center gap-1">
                <Loader2 size={8} className="animate-spin" />
                <span>Running…</span>
              </div>
            )}
            {job.lastError && !taskSucceeded && !running && (
              <div className="text-[10px] text-red/70 mt-0.5 truncate" title={job.lastError}>
                {job.lastError}
              </div>
            )}
            {isDeliveryFailure && !running && (
              <div className="text-[10px] text-orange/70 mt-0.5 truncate" title={job.lastError}>
                Delivery failed — check channel config in cron settings
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!job.enabled && (
            <span className="text-[10px] text-muted-foreground">Disabled</span>
          )}
          <button
            onClick={() => onEdit(job)}
            className="bg-transparent border border-border/60 text-muted-foreground w-6 h-6 cursor-pointer flex items-center justify-center hover:text-purple hover:border-purple transition-colors focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0"
            title="Edit"
            aria-label={`Edit ${name}`}
          >
            <Pencil size={10} />
          </button>
          <button
            onClick={handleRun}
            disabled={running}
            className={`bg-transparent border border-border/60 w-6 h-6 cursor-pointer flex items-center justify-center transition-colors disabled:cursor-wait focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0 ${running ? 'text-purple border-purple' : 'text-muted-foreground hover:text-purple hover:border-purple'}`}
            title={running ? 'Running…' : 'Run now'}
            aria-label={`Run ${name}`}
          >
            {running ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
          </button>
          <button
            onClick={handleDeleteClick}
            className={`bg-transparent border w-6 h-6 cursor-pointer flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0 ${
              confirmingDelete
                ? 'border-red bg-red/20 text-red'
                : 'border-border/60 text-muted-foreground hover:text-red hover:border-red'
            }`}
            title={confirmingDelete ? 'Click again to confirm' : 'Delete'}
            aria-label={confirmingDelete ? `Confirm delete ${name}` : `Delete ${name}`}
          >
            {confirmingDelete
              ? <span className="text-[8px] font-bold">Sure?</span>
              : <Trash2 size={10} />
            }
          </button>
          <button
            onClick={handleExpand}
            className="bg-transparent border border-transparent text-muted-foreground cursor-pointer p-0.5 focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0 rounded-sm"
            aria-label={expanded ? 'Hide history' : 'Show history'}
          >
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-2 pl-8">
          {!runs.length && <div className="text-[10px] text-muted-foreground">No run history</div>}
          {runs.map((r, i) => {
            const runOk = r.status === 'success' || r.status === 'ok' || r.status === 'finished';
            return (
              <div key={i} className="text-[10px] text-muted-foreground py-1 border-b border-border/20 last:border-0">
                <div className="flex gap-2 items-center">
                  <span className="tabular-nums">{r.timestamp ? new Date(r.timestamp).toLocaleString() : '—'}</span>
                  <span className={`flex items-center gap-0.5 ${runOk ? 'text-green' : 'text-red'}`}>
                    {runOk ? <CheckCircle size={8} /> : <XCircle size={8} />} {r.status}
                  </span>
                  {r.duration !== undefined && <span className="tabular-nums">{Math.round(r.duration / 1000)}s</span>}
                </div>
                {r.error && <div className="text-red mt-0.5 truncate" title={r.error}>{r.error}</div>}
                {r.summary && <div className="text-foreground/60 mt-0.5 line-clamp-2">{r.summary.slice(0, 150)}{r.summary.length > 150 ? '…' : ''}</div>}
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
  const { jobs, isLoading, error, fetchJobs, toggleJob, runJob, fetchRuns, addJob, updateJob, deleteJob } = useCrons();
  const { sessions, agentName } = useSessionContext();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);

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

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto">
        {/* aria-live region for error display */}
        <div aria-live="polite" aria-atomic="true">
          {error && (
            <div className="px-3 py-2 text-[10px] text-red bg-red/10">{error}</div>
          )}
        </div>

        {/* Loading skeleton */}
        {isLoading && !jobs.length && !error && (
          <div className="space-y-2 py-2">
            <div className="h-10 bg-muted/20 animate-pulse rounded mx-3" />
            <div className="h-10 bg-muted/20 animate-pulse rounded mx-3" />
            <div className="h-10 bg-muted/20 animate-pulse rounded mx-3" />
          </div>
        )}

        {/* Add + Refresh row */}
        {!isLoading && (
          <div className="flex items-center border-b border-border/40">
            <button
              onClick={handleAdd}
              className="group flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-foreground/[0.02] transition-colors cursor-pointer flex-1 bg-transparent border-0 text-left focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0"
              aria-label="Add cron job"
            >
              <span className="shrink-0 text-muted-foreground group-hover:text-purple transition-colors">
                <Plus size={12} />
              </span>
              <span className="text-muted-foreground group-hover:text-purple transition-colors">
                Add cron
              </span>
            </button>
            <button
              onClick={fetchJobs}
              disabled={isLoading}
              className="shrink-0 px-2 py-1.5 bg-transparent border-0 text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0"
              title="Refresh crons"
              aria-label="Refresh crons"
            >
              <RefreshCw size={10} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !jobs.length && !error && (
          <div className="text-muted-foreground px-3 py-6 text-center text-[11px]">
            No scheduled tasks yet
          </div>
        )}
        {jobs.map(job => {
          const targetSession = sessions.find((session) => getSessionKey(session) === job.sessionKey);
          const fallbackRootId = job.sessionKey ? getRootAgentId(job.sessionKey) : null;
          const targetLabel = targetSession
            ? getSessionDisplayLabel(targetSession, agentName)
            : fallbackRootId === 'main'
              ? `${agentName} (main)`
              : fallbackRootId
                ? `Agent ${fallbackRootId}`
                : 'Unassigned';

          return (
            <CronRow
              key={job.id}
              job={{ ...job, targetLabel }}
              onToggle={toggleJob}
              onRun={runJob}
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
