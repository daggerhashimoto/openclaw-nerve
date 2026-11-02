import { memo, useState, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Pane } from '@/components/ui/Pane';
import { paneStateLabel } from '@/lib/paneState';
import { nameHueStyle } from '@/lib/agentColors';
import type { KanbanTask } from './types';
import { RUN_WORD, RUN_WORD_CLASS, assigneeAgentId, assigneeName, getTaskRunStatus, priorityWord, taskPaneState } from './tone';

interface KanbanCardProps {
  task: KanbanTask;
  onClick: (task: KanbanTask) => void;
  /** True when rendered inside DragOverlay: skips the sortable hook */
  isOverlay?: boolean;
  /** Alias for isOverlay (compat with KanbanBoard) */
  isDragOverlay?: boolean;
  /** Family hue of the assignee; shows in the glass of the off pane and colours the name */
  hue?: string;
}

export const KanbanCard = memo(function KanbanCard({ task, onClick, isOverlay, isDragOverlay, hue }: KanbanCardProps) {
  const overlay = isOverlay || isDragOverlay;
  return overlay ? (
    <CardContent task={task} onClick={onClick} hue={hue} isDragging isOverlay />
  ) : (
    <SortableCard task={task} onClick={onClick} hue={hue} />
  );
});

/* Sortable wrapper (only used for in-place cards, not overlay) */
function SortableCard({ task, onClick, hue }: { task: KanbanTask; onClick: (task: KanbanTask) => void; hue?: string }) {
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
      <CardContent task={task} onClick={onClick} hue={hue} isDragging={isDragging} />
    </div>
  );
}

/**
 * A task as a row on Plate: its pane leads (blue while the agent runs, red when the run broke,
 * cantaloupe while it waits on you, the assignee's hue in the glass otherwise), the title in
 * Reading White, one line of description, the labels in words, then who holds it and how the
 * run went. No pills, no dots; the pane is the only coloured element besides a lit word.
 */
function CardContent({
  task,
  onClick,
  hue,
  isDragging,
  isOverlay,
}: {
  task: KanbanTask;
  onClick: (task: KanbanTask) => void;
  hue?: string;
  isDragging?: boolean;
  isOverlay?: boolean;
}) {
  const paneState = taskPaneState(task);
  const name = assigneeName(task.assignee);
  const agentId = assigneeAgentId(task.assignee);
  const priority = priorityWord(task.priority);
  const runStatus = task.run ? getTaskRunStatus(task.run.status) : null;
  const extraLabels = task.labels.length - 3;

  return (
    <button
      type="button"
      onClick={() => { if (!isDragging) onClick(task); }}
      className={`nerve-task-card group flex w-full cursor-pointer items-start gap-2 rounded-[4px] px-3 py-2.5 text-left transition-[background-color,box-shadow,opacity] duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ${
        isOverlay ? 'is-lifted' : isDragging ? 'opacity-30' : ''
      }`}
      data-state={paneState}
    >
      <Pane state={paneState} size="sm" hue={hue} label={paneStateLabel(paneState)} className="mt-[4px]" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block text-[0.867rem] font-medium leading-5 text-foreground">
          {task.title}
        </span>

        {task.description && (
          <span className="mt-0.5 block truncate text-[0.8rem] leading-5 text-muted-foreground">
            {task.description}
          </span>
        )}

        {task.labels.length > 0 && (
          <span className="mt-0.5 flex flex-wrap gap-x-2 text-[0.8rem] leading-5 text-muted-foreground">
            {task.labels.slice(0, 3).map((label, idx) => (
              <span key={`${label}-${idx}`}>{label}</span>
            ))}
            {extraLabels > 0 && <span>+{extraLabels}</span>}
          </span>
        )}

        {(name || priority || runStatus || task.dueAt) && (
          <span className="mt-0.5 flex items-center gap-2 text-[0.8rem] leading-5 text-muted-foreground">
            {name && (
              <span
                className={`max-w-[9rem] truncate ${agentId && hue ? 'name-hued' : ''}`}
                style={agentId ? nameHueStyle(hue) : undefined}
              >
                {name}
              </span>
            )}
            {priority && <span className={priority.className}>{priority.word}</span>}
            {runStatus && <span className={RUN_WORD_CLASS[runStatus]}>{RUN_WORD[runStatus]}</span>}
            {runStatus === 'running' && task.run?.startedAt && (
              <span className="font-mono text-live-text tabular">
                <ElapsedTime since={task.run.startedAt} />
              </span>
            )}
            {task.dueAt && (
              <span className="ml-auto font-mono tabular" title="Due">
                {new Date(task.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            )}
          </span>
        )}
      </span>
    </button>
  );
}

/* Elapsed time (ticks every second) */
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
