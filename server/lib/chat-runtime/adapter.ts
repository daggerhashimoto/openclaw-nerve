import type { HistoryContentBlock, HistoryMessage, RuntimeEvent } from './types.js';

export interface AdapterGatewayEvent {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: unknown;
}

export function adaptGatewayEvent(event: AdapterGatewayEvent): RuntimeEvent[] {
  const payload = event.payload;
  if (!isRecord(payload)) return [];

  if (event.event === 'chat') {
    return adaptChatEvent(payload, event.seq);
  }

  if (event.event === 'agent') {
    return adaptAgentEvent(payload);
  }

  return [];
}

export function adaptHistorySnapshot(sessionKey: string, messages: HistoryMessage[]): RuntimeEvent[] {
  if (!sessionKey) return [];

  const fallbackAt = Date.now();
  const events: RuntimeEvent[] = [
    { type: 'history_snapshot', sessionKey, messages, at: fallbackAt },
  ];
  let lastAssistantRunId: string | undefined;
  const finalizedRunAts = new Map<string, number>();
  const finalizableUserRunAts = new Map<string, number>();
  const noteFinalizedRun = (runId: string, at: number) => {
    finalizedRunAts.set(runId, Math.max(finalizedRunAts.get(runId) ?? at, at));
  };
  const noteFinalizableUserRun = (runId: string, at: number) => {
    finalizableUserRunAts.set(runId, Math.max(finalizableUserRunAts.get(runId) ?? at, at));
  };

  messages.forEach((message, messageIndex) => {
    const at = messageTime(message, fallbackAt);

    if (message.role === 'user') {
      const text = extractText(message);
      if (text === undefined) return;

      const explicitRunId = readNonEmptyString(message, 'runId');
      const runId = explicitRunId ?? historyUserRunId(message, messageIndex);
      const event: Extract<RuntimeEvent, { type: 'user_message_committed' }> = {
        type: 'user_message_committed',
        sessionKey,
        runId,
        text,
        at,
      };
      const messageId = historyMessageIdentity(message);
      const idempotencyKey = readNonEmptyString(message, 'idempotencyKey');
      if (messageId) event.messageId = messageId;
      if (idempotencyKey) event.idempotencyKey = idempotencyKey;
      events.push(event);
      if (!explicitRunId) noteFinalizableUserRun(runId, at);
      return;
    }

    if (message.role === 'assistant') {
      const runId = historyRunId(message, messageIndex);
      lastAssistantRunId = runId;

      events.push(...adaptAssistantHistoryMessage(sessionKey, runId, message, at));
      noteFinalizedRun(runId, at);
      return;
    }

    if (message.role === 'tool' || message.role === 'toolResult') {
      const runId = readNonEmptyString(message, 'runId') ?? lastAssistantRunId ?? historyFallbackRunId(message, messageIndex);
      const toolEvents = adaptToolHistoryMessage(sessionKey, runId, message, at);
      if (toolEvents.length > 0) {
        events.push(...toolEvents);
        noteFinalizedRun(runId, at);
      }
    }
  });

  for (const [runId, at] of finalizedRunAts) {
    events.push({ type: 'turn_finalized', sessionKey, runId, at });
  }
  for (const [runId, at] of finalizableUserRunAts) {
    if (finalizedRunAts.has(runId)) continue;
    events.push({ type: 'turn_finalized', sessionKey, runId, at });
  }

  return events;
}

