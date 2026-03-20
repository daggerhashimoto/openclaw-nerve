import { useState, useCallback, useRef, useEffect } from 'react';
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
import type { TaskStatus, TaskPriority } from './types';
import type { CreateTaskPayload } from './hooks/useKanban';

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To Do' },
  { value: 'in-progress', label: 'In Progress' },
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

export function CreateTaskDialog({ open, onOpenChange, onCreate }: CreateTaskDialogProps) {
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

  const handleSubmit = useCallback(async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const labels = labelsRaw
        .split(',')
        .map(l => l.trim())
        .filter(Boolean);
      await onCreate({
        title: trimmedTitle,
        description: description.trim() || undefined,
        status,
        priority,
        labels: labels.length > 0 ? labels : undefined,
        assignee: assignee.trim() || undefined,
      });
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

  const selectClass = 'cockpit-select h-11 text-sm';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[92vw] gap-4 p-5 sm:max-w-[680px]" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <div className="cockpit-kicker">
            <span className="text-primary">◆</span>
            Task Board
          </div>
          <DialogTitle className="text-[1.4rem] font-semibold tracking-[-0.03em] text-foreground">Create task</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">Capture the work, set the lane, and leave the board readable for the next handoff.</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="cockpit-note text-sm" data-tone="danger">
            {error}
          </div>
        )}

        {/* Title */}
        <div>
          <label htmlFor="kb-new-title" className="cockpit-field-label mb-2 block">
            Title <span className="text-destructive">*</span>
          </label>
          <Input
            id="kb-new-title"
            ref={titleRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Task title…"
            maxLength={500}
            className="h-11"
            aria-invalid={title.length > 0 && !isValid}
          />
          {title.length > 0 && trimmedTitle.length === 0 && (
            <p className="text-[0.667rem] text-destructive mt-0.5">Title is required.</p>
          )}
        </div>

        {/* Description */}
        <div>
          <label htmlFor="kb-new-desc" className="cockpit-field-label mb-2 block">
            Description
          </label>
          <textarea
            id="kb-new-desc"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Markdown description (optional)…"
            rows={4}
            className="cockpit-textarea min-h-[144px]"
          />
        </div>

        {/* 2-col grid for secondary fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Status */}
          <div>
            <label htmlFor="kb-new-status" className="cockpit-field-label mb-2 block">
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

          {/* Priority */}
          <div>
            <label htmlFor="kb-new-priority" className="cockpit-field-label mb-2 block">
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

          {/* Labels */}
          <div>
            <label htmlFor="kb-new-labels" className="cockpit-field-label mb-2 block">
              Labels
            </label>
            <Input
              id="kb-new-labels"
              value={labelsRaw}
              onChange={e => setLabelsRaw(e.target.value)}
              placeholder="bug, frontend, urgent"
              className="h-11"
            />
            <p className="mt-1 text-[0.733rem] text-muted-foreground">Comma-separated</p>
          </div>

          {/* Assignee */}
          <div>
            <label htmlFor="kb-new-assignee" className="cockpit-field-label mb-2 block">
              Assignee
            </label>
            <Input
              id="kb-new-assignee"
              value={assignee}
              onChange={e => setAssignee(e.target.value)}
              placeholder="operator"
              className="h-11"
            />
          </div>
        </div>

        <DialogFooter className="mt-1">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!isValid || submitting}>
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Create Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
