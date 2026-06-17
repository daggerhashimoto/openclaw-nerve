import type { ChatMessage } from '@/types';
import { splitToolCallMessage, countUserChatMsgs } from '@/features/chat/operations';
import type { ChatMsg, ToolGroupEntry } from '@/features/chat/types';
import { extractTTSMarkers } from '@/features/tts/useTTS';
import { describeToolUse, renderMarkdown, renderToolResults } from '@/utils/helpers';
import { stripVoiceTTSHint } from '../../../../shared/chat-upload-manifest';
import type {
  SessionTimeline,
  TimelineItem,
  TimelineProjection,
  TimelineProjectionOptions,
  TimelineTurn,
  ToolCallTimelineItem,
  ToolResultTimelineItem,
  UserTimelineItem,
} from './types';
import { orderedTimelineItems, timelineItemsByTurnId } from './reducer';

export function projectTimeline(
  timeline: SessionTimeline,
  options: TimelineProjectionOptions = {},
): TimelineProjection {
  const orderedItems = orderedTimelineItems(timeline);
  const itemsByTurnId = timelineItemsByTurnId(timeline);
  const activeTurnIds = new Set(
    timeline.turns
      .filter((turn) => isActiveTurn(turn, itemsByTurnId[turn.id] ?? [], options.failedIdempotencyKeys))
      .map((turn) => turn.id),
  );
  const projectionContext = { ...options, activeTurnIds };
  const { messages, totalMessages } = projectMessages(orderedItems, projectionContext, options.visibleCount);
  const runningTool = findLastRunningTool(orderedItems, activeTurnIds);
  const streamingAssistant = orderedItems.some((item) =>
    (item.kind === 'assistant_message' || item.kind === 'assistant_segment') &&
    (item.isStreaming || item.status === 'running') &&
    item.text.trim().length > 0,
  );
  const isGenerating = activeTurnIds.size > 0 || orderedItems.some((item) =>
    isActiveItem(item, activeTurnIds, options.failedIdempotencyKeys),
  );
  const currentToolDescription = runningTool ? toolDescription(runningTool) : null;

  return {
    messages,
    totalMessages,
    isGenerating,
    processingStage: runningTool
      ? 'tool_use'
      : streamingAssistant
        ? 'streaming'
        : isGenerating
          ? 'thinking'
          : null,
    lastEventTimestamp: timeline.updatedAt,
    activityLog: buildActivityLog(orderedItems, activeTurnIds),
    currentToolDescription,
  };
}

interface ProjectionContext extends TimelineProjectionOptions {
  activeTurnIds: ReadonlySet<string>;
}

function projectItem(
  item: TimelineItem,
  options: ProjectionContext,
): ChatMsg[] {
  switch (item.kind) {
    case 'tool_group':
      return [];
    case 'user_message':
      return projectUserItem(item, options);
    case 'assistant_message':
    case 'assistant_segment':
      return projectAssistantItem(item);
    case 'thinking':
      return projectThinkingItem(item);
    case 'tool_call':
      return [projectToolCallItem(item)];
    case 'tool_result':
      return [projectToolResultItem(item)];
    case 'system_event':
      return projectSystemItem(item);
  }
}

