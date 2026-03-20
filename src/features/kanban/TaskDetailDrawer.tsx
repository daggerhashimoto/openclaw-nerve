import { useState, useCallback, useEffect, useRef } from 'react';
import {
  X, Play, CheckCircle2, XCircle, Trash2, Save, Loader2,
  Clock, User, Tag, AlertTriangle, MessageSquare, StopCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { COLUMN_LABELS, type KanbanTask, type TaskStatus, type TaskPriority } from './types';
import type { UpdateTaskPayload, VersionConflictError } from './hooks/useKanban';
import { getTaskPriorityLabel, getTaskPriorityTone, getTaskRunTone, getTaskStatusTone, getTaskPriority, getTaskStatus } from './tone';

/* ── Elapsed time helper ── */
function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

function RunElapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="text-[0.667rem] text-muted-foreground tabular-nums">
      {formatElapsed(now - startedAt)}
    </span>
  );
}

interface TaskDetailDrawerProps {
  task: KanbanTask | null;
  onClose: () => void;
  onUpdate: (id: string, payload: UpdateTaskPayload) => Promise<KanbanTask>;
  onDelete: (id: string) => Promise<void>;
  onExecute?: (id: string, options?: { model?: string; thinking?: string }) => Promise<KanbanTask>;
  onApprove?: (id: string, note?: string) => Promise<KanbanTask>;
  onReject?: (id: string, note: string) => Promise<KanbanTask>;
  onAbort?: (id: string, note?: string) => Promise<KanbanTask>;
}

