import { memo, useState, useEffect } from 'react';
import { Check, X, ArrowUpCircle, PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { KanbanProposal } from './hooks/useProposals';
import { TASK_STATUS_TONE } from './tone';

/* ── Type badge ── */
function TypeBadge({ type }: { type: 'create' | 'update' }) {
  if (type === 'create') {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[0.667rem] font-semibold ${TASK_STATUS_TONE.done.badgeClass}`}>
        <PlusCircle size={10} />
        Create
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[0.667rem] font-semibold ${TASK_STATUS_TONE.todo.badgeClass}`}>
      <ArrowUpCircle size={10} />
      Update
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

  return <span className="text-[0.667rem] text-muted-foreground tabular-nums">{label}</span>;
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
            <span className="text-[0.667rem] text-muted-foreground">
              {priority}
            </span>
          )}
          {labels?.map((l) => (
            <span key={l} className="text-[0.667rem] px-1 py-0 rounded bg-muted text-muted-foreground">
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
        Update: <span className="font-mono text-[0.667rem] text-muted-foreground">{taskId.slice(0, 8)}</span>
      </p>
      <p className="text-[0.667rem] text-muted-foreground truncate">
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
    <div className="flex items-start gap-3 border-b border-border/40 px-4 py-3 transition-colors last:border-b-0 hover:bg-primary/[0.04]">
      <div className="flex flex-col items-start gap-1 shrink-0 pt-0.5">
        <TypeBadge type={proposal.type} />
        <RelativeTime ts={proposal.proposedAt} />
      </div>

      <ProposalSummary proposal={proposal} />

      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="outline"
          size="xs"
          onClick={handleApprove}
          disabled={acting}
          title="Approve"
          aria-label="Approve proposal"
          className="border-green/30 bg-green/8 text-green hover:bg-green/12"
        >
          <Check size={14} />
          <span className="hidden sm:inline">Approve</span>
        </Button>
        <Button
          variant="outline"
          size="xs"
          onClick={handleReject}
          disabled={acting}
          title="Reject"
          aria-label="Reject proposal"
          className="border-destructive/22 bg-destructive/8 text-destructive hover:bg-destructive/14"
        >
          <X size={14} />
          <span className="hidden sm:inline">Reject</span>
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
      <div className="px-4 py-8 text-center">
        <div className="cockpit-badge mx-auto w-fit">Inbox clear</div>
        <p className="mt-3 text-sm text-muted-foreground">No pending proposals right now.</p>
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
