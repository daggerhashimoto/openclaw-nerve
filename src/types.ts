/** Possible high-level states an agent session can be in. */
export type AgentStatusKind = 'IDLE' | 'THINKING' | 'STREAMING' | 'DONE' | 'ERROR';

/** Fine-grained agent state including current tool activity. */
export interface GranularAgentState {
  status: AgentStatusKind;
  toolName?: string;        // e.g., "read", "exec", "web_search"
  toolDescription?: string; // e.g., "Reading src/types.ts"
  since: number;            // Date.now() of last state change
}

/** A gateway session (main agent or sub-agent). Fields are optional due to API version variance. */
export interface Session {
  sessionKey?: string;
  key?: string;
  id?: string;
  label?: string;
  state?: string;
  agentState?: string;
  busy?: boolean;
  processing?: boolean;
  status?: string;
  lastActivity?: string | number;
  updatedAt?: number;
  abortedLastRun?: boolean;
  model?: string;
  thinking?: string;
  thinkingLevel?: string;
  totalTokens?: number;
  contextTokens?: number;
  parentId?: string;  // from gateway API (v2026.2.9+)
  inputTokens?: number;
  outputTokens?: number;
  channel?: string;
  kind?: string;
  displayName?: string;
}

/** Extract the canonical key from a Session object (handles API inconsistency). */
export function getSessionKey(s: Session): string {
  return s.sessionKey || s.key || s.id || '';
}

/** A single entry in the agent activity log (displayed in the TopBar). */
export interface AgentLogEntry {
  icon: string;
  text: string;
  ts: number;
}

/** A gateway event entry shown in the events panel. */
export interface EventEntry {
  badge: string;
  badgeCls: string;
  desc: string;
  ts: Date;
}

export interface Memory {
  type: 'section' | 'item' | 'daily';
  text: string;
  date?: string;
  /** Temporary ID for optimistic updates */
  tempId?: string;
  /** True while the operation is pending confirmation */
  pending?: boolean;
  /** True if the operation failed (for error display before removal) */
  failed?: boolean;
  /** True if this memory is being deleted (fade out animation) */
  deleting?: boolean;
}

/** Memory category types for storing new memories */
export type MemoryCategory = 'preference' | 'fact' | 'decision' | 'entity' | 'other';

/** API response for memory operations */
export interface MemoryApiResponse {
  ok: boolean;
  error?: string;
  result?: unknown;
}

/** Aggregated token usage and cost data from the gateway. */
export interface TokenData {
  entries?: TokenEntry[];
  totalCost?: number;
  totalInput?: number;
  totalOutput?: number;
  totalCacheRead?: number;
  totalMessages?: number;
  persistent?: {
    totalCost: number;
    totalInput: number;
    totalOutput: number;
    lastUpdated: string;
  };
  updatedAt?: number;
}

/** Per-source breakdown of token usage and cost. */
export interface TokenEntry {
  source: string;
  cost: number;
  messageCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  errorCount?: number;
}

/** Possible roles for chat messages */
export type ChatMessageRole = 'user' | 'assistant' | 'tool' | 'toolResult' | 'system';

/** Discriminated content block types */
export type ContentBlockType = 'text' | 'tool_use' | 'toolCall' | 'tool_result' | 'toolResult' | 'image' | 'thinking';

/** A single chat message (user, assistant, tool, or system). */
export interface ChatMessage {
  role: ChatMessageRole;
  content: string | ContentBlock[];
  text?: string;
  timestamp?: string | number;
  createdAt?: string | number;
  ts?: string | number;
  MediaPath?: string;
  MediaPaths?: string[];
  MediaType?: string;
  MediaTypes?: string[];
  MediaUrl?: string;
  MediaUrls?: string[];
}

/** A content block within a multi-part message (text, tool call, image, etc.). */
export interface ContentBlock {
  type: ContentBlockType;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  id?: string;
  toolCallId?: string;
  arguments?: string | Record<string, unknown>;
  content?: string | ContentBlock[];
  /** Image content block fields (from gateway) */
  data?: string;       // base64 image data
  mimeType?: string;   // e.g. "image/jpeg"
  omitted?: boolean;
  bytes?: number;
  /** Anthropic-style image source */
  source?: { type?: string; media_type?: string; data?: string };
}

/** Gateway message types */
export interface GatewayEvent {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: { presence: number; health: number };
}

export interface GatewayRequest {
  type: 'req';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface GatewayResponse {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { message: string; code?: string };
}

export type GatewayMessage = GatewayEvent | GatewayRequest | GatewayResponse;

/** Generic event payload for gateway events */
export interface EventPayload {
  sessionKey?: string;
  state?: string;
  agentState?: string;
  runId?: string;
  seq?: number;
  message?: ChatMessage | string;
  messages?: ChatMessage[];
  content?: ContentBlock[];
  name?: string;
  error?: string;
  errorMessage?: string;
  stopReason?: string;
}

// ─── Typed event payloads ────────────────────────────────────────────

/** Payload for 'chat' events */
export interface ChatEventPayload {
  sessionKey?: string;
  state?: string;
  runId?: string;
  seq?: number;
  message?: ChatMessage | string;
  messages?: ChatMessage[];
  content?: ContentBlock[];
  error?: string;
  errorMessage?: string;
  stopReason?: string;
}

/** Payload for 'agent' events (state changes + tool streaming) */
export interface AgentEventPayload {
  sessionKey?: string;
  state?: string;
  agentState?: string;
  /** Present when stream === 'tool' */
  stream?: string;
  /** Tool stream data (present when stream === 'tool') */
  data?: AgentToolStreamData;
  totalTokens?: number;
  contextTokens?: number;
}

/** Data within an agent tool-stream event */
export interface AgentToolStreamData {
  phase: 'start' | 'result';
  toolCallId?: string;
  name?: string;
  args?: Record<string, unknown>;
}

/** Payload for 'cron' events */
export interface CronEventPayload {
  name?: string;
}

/** Payload for error events */
export interface ErrorEventPayload {
  message?: string;
  error?: string;
}

/** Sessions list RPC response */
export interface SessionsListResponse {
  sessions?: Session[];
}

/** Chat history RPC response */
export interface ChatHistoryResponse {
  messages?: ChatMessage[];
}