export function TaskDetailDrawer({ task, onClose, onUpdate, onDelete, onExecute, onApprove, onReject, onAbort }: TaskDetailDrawerProps) {
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState<TaskStatus>('todo');
  const [editPriority, setEditPriority] = useState<TaskPriority>('normal');
  const [editLabels, setEditLabels] = useState('');
  const [editAssignee, setEditAssignee] = useState('');
  const [editVersion, setEditVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  /* Populate fields when task changes */
  useEffect(() => {
    if (task) {
      setEditTitle(task.title);
      setEditDescription(task.description || '');
      setEditStatus(getTaskStatus(task.status));
      setEditPriority(getTaskPriority(task.priority));
      setEditLabels(task.labels.join(', '));
      setEditAssignee(task.assignee || '');
      setEditVersion(task.version);
      setError(null);
      setDirty(false);
      setConfirmDelete(false);
    }
  }, [task]);

  /* Safe close — warn on unsaved changes */
  const safeClose = useCallback(() => {
    if (dirty && !window.confirm('You have unsaved changes. Discard?')) return;
    onClose();
  }, [dirty, onClose]);

  /* Close on Escape */
  useEffect(() => {
    if (!task) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') safeClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [task, safeClose]);

  const markDirty = useCallback(() => setDirty(true), []);

  const handleSave = useCallback(async () => {
    if (!task || saving) return;
    setSaving(true);
    setError(null);
    try {
      const labels = editLabels
        .split(',')
        .map(l => l.trim())
        .filter(Boolean);
      await onUpdate(task.id, {
        title: editTitle.trim(),
        description: editDescription.trim() || null,
        status: editStatus,
        priority: editPriority,
        labels,
        assignee: editAssignee.trim() || null,
        version: editVersion,
      });
      setDirty(false);
    } catch (err) {
      if (err instanceof Error && err.message === 'version_conflict') {
        const latest = (err as VersionConflictError).latest;
        if (latest) {
          // Refresh drawer fields with latest server state so user can retry
          setEditTitle(latest.title);
          setEditDescription(latest.description || '');
          setEditStatus(getTaskStatus(latest.status));
          setEditPriority(getTaskPriority(latest.priority));
          setEditLabels(latest.labels.join(', '));
          setEditAssignee(latest.assignee || '');
          setEditVersion(latest.version);
        }
        setError('Task was modified elsewhere. Fields refreshed to latest version -- review and save again.');
        setDirty(false);
      } else {
        setError(err instanceof Error ? err.message : 'Save failed');
      }
    } finally {
      setSaving(false);
    }
  }, [task, saving, editTitle, editDescription, editStatus, editPriority, editLabels, editAssignee, editVersion, onUpdate]);

  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = useCallback(async () => {
    if (!task || deleting) return;
    setDeleting(true);
    try {
      await onDelete(task.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [task, deleting, onDelete, onClose]);

  /* ── Workflow action state ── */
  const [workflowLoading, setWorkflowLoading] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  const handleExecute = useCallback(async () => {
    if (!task || !onExecute || workflowLoading) return;
    setWorkflowLoading('execute');
    setError(null);
    try {
      await onExecute(task.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execute failed');
    } finally {
      setWorkflowLoading(null);
    }
  }, [task, onExecute, workflowLoading]);

  const handleApprove = useCallback(async () => {
    if (!task || !onApprove || workflowLoading) return;
    setWorkflowLoading('approve');
    setError(null);
    try {
      await onApprove(task.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setWorkflowLoading(null);
    }
  }, [task, onApprove, workflowLoading]);

  const handleReject = useCallback(async () => {
    if (!task || !onReject || workflowLoading) return;
    if (!showRejectInput) {
      setShowRejectInput(true);
      return;
    }
    if (!rejectNote.trim()) return;
    setWorkflowLoading('reject');
    setError(null);
    try {
      await onReject(task.id, rejectNote.trim());
      setShowRejectInput(false);
      setRejectNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setWorkflowLoading(null);
    }
  }, [task, onReject, workflowLoading, showRejectInput, rejectNote]);

  const handleAbort = useCallback(async () => {
    if (!task || !onAbort || workflowLoading) return;
    setWorkflowLoading('abort');
    setError(null);
    try {
      await onAbort(task.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Abort failed');
    } finally {
      setWorkflowLoading(null);
    }
  }, [task, onAbort, workflowLoading]);

  /* Reset reject input when task changes */
  useEffect(() => {
    setShowRejectInput(false);
    setRejectNote('');
    setWorkflowLoading(null);
  }, [task?.id]);

  const isOpen = task !== null;

  const selectClass = 'cockpit-select h-11 text-sm';
  const priorityTone = task ? getTaskPriorityTone(editPriority) : null;

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 transition-opacity duration-200"
          onClick={safeClose}
        />
      )}

      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Task details"
        className={`shell-panel fixed top-0 right-0 z-50 flex h-full w-[min(92vw,520px)] max-w-full flex-col overflow-hidden rounded-l-[32px] border-l border-border/70 shadow-[0_28px_72px_rgba(0,0,0,0.36)] transition-transform duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {task && (
          <>
            <div className="panel-header min-h-[56px] justify-between gap-3 px-4">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[0.667rem] font-semibold ${getTaskStatusTone(task.status).badgeClass}`}>
                  {COLUMN_LABELS[task.status as keyof typeof COLUMN_LABELS] ?? 'Task'}
                </span>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[0.667rem] font-semibold ${priorityTone?.badgeClass ?? ''}`}>
                  {getTaskPriorityLabel(editPriority)}
                </span>
              </div>
              <button
                onClick={safeClose}
                className="shell-icon-button size-9 px-0"
                aria-label="Close drawer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {error && (
                <div className="cockpit-note flex items-center gap-2 text-sm" data-tone="danger">
                  <AlertTriangle size={12} />
                  {error}
                </div>
              )}

              <div className="cockpit-surface p-4 space-y-4">
                <div>
                  <label htmlFor="kb-title" className="cockpit-field-label mb-2 block">
                    Title
                  </label>
                  <Input
                    id="kb-title"
                    value={editTitle}
                    onChange={e => { setEditTitle(e.target.value); markDirty(); }}
                    maxLength={500}
                    className="cockpit-input h-11 text-sm font-semibold"
                  />
                </div>

                <div>
                  <label htmlFor="kb-description" className="cockpit-field-label mb-2 block">
                    Description
                  </label>
                  <textarea
                    id="kb-description"
                    value={editDescription}
                    onChange={e => { setEditDescription(e.target.value); markDirty(); }}
                    placeholder="Markdown description…"
                    rows={8}
                    className="cockpit-textarea min-h-[180px]"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="kb-status" className="cockpit-field-label mb-2 block">
                      Status
                    </label>
                    <select
                      id="kb-status"
                      value={editStatus}
                      onChange={e => { setEditStatus(e.target.value as TaskStatus); markDirty(); }}
                      className={selectClass}
                    >
                      {Object.entries(COLUMN_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="kb-priority" className="cockpit-field-label mb-2 block">
                      Priority
                    </label>
                    <select
                      id="kb-priority"
                      value={editPriority}
                      onChange={e => { setEditPriority(getTaskPriority(e.target.value)); markDirty(); }}
                      className={selectClass}
                    >
                      {(['critical', 'high', 'normal', 'low'] as TaskPriority[]).map(p => (
                        <option key={p} value={p}>{getTaskPriorityLabel(p)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="kb-labels" className="cockpit-field-label mb-2 block">
                      <Tag size={10} className="mr-1 inline" />
                      Labels
                    </label>
                    <Input
                      id="kb-labels"
                      value={editLabels}
                      onChange={e => { setEditLabels(e.target.value); markDirty(); }}
                      placeholder="bug, urgent"
                      className="cockpit-input h-11"
                    />
                  </div>
                  <div>
                    <label htmlFor="kb-assignee" className="cockpit-field-label mb-2 block">
                      <User size={10} className="mr-1 inline" />
                      Assignee
                    </label>
                    <Input
                      id="kb-assignee"
                      value={editAssignee}
                      onChange={e => { setEditAssignee(e.target.value); markDirty(); }}
                      placeholder="operator"
                      className="cockpit-input h-11"
                    />
                  </div>
                </div>
              </div>

              <div className="cockpit-note space-y-2">
                <h4 className="cockpit-field-label">Metadata</h4>
                <div className="space-y-1 text-[0.733rem] text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Clock size={10} />
                    Created: {new Date(task.createdAt).toLocaleString()}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock size={10} />
                    Updated: {new Date(task.updatedAt).toLocaleString()}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <User size={10} />
                    By: {task.createdBy === 'operator' ? 'Operator' : task.createdBy}
                  </div>
                </div>
              </div>

              {task.run && (
                <div className="cockpit-note space-y-2">
                  <h4 className="cockpit-field-label">Agent Run</h4>
                  <div className="space-y-1.5 text-[0.733rem] text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[0.667rem] font-semibold ${getTaskRunTone(task.run.status).badgeClass}`}>
                        {task.run.status === 'running' && <Loader2 size={9} className="animate-spin" />}
                        {task.run.status.charAt(0).toUpperCase() + task.run.status.slice(1)}
                      </span>
                      {task.run.status === 'running' && task.run.startedAt && (
                        <RunElapsed startedAt={task.run.startedAt} />
                      )}
                    </div>
                    <div>
                      Session:{' '}
                      <code className="cockpit-kbd select-all cursor-pointer">{task.run.sessionKey}</code>
                    </div>
                    {task.run.startedAt && (
                      <div>Started: {new Date(task.run.startedAt).toLocaleString()}</div>
                    )}
                    {task.run.endedAt && (
                      <div>Ended: {new Date(task.run.endedAt).toLocaleString()}</div>
                    )}
                    {task.run.error && (
                      <div className="break-words text-destructive">Error: {task.run.error}</div>
                    )}
                  </div>
                </div>
              )}

              {task.result && (
                <div className="cockpit-note space-y-2">
                  <h4 className="cockpit-field-label">Result</h4>
                  <div className="whitespace-pre-wrap rounded-2xl border border-border/60 bg-background/45 p-3 text-xs text-foreground">
                    {task.result}
                  </div>
                </div>
              )}

              {task.feedback.length > 0 && (
                <div className="cockpit-note space-y-3">
                  <h4 className="cockpit-field-label">
                    <MessageSquare size={10} className="mr-1 inline" />
                    Feedback
                  </h4>
                  <div className="space-y-2">
                    {task.feedback.map((fb, i) => (
                      <div key={i} className="rounded-2xl border border-border/60 bg-background/45 p-3 text-xs">
                        <div className="mb-1 flex items-center justify-between text-[0.667rem] text-muted-foreground">
                          <span>{fb.by === 'operator' ? 'Operator' : fb.by}</span>
                          <span>{new Date(fb.at).toLocaleString()}</span>
                        </div>
                        <p className="text-foreground">{fb.note}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-border/60 bg-background/88 px-4 py-3 backdrop-blur-sm">
              {/* Reject note input */}
              {showRejectInput && (
                <div className="mb-3 flex items-center gap-2">
                  <Input
                    value={rejectNote}
                    onChange={e => setRejectNote(e.target.value)}
                    placeholder="Rejection reason (required)…"
                    className="cockpit-input h-10 flex-1 text-sm"
                    onKeyDown={e => { if (e.key === 'Enter') handleReject(); if (e.key === 'Escape') { setShowRejectInput(false); setRejectNote(''); } }}
                    autoFocus
                  />
                  <Button size="xs" variant="outline" onClick={() => { setShowRejectInput(false); setRejectNote(''); }}>
                    Cancel
                  </Button>
                </div>
              )}

              <div className="flex items-center gap-2">
              {/* Workflow actions */}
              {(task.status === 'backlog' || task.status === 'todo') && onExecute && (
                <Button size="xs" onClick={handleExecute} disabled={workflowLoading !== null}>
                  {workflowLoading === 'execute' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                  Execute
                </Button>
              )}
              {task.status === 'in-progress' && task.run?.status === 'running' && onAbort && (
                <Button size="xs" variant="outline" onClick={handleAbort} disabled={workflowLoading !== null} className="border-orange/30 bg-orange/8 text-orange hover:bg-orange/12">
                  {workflowLoading === 'abort' ? <Loader2 size={12} className="animate-spin" /> : <StopCircle size={12} />}
                  Abort
                </Button>
              )}
              {task.status === 'review' && (
                <>
                  {onApprove && (
                    <Button size="xs" variant="outline" onClick={handleApprove} disabled={workflowLoading !== null} className="border-green/30 bg-green/8 text-green hover:bg-green/12">
                      {workflowLoading === 'approve' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                      Approve
                    </Button>
                  )}
                  {onReject && (
                    <Button size="xs" variant="outline" onClick={handleReject} disabled={workflowLoading !== null || (showRejectInput && !rejectNote.trim())} className="border-destructive/30 bg-destructive/8 text-destructive hover:bg-destructive/12">
                      {workflowLoading === 'reject' ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                      Reject
                    </Button>
                  )}
                </>
              )}

              <div className="flex-1" />

              {confirmDelete ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-[0.733rem] text-destructive font-medium">Delete?</span>
                  <Button
                    size="xs"
                    variant="destructive"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? <Loader2 size={12} className="animate-spin" /> : 'Yes'}
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                  >
                    No
                  </Button>
                </span>
              ) : (
                <Button
                  size="xs"
                  variant="destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={12} />
                  Delete
                </Button>
              )}

              <Button
                size="xs"
                onClick={handleSave}
                disabled={!dirty || saving}
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                Save
              </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