function projectMessages(
  orderedItems: TimelineItem[],
  options: ProjectionContext,
  visibleCount?: number,
): { messages: ChatMsg[]; totalMessages: number } {
  if (!Number.isFinite(visibleCount) || visibleCount === undefined || visibleCount < 0) {
    const messages = tagIntermediateMessagesLinear(groupConsecutiveToolCalls(
      orderedItems.flatMap((item) => projectItem(item, options)),
    ));
    return { messages, totalMessages: messages.length };
  }

  if (visibleCount === 0) {
    return { messages: [], totalMessages: countProjectedMessages(orderedItems) };
  }

  const visibleMessages: ChatMsg[] = [];
  let totalMessages = 0;
  let index = orderedItems.length - 1;

  while (index >= 0) {
    const item = orderedItems[index];
    if (item.kind === 'tool_group') {
      index--;
      continue;
    }

    if (item.kind === 'tool_call') {
      const toolItems: ToolCallTimelineItem[] = [];
      let nextIndex = index;
      for (; nextIndex >= 0; nextIndex--) {
        const candidate = orderedItems[nextIndex];
        if (candidate.kind === 'tool_group') continue;
        if (candidate.kind !== 'tool_call') {
          if (projectItemCount(candidate) === 0) continue;
          break;
        }
        toolItems.unshift(candidate);
      }

      totalMessages += 1;
      if (visibleMessages.length < visibleCount) {
        const grouped = groupConsecutiveToolCalls(toolItems.map(projectToolCallItem));
        visibleMessages.unshift(...grouped);
      }
      index = nextIndex;
      continue;
    }

    const messageCount = projectItemCount(item);
    totalMessages += messageCount;
    if (messageCount > 0 && visibleMessages.length < visibleCount) {
      const remaining = visibleCount - visibleMessages.length;
      const projected = projectItem(item, options);
      visibleMessages.unshift(...projected.slice(-remaining));
    }
    index--;
  }

  return {
    messages: tagIntermediateMessagesLinear(visibleMessages),
    totalMessages,
  };
}

function projectUserItem(
  item: UserTimelineItem,
  options: ProjectionContext,
): ChatMsg[] {
  const failedBySend = Boolean(item.idempotencyKey && options.failedIdempotencyKeys?.has(item.idempotencyKey));
  const failed = failedBySend || item.status === 'failed';
  const turnIsActive = Boolean(item.turnId && options.activeTurnIds.has(item.turnId));
  const pending = !failed && turnIsActive && (
    Boolean(item.pending) ||
    item.status === 'provisional' ||
    item.status === 'running'
  );
  const text = stripVoiceTTSHint(item.text);
  const projected = splitMessageWithStableIds({
    role: 'user',
    content: text,
    timestamp: item.createdAt,
  }, item.id);
  const messages = projected.length > 0 ? projected : fallbackUserMessagesForMedia(item);

  return messages.map((message) => ({
    ...message,
    ...(message.role === 'user' ? { html: renderMarkdown(message.rawText) } : {}),
    ...(message.role === 'user' ? userMediaProps(item) : {}),
    tempId: message.role === 'user' ? item.idempotencyKey : message.tempId,
    pending: message.role === 'user' ? pending : message.pending,
    failed: message.role === 'user' ? failed : message.failed,
  }));
}

function projectAssistantItem(
  item: Extract<TimelineItem, { kind: 'assistant_message' | 'assistant_segment' }>,
): ChatMsg[] {
  if (!item.text.trim() && !item.isStreaming) return [];
  const { ttsText } = extractTTSMarkers(item.text);
  const spokenText = ttsText?.trim();
  return splitMessageWithStableIds({
    role: 'assistant',
    content: item.text,
    timestamp: item.createdAt,
  }, item.id).map((message) => ({
    ...message,
    streaming: item.isStreaming || item.status === 'running',
    ...(message.role === 'assistant' && spokenText ? { ttsText: spokenText } : {}),
  }));
}

function projectThinkingItem(item: Extract<TimelineItem, { kind: 'thinking' }>): ChatMsg[] {
  if (!item.text.trim()) return [];
  return [{
    msgId: item.id,
    role: 'assistant',
    html: renderMarkdown(item.text),
    rawText: item.text,
    timestamp: dateFromMs(item.createdAt),
    streaming: item.status === 'running',
    isThinking: true,
    thinkingText: item.text,
    ...(item.durationMs ? { thinkingDurationMs: item.durationMs } : {}),
  }];
}

function projectToolCallItem(item: ToolCallTimelineItem): ChatMsg {
  const args = toRecord(item.args);
  const description = toolDescription(item);
  const rawText = toolRawText(item, args);

  return {
    msgId: item.id,
    role: 'tool',
    html: renderMarkdown(description),
    rawText,
    timestamp: dateFromMs(item.createdAt),
    streaming: item.status === 'running',
  };
}

function projectToolResultItem(item: ToolResultTimelineItem): ChatMsg {
  const text = item.text ?? stringifyToolValue(item.error ?? item.result ?? '');
  return {
    msgId: item.id,
    role: 'toolResult',
    html: renderToolResults(renderMarkdown(text)),
    rawText: text,
    timestamp: dateFromMs(item.createdAt),
    streaming: item.status === 'running',
    failed: item.status === 'failed' || Boolean(item.error),
  };
}

