import { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import {
  X, Play, CheckCircle2, XCircle, Trash2, Save, Loader2, StopCircle, Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pane } from '@/components/ui/Pane';
import { paneStateLabel } from '@/lib/paneState';
import { useAgentHues } from '@/lib/agentColors';
import { useSessionContext } from '@/contexts/SessionContext';
import { COLUMN_LABELS, type KanbanTask, type TaskStatus, type TaskPriority } from './types';
import type { UpdateTaskPayload, VersionConflictError } from './hooks/useKanban';
import { AssigneeCombobox } from './components/AssigneeCombobox';
import { buildAssigneeOptionsForEdit } from './lib/assigneeOptions';
import {
  RUN_WORD, RUN_WORD_CLASS, assigneeAgentId, columnTitle, getTaskPriorityLabel, getTaskPriority, getTaskRunStatus,
  getTaskStatus, runPaneState, taskPaneState,
} from './tone';

const MarkdownRenderer = lazy(() =>
  import('@/features/markdown/MarkdownRenderer').then(m => ({ default: m.MarkdownRenderer })),
);

const NO_IDS: readonly string[] = [];

/* Elapsed time helper */
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
    <span className="font-mono text-[0.8rem] text-live-text tabular">
      {formatElapsed(now - startedAt)}
    </span>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-foreground">{children}</span>
    </>
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

/**
 * The task's room: a floating Panel drawer on the right with the edge light along its inner
 * edge. The header carries the task's pane (its light temperature, the assignee's hue in the
 * glass), the body is a flat form with the description as an operator window, then the
 * details, the run and the result in sections; the footer holds the workflow actions.
 */
export function TaskDetailDrawer({ task, onClose, onUpdate, onDelete, onExecute, onApprove, onReject, onAbort }: TaskDetailDrawerProps) {
  const { sessions, agentName } = useSessionContext();
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
  const [descriptionEditing, setDescriptionEditing] = useState(true);
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
      setDescriptionEditing(true);
      setConfirmDelete(false);
    }
  }, [task]);

  /* Safe close: warn on unsaved changes */
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

  /* Workflow action state */
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
  const assigneeOptions = useMemo(
    () => buildAssigneeOptionsForEdit(sessions, task?.assignee ?? null, agentName),
    [agentName, sessions, task?.assignee],
  );

  /* Identity: the assignee's family hue sits in the glass of the header pane */
  const assigneeId = assigneeAgentId(task?.assignee);
  const hueIds = useMemo(() => (assigneeId ? [assigneeId] : NO_IDS), [assigneeId]);
  const { hueFor } = useAgentHues(hueIds);
  const hue = assigneeId ? hueFor(assigneeId) : undefined;

  const paneState = task ? taskPaneState(task) : 'off';
  const runStatus = task?.run ? getTaskRunStatus(task.run.status) : null;
  const selectClass = 'cockpit-select h-11 sm:h-[2.133rem]';

  return (
    <>
      {/* Backdrop: the room dims, nothing blurs */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/60 transition-opacity duration-200"
          onClick={safeClose}
        />
      )}

      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Task details"
        className={`nerve-drawer fixed right-0 top-0 z-50 flex h-full w-[min(92vw,520px)] max-w-full flex-col overflow-hidden transition-transform duration-[220ms] ease-[var(--arrive-ease)] ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {task && (
          <>
            {/* Header: the task's pane, where it stands, and its priority */}
            <div className="flex min-h-[2.933rem] shrink-0 items-center gap-2 border-b border-border pl-4 pr-2">
              <Pane state={paneState} hue={hue} label={paneStateLabel(paneState)} />
              <span className="min-w-0 flex-1 truncate text-[0.867rem] text-foreground">
                {columnTitle(task.status)}
                <span className="text-muted-foreground"> · {getTaskPriorityLabel(editPriority)} priority</span>
              </span>
              <button
                onClick={safeClose}
                className="shell-icon-button"
                aria-label="Close drawer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
              {error && (
                <div className="cockpit-note" data-tone="danger">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                <div className="cockpit-field">
                  <label htmlFor="kb-title" className="cockpit-field-label">Title</label>
                  <Input
                    id="kb-title"
                    value={editTitle}
                    onChange={e => { setEditTitle(e.target.value); markDirty(); }}
                    maxLength={500}
                    className="cockpit-input h-11 font-medium sm:h-[2.133rem]"
                  />
                </div>

                <div className="cockpit-field">
                  <div className="flex items-center justify-between">
                    <label htmlFor="kb-description" className="cockpit-field-label">Description</label>
                    <button
                      type="button"
                      aria-label="Toggle description edit mode"
                      aria-pressed={descriptionEditing}
                      onClick={() => setDescriptionEditing(v => !v)}
                      className="shell-icon-button"
                      data-active={descriptionEditing ? 'true' : 'false'}
                      title={descriptionEditing ? 'Preview' : 'Edit'}
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                  {descriptionEditing ? (
                    /* The description is an operator window: Plate at rest, warm while you type */
                    <div className="nerve-window-frame">
                      <div className="nerve-window rounded-[3px]">
                        <textarea
                          id="kb-description"
                          value={editDescription}
                          onChange={e => { setEditDescription(e.target.value); markDirty(); }}
                          placeholder="Markdown description"
                          rows={8}
                          className="block min-h-[180px] w-full resize-y border-0 bg-transparent px-3 py-2 text-[0.867rem] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="min-h-[180px] rounded-[3px] bg-plate p-3 text-[0.867rem] text-foreground">
                      <Suspense fallback={<div className="whitespace-pre-wrap">{editDescription}</div>}>
                        <MarkdownRenderer content={editDescription} suppressImages />
                      </Suspense>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="cockpit-field">
                    <label htmlFor="kb-status" className="cockpit-field-label">Status</label>
                    <select
                      id="kb-status"
                      value={editStatus}
                      onChange={e => { setEditStatus(e.target.value as TaskStatus); markDirty(); }}
                      className={selectClass}
                    >
                      {Object.entries(COLUMN_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{columnTitle(val, label)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="cockpit-field">
                    <label htmlFor="kb-priority" className="cockpit-field-label">Priority</label>
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
                  <div className="cockpit-field">
                    <label htmlFor="kb-labels" className="cockpit-field-label">Labels</label>
                    <Input
                      id="kb-labels"
                      value={editLabels}
                      onChange={e => { setEditLabels(e.target.value); markDirty(); }}
                      placeholder="bug, urgent"
                      className="cockpit-input h-11 sm:h-[2.133rem]"
                    />
                  </div>
                  <div className="cockpit-field">
                    <label htmlFor="kb-assignee" className="cockpit-field-label">Assignee</label>
                    <AssigneeCombobox
                      id="kb-assignee"
                      value={editAssignee}
                      onChange={(nextValue) => { setEditAssignee(nextValue); markDirty(); }}
                      options={assigneeOptions}
                      ariaLabel="Assignee"
                      placeholder="Select assignee"
                      noResultsText="No matching assignees"
                      inline
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="settings-heading">Details</h3>
                <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-[0.8rem]">
                  <DetailRow label="Created">{new Date(task.createdAt).toLocaleString()}</DetailRow>
                  <DetailRow label="Updated">{new Date(task.updatedAt).toLocaleString()}</DetailRow>
                  <DetailRow label="By">{task.createdBy === 'operator' ? 'You' : task.createdBy}</DetailRow>
                </div>
              </div>

              {task.run && runStatus && (
                <div className="space-y-2">
                  <h3 className="settings-heading">Agent run</h3>
                  <div className="flex items-center gap-2 text-[0.867rem]">
                    <Pane state={runPaneState(task.run.status)} size="sm" />
                    <span className={RUN_WORD_CLASS[runStatus]}>{RUN_WORD[runStatus]}</span>
                    {runStatus === 'running' && task.run.startedAt && (
                      <RunElapsed startedAt={task.run.startedAt} />
                    )}
                  </div>
                  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-[0.8rem]">
                    <DetailRow label="Session">
                      <code className="cockpit-kbd cursor-pointer select-all">{task.run.sessionKey}</code>
                    </DetailRow>
                    {task.run.startedAt && (
                      <DetailRow label="Started">{new Date(task.run.startedAt).toLocaleString()}</DetailRow>
                    )}
                    {task.run.endedAt && (
                      <DetailRow label="Ended">{new Date(task.run.endedAt).toLocaleString()}</DetailRow>
                    )}
                  </div>
                  {task.run.error && (
                    <div className="break-words text-[0.8rem] text-destructive">{task.run.error}</div>
                  )}
                </div>
              )}

              {task.result?.trim() && (
                <div className="space-y-2">
                  <h3 className="settings-heading">Result</h3>
                  <div className="rounded-[3px] bg-plate p-3 text-[0.867rem] text-foreground">
                    <Suspense fallback={<div className="whitespace-pre-wrap">{task.result}</div>}>
                      <MarkdownRenderer content={task.result} suppressImages />
                    </Suspense>
                  </div>
                </div>
              )}

              {task.feedback.length > 0 && (
                <div className="space-y-2">
                  <h3 className="settings-heading">Feedback</h3>
                  <div className="space-y-1.5">
                    {task.feedback.map((fb, i) => (
                      <div key={i} className="rounded-[3px] bg-plate p-3 text-[0.867rem]">
                        <div className="mb-1 flex items-center justify-between gap-2 text-[0.8rem] text-muted-foreground">
                          <span>{fb.by === 'operator' ? 'You' : fb.by}</span>
                          <span className="font-mono tabular">{new Date(fb.at).toLocaleString()}</span>
                        </div>
                        <p className="text-foreground">{fb.note}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer: the workflow at the left, Delete and Save at the right */}
            <div className="shrink-0 border-t border-border px-3 py-2">
              {showRejectInput && (
                <div className="mb-2 flex items-center gap-2">
                  <Input
                    value={rejectNote}
                    onChange={e => setRejectNote(e.target.value)}
                    placeholder="Why it is rejected (required)"
                    className="cockpit-input h-11 flex-1 sm:h-[2.133rem]"
                    onKeyDown={e => { if (e.key === 'Enter') handleReject(); if (e.key === 'Escape') { setShowRejectInput(false); setRejectNote(''); } }}
                    autoFocus
                  />
                  <Button size="sm" variant="outline" onClick={() => { setShowRejectInput(false); setRejectNote(''); }}>
                    Cancel
                  </Button>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                {(task.status === 'backlog' || task.status === 'todo') && onExecute && (
                  <Button size="sm" onClick={handleExecute} disabled={workflowLoading !== null}>
                    {workflowLoading === 'execute' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                    Execute
                  </Button>
                )}
                {task.status === 'in-progress' && task.run?.status === 'running' && onAbort && (
                  <Button size="sm" variant="outline" onClick={handleAbort} disabled={workflowLoading !== null}>
                    {workflowLoading === 'abort' ? <Loader2 size={14} className="animate-spin" /> : <StopCircle size={14} />}
                    Abort
                  </Button>
                )}
                {task.status === 'review' && (
                  <>
                    {onApprove && (
                      <Button size="sm" onClick={handleApprove} disabled={workflowLoading !== null}>
                        {workflowLoading === 'approve' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                        Approve
                      </Button>
                    )}
                    {onReject && (
                      <Button size="sm" variant="outline" onClick={handleReject} disabled={workflowLoading !== null || (showRejectInput && !rejectNote.trim())}>
                        {workflowLoading === 'reject' ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                        Reject
                      </Button>
                    )}
                  </>
                )}

                <div className="flex-1" />

                {confirmDelete ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-[0.8rem] text-destructive">Delete this task?</span>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleDelete}
                      disabled={deleting}
                    >
                      {deleting ? <Loader2 size={14} className="animate-spin" /> : 'Yes'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                    >
                      No
                    </Button>
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmDelete(true)}
                    className="hover:text-destructive"
                  >
                    <Trash2 size={14} />
                    Delete
                  </Button>
                )}

                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!dirty || saving}
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
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