function adaptChatEvent(payload: Record<string, unknown>, seq?: number): RuntimeEvent[] {
  const sessionKey = readNonEmptyString(payload, 'sessionKey');
  const runId = readNonEmptyString(payload, 'runId') ?? readNonEmptyString(payload, 'id');
  const state = readNonEmptyString(payload, 'state');
  if (!sessionKey || !runId || !state) return [];

  const at = Date.now();

  if (state === 'started') {
    const event: Extract<RuntimeEvent, { type: 'turn_started' }> = {
      type: 'turn_started',
      sessionKey,
      runId,
      at,
    };
    if (typeof seq === 'number') event.seq = seq;
    return [event];
  }

  if (state === 'delta') {
    const text = extractText(payload.message);
    if (!hasText(text)) return [];

    const event: Extract<RuntimeEvent, { type: 'assistant_delta' }> = {
      type: 'assistant_delta',
      sessionKey,
      runId,
      text,
      at,
    };
    if (typeof seq === 'number') event.seq = seq;
    return [event];
  }

  if (state === 'final') {
    const events = adaptChatFinalContentBlocks(sessionKey, runId, payload, at);
    if (events.length === 0) {
      const text = extractFinalText(payload);
      if (hasText(text)) {
        const stopReason = readNonEmptyString(payload, 'stopReason');
        const finalEvent: Extract<RuntimeEvent, { type: 'assistant_final' }> = {
          type: 'assistant_final',
          sessionKey,
          runId,
          text,
          at,
        };
        if (stopReason) finalEvent.stopReason = stopReason;
        events.push(finalEvent);
      }
    }
    events.push({ type: 'turn_finalized', sessionKey, runId, at });
    return events;
  }

  if (state === 'aborted') {
    return [{ type: 'turn_failed', sessionKey, runId, error: 'aborted', at }];
  }

  if (state === 'error') {
    return [{ type: 'turn_failed', sessionKey, runId, error: errorMessage(payload, 'error'), at }];
  }

  return [];
}

function adaptAgentEvent(payload: Record<string, unknown>): RuntimeEvent[] {
  const stream = readNonEmptyString(payload, 'stream');
  const data = payload.data;
  if (!isRecord(data)) return [];

  const sessionKey = readNonEmptyString(payload, 'sessionKey') ?? readNonEmptyString(data, 'sessionKey');
  const runId = readNonEmptyString(payload, 'runId') ?? readNonEmptyString(payload, 'id') ?? readNonEmptyString(data, 'runId');
  if (!sessionKey || !runId) return [];

  if (stream === 'tool') {
    return adaptLegacyToolStreamEvent(sessionKey, runId, data);
  }

  if (stream === 'item') {
    return adaptItemStreamEvent(sessionKey, runId, data);
  }

  if (stream === 'command_output') {
    return adaptCommandOutputStreamEvent(sessionKey, runId, data);
  }

  if (stream === 'thinking') {
    return adaptThinkingStreamEvent(sessionKey, runId, data);
  }

  return [];
}

function adaptLegacyToolStreamEvent(
  sessionKey: string,
  runId: string,
  data: Record<string, unknown>,
): RuntimeEvent[] {
  const phase = readNonEmptyString(data, 'phase');
  const toolCallId = readNonEmptyString(data, 'toolCallId') ?? readNonEmptyString(data, 'id');
  if (!phase || !toolCallId) return [];

  const at = Date.now();

  if (phase === 'start') {
    const name = readNonEmptyString(data, 'name');
    if (!name) return [];

    return [{
      type: 'tool_started',
      sessionKey,
      runId,
      toolCallId,
      name,
      args: data.args ?? {},
      at,
    }];
  }

  if (isToolFinishPhase(phase)) {
    return [buildToolFinishedEvent(sessionKey, runId, toolCallId, data, at)];
  }

  return [];
}

function adaptItemStreamEvent(
  sessionKey: string,
  runId: string,
  data: Record<string, unknown>,
): RuntimeEvent[] {
  const kind = readNonEmptyString(data, 'kind');
  if (kind !== 'tool') return [];

  const phase = readNonEmptyString(data, 'phase');
  const toolCallId = toolCallIdFrom(data);
  if (!phase || !toolCallId) return [];

  const at = Date.now();

  if (phase === 'start') {
    const name = readNonEmptyString(data, 'name');
    if (!name) return [];

    return [{
      type: 'tool_started',
      sessionKey,
      runId,
      toolCallId,
      name,
      args: toolArgsFromAgentItem(data),
      at,
    }];
  }

  if (isToolFinishPhase(phase)) {
    return [buildToolFinishedEvent(sessionKey, runId, toolCallId, data, at)];
  }

  return [];
}

function adaptCommandOutputStreamEvent(
  sessionKey: string,
  runId: string,
  data: Record<string, unknown>,
): RuntimeEvent[] {
  const phase = readNonEmptyString(data, 'phase');
  const toolCallId = toolCallIdFrom(data);
  if (!phase || !toolCallId || !isToolFinishPhase(phase)) return [];

  return [buildToolFinishedEvent(sessionKey, runId, toolCallId, data, Date.now())];
}

