import { memo, useState, useEffect } from 'react';
import { Check, X, ArrowUpCircle, PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { KanbanProposal } from './hooks/useProposals';

/* ── Type badge ── */
function TypeBadge({ type }: { type: 'create' | 'update' }) {
  if (type === 'create') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-sm bg-emerald-500/15 text-emerald-400">
        <PlusCircle size={10} />
        CREATE
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-sm bg-blue-500/15 text-blue-400">
      <ArrowUpCircle size={10} />
      UPDATE
    </span>
  );
}

/* ── Relative timestamp (ticks every 30s for live updates) ── */
function RelativeTime({ ts }: { ts: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, now - ts);
  const secs = Math.floor(diff / 1000);
  let label: string;
  if (secs < 60) label = 'just now';
  else if (secs < 3600) label = `${Math.floor(secs / 60)}m ago`;
  else if (secs < 86400) label = `${Math.floor(secs / 3600)}h ago`;
  else label = `${Math.floor(secs / 86400)}d ago`;

  return <span className="text-[10px] text-muted-foreground tabular-nums">{label}</span>;
}

/* ── Summary text ── */
function ProposalSummary({ proposal }: { proposal: KanbanProposal }) {
  const { type, payload } = proposal;
  if (type === 'create') {
    const title = (payload.title as string) || 'Untitled';
    const priority = payload.priority as string | undefined;
    const labels = payload.labels as string[] | undefined;
    return (
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground truncate">{title}</p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {priority && (
            <span className="text-[10px] text-muted-foreground">
              {priority}
            </span>
          )}
          {labels?.map((l) => (
            <span key={l} className="text-[10px] px-1 py-0 rounded bg-muted text-muted-foreground">
              {l}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // Update proposal
  const taskId = (payload.id as string) || '???';
  const changes = Object.keys(payload).filter((k) => k !== 'id');
  return (
    <div className="min-w-0 flex-1">
      <p className="text-xs font-medium text-foreground truncate">
        Update: <span className="font-mono text-[10px] text-muted-foreground">{taskId.slice(0, 8)}</span>
      </p>
      <p className="text-[10px] text-muted-foreground truncate">
        Fields: {changes.join(', ') || 'none'}
      </p>
    </div>
  );
}

/* ── Single proposal row ── */
function ProposalRow({
  proposal,
  onApprove,
  onReject,
}: {
  proposal: KanbanProposal;
  onApprove: (id: string) => void | Promise<void>;
  onReject: (id: string) => void | Promise<void>;
}) {
  const [acting, setActing] = useState(false);

  const handleApprove = async () => {
    setActing(true);
    try {
      await onApprove(proposal.id);
    } finally {
      setActing(false);
    }
  };

  const handleReject = async () => {
    setActing(true);
    try {
      await onReject(proposal.id);
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="flex items-start gap-2 py-2 px-3 border-b border-border/40 last:border-b-0 hover:bg-muted/30 transition-colors">
      <div className="flex flex-col items-start gap-1 shrink-0 pt-0.5">
        <TypeBadge type={proposal.type} />
        <RelativeTime ts={proposal.proposedAt} />
      </div>

      <ProposalSummary proposal={proposal} />

      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleApprove}
          disabled={acting}
          title="Approve"
          aria-label="Approve proposal"
          className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
        >
          <Check size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleReject}
          disabled={acting}
          title="Reject"
          aria-label="Reject proposal"
          className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
        >
          <X size={14} />
        </Button>
      </div>
    </div>
  );
}

/* ── Main inbox panel ── */
interface ProposalInboxProps {
  proposals: KanbanProposal[];
  onApprove: (id: string) => void | Promise<void>;
  onReject: (id: string) => void | Promise<void>;
}

export const ProposalInbox = memo(function ProposalInbox({
  proposals,
  onApprove,
  onReject,
}: ProposalInboxProps) {
  if (proposals.length === 0) {
    return (
      <div className="py-6 px-4 text-center text-xs text-muted-foreground">
        No pending proposals
      </div>
    );
  }

  return (
    <div className="max-h-[320px] overflow-y-auto">
      {proposals.map((p) => (
        <ProposalRow
          key={p.id}
          proposal={p}
          onApprove={onApprove}
          onReject={onReject}
        />
      ))}
    </div>
  );
});