function projectSystemItem(item: Extract<TimelineItem, { kind: 'system_event' }>): ChatMsg[] {
  return splitMessageWithStableIds({
    role: 'system',
    content: item.text,
    timestamp: item.createdAt,
  }, item.id).map((message) => ({
    ...message,
    failed: item.severity === 'error',
  }));
}

function splitMessageWithStableIds(message: ChatMessage, baseId: string): ChatMsg[] {
  const split = splitToolCallMessage(message);
  return split.map((chatMessage, index) => ({
    ...chatMessage,
    msgId: split.length === 1 ? baseId : `${baseId}:${index}`,
  }));
}

function fallbackUserMessagesForMedia(item: UserTimelineItem): ChatMsg[] {
  if (!item.images?.length && !item.uploadAttachments?.length) return [];
  const text = stripVoiceTTSHint(item.text);

  return [{
    msgId: item.id,
    role: 'user',
    html: renderMarkdown(text),
    rawText: text,
    timestamp: dateFromMs(item.createdAt),
    streaming: false,
    ...userMediaProps(item),
    ...(text.startsWith('[voice] ') ? { isVoice: true } : {}),
  }];
}

function userMediaProps(item: UserTimelineItem): Pick<ChatMsg, 'images' | 'uploadAttachments'> {
  return {
    ...(item.images?.length ? { images: item.images } : {}),
    ...(item.uploadAttachments?.length ? { uploadAttachments: item.uploadAttachments } : {}),
  };
}

function groupConsecutiveToolCalls(messages: ChatMsg[]): ChatMsg[] {
  const grouped: ChatMsg[] = [];
  let toolBuffer: ChatMsg[] = [];

  const flushTools = () => {
    if (toolBuffer.length === 0) return;
    if (toolBuffer.length === 1) {
      grouped.push(toolBuffer[0]);
      toolBuffer = [];
      return;
    }

    const entries: ToolGroupEntry[] = toolBuffer.map((tool) => ({
      html: tool.html,
      rawText: tool.rawText,
      preview: plainText(tool.html) || tool.rawText.slice(0, 80),
    }));
    grouped.push({
      msgId: `tool-group:${toolBuffer[0].msgId ?? 'first'}:${toolBuffer[toolBuffer.length - 1].msgId ?? 'last'}`,
      role: 'tool',
      html: `Used ${entries.length} tools`,
      rawText: entries.map((entry) => entry.preview).join('\n'),
      timestamp: toolBuffer[0].timestamp,
      toolGroup: entries,
    });
    toolBuffer = [];
  };

  for (const message of messages) {
    if (message.role === 'tool' && !message.toolGroup) {
      toolBuffer.push(message);
    } else {
      flushTools();
      grouped.push(message);
    }
  }
  flushTools();
  return grouped;
}

function tagIntermediateMessagesLinear(messages: ChatMsg[]): ChatMsg[] {
  const tagged = messages.map((message) => ({ ...message }));
  let hasToolAfterBeforeNextUser = false;

  for (let index = tagged.length - 1; index >= 0; index--) {
    const message = tagged[index];
    if (message.role === 'user') {
      hasToolAfterBeforeNextUser = false;
      continue;
    }
    if (message.role === 'tool' || message.role === 'toolResult' || message.toolGroup) {
      hasToolAfterBeforeNextUser = true;
      continue;
    }
    if (
      message.role === 'assistant' &&
      !message.isThinking &&
      hasToolAfterBeforeNextUser &&
      !(message.charts?.length)
    ) {
      message.intermediate = true;
    }
  }

  return tagged;
}

function countProjectedMessages(orderedItems: TimelineItem[]): number {
  let count = 0;
  let inToolRun = false;

  for (const item of orderedItems) {
    if (item.kind === 'tool_group') continue;
    if (item.kind === 'tool_call') {
      if (!inToolRun) count += 1;
      inToolRun = true;
      continue;
    }
    const itemCount = projectItemCount(item);
    if (itemCount > 0) {
      inToolRun = false;
    }
    count += itemCount;
  }

  return count;
}