function adaptThinkingStreamEvent(
  sessionKey: string,
  runId: string,
  data: Record<string, unknown>,
): RuntimeEvent[] {
  const phase = readNonEmptyString(data, 'phase');
  const text = thinkingStreamTextValue(data);
  const blockIndex = readInteger(data, 'blockIndex')
    ?? readInteger(data, 'contentIndex')
    ?? readInteger(data, 'index')
    ?? 0;
  const at = Date.now();

  if (phase === 'start' && !hasText(text)) {
    return [{ type: 'thinking_started', sessionKey, runId, blockIndex, at }];
  }

  if (!hasText(text)) return [];

  if (phase === 'end' || phase === 'complete' || phase === 'completed') {
    return [{ type: 'thinking_final', sessionKey, runId, blockIndex, text, at }];
  }

  return [{ type: 'thinking_delta', sessionKey, runId, blockIndex, text, at }];
}

function buildToolFinishedEvent(
  sessionKey: string,
  runId: string,
  toolCallId: string,
  data: Record<string, unknown>,
  at: number,
): Extract<RuntimeEvent, { type: 'tool_finished' }> {
  const event: Extract<RuntimeEvent, { type: 'tool_finished' }> = {
    type: 'tool_finished',
    sessionKey,
    runId,
    toolCallId,
    at,
  };

  const result = toolStreamResultValue(data);
  if (result !== undefined) event.result = result;
  const error = optionalErrorMessage(data) ?? toolStatusError(data);
  if (error) event.error = error;
  return event;
}

function toolArgsFromAgentItem(data: Record<string, unknown>): unknown {
  if (Object.hasOwn(data, 'args')) return data.args;
  if (Object.hasOwn(data, 'input')) return data.input;
  if (Object.hasOwn(data, 'arguments')) return data.arguments;

  const name = readNonEmptyString(data, 'name');
  const preview = readNonEmptyString(data, 'meta') ?? readNonEmptyString(data, 'title');
  const command = commandPreviewFromAgentItem(name, preview);
  return command ? { command } : {};
}

function commandPreviewFromAgentItem(name: string | undefined, preview: string | undefined): string | undefined {
  if (!preview) return undefined;
  if (!name) return preview;

  const prefix = `${name} `;
  return preview.toLowerCase().startsWith(prefix.toLowerCase())
    ? preview.slice(prefix.length).trim()
    : preview;
}

function toolStreamResultValue(data: Record<string, unknown>): unknown {
  if (Object.hasOwn(data, 'result')) return data.result;
  if (Object.hasOwn(data, 'output')) return data.output;
  if (Object.hasOwn(data, 'summary')) return data.summary;
  if (Object.hasOwn(data, 'progressText')) return data.progressText;
  return undefined;
}

function thinkingStreamTextValue(data: Record<string, unknown>): string | undefined {
  return readNonEmptyString(data, 'text')
    ?? readNonEmptyString(data, 'content')
    ?? readNonEmptyString(data, 'thinking')
    ?? readNonEmptyString(data, 'reasoning')
    ?? readNonEmptyString(data, 'delta');
}

function readInteger(source: unknown, key: string): number | undefined {
  if (!isRecord(source)) return undefined;

  const value = source[key];
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return undefined;

  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isToolFinishPhase(phase: string): boolean {
  return phase === 'result' || phase === 'end' || phase === 'complete' || phase === 'completed';
}

function toolStatusError(data: Record<string, unknown>): string | undefined {
  const status = readNonEmptyString(data, 'status');
  if (status !== 'failed' && status !== 'error') return undefined;

  const result = toolStreamResultValue(data);
  if (typeof result === 'string' && result.trim()) return result;
  return 'tool failed';
}

function adaptAssistantHistoryMessage(
  sessionKey: string,
  runId: string,
  message: HistoryMessage,
  at: number,
): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];

  if (Array.isArray(message.content)) {
    let thinkingBlockIndex = 0;
    let textSegmentIndex = 0;
    message.content.forEach((block) => {
      if (!isRecord(block)) return;

      if (block.type === 'text') {
        const text = extractText(block);
        if (hasText(text)) {
          events.push({ type: 'assistant_final', sessionKey, runId, segmentIndex: textSegmentIndex, text, at });
          textSegmentIndex += 1;
        }
        return;
      }

      if (block.type === 'thinking') {
        const text = extractThinkingText(block);
        if (hasText(text)) {
          events.push({ type: 'thinking_final', sessionKey, runId, blockIndex: thinkingBlockIndex, text, at });
        }
        thinkingBlockIndex += 1;
        return;
      }

      if (block.type === 'tool_use' || block.type === 'toolCall') {
        const toolCallId = readNonEmptyString(block, 'toolCallId') ?? readNonEmptyString(block, 'id');
        if (!toolCallId) return;

        events.push({
          type: 'tool_started',
          sessionKey,
          runId,
          toolCallId,
          name: readNonEmptyString(block, 'name') ?? 'unknown',
          args: blockInput(block),
          at,
        });
        return;
      }

      if (isToolResultBlock(block)) {
        const event = toolFinishedEvent(sessionKey, runId, block, at);
        if (event) events.push(event);
      }
    });
  } else {
    const text = extractText(message);
    if (hasText(text)) {
      events.push({ type: 'assistant_final', sessionKey, runId, text, at });
    }
  }
  return events;
}

