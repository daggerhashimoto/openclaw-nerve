import { LayoutGrid } from 'lucide-react';

/**
 * Placeholder Kanban board — replaced by full board in Issue 03.
 */
export function KanbanPanel() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-background text-muted-foreground select-none">
      <LayoutGrid size={48} className="text-primary opacity-60" />
      <h2 className="text-lg font-bold tracking-wide text-foreground">Kanban Board</h2>
      <p className="text-xs text-muted-foreground max-w-xs text-center">
        Task management is coming soon. This view will show columns for backlog, todo, in-progress, review, and done.
      </p>
    </div>
  );
}
