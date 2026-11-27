import type { KanbanTask, TaskPriority, TaskRunLink } from '@/features/kanban/types';
import type { KanbanProposal } from '@/features/kanban/hooks/useProposals';
import type { CronJob } from '@/features/workspace/hooks/useCrons';
import type { GranularAgentState, Session } from '@/types';

export type AttentionSource = 'tasks' | 'proposals' | 'crons' | 'sessions';
export type AttentionSection = 'decide' | 'blocked' | 'progress' | 'finished';
export type AttentionKind =
  | 'review' | 'proposal' | 'task-failed' | 'gone-quiet' | 'cron-failed'
  | 'session-failed' | 'task-running' | 'session-running' | 'task-finished' | 'cron-finished';

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
  open: OpenTarget;
  detail: AttentionItemDetail;
}

export interface AttentionInput {
  now: number;
  lastLook: number | null;
  seen: ReadonlySet<string>;
  tasks: KanbanTask[];
  proposals: KanbanProposal[];
  crons: CronJob[];
  sessions: Session[];
  agentStatus: Record<string, GranularAgentState>;
  busyState: Record<string, boolean>;
  sources: Record<AttentionSource, SourceStatus>;
}

export interface AttentionBrief {
  decide: AttentionItem[];
  blocked: AttentionItem[];
  progress: AttentionItem[];
  finished: AttentionItem[];
  seen: { blocked: AttentionItem[]; finished: AttentionItem[] };
  sources: Record<AttentionSource, SourceStatus>;
  since: number;
  allClear: boolean;
}