export function projectItemCount(item: TimelineItem): number {
  switch (item.kind) {
    case 'tool_group':
    case 'tool_call':
      return 0;
    case 'assistant_message':
    case 'assistant_segment':
      return item.text.trim() || item.isStreaming ? 1 : 0;
    case 'thinking':
      return item.text.trim() ? 1 : 0;
    case 'user_message': {
      const textCount = countUserChatMsgs(item.text);
      if (textCount > 0) return textCount;
      if (item.images?.length || item.uploadAttachments?.length) return 1;
      return 0;
    }
    case 'tool_result':
    case 'system_event':
      return 1;
  }
}

function buildActivityLog(
  orderedItems: TimelineItem[],
  activeTurnIds: ReadonlySet<string>,
) {
  return orderedItems
    .filter((item): item is ToolCallTimelineItem => item.kind === 'tool_call')
    .filter((tool) => tool.status === 'running' || Boolean(tool.turnId && activeTurnIds.has(tool.turnId)))
    .slice(-8)
    .map((tool) => ({
      id: tool.id,
      toolName: tool.name,
      description: toolDescription(tool),
      startedAt: tool.createdAt,
      ...(tool.status === 'running' ? {} : { completedAt: tool.updatedAt }),
      phase: tool.status === 'running' ? 'running' as const : 'completed' as const,
    }));
}

function findLastRunningTool(
  orderedItems: TimelineItem[],
  activeTurnIds: ReadonlySet<string>,
): ToolCallTimelineItem | null {
  for (let index = orderedItems.length - 1; index >= 0; index--) {
    const item = orderedItems[index];
    if (
      item.kind === 'tool_call' &&
      item.status === 'running' &&
      (!item.turnId || activeTurnIds.size === 0 || activeTurnIds.has(item.turnId))
    ) {
      return item;
    }
  }
  return null;
}

function isActiveTurn(
  turn: TimelineTurn,
  turnItems: TimelineItem[],
  failedIdempotencyKeys?: ReadonlySet<string>,
): boolean {
  if (turn.status !== 'running') return false;

  if (turnItems.length === 0) return true;

  const onlyCompletedHistoryInputs = turnItems.every((item) =>
    item.kind === 'user_message' &&
    item.source === 'history' &&
    item.status === 'complete'
  );
  if (onlyCompletedHistoryInputs && isSyntheticHistoryInputRun(turn.runId)) return false;

  const outputItems = turnItems.filter((item) => item.kind !== 'user_message');
  if (outputItems.length > 0) return true;

  return turnItems.some((item) => {
    if (item.kind !== 'user_message') return true;
    return !item.idempotencyKey || !failedIdempotencyKeys?.has(item.idempotencyKey);
  });
}

function isSyntheticHistoryInputRun(runId: string): boolean {
  return (
    runId.startsWith('history:user:') ||
    runId.startsWith('optimistic:message:history-')
  );
}

function isActiveItem(
  item: TimelineItem,
  activeTurnIds: ReadonlySet<string>,
  failedIdempotencyKeys?: ReadonlySet<string>,
): boolean {
  if (item.status === 'running') return true;
  if (item.status !== 'provisional') return false;
  if (item.kind === 'user_message' && item.idempotencyKey && failedIdempotencyKeys?.has(item.idempotencyKey)) {
    return false;
  }
  return Boolean(item.turnId && activeTurnIds.has(item.turnId));
}

function toolDescription(item: ToolCallTimelineItem): string {
  return describeToolUse(item.name, toRecord(item.args)) ?? (item.name || 'using tool');
}

function toolRawText(item: ToolCallTimelineItem, args: Record<string, unknown>): string {
  const base = `**tool:** \`${item.name}\`\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\``;
  if (item.error) return `${base}\n\nError: ${item.error}`;
  if (item.result === undefined) return base;
  return `${base}\n\nResult:\n${stringifyToolValue(item.result)}`;
}

function stringifyToolValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function plainText(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

function dateFromMs(value: number): Date {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : new Date();
}
