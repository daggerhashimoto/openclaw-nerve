export interface ImageAttachment {
  id: string;
  mimeType: string;
  content: string; // base64
  preview: string; // data URL for display
  name: string;
}

/** Image data as stored on messages (no id needed — not user-removable) */
export type MessageImage = Omit<ImageAttachment, 'id'>;

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
  /** System notification (subagent/cron completion) — rendered as collapsible strip */
  isSystemNotification?: boolean;
  /** Short label for system notification strip (e.g. "Subagent completed: kb-fix-auth") */
  systemLabel?: string;
}
