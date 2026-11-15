import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSessionContext } from '@/contexts/SessionContext';
import type { TaskStatus, TaskPriority } from './types';
import type { CreateTaskPayload } from './hooks/useKanban';
import { AssigneeCombobox } from './components/AssigneeCombobox';
import { buildAssigneeOptions } from './lib/assigneeOptions';

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To do' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'review', label: 'Review' },
];

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (payload: CreateTaskPayload) => Promise<void>;
}

/**
 * Create a task. A plain dialog of fields: the description is an operator window that
 * warms while you type in it; the rest are flat inputs and selects.
 */
export function CreateTaskDialog({ open, onOpenChange, onCreate }: CreateTaskDialogProps) {
  const { sessions, agentName } = useSessionContext();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [labelsRaw, setLabelsRaw] = useState('');
  const [assignee, setAssignee] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  /* Focus title on open */
  useEffect(() => {
    if (open) {
      // Small delay so the dialog animation finishes
      const t = setTimeout(() => titleRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [open]);

  /* Reset form on close */
  useEffect(() => {
    if (!open) {
      setTitle('');
      setDescription('');
      setStatus('todo');
      setPriority('normal');
      setLabelsRaw('');
      setAssignee('');
      setError(null);
    }
  }, [open]);

  const trimmedTitle = title.trim();
  const isValid = trimmedTitle.length > 0 && trimmedTitle.length <= 500;
  const assigneeOptions = useMemo(
    () => buildAssigneeOptions(sessions, agentName),
    [agentName, sessions],
  );

  const handleSubmit = useCallback(async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const labels = labelsRaw
        .split(',')
        .map(l => l.trim())
        .filter(Boolean);
      const payload: CreateTaskPayload = {
        title: trimmedTitle,
        description: description.trim() || undefined,
        status,
        priority,
        ...(labels.length > 0 ? { labels } : {}),
        ...(assignee ? { assignee } : {}),
      };
      await onCreate(payload);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create task. Try again.");
    } finally {
      setSubmitting(false);
    }
  }, [isValid, submitting, trimmedTitle, description, status, priority, labelsRaw, assignee, onCreate, onOpenChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && document.activeElement?.tagName !== 'TEXTAREA') {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const selectClass = 'cockpit-select h-11 sm:h-[2.133rem]';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[92vw] gap-4 p-5 sm:max-w-[640px]" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="text-[1.067rem] font-semibold text-foreground">Create task</DialogTitle>
          <DialogDescription className="text-[0.867rem] text-muted-foreground">
            Name the work and pick its column. An agent or you can take it from there.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="cockpit-note" data-tone="danger">
            {error}
          </div>
        )}

        {/* Title */}
        <div className="cockpit-field">
          <label htmlFor="kb-new-title" className="cockpit-field-label">
            Title
          </label>
          <Input
            id="kb-new-title"
            ref={titleRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="What needs doing"
            maxLength={500}
            className="cockpit-input h-11 sm:h-[2.133rem]"
            aria-invalid={title.length > 0 && !isValid}
          />
          {title.length > 0 && trimmedTitle.length === 0 && (
            <p className="text-[0.8rem] text-destructive">Title is required.</p>
          )}
        </div>

        {/* Description: an operator window */}
        <div className="cockpit-field">
          <label htmlFor="kb-new-desc" className="cockpit-field-label">
            Description
          </label>
          <div className="nerve-window-frame">
            <div className="nerve-window rounded-[3px]">
              <textarea
                id="kb-new-desc"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Markdown, optional"
                rows={4}
                className="block min-h-[132px] w-full resize-y border-0 bg-transparent px-3 py-2 text-[0.867rem] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>
        </div>

        {/* Secondary fields */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="cockpit-field">
            <label htmlFor="kb-new-status" className="cockpit-field-label">
              Status
            </label>
            <select
              id="kb-new-status"
              value={status}
              onChange={e => setStatus(e.target.value as TaskStatus)}
              className={selectClass}
            >
              {STATUS_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="cockpit-field">
            <label htmlFor="kb-new-priority" className="cockpit-field-label">
              Priority
            </label>
            <select
              id="kb-new-priority"
              value={priority}
              onChange={e => setPriority(e.target.value as TaskPriority)}
              className={selectClass}
            >
              {PRIORITY_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="cockpit-field">
            <label htmlFor="kb-new-labels" className="cockpit-field-label">
              Labels
            </label>
            <Input
              id="kb-new-labels"
              value={labelsRaw}
              onChange={e => setLabelsRaw(e.target.value)}
              placeholder="bug, frontend, urgent"
              className="cockpit-input h-11 sm:h-[2.133rem]"
            />
            <p className="cockpit-field-hint">Comma separated.</p>
          </div>

          <div className="cockpit-field">
            <label htmlFor="kb-new-assignee" className="cockpit-field-label">
              Assignee
            </label>
            <AssigneeCombobox
              id="kb-new-assignee"
              value={assignee}
              onChange={setAssignee}
              options={assigneeOptions}
              ariaLabel="Assignee"
              placeholder="Select assignee"
              noResultsText="No matching assignees"
              inline
            />
          </div>
        </div>

        <DialogFooter className="mt-1 gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!isValid || submitting}>
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