function adaptToolHistoryMessage(
  sessionKey: string,
  runId: string,
  message: HistoryMessage,
  at: number,
): RuntimeEvent[] {
  const event = toolFinishedEvent(sessionKey, runId, message, at);
  return event ? [event] : [];
}

function adaptChatFinalContentBlocks(
  sessionKey: string,
  runId: string,
  payload: Record<string, unknown>,
  at: number,
): RuntimeEvent[] {
  const message = finalAssistantPayloadMessage(payload);
  if (!isRecord(message) || !Array.isArray(message.content)) return [];

  return adaptAssistantHistoryMessage(sessionKey, runId, message as unknown as HistoryMessage, at);
}

function extractFinalText(payload: Record<string, unknown>): string | undefined {
  if (Array.isArray(payload.messages)) {
    for (const candidate of [...payload.messages].reverse()) {
      const text = extractAssistantMessageText(candidate);
      if (hasText(text)) return text;
    }
  }

  const messageText = extractAssistantMessageText(payload.message);
  if (hasText(messageText)) return messageText;

  if (payload.content !== undefined) {
    const contentText = extractText({ content: payload.content });
    if (hasText(contentText)) return contentText;
  }

  return undefined;
}

function finalAssistantPayloadMessage(payload: Record<string, unknown>): unknown {
  if (Array.isArray(payload.messages)) {
    for (const candidate of [...payload.messages].reverse()) {
      if (isAssistantLikeMessage(candidate)) return candidate;
    }
  }

  return isAssistantLikeMessage(payload.message) ? payload.message : undefined;
}

function isAssistantLikeMessage(value: unknown): boolean {
  if (!isRecord(value)) return false;

  const role = readNonEmptyString(value, 'role');
  return !role || role === 'assistant';
}

function extractAssistantMessageText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return undefined;

  const role = readNonEmptyString(value, 'role');
  if (role && role !== 'assistant') return undefined;

  return extractText(value);
}

function extractText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return undefined;

  const content = value.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content.flatMap((block) => {
      if (!isRecord(block)) return [];
      if (block.type === 'text' && typeof block.text === 'string') return [block.text];
      return [];
    });
    return parts.length > 0 ? parts.join('\n') : undefined;
  }

  return typeof value.text === 'string' ? value.text : undefined;
}

function toolFinishedEvent(
  sessionKey: string,
  runId: string,
  source: unknown,
  at: number,
): Extract<RuntimeEvent, { type: 'tool_finished' }> | undefined {
  if (!isRecord(source)) return undefined;

  const toolCallId = toolCallIdFrom(source);
  if (!toolCallId) return undefined;

  const event: Extract<RuntimeEvent, { type: 'tool_finished' }> = {
    type: 'tool_finished',
    sessionKey,
    runId,
    toolCallId,
    at,
  };

  const result = toolResultValue(source);
  if (result !== undefined) event.result = result;
  const error = optionalErrorMessage(source);
  if (error) event.error = error;
  return event;
}

function toolCallIdFrom(source: unknown): string | undefined {
  return readNonEmptyString(source, 'toolCallId')
    ?? readNonEmptyString(source, 'toolUseId')
    ?? readNonEmptyString(source, 'tool_use_id')
    ?? readNonEmptyString(source, 'id')
    ?? openClawId(source);
}

function toolResultValue(source: Record<string, unknown>): unknown {
  if (Object.hasOwn(source, 'result')) return source.result;
  if (Object.hasOwn(source, 'content')) return contentResultValue(source.content);
  if (typeof source.text === 'string') return source.text;
  return undefined;
}

