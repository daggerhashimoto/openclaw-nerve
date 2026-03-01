import { useState, useCallback, useEffect, useRef } from 'react';
import {
  X, Play, CheckCircle2, XCircle, Trash2, Save, Loader2,
  Clock, User, Tag, AlertTriangle, MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { KanbanTask, TaskStatus, TaskPriority } from './types';
import type { UpdateTaskPayload, VersionConflictError } from './hooks/useKanban';

/* ── Priority colors ── */
const PRIORITY_COLOR: Record<TaskPriority, string> = {
  critical: 'text-[#ef4444]',
  high: 'text-[#f59e0b]',
  normal: 'text-[#3b82f6]',
  low: 'text-[#6b7280]',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  'in-progress': 'In Progress',
  review: 'Review',
  done: 'Done',
  cancelled: 'Cancelled',
};

const STATUS_BADGE: Record<TaskStatus, string> = {
  backlog: 'bg-slate-500/20 text-slate-400',
  todo: 'bg-blue-500/20 text-blue-400',
  'in-progress': 'bg-cyan-500/20 text-cyan-400',
  review: 'bg-amber-500/20 text-amber-400',
  done: 'bg-green-500/20 text-green-400',
  cancelled: 'bg-gray-500/20 text-gray-400',
};

interface TaskDetailDrawerProps {
  task: KanbanTask | null;
  onClose: () => void;
  onUpdate: (id: string, payload: UpdateTaskPayload) => Promise<KanbanTask>;
  onDelete: (id: string) => Promise<void>;
}

export function TaskDetailDrawer({ task, onClose, onUpdate, onDelete }: TaskDetailDrawerProps) {
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
      setEditStatus(task.status);
      setEditPriority(task.priority);
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
          setEditStatus(latest.status);
          setEditPriority(latest.priority);
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

  /* Stub action handlers (Issue 05) */
  const stubAction = useCallback((action: string) => {
    alert(`${action} — coming in Issue 05`);
  }, []);

  const isOpen = task !== null;

  const selectClass = 'h-[34px] w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none';

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
        className={`fixed top-0 right-0 z-50 h-full w-[460px] max-w-full bg-background border-l border-border shadow-2xl flex flex-col transition-transform duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {task && (
          <>
            {/* Header (§19.8: 52px) */}
            <div className="flex items-center justify-between h-[52px] px-3.5 border-b border-border shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_BADGE[task.status]}`}>
                  {STATUS_LABEL[task.status]}
                </span>
                <span className={`text-[10px] font-semibold ${PRIORITY_COLOR[task.priority]}`}>
                  {editPriority.charAt(0).toUpperCase() + editPriority.slice(1)}
                </span>
              </div>
              <button
                onClick={safeClose}
                className="p-1 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Close drawer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-3.5">
              {error && (
                <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2 flex items-center gap-1.5">
                  <AlertTriangle size={12} />
                  {error}
                </div>
              )}

              {/* Title */}
              <div>
                <label htmlFor="kb-title" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
                  Title
                </label>
                <Input
                  id="kb-title"
                  value={editTitle}
                  onChange={e => { setEditTitle(e.target.value); markDirty(); }}
                  maxLength={500}
                  className="h-[34px] text-sm font-semibold"
                />
              </div>

              {/* Description */}
              <div>
                <label htmlFor="kb-description" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
                  Description
                </label>
                <textarea
                  id="kb-description"
                  value={editDescription}
                  onChange={e => { setEditDescription(e.target.value); markDirty(); }}
                  placeholder="Markdown description…"
                  rows={8}
                  className="w-full min-h-[180px] rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-y"
                />
              </div>

              {/* Status + Priority grid */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="kb-status" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
                    Status
                  </label>
                  <select
                    id="kb-status"
                    value={editStatus}
                    onChange={e => { setEditStatus(e.target.value as TaskStatus); markDirty(); }}
                    className={selectClass}
                  >
                    {Object.entries(STATUS_LABEL).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="kb-priority" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
                    Priority
                  </label>
                  <select
                    id="kb-priority"
                    value={editPriority}
                    onChange={e => { setEditPriority(e.target.value as TaskPriority); markDirty(); }}
                    className={selectClass}
                  >
                    {(['critical', 'high', 'normal', 'low'] as TaskPriority[]).map(p => (
                      <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Labels + Assignee */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="kb-labels" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
                    <Tag size={10} className="inline mr-1" />Labels
                  </label>
                  <Input
                    id="kb-labels"
                    value={editLabels}
                    onChange={e => { setEditLabels(e.target.value); markDirty(); }}
                    placeholder="bug, urgent"
                    className="h-[34px]"
                  />
                </div>
                <div>
                  <label htmlFor="kb-assignee" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
                    <User size={10} className="inline mr-1" />Assignee
                  </label>
                  <Input
                    id="kb-assignee"
                    value={editAssignee}
                    onChange={e => { setEditAssignee(e.target.value); markDirty(); }}
                    placeholder="operator"
                    className="h-[34px]"
                  />
                </div>
              </div>

              {/* Metadata (read-only) */}
              <div className="border-t border-border/50 pt-3">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Metadata
                </h4>
                <div className="space-y-1 text-[11px] text-muted-foreground">
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

              {/* Run link section */}
              {task.run && (
                <div className="border-t border-border/50 pt-3">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Linked Run
                  </h4>
                  <div className="space-y-1 text-[11px] text-muted-foreground">
                    <div>Session: <code className="text-[10px] bg-muted px-1 py-0.5 rounded">{task.run.sessionKey}</code></div>
                    <div>Status: <span className="font-semibold">{task.run.status}</span></div>
                    {task.run.startedAt && (
                      <div>Started: {new Date(task.run.startedAt).toLocaleString()}</div>
                    )}
                    {task.run.endedAt && (
                      <div>Ended: {new Date(task.run.endedAt).toLocaleString()}</div>
                    )}
                    {task.run.error && (
                      <div className="text-destructive">Error: {task.run.error}</div>
                    )}
                  </div>
                </div>
              )}

              {/* Result */}
              {task.result && (
                <div className="border-t border-border/50 pt-3">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Result
                  </h4>
                  <div className="text-xs text-foreground whitespace-pre-wrap bg-muted/30 rounded-md p-2">
                    {task.result}
                  </div>
                </div>
              )}

              {/* Feedback / timeline */}
              {task.feedback.length > 0 && (
                <div className="border-t border-border/50 pt-3">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    <MessageSquare size={10} className="inline mr-1" />Feedback
                  </h4>
                  <div className="space-y-2">
                    {task.feedback.map((fb, i) => (
                      <div key={i} className="text-xs bg-muted/30 rounded-md p-2">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
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

            {/* Sticky action bar */}
            <div className="shrink-0 border-t border-border bg-background/90 backdrop-blur-sm px-3.5 py-2.5 flex items-center gap-2">
              {/* Contextual action stubs (Issue 05) */}
              {(task.status === 'backlog' || task.status === 'todo') && (
                <Button size="xs" variant="outline" onClick={() => stubAction('Execute')}>
                  <Play size={12} /> Execute
                </Button>
              )}
              {task.status === 'review' && (
                <>
                  <Button size="xs" variant="outline" onClick={() => stubAction('Approve')}>
                    <CheckCircle2 size={12} /> Approve
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => stubAction('Reject')}>
                    <XCircle size={12} /> Reject
                  </Button>
                </>
              )}

              <div className="flex-1" />

              {confirmDelete ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-[11px] text-destructive font-medium">Delete?</span>
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
          </>
        )}
      </div>
    </>
  );
}
