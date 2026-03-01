import { memo, useState, useEffect } from 'react';
import { Clock, Play, CheckCircle2, AlertCircle, XCircle } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { KanbanTask, TaskPriority } from './types';

/* ── Priority colors (from spec §19.4) ── */
const PRIORITY_DOT: Record<TaskPriority, string> = {
  critical: 'bg-[#ef4444]',
  high: 'bg-[#f59e0b]',
  normal: 'bg-[#3b82f6]',
  low: 'bg-[#6b7280]',
};

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  critical: 'Critical',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

/* ── Run status indicators ── */
function RunBadge({ status }: { status: string }) {
  switch (status) {
    case 'running':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-cyan-400">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          Live
        </span>
      );
    case 'done':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-400">
          <CheckCircle2 size={10} /> Done
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-400">
          <AlertCircle size={10} /> Error
        </span>
      );
    case 'aborted':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-400">
          <XCircle size={10} /> Aborted
        </span>
      );
    default:
      return null;
  }
}

interface KanbanCardProps {
  task: KanbanTask;
  onClick: (task: KanbanTask) => void;
  /** True when rendered inside DragOverlay — skips sortable hook */
  isOverlay?: boolean;
  /** Alias for isOverlay (compat with KanbanBoard) */
  isDragOverlay?: boolean;
}

export const KanbanCard = memo(function KanbanCard({ task, onClick, isOverlay, isDragOverlay }: KanbanCardProps) {
  const overlay = isOverlay || isDragOverlay;
  return overlay ? (
    <CardContent task={task} onClick={onClick} isDragging isOverlay />
  ) : (
    <SortableCard task={task} onClick={onClick} />
  );
});

/* ── Sortable wrapper (only used for in-place cards, not overlay) ── */
function SortableCard({ task, onClick }: { task: KanbanTask; onClick: (task: KanbanTask) => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <CardContent task={task} onClick={onClick} isDragging={isDragging} />
    </div>
  );
}

/* ── Visual card content (shared between sortable + overlay) ── */
function CardContent({
  task,
  onClick,
  isDragging,
  isOverlay,
}: {
  task: KanbanTask;
  onClick: (task: KanbanTask) => void;
  isDragging?: boolean;
  isOverlay?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => { if (!isDragging) onClick(task); }}
      className={`w-full text-left bg-card border border-border rounded-[10px] px-2.5 py-2.5 transition-all duration-[120ms] cursor-pointer group focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
        isOverlay
          ? 'shadow-[0_8px_24px_rgba(0,0,0,.35)] scale-[1.02] rotate-[1deg] border-primary/40'
          : isDragging
            ? 'opacity-30'
            : 'hover:shadow-[0_4px_14px_rgba(0,0,0,.25)]'
      }`}
    >
      {/* Row 1: priority dot + title */}
      <div className="flex items-start gap-2">
        <span
          className={`mt-1 shrink-0 w-2 h-2 rounded-full ${PRIORITY_DOT[task.priority]}`}
          title={PRIORITY_LABEL[task.priority]}
          aria-label={`Priority: ${PRIORITY_LABEL[task.priority]}`}
          role="img"
        />
        <span className="text-[13px] font-semibold leading-[18px] text-foreground line-clamp-2 min-w-0">
          {task.title}
        </span>
      </div>

      {/* Row 2: description preview */}
      {task.description && (
        <p className="mt-1 ml-4 text-[11px] leading-[15px] text-muted-foreground line-clamp-1">
          {task.description}
        </p>
      )}

      {/* Row 3: labels */}
      {task.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5 ml-4">
          {task.labels.slice(0, 3).map((label, idx) => (
            <span
              key={`${label}-${idx}`}
              className="text-[10px] font-medium leading-none bg-muted text-muted-foreground px-1.5 py-0.5 rounded-sm"
            >
              {label}
            </span>
          ))}
          {task.labels.length > 3 && (
            <span className="text-[10px] text-muted-foreground">
              +{task.labels.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Row 3: meta line (assignee, run status, time) */}
      <div className="flex items-center gap-2 mt-1.5 ml-4 text-[11px] text-muted-foreground">
        {task.assignee && (
          <span className="truncate max-w-[100px]">
            {task.assignee === 'operator' ? 'Operator' : task.assignee.replace('agent:', '@')}
          </span>
        )}

        {task.run && <RunBadge status={task.run.status} />}

        {task.run?.status === 'running' && task.run.startedAt && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-cyan-400/80">
            <Clock size={9} />
            <ElapsedTime since={task.run.startedAt} />
          </span>
        )}

        {task.dueAt && (
          <span className="inline-flex items-center gap-0.5 ml-auto">
            <Play size={9} className="rotate-90" />
            {new Date(task.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
    </button>
  );
}

/* ── Tiny elapsed-time component (ticks every second) ── */
function ElapsedTime({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return <span>{m}:{s.toString().padStart(2, '0')}</span>;
}
