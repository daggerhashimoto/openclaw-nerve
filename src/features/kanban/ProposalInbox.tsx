import { memo, useState, useEffect } from 'react';
import { Check, X } from 'lucide-react';
import { Pane } from '@/components/ui/Pane';
import type { KanbanProposal } from './hooks/useProposals';

/* Relative timestamp (ticks every 30s for live updates) */
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

  return <span className="font-mono tabular">{label}</span>;
}

/* Summary: the title in Reading White, then what the proposal is in one muted line */
function ProposalSummary({ proposal }: { proposal: KanbanProposal }) {
  const { type, payload } = proposal;
  if (type === 'create') {
    const title = (payload.title as string) || 'Untitled';
    const priority = payload.priority as string | undefined;
    const labels = payload.labels as string[] | undefined;
    const parts = ['New task', priority, labels?.join(', ')].filter(Boolean);
    return (
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.867rem] text-foreground">{title}</p>
        <p className="flex flex-wrap gap-x-2 text-[0.8rem] text-muted-foreground">
          {parts.map((part, i) => <span key={i} className="truncate">{part}</span>)}
          <RelativeTime ts={proposal.proposedAt} />
        </p>
      </div>
    );
  }

  // Update proposal
  const taskId = (payload.id as string) || '???';
  const changes = Object.keys(payload).filter((k) => k !== 'id');
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-[0.867rem] text-foreground">
        Update <span className="font-mono text-[0.8rem] text-muted-foreground">{taskId.slice(0, 8)}</span>
      </p>
      <p className="flex flex-wrap gap-x-2 text-[0.8rem] text-muted-foreground">
        <span className="truncate">{changes.length ? changes.join(', ') : 'no fields'}</span>
        <RelativeTime ts={proposal.proposedAt} />
      </p>
    </div>
  );
}

/* Single proposal row: a cantaloupe pane (it waits on you), the summary, Approve and Reject */
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
    <div className="flex items-start gap-2 border-b border-border py-2 pl-3 pr-1 last:border-b-0">
      <Pane state="operator" size="sm" label="Waiting on you" className="mt-[5px]" />
      <ProposalSummary proposal={proposal} />
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={handleApprove}
          disabled={acting}
          title="Approve"
          aria-label="Approve proposal"
          className="shell-chip disabled:opacity-50"
        >
          <Check size={14} />
          <span className="hidden sm:inline">Approve</span>
        </button>
        <button
          type="button"
          onClick={handleReject}
          disabled={acting}
          title="Reject"
          aria-label="Reject proposal"
          className="shell-chip hover:text-destructive disabled:opacity-50"
        >
          <X size={14} />
          <span className="hidden sm:inline">Reject</span>
        </button>
      </div>
    </div>
  );
}

/* Main inbox panel */
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
      <div className="px-3 py-6 text-center text-[0.8rem] text-muted-foreground">
        No proposals waiting.
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
