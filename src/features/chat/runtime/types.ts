import type { ActivityLogEntry, ProcessingStage } from '@/contexts/ChatContext';
import type { ChatMsg, MessageImage, UploadAttachmentDescriptor } from '@/features/chat/types';

export type TimelineHydrationState = 'cold' | 'hydrating' | 'ready' | 'stale';
export type TimelineTurnStatus = 'running' | 'finalized' | 'failed' | 'aborted';
export type TimelineItemStatus = 'provisional' | 'running' | 'complete' | 'failed' | 'aborted';
export type TimelineItemSource = 'history' | 'live' | 'optimistic' | 'system';

export interface TimelineOrderKey {
  turn: number;
  block: number;
  sub: number;
}

export interface TimelineItemBase {
  id: string;
  sessionKey: string;
  turnId?: string;
  runId?: string;
  kind:
    | 'user_message'
    | 'assistant_message'
    | 'assistant_segment'
    | 'thinking'
    | 'tool_group'
    | 'tool_call'
    | 'tool_result'
    | 'system_event';
  orderKey: TimelineOrderKey;
  createdAt: number;
  updatedAt: number;
  status: TimelineItemStatus;
  source: TimelineItemSource;
}

export interface UserTimelineItem extends TimelineItemBase {
  kind: 'user_message';
  text: string;
  idempotencyKey?: string;
  messageId?: string;
  pending?: boolean;
  images?: MessageImage[];
  uploadAttachments?: UploadAttachmentDescriptor[];
}

export interface ThinkingTimelineItem extends TimelineItemBase {
  kind: 'thinking';
  text: string;
  durationMs?: number;
}

export interface ToolGroupTimelineItem extends TimelineItemBase {
  kind: 'tool_group';
  childItemIds: string[];
  closed: boolean;
}

export interface ToolCallTimelineItem extends TimelineItemBase {
  kind: 'tool_call';
  toolCallId: string;
  name: string;
  args: unknown;
  result?: unknown;
  error?: string;
}

export interface ToolResultTimelineItem extends TimelineItemBase {
  kind: 'tool_result';
  toolCallId?: string;
  text?: string;
  result?: unknown;
  error?: string;
}

export interface AssistantTimelineItem extends TimelineItemBase {
  kind: 'assistant_message' | 'assistant_segment';
  text: string;
  isStreaming: boolean;
  seq?: number;
  segmentIndex?: number;
  finalText?: string;
  stopReason?: string;
}

export interface SystemTimelineItem extends TimelineItemBase {
  kind: 'system_event';
  text: string;
  severity: 'info' | 'warning' | 'error';
}

export type TimelineItem =
  | UserTimelineItem
  | ThinkingTimelineItem
  | ToolGroupTimelineItem
  | ToolCallTimelineItem
  | ToolResultTimelineItem
  | AssistantTimelineItem
  | SystemTimelineItem;

export interface TimelineTurn {
  id: string;
  sessionKey: string;
  runId: string;
  status: TimelineTurnStatus;
  startedAt: number;
  finalizedAt?: number;
  inputItemIds: string[];
  outputItemIds: string[];
  orderBase: TimelineOrderKey;
}

export interface SessionTimeline {
  sessionKey: string;
  version: number;
  cursor: string;
  hydrationState: TimelineHydrationState;
  turns: TimelineTurn[];
  items: Record<string, TimelineItem>;
  updatedAt: number;
  orderedItems?: TimelineItem[];
  itemIndexById?: Record<string, number>;
  itemsByTurnId?: Record<string, TimelineItem[]>;
  turnIndexById?: Record<string, number>;
}

export type TimelinePatchOp =
  | { op: 'upsert_turn'; turn: TimelineTurn }
  | { op: 'upsert_item'; item: TimelineItem }
  | { op: 'bind_user_message_run'; idempotencyKey: string; runId: string; at: number }
  | { op: 'remove_item'; id: string; reason: 'compaction' | 'user_reset' }
  | { op: 'remove_turn'; id: string; reason: 'compaction' | 'user_reset' }
  | { op: 'set_hydration_state'; state: TimelineHydrationState };

export interface TimelinePatch {
  sessionKey: string;
  cursor: string;
  ops: TimelinePatchOp[];
  createdAt: number;
}

export interface TimelineSnapshot {
  type: 'snapshot';
  sessionKey: string;
  cursor: string;
  timeline: SessionTimeline;
  reason: 'initial' | 'cursor_expired' | 'hydration' | 'manual';
}

export interface RuntimeTimelineState {
  sessionKey: string;
  cursor: string;
  timeline: SessionTimeline;
}

export interface TimelineProjection {
  messages: ChatMsg[];
  totalMessages: number;
  isGenerating: boolean;
  processingStage: ProcessingStage;
  lastEventTimestamp: number;
  activityLog: ActivityLogEntry[];
  currentToolDescription: string | null;
}

export interface TimelineProjectionOptions {
  failedIdempotencyKeys?: ReadonlySet<string>;
  visibleCount?: number;
}