function contentResultValue(content: unknown): unknown {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content;

  const text = content.flatMap((block) => {
    if (!isRecord(block)) return [];
    if (block.type === 'text' && typeof block.text === 'string') return [block.text];
    return [];
  });
  return text.length > 0 ? text.join('\n') : content;
}

function extractThinkingText(block: Record<string, unknown>): string | undefined {
  if (typeof block.thinking === 'string') return block.thinking;
  if (typeof block.text === 'string') return block.text;
  if (typeof block.content === 'string') return block.content;
  return undefined;
}

function blockInput(block: HistoryContentBlock | Record<string, unknown>): unknown {
  return block.input ?? block.arguments ?? {};
}

function historyRunId(message: HistoryMessage, messageIndex: number): string {
  return readNonEmptyString(message, 'runId') ?? historyFallbackRunId(message, messageIndex);
}

function historyFallbackRunId(message: HistoryMessage, messageIndex: number): string {
  const messageIdentity = historyMessageIdentity(message);
  if (messageIdentity) return `history:message:${messageIdentity}`;

  const seq = openClawSeq(message);
  if (seq !== undefined) return `history:seq:${seq}`;

  const timestamp = messageTimeIdentity(message);
  if (timestamp !== undefined) return `history:time:${timestamp}:index:${messageIndex}`;

  return `history:index:${messageIndex}`;
}

function historyUserRunId(message: HistoryMessage, messageIndex: number): string {
  const messageIdentity = historyMessageIdentity(message);
  if (messageIdentity) return `history:user:${messageIdentity}`;

  const seq = openClawSeq(message);
  if (seq !== undefined) return `history:user-seq:${seq}`;

  const timestamp = messageTimeIdentity(message);
  if (timestamp !== undefined) return `history:user-time:${timestamp}:index:${messageIndex}`;

  return `history:user-index:${messageIndex}`;
}

function historyMessageIdentity(message: HistoryMessage): string | undefined {
  return readNonEmptyString(message, 'messageId')
    ?? readNonEmptyString(message, 'id')
    ?? openClawId(message);
}

function messageTime(message: HistoryMessage, fallbackAt: number): number {
  return messageTimeIdentity(message)
    ?? fallbackAt;
}

function messageTimeIdentity(message: HistoryMessage): number | undefined {
  return timeValue(message.timestamp)
    ?? timeValue(message.createdAt)
    ?? timeValue(message.ts);
}

function timeValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function errorMessage(record: Record<string, unknown>, fallback: string): string {
  return optionalErrorMessage(record) ?? readNonEmptyString(record, 'errorMessage') ?? fallback;
}

function optionalErrorMessage(record: Record<string, unknown>): string | undefined {
  const error = record.error;
  if (typeof error === 'string' && error.trim()) return error;
  if (isRecord(error)) return readNonEmptyString(error, 'message');
  if (record.isError === true) return toolResultErrorMessage(record);
  return undefined;
}

function readNonEmptyString(source: unknown, key: string): string | undefined {
  if (!isRecord(source)) return undefined;

  const record = source;
  const value = record[key];
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function openClawId(source: unknown): string | undefined {
  const metadata = openClawMetadata(source);
  return metadata ? readNonEmptyString(metadata, 'id') : undefined;
}

function openClawSeq(source: unknown): string | undefined {
  const metadata = openClawMetadata(source);
  if (!metadata) return undefined;

  const seq = metadata.seq;
  if (typeof seq === 'number' && Number.isFinite(seq)) return String(seq);
  if (typeof seq === 'string' && seq.trim()) return seq.trim();
  return undefined;
}

function openClawMetadata(source: unknown): Record<string, unknown> | undefined {
  if (!isRecord(source)) return undefined;

  const metadata = source.__openclaw;
  return isRecord(metadata) ? metadata : undefined;
}

function toolResultErrorMessage(record: Record<string, unknown>): string {
  const result = toolResultValue(record);
  if (typeof result === 'string' && result.trim()) return result;

  const toolCallId = toolCallIdFrom(record);
  return toolCallId ? `tool ${toolCallId} failed` : 'tool failed';
}

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isToolResultBlock(block: Record<string, unknown>): boolean {
  return block.type === 'tool_result' || block.type === 'toolResult';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
