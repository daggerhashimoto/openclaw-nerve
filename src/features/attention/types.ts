import type { KanbanTask, TaskPriority, TaskRunLink } from '@/features/kanban/types';
import type { KanbanProposal } from '@/features/kanban/hooks/useProposals';
import type { CronJob } from '@/features/workspace/hooks/useCrons';
import type { GranularAgentState, Session } from '@/types';
import type { CronRunEntry } from './today/buildDay';
import type { ExecApproval } from './execApprovals';

export type AttentionSource = 'tasks' | 'proposals' | 'crons' | 'sessions' | 'approvals';
export type AttentionSection = 'decide' | 'blocked' | 'progress' | 'finished';
export type AttentionKind =
  | 'approval' | 'review' | 'proposal' | 'task-failed' | 'gone-quiet' | 'cron-failed'
  | 'session-failed' | 'task-running' | 'session-running' | 'task-finished' | 'cron-recovered';

export type OpenTarget =
  | { type: 'task'; id: string }
  | { type: 'proposal'; id: string }
  | { type: 'cron'; id: string }
  | { type: 'session'; key: string }
  /** A source's own panel with nothing selected, for "Open Crons" when a source could not be read. */
  | { type: 'source'; source: 'tasks' | 'crons' };

export interface SourceStatus {
  state: 'loading' | 'live' | 'error' | 'off';
  error?: string;
  checkedAt?: number;
}

/**
 * Every source's status. Exec approvals are optional: a gateway without the approval methods
 * (or a caller that does not read them) leaves them out, which reads as off.
 */
export type AttentionSources = Record<Exclude<AttentionSource, 'approvals'>, SourceStatus> & {
  approvals?: SourceStatus;
};

/** A link the item's own data carries: a pull request named in its result or notes. */
export interface EvidenceLink {
  label: string;
  href: string;
}

export interface AttentionItemDetail {
  result?: string;
  runStatus?: TaskRunLink['status'];
  runEndedAt?: number;
  sessionKey?: string;
  error?: string;
  nextRun?: number;
  quietSince?: number;
  proposedBy?: string;
  proposalChange?: string;
  /** Pull request links found in a task's result and notes. */
  links?: EvidenceLink[];
  /** A recovered cron: when the failed run ran. The recovery time is `updatedAt`. */
  failedAt?: number;
  /** An exec approval: the command as the gateway shows it, and where it would run. */
  command?: string;
  /** The gateway's shorter form of the command, when it has one. */
  commandPreview?: string;
  /** The session asking, in words. */
  sessionName?: string;
  cwd?: string;
  host?: string;
  /** The decisions the gateway accepts for this approval (allow-once, allow-always, deny). */
  decisions?: string[];
  warning?: string;
  expiresAt?: number;
}

export interface AttentionItem {
  /** `${source}:${sourceId}:${kind}`, plus a run discriminator for failures and finishes. */
  key: string;
  source: AttentionSource;
  sourceId: string;
  kind: AttentionKind;
  section: AttentionSection;
  title: string;
  ownerId?: string;
  /** Time of the event that put the item here; ages are read from it. */
  updatedAt: number;
  deadline?: number;
  priority: TaskPriority;
  freshness: 'live' | 'stale' | 'unavailable';
  /** Approvals have no panel of their own; they open their session, or nothing. */
  open: OpenTarget | null;
  detail: AttentionItemDetail;
}

export interface AttentionInput {
  now: number;
  lastLook: number | null;
  seen: ReadonlySet<string>;
  tasks: KanbanTask[];
  proposals: KanbanProposal[];
  crons: CronJob[];
  /** Run history per cron job id, when it was read; recovered failures come from it. */
  cronRuns?: Record<string, CronRunEntry[]>;
  /** Pending exec approvals from the gateway. */
  approvals?: ExecApproval[];
  sessions: Session[];
  agentStatus: Record<string, GranularAgentState>;
  busyState: Record<string, boolean>;
  sources: AttentionSources;
}

export interface AttentionBrief {
  /** Approvals first (they hold an agent), then reviews and proposals, ranked. */
  decide: AttentionItem[];
  /** Failures, and running tasks that went quiet. */
  blocked: AttentionItem[];
  progress: AttentionItem[];
  /** Task results and recovered failures since the last look. */
  finished: AttentionItem[];
  seen: { blocked: AttentionItem[]; finished: AttentionItem[] };
  sources: AttentionSources;
  since: number;
  allClear: boolean;
}
