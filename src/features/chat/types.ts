export interface ImageAttachment {
  id: string;
  mimeType: string;
  content: string; // base64
  preview: string; // data URL for display
  name: string;
}

/** Image data as stored on messages (no id needed — not user-removable) */
export type MessageImage = Omit<ImageAttachment, 'id'>;

export type UploadMode = 'inline' | 'file_reference';
export type UploadAttachmentOrigin = 'upload' | 'server_path';

export interface UploadAttachmentPolicy {
  forwardToSubagents: boolean;
}

export interface InlineUploadReference {
  encoding: 'base64';
  base64: string;
  base64Bytes: number;
  previewUrl?: string;
  compressed: boolean;
}

export type UploadPreparationOutcome =
  | 'inline_ready'
  | 'optimized_inline'
  | 'file_reference_ready'
  | 'downgraded_to_file_reference'
  | 'blocked_inline';

export interface UploadPreparationMetadata {
  sourceMode: UploadMode;
  finalMode: UploadMode;
  outcome: UploadPreparationOutcome;
  reason?: string;
  originalMimeType: string;
  originalSizeBytes: number;
  inlineBase64Bytes?: number;
  contextSafetyMaxBytes?: number;
  inlineTargetBytes?: number;
  inlineChosenWidth?: number;
  inlineChosenHeight?: number;
  inlineIterations?: number;
  inlineMinDimension?: number;
  inlineFallbackReason?: string;
  localPathAvailable?: boolean;
}

export interface FileUploadReference {
  kind: 'local_path';
  path: string;
  uri: string;
}

export interface UploadAttachmentDescriptor {
  id: string;
  origin: UploadAttachmentOrigin;
  mode: UploadMode;
  name: string;
  mimeType: string;
  sizeBytes: number;
  inline?: InlineUploadReference;
  reference?: FileUploadReference;
  preparation?: UploadPreparationMetadata;
  policy: UploadAttachmentPolicy;
}

export interface UploadManifestOptions {
  enabled: boolean;
  exposeInlineBase64ToAgent: boolean;
  allowSubagentForwarding: boolean;
}

export interface OutgoingUploadPayload {
  descriptors: UploadAttachmentDescriptor[];
  manifest: UploadManifestOptions;
}

export type ChatMsgRole = 'user' | 'assistant' | 'tool' | 'toolResult' | 'system' | 'event';

/** Whether a message should default to collapsed state */
export function isMessageCollapsible(msg: ChatMsg): boolean {
  const isTool = msg.role === 'tool' || msg.role === 'toolResult';
  const isSystem = msg.role === 'system' || msg.role === 'event';
  return isTool || isSystem;
}

/** A single tool entry within a grouped tool bubble */
export interface ToolGroupEntry {
  html: string;
  rawText: string;
  /** Human-friendly description from describeToolUse() */
  preview: string;
}

import type { ChartData } from '@/features/charts/extractCharts';

let _msgIdCounter = 0;
/** Generate a stable, unique ID for a ChatMsg (monotonic counter + timestamp). */
export function generateMsgId(): string {
  return `m-${Date.now()}-${++_msgIdCounter}`;
}

export interface ChatMsg {
  /** Stable unique ID for React keying — assigned once at creation, never changes. */
  msgId?: string;
  role: ChatMsgRole;
  html: string;
  rawText: string;
  timestamp: Date;
  streaming?: boolean;
  collapsed?: boolean;
  images?: MessageImage[];
  /** Local attachment metadata for upload mode summaries/debug rendering. */
  uploadAttachments?: UploadAttachmentDescriptor[];
  /** Optimistic: message is being sent, not yet confirmed */
  pending?: boolean;
  /** Optimistic: message send failed */
  failed?: boolean;
  /** Temporary ID for optimistic updates */
  tempId?: string;
  /** Grouped tool calls — when set, this is a grouped tool bubble */
  toolGroup?: ToolGroupEntry[];
  /** Intermediate assistant message (narration between tool calls, not the final answer) */
  intermediate?: boolean;
  /** Extracted chart data for inline rendering */
  charts?: ChartData[];
  /** Extracted image URLs from agent messages (markdown, MEDIA:, bare URLs) */
  extractedImages?: { url: string; alt?: string }[];
  /** Whether this is a thinking bubble (not regular assistant content) */
  isThinking?: boolean;
  /** Thinking trace text */
  thinkingText?: string;
  /** How long the model spent thinking (milliseconds) */
  thinkingDurationMs?: number;
  /** Whether this is a voice (STT-transcribed) message */
  isVoice?: boolean;
  /** Extracted spoken text from a hidden [tts:...] marker. */
  ttsText?: string | null;
  /** System notification (subagent/cron completion) — rendered as collapsible strip */
  isSystemNotification?: boolean;
  /** Short label for system notification strip (e.g. "Subagent completed: kb-fix-auth") */
  systemLabel?: string;
}
