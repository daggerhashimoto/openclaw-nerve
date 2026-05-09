import type { UploadAttachmentDescriptorForManifest } from '../../../shared/chat-upload-manifest.js';

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
  kind: 'user_message' | 'thinking' | 'tool_group' | 'tool_call' | 'assistant_message' | 'system_event';
  orderKey: TimelineOrderKey;
  createdAt: number;
  updatedAt: number;
  status: TimelineItemStatus;
  source: TimelineItemSource;
}

export interface TimelineMessageImage {
  mimeType: string;
  content: string;
  preview: string;
  name: string;
}

export type TimelineUploadAttachment = UploadAttachmentDescriptorForManifest;

export interface UserTimelineItem extends TimelineItemBase {
  kind: 'user_message';
  text: string;
  idempotencyKey?: string;
  messageId?: string;
  pending?: boolean;
  images?: TimelineMessageImage[];
  uploadAttachments?: TimelineUploadAttachment[];
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

export interface AssistantTimelineItem extends TimelineItemBase {
  kind: 'assistant_message';
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
}

export type RuntimeEvent =
  | { type: 'turn_started'; sessionKey: string; runId: string; at: number; seq?: number }
  | { type: 'user_message_committed'; sessionKey: string; runId?: string; messageId?: string; idempotencyKey?: string; text: string; images?: TimelineMessageImage[]; uploadAttachments?: TimelineUploadAttachment[]; at: number }
  | { type: 'user_message_run_bound'; sessionKey: string; idempotencyKey: string; runId: string; at: number }
  | { type: 'thinking_started'; sessionKey: string; runId: string; blockIndex: number; at: number }
  | { type: 'thinking_delta'; sessionKey: string; runId: string; blockIndex: number; text: string; at: number }
  | { type: 'thinking_final'; sessionKey: string; runId: string; blockIndex: number; text: string; durationMs?: number; at: number }
  | { type: 'tool_started'; sessionKey: string; runId: string; toolCallId: string; name: string; args: unknown; at: number }
  | { type: 'tool_finished'; sessionKey: string; runId: string; toolCallId: string; result?: unknown; error?: string; at: number }
  | { type: 'assistant_delta'; sessionKey: string; runId: string; text: string; at: number; seq?: number; segmentIndex?: number }
  | { type: 'assistant_final'; sessionKey: string; runId: string; text: string; stopReason?: string; at: number; segmentIndex?: number }
  | { type: 'turn_finalized'; sessionKey: string; runId: string; at: number }
  | { type: 'turn_failed'; sessionKey: string; runId: string; error: string; at: number }
  | { type: 'user_message_failed'; sessionKey: string; idempotencyKey: string; error: string; at: number }
  | { type: 'history_snapshot'; sessionKey: string; messages: HistoryMessage[]; at: number };

export interface HistoryContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image' | string;
  text?: string;
  thinking?: string;
  id?: string;
  toolCallId?: string;
  name?: string;
  input?: unknown;
  arguments?: unknown;
  content?: unknown;
  data?: string;
  mimeType?: string;
  omitted?: boolean;
  /**
   * Image history mirrors provider payloads: block-level mimeType is Nerve
   * camelCase, while source.media_type must stay snake_case for Anthropic
   * content blocks consumed by adapter.ts imageBlockToMessageImage.
   */
  source?: {
    type?: string;
    media_type?: string;
    data?: string;
    filename?: string;
  };
}

export interface HistoryMessage {
  role: 'user' | 'assistant' | 'tool' | 'toolResult' | 'system';
  content: string | HistoryContentBlock[];
  timestamp?: string | number;
  createdAt?: string | number;
  ts?: string | number;
  id?: string;
  messageId?: string;
  runId?: string;
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
