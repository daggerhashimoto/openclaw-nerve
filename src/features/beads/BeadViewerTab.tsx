import { AlertTriangle, ArrowUpRight, CircleDot, FileText, GitBranch, Loader2 } from 'lucide-react';
import { MarkdownRenderer } from '@/features/markdown/MarkdownRenderer';
import { useBeadDetail } from './useBeadDetail';
import type { BeadLinkTarget } from './links';

interface BeadViewerTabProps {
  beadTarget: BeadLinkTarget;
  onOpenBeadId?: (target: BeadLinkTarget) => void;
  onOpenWorkspacePath?: (path: string, basePath?: string) => void | Promise<void>;
}

function formatTimestamp(value: string | null): string | null {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString();
}

function RelationList({
  title,
  items,
  onOpenBeadId,
}: {
  title: string;
  items: Array<{ id: string; title: string | null; status: string | null; dependencyType: string | null }>;
  onOpenBeadId?: (target: BeadLinkTarget) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        <GitBranch size={13} />
        <span>{title}</span>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="flex w-full items-start justify-between gap-3 rounded-2xl border border-border/60 bg-card/60 px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-card disabled:cursor-default disabled:opacity-75"
            onClick={() => onOpenBeadId?.({ beadId: item.id })}
            disabled={!onOpenBeadId}
          >
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <span className="truncate">{item.title || item.id}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                <span className="font-mono">{item.id}</span>
                {item.status ? <span> · {item.status}</span> : null}
                {item.dependencyType ? <span> · {item.dependencyType}</span> : null}
              </div>
            </div>
            <ArrowUpRight size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </section>
  );
}

export function BeadViewerTab({ beadTarget, onOpenBeadId, onOpenWorkspacePath }: BeadViewerTabProps) {
  const { bead, loading, error } = useBeadDetail(beadTarget);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" />
        <span>Loading bead…</span>
      </div>
    );
  }

  if (error || !bead) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-md rounded-3xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <AlertTriangle size={15} />
            <span>Could not load bead {beadTarget.beadId}</span>
          </div>
          <p className="text-destructive/80">{error || 'Unknown error'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-5 sm:px-6 sm:py-6">
        <section className="shell-panel rounded-[28px] border border-border/60 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="cockpit-badge">Bead Viewer</span>
                <span className="font-mono">{bead.id}</span>
                {bead.status ? <span className="cockpit-badge">{bead.status}</span> : null}
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">{bead.title}</h1>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {bead.issueType ? <span>Type: {bead.issueType}</span> : null}
                  {bead.priority !== null ? <span>Priority: {bead.priority}</span> : null}
                  {bead.owner ? <span>Owner: {bead.owner}</span> : null}
                  {bead.updatedAt ? <span>Updated: {formatTimestamp(bead.updatedAt)}</span> : null}
                  {bead.closedAt ? <span>Closed: {formatTimestamp(bead.closedAt)}</span> : null}
                </div>
              </div>
            </div>
          </div>

          {bead.notes ? (
            <div className="mt-5 border-t border-border/50 pt-5">
              <div className="mb-3 flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                <CircleDot size={13} />
                <span>Notes</span>
              </div>
              <MarkdownRenderer
                content={bead.notes}
                onOpenBeadId={onOpenBeadId}
                onOpenWorkspacePath={onOpenWorkspacePath}
              />
            </div>
          ) : null}

          {bead.closeReason ? (
            <div className="mt-5 rounded-2xl border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Close reason:</span> {bead.closeReason}
            </div>
          ) : null}
        </section>

        {bead.linkedPlan ? (
          <section className="shell-panel rounded-[28px] border border-border/60 p-5 sm:p-6">
            <div className="mb-3 flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              <FileText size={13} />
              <span>Linked plan</span>
            </div>
            <button
              type="button"
              className="flex w-full items-start justify-between gap-3 rounded-2xl border border-border/60 bg-card/60 px-4 py-4 text-left transition-colors hover:border-primary/40 hover:bg-card disabled:cursor-default disabled:opacity-75"
              onClick={() => { void onOpenWorkspacePath?.(bead.linkedPlan!.path); }}
              disabled={!onOpenWorkspacePath}
            >
              <div className="min-w-0 space-y-1">
                <div className="truncate text-sm font-medium text-foreground">{bead.linkedPlan.title}</div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-mono">{bead.linkedPlan.path}</span>
                  {bead.linkedPlan.status ? <span> · {bead.linkedPlan.status}</span> : null}
                  {bead.linkedPlan.archived ? <span> · archived</span> : null}
                </div>
              </div>
              <ArrowUpRight size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
            </button>
          </section>
        ) : null}

        <RelationList title="Dependencies" items={bead.dependencies} onOpenBeadId={onOpenBeadId} />
        <RelationList title="Dependents" items={bead.dependents} onOpenBeadId={onOpenBeadId} />
      </div>
    </div>
  );
}
