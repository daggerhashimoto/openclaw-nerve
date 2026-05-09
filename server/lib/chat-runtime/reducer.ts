import {
  assistantItemId,
  assistantSegmentItemId,
  fingerprintText,
  thinkingItemId,
  toolCallItemId,
  toolGroupItemId,
  turnId,
  userItemId,
} from './id.js';
import type {
  AssistantTimelineItem,
  RuntimeEvent,
  SessionTimeline,
  ThinkingTimelineItem,
  TimelineItem,
  TimelineOrderKey,
  TimelinePatchOp,
  TimelineTurn,
  ToolCallTimelineItem,
  ToolGroupTimelineItem,
  UserTimelineItem,
} from './types.js';

const USER_BLOCK = 0;
const THINKING_BLOCK = 10;
const TOOL_BLOCK = 20;
const ASSISTANT_BLOCK = 100;
const OUTPUT_BLOCK_STEP = 10;

type AssistantItemResolution =
  | { action: 'upsert'; itemId: string; useEventOrder: boolean }
  | { action: 'ignore' };

export function createEmptyTimeline(sessionKey: string): SessionTimeline {
  return {
    sessionKey,
    version: 0,
    cursor: '0',
    hydrationState: 'cold',
    turns: [],
    items: {},
    updatedAt: 0,
  };
}

export function reduceRuntimeEvent(timeline: SessionTimeline, event: RuntimeEvent): SessionTimeline {
  if (event.sessionKey !== timeline.sessionKey) return timeline;

  const draft = cloneTimeline(timeline);

  switch (event.type) {
    case 'turn_started': {
      const turn = findExistingTurn(draft, event.runId)
        ?? rebindSinglePendingOptimisticPromptTurn(draft, event.runId, event.at)
        ?? ensureTurn(draft, event.runId, event.at);
      if (!isTerminalTurnStatus(turn.status)) {
        turn.status = 'running';
        turn.finalizedAt = undefined;
      }
      break;
    }

    case 'user_message_committed': {
      const runId = event.runId ?? optimisticRunId(event);
      let itemId = userItemId({
        sessionKey: event.sessionKey,
        messageId: event.messageId,
        idempotencyKey: event.idempotencyKey,
        text: event.text,
        timestamp: event.at,
      });
      let existing = itemOfKind(draft.items[itemId], 'user_message');
      let turn: TimelineTurn | undefined;
      if (isStaleOptimisticUserRetry(draft, existing, event)) break;
      if (event.idempotencyKey) {
        const optimisticItemId = userItemId({
          sessionKey: event.sessionKey,
          idempotencyKey: event.idempotencyKey,
        });
        const optimisticItem = itemOfKind(draft.items[optimisticItemId], 'user_message');
        if (optimisticItem) {
          const optimisticTurn = optimisticItem.turnId
            ? draft.turns.find((candidate) => candidate.id === optimisticItem.turnId)
            : undefined;
          const persistedRunId = event.runId;
          const realRunTurn = persistedRunId
            ? draft.turns.find((candidate) => candidate.runId === persistedRunId || candidate.id === turnId(event.sessionKey, persistedRunId))
            : undefined;
          itemId = optimisticItemId;
          existing = optimisticItem;

          if (
            event.runId &&
            optimisticTurn &&
            realRunTurn &&
            realRunTurn.id !== optimisticTurn.id &&
            isPromptOnlyInputTurn(optimisticTurn, optimisticItemId)
          ) {
            turn = realRunTurn;
            removeValue(optimisticTurn.inputItemIds, optimisticItemId);
            neutralizeTurn(optimisticTurn, event.at);
          } else if (event.runId && optimisticTurn && isPromptOnlyInputTurn(optimisticTurn, optimisticItemId)) {
            optimisticTurn.runId = event.runId;
            turn = optimisticTurn;
          }
        }
      }
      turn = turn ?? ensureTurn(draft, runId, event.at);
      const isHistoryBacked = Boolean(event.messageId);
      const orderKey = existing?.turnId && existing.turnId !== turn.id
        ? orderKeyFor(turn, USER_BLOCK, turn.inputItemIds.length)
        : existing?.orderKey ?? orderKeyFor(turn, USER_BLOCK, turn.inputItemIds.length);
      const item: UserTimelineItem = {
        ...baseItem(existing, itemId, event.sessionKey, turn, orderKey, event.at),
        kind: 'user_message',
        text: event.text,
        idempotencyKey: event.idempotencyKey,
        messageId: event.messageId,
        pending: isHistoryBacked ? false : true,
        status: isHistoryBacked ? 'complete' : 'provisional',
        source: isHistoryBacked ? 'history' : 'optimistic',
      };

      draft.items[itemId] = item;
      detachInputItemFromOtherTurns(draft, itemId, turn.id);
      appendUnique(turn.inputItemIds, itemId);
      break;
    }

    case 'thinking_started':
    case 'thinking_delta':
    case 'thinking_final': {
      const turn = ensureTurn(draft, event.runId, event.at);
      if (shouldIgnoreEventForTerminalTurn(turn, event)) break;

      const itemId = thinkingItemId(event.sessionKey, event.runId, event.blockIndex);
      const existing = itemOfKind(draft.items[itemId], 'thinking');
      if (event.type !== 'thinking_final' && existing && isTerminalItemStatus(existing.status)) break;

      const isFinal = event.type === 'thinking_final';
      const text = event.type === 'thinking_started' ? existing?.text ?? '' : event.text;
      if (!existing) closeOpenToolGroupsForOutputBoundary(draft, turn, event.at);
      const item: ThinkingTimelineItem = {
        ...baseItem(
          existing,
          itemId,
          event.sessionKey,
          turn,
          existing?.orderKey ?? nextOutputOrderKey(draft, turn, THINKING_BLOCK + event.blockIndex),
          event.at,
        ),
        kind: 'thinking',
        text,
        durationMs: isFinal ? event.durationMs : existing?.durationMs,
        status: isFinal ? 'complete' : 'running',
        source: isFinal ? 'history' : 'live',
      };

      draft.items[itemId] = item;
      appendUnique(turn.outputItemIds, itemId);
      break;
    }

    case 'tool_started':
    case 'tool_finished': {
      const turn = ensureTurn(draft, event.runId, event.at);
      const toolId = toolCallItemId(event.sessionKey, event.runId, event.toolCallId);
      const existingTool = itemOfKind(draft.items[toolId], 'tool_call');
      if (isTerminalTurnStatus(turn.status)) {
        if (event.type === 'tool_finished' && existingTool) {
          draft.items[toolId] = buildToolItem(existingTool, toolId, draft, turn, event);
          closeToolGroupsForTurn(draft, turn, event.at, groupTerminalStatusForTurn(turn));
        }
        break;
      }

      const nextTool = buildToolItem(existingTool, toolId, draft, turn, event);

      draft.items[toolId] = nextTool;
      upsertToolGroup(draft, turn, toolId, event.at);
      break;
    }

    case 'assistant_delta':
    case 'assistant_final': {
      const turn = ensureTurn(draft, event.runId, event.at);
      if (shouldIgnoreEventForTerminalTurn(turn, event)) break;

      const resolution = resolveAssistantTimelineItem(draft, turn, event);
      if (resolution.action === 'ignore') break;
      const itemId = resolution.itemId;
      const existing = itemOfKind(draft.items[itemId], 'assistant_message');
      if (event.type === 'assistant_delta' && existing && isTerminalItemStatus(existing.status)) break;
      if (event.type === 'assistant_delta' && existing && shouldIgnoreAssistantDelta(existing, event)) break;

      const isFinal = event.type === 'assistant_final';
      closeOpenToolGroupsForOutputBoundary(draft, turn, event.at);
      const orderKey = resolution.useEventOrder
        ? nextOutputOrderKey(draft, turn, ASSISTANT_BLOCK)
        : existing?.orderKey ?? nextOutputOrderKey(draft, turn, ASSISTANT_BLOCK);
      const item: AssistantTimelineItem = {
        ...baseItem(
          existing,
          itemId,
          event.sessionKey,
          turn,
          orderKey,
          event.at,
        ),
        kind: 'assistant_message',
        text: event.text,
        isStreaming: !isFinal,
        seq: event.type === 'assistant_delta' ? event.seq ?? existing?.seq : existing?.seq,
        segmentIndex: event.segmentIndex ?? existing?.segmentIndex,
        finalText: isFinal ? event.text : existing?.finalText,
        stopReason: isFinal ? event.stopReason : existing?.stopReason,
        status: isFinal ? 'complete' : 'running',
        source: isFinal ? 'history' : 'live',
      };

      draft.items[itemId] = item;
      appendUnique(turn.outputItemIds, itemId);
      break;
    }

    case 'turn_finalized': {
      const turn = ensureTurn(draft, event.runId, event.at);
      if (isTerminalTurnStatus(turn.status)) break;

      turn.status = 'finalized';
      turn.finalizedAt = event.at;
      closeThinkingItemsForTurn(draft, turn, event.at, 'complete');
      closeToolGroupsForTurn(draft, turn, event.at, 'finalized');
      break;
    }

    case 'turn_failed': {
      const turn = ensureTurn(draft, event.runId, event.at);
      if (isTerminalTurnStatus(turn.status)) break;

      turn.status = 'failed';
      turn.finalizedAt = event.at;
      closeThinkingItemsForTurn(draft, turn, event.at, 'failed');
      closeToolGroupsForTurn(draft, turn, event.at, 'failed');
      break;
    }

    case 'user_message_failed': {
      const itemId = userItemId({
        sessionKey: event.sessionKey,
        idempotencyKey: event.idempotencyKey,
      });
      const item = itemOfKind(draft.items[itemId], 'user_message')
        ?? Object.values(draft.items).find((candidate) =>
          candidate.kind === 'user_message' &&
          candidate.idempotencyKey === event.idempotencyKey
        );
      if (!item || item.kind !== 'user_message') break;

      draft.items[item.id] = {
        ...item,
        pending: false,
        status: 'failed',
        updatedAt: Math.max(item.updatedAt, event.at),
      };

      const turn = draft.turns.find((candidate) => candidate.id === item.turnId);
      if (turn && !isTerminalTurnStatus(turn.status)) {
        turn.status = 'failed';
        turn.finalizedAt = event.at;
        closeThinkingItemsForTurn(draft, turn, event.at, 'failed');
        closeToolGroupsForTurn(draft, turn, event.at, 'failed');
      }
      break;
    }

    case 'history_snapshot': {
      draft.hydrationState = 'ready';
      break;
    }
  }

  return advanceTimeline(draft, event.at);
}

export function timelineItemsInOrder(timeline: SessionTimeline): TimelineItem[] {
  return Object.values(timeline.items).sort(compareItems);
}

export function buildPatchFromTimeline(timeline: SessionTimeline): TimelinePatchOp[] {
  return [
    { op: 'set_hydration_state', state: timeline.hydrationState },
    ...timeline.turns.map((turn) => ({ op: 'upsert_turn' as const, turn })),
    ...timelineItemsInOrder(timeline).map((item) => ({ op: 'upsert_item' as const, item })),
  ];
}

function cloneTimeline(timeline: SessionTimeline): SessionTimeline {
  return {
    ...timeline,
    turns: timeline.turns.map((turn) => ({
      ...turn,
      orderBase: { ...turn.orderBase },
      inputItemIds: [...turn.inputItemIds],
      outputItemIds: [...turn.outputItemIds],
    })),
    items: { ...timeline.items },
  };
}

function ensureTurn(timeline: SessionTimeline, runId: string, at: number): TimelineTurn {
  const id = turnId(timeline.sessionKey, runId);
  const existing = findExistingTurn(timeline, runId);
  if (existing) return existing;

  const turn: TimelineTurn = {
    id,
    sessionKey: timeline.sessionKey,
    runId,
    status: 'running',
    startedAt: at,
    inputItemIds: [],
    outputItemIds: [],
    orderBase: { turn: timeline.turns.length, block: 0, sub: 0 },
  };
  timeline.turns.push(turn);
  return turn;
}

function findExistingTurn(timeline: SessionTimeline, runId: string): TimelineTurn | undefined {
  const id = turnId(timeline.sessionKey, runId);
  return timeline.turns.find((turn) => turn.id === id || turn.runId === runId);
}

function rebindSinglePendingOptimisticPromptTurn(
  timeline: SessionTimeline,
  runId: string,
  at: number,
): TimelineTurn | undefined {
  const candidates = timeline.turns
    .map((turn) => {
      if (!turn.runId.startsWith('optimistic:')) return undefined;
      if (isTerminalTurnStatus(turn.status)) return undefined;
      if (turn.inputItemIds.length !== 1 || turn.outputItemIds.length !== 0) return undefined;

      const input = itemOfKind(timeline.items[turn.inputItemIds[0]], 'user_message');
      if (!input || input.source !== 'optimistic' || input.pending === false) return undefined;

      return { turn, input };
    })
    .filter((candidate): candidate is { turn: TimelineTurn; input: UserTimelineItem } => Boolean(candidate));

  if (candidates.length !== 1) return undefined;

  const { turn, input } = candidates[0];
  turn.runId = runId;
  turn.status = 'running';
  turn.finalizedAt = undefined;
  timeline.items[input.id] = {
    ...input,
    runId,
    turnId: turn.id,
    updatedAt: Math.max(input.updatedAt, at),
  };
  return turn;
}

function baseItem<TItem extends TimelineItem | undefined>(
  existing: TItem,
  id: string,
  sessionKey: string,
  turn: TimelineTurn,
  orderKey: TimelineOrderKey,
  at: number,
): Omit<TimelineItem, 'kind'> {
  return {
    id,
    sessionKey,
    turnId: turn.id,
    runId: turn.runId,
    orderKey,
    createdAt: existing?.createdAt ?? at,
    updatedAt: Math.max(existing?.updatedAt ?? at, at),
    status: existing?.status ?? 'running',
    source: existing?.source ?? 'live',
  };
}

function buildToolItem(
  existing: ToolCallTimelineItem | undefined,
  itemId: string,
  timeline: SessionTimeline,
  turn: TimelineTurn,
  event: Extract<RuntimeEvent, { type: 'tool_started' | 'tool_finished' }>,
): ToolCallTimelineItem {
  const isFinished = event.type === 'tool_finished';
  const isFailed = isFinished && Boolean(event.error);
  const terminalStatus = existing?.status === 'complete' || existing?.status === 'failed';
  return {
    ...baseItem(
      existing,
      itemId,
      event.sessionKey,
      turn,
      existing?.orderKey ?? orderKeyFor(turn, TOOL_BLOCK, nextToolSub(timeline, turn)),
      event.at,
    ),
    kind: 'tool_call',
    toolCallId: event.toolCallId,
    name: event.type === 'tool_started' ? event.name : existing?.name ?? 'unknown',
    args: event.type === 'tool_started' ? event.args : existing?.args ?? {},
    result: isFinished ? event.result ?? existing?.result : existing?.result,
    error: isFinished ? event.error ?? existing?.error : existing?.error,
    status: isFinished ? (isFailed ? 'failed' : 'complete') : terminalStatus ? existing.status : 'running',
    source: isFinished || terminalStatus ? 'history' : 'live',
  };
}

function upsertToolGroup(timeline: SessionTimeline, turn: TimelineTurn, toolId: string, at: number): void {
  const existing = findToolGroupContainingTool(timeline, turn, toolId) ?? findOpenToolGroupForTurn(timeline, turn);
  const groupId = existing?.id ?? toolGroupItemId(timeline.sessionKey, turn.runId, nextToolGroupIndex(timeline, turn));
  const childItemIds = existing?.childItemIds ? [...existing.childItemIds] : [];
  appendUnique(childItemIds, toolId);
  const allChildrenTerminal = areToolGroupChildrenTerminal(timeline, childItemIds);
  const isClosed = Boolean(existing?.closed) || allChildrenTerminal;

  const group: ToolGroupTimelineItem = {
    ...baseItem(
      existing,
      groupId,
      timeline.sessionKey,
      turn,
      existing?.orderKey ?? nextOutputOrderKey(timeline, turn, TOOL_BLOCK),
      at,
    ),
    kind: 'tool_group',
    childItemIds,
    closed: isClosed,
    status: isClosed ? closedToolGroupStatus(timeline, childItemIds, existing?.status) : 'running',
    source: isClosed ? 'history' : 'live',
  };

  timeline.items[groupId] = group;
  alignToolGroupChildOrder(timeline, group, at);
  appendUnique(turn.outputItemIds, groupId);
  removeValue(turn.outputItemIds, toolId);
}

function findToolGroupContainingTool(timeline: SessionTimeline, turn: TimelineTurn, toolId: string): ToolGroupTimelineItem | undefined {
  return toolGroupsForTurn(timeline, turn).find((group) => group.childItemIds.includes(toolId));
}

function findOpenToolGroupForTurn(timeline: SessionTimeline, turn: TimelineTurn): ToolGroupTimelineItem | undefined {
  return toolGroupsForTurn(timeline, turn).find((group) => !group.closed);
}

function toolGroupsForTurn(timeline: SessionTimeline, turn: TimelineTurn): ToolGroupTimelineItem[] {
  return Object.values(timeline.items)
    .map((item) => itemOfKind(item, 'tool_group'))
    .filter((group): group is ToolGroupTimelineItem => Boolean(group && group.turnId === turn.id))
    .sort(compareItems);
}

function nextToolGroupIndex(timeline: SessionTimeline, turn: TimelineTurn): number {
  let index = 0;
  while (timeline.items[toolGroupItemId(timeline.sessionKey, turn.runId, index)]) index += 1;
  return index;
}

function nextOutputOrderKey(timeline: SessionTimeline, turn: TimelineTurn, preferredBlock: number): TimelineOrderKey {
  const lastOutputOrderKey = [...turn.outputItemIds]
    .reverse()
    .map((itemId) => timeline.items[itemId]?.orderKey)
    .find((orderKey): orderKey is TimelineOrderKey => Boolean(orderKey));

  if (!lastOutputOrderKey) return orderKeyFor(turn, preferredBlock, 0);
  if (lastOutputOrderKey.block >= preferredBlock) {
    return orderKeyFor(turn, lastOutputOrderKey.block + OUTPUT_BLOCK_STEP, 0);
  }
  return orderKeyFor(turn, preferredBlock, 0);
}

function alignToolGroupChildOrder(timeline: SessionTimeline, group: ToolGroupTimelineItem, at: number): void {
  group.childItemIds.forEach((childItemId, index) => {
    const child = itemOfKind(timeline.items[childItemId], 'tool_call');
    if (!child) return;

    const orderKey = { ...group.orderKey, sub: group.orderKey.sub + index + 1 };
    timeline.items[childItemId] = {
      ...child,
      orderKey,
      updatedAt: Math.max(child.updatedAt, at),
    };
  });
}

function areToolGroupChildrenTerminal(timeline: SessionTimeline, childItemIds: string[]): boolean {
  return childItemIds.every((childItemId) => {
    const child = itemOfKind(timeline.items[childItemId], 'tool_call');
    return child ? isTerminalItemStatus(child.status) : false;
  });
}

function closedToolGroupStatus(
  timeline: SessionTimeline,
  childItemIds: string[],
  existingStatus?: TimelineItem['status'],
): ToolGroupTimelineItem['status'] {
  const childStatuses = childItemIds.map((childItemId) => itemOfKind(timeline.items[childItemId], 'tool_call')?.status);
  if (childStatuses.some((status) => status === 'failed' || status === 'aborted')) return 'failed';
  if (areToolGroupChildrenTerminal(timeline, childItemIds)) return 'complete';
  if (existingStatus && existingStatus !== 'running') return existingStatus;
  return 'failed';
}

function closeOpenToolGroupsForOutputBoundary(timeline: SessionTimeline, turn: TimelineTurn, at: number): void {
  for (const group of toolGroupsForTurn(timeline, turn)) {
    if (group.closed) continue;

    const childItemIds = [...group.childItemIds];
    terminalizeToolGroupChildren(timeline, childItemIds, at, 'failed');
    timeline.items[group.id] = {
      ...group,
      childItemIds,
      closed: true,
      status: closedToolGroupStatus(timeline, childItemIds, group.status),
      source: 'history',
      updatedAt: at,
    };
  }
}

function closeThinkingItemsForTurn(
  timeline: SessionTimeline,
  turn: TimelineTurn,
  at: number,
  status: 'complete' | 'failed',
): void {
  for (const item of Object.values(timeline.items)) {
    const thinking = itemOfKind(item, 'thinking');
    if (!thinking || thinking.turnId !== turn.id || isTerminalItemStatus(thinking.status)) continue;

    timeline.items[thinking.id] = {
      ...thinking,
      status,
      source: 'history',
      updatedAt: Math.max(thinking.updatedAt, at),
    };
  }
}

function closeToolGroupsForTurn(
  timeline: SessionTimeline,
  turn: TimelineTurn,
  at: number,
  terminalStatus: 'finalized' | 'failed',
): void {
  for (const item of Object.values(timeline.items)) {
    const group = itemOfKind(item, 'tool_group');
    if (!group || group.turnId !== turn.id) continue;

    const childItemIds = [...group.childItemIds];
    terminalizeToolGroupChildren(
      timeline,
      childItemIds,
      at,
      terminalStatus === 'finalized' ? 'complete' : 'failed',
    );

    timeline.items[group.id] = {
      ...group,
      childItemIds,
      closed: true,
      status: closedToolGroupStatus(
        timeline,
        childItemIds,
        terminalStatus === 'finalized' ? 'complete' : 'failed',
      ),
      source: 'history',
      updatedAt: at,
    };
  }
}

function terminalizeToolGroupChildren(
  timeline: SessionTimeline,
  childItemIds: string[],
  at: number,
  status: 'complete' | 'failed',
): void {
  for (const childItemId of childItemIds) {
    const child = itemOfKind(timeline.items[childItemId], 'tool_call');
    if (!child || isTerminalItemStatus(child.status)) continue;

    timeline.items[childItemId] = {
      ...child,
      status,
      source: 'history',
      updatedAt: Math.max(child.updatedAt, at),
    };
  }
}

function itemOfKind<TKind extends TimelineItem['kind']>(
  item: TimelineItem | undefined,
  kind: TKind,
): Extract<TimelineItem, { kind: TKind }> | undefined {
  return item?.kind === kind ? (item as Extract<TimelineItem, { kind: TKind }>) : undefined;
}

function orderKeyFor(turn: TimelineTurn, block: number, sub: number): TimelineOrderKey {
  return { turn: turn.orderBase.turn, block, sub };
}

function resolveAssistantTimelineItem(
  timeline: SessionTimeline,
  turn: TimelineTurn,
  event: Extract<RuntimeEvent, { type: 'assistant_delta' | 'assistant_final' }>,
): AssistantItemResolution {
  const defaultItemId = assistantItemId(event.sessionKey, event.runId);
  const segmentItemId = event.segmentIndex === undefined
    ? undefined
    : assistantSegmentItemId(event.sessionKey, event.runId, event.segmentIndex);
  if (event.type === 'assistant_final' && event.segmentIndex === undefined) {
    const matchingSegment = findSegmentedAssistantItemForText(timeline, turn, event.text);
    if (matchingSegment) return { action: 'upsert', itemId: matchingSegment.id, useEventOrder: false };
    if (hasSegmentedAssistantItemsForTurn(timeline, turn)) return { action: 'ignore' };
  }

  if (segmentItemId && timeline.items[segmentItemId]) {
    return { action: 'upsert', itemId: segmentItemId, useEventOrder: false };
  }

  const defaultItem = itemOfKind(timeline.items[defaultItemId], 'assistant_message');
  if (defaultItem && isSameTurnRunItem(defaultItem, turn)) {
    if (event.segmentIndex === undefined || defaultItem.segmentIndex === event.segmentIndex) {
      return { action: 'upsert', itemId: defaultItemId, useEventOrder: false };
    }

    if (event.type === 'assistant_final' && defaultItem.segmentIndex === undefined) {
      if (assistantTextMatches(defaultItem, event.text)) {
        removeValue(turn.outputItemIds, defaultItemId);
        return { action: 'upsert', itemId: defaultItemId, useEventOrder: true };
      }
      removeDefaultAssistantItemIfSuperseded(timeline, turn, defaultItemId);
    }
  }

  return event.segmentIndex === undefined
    ? { action: 'upsert', itemId: defaultItemId, useEventOrder: false }
    : { action: 'upsert', itemId: segmentItemId ?? defaultItemId, useEventOrder: false };
}

function isSameTurnRunItem(
  item: TimelineItem,
  turn: TimelineTurn,
): boolean {
  return item.turnId === turn.id && item.runId === turn.runId;
}

function assistantTextMatches(item: AssistantTimelineItem, text: string): boolean {
  return item.text === text || item.finalText === text;
}

function shouldIgnoreAssistantDelta(
  existing: AssistantTimelineItem,
  event: Extract<RuntimeEvent, { type: 'assistant_delta' }>,
): boolean {
  if (event.seq !== undefined && existing.seq !== undefined) return event.seq < existing.seq;
  return event.at < existing.updatedAt;
}

function findSegmentedAssistantItemForText(
  timeline: SessionTimeline,
  turn: TimelineTurn,
  text: string,
): AssistantTimelineItem | undefined {
  return segmentedAssistantItemsForTurn(timeline, turn).find((item) => assistantTextMatches(item, text));
}

function hasSegmentedAssistantItemsForTurn(timeline: SessionTimeline, turn: TimelineTurn): boolean {
  return segmentedAssistantItemsForTurn(timeline, turn).length > 0;
}

function segmentedAssistantItemsForTurn(timeline: SessionTimeline, turn: TimelineTurn): AssistantTimelineItem[] {
  return Object.values(timeline.items).flatMap((item) => {
    const assistant = itemOfKind(item, 'assistant_message');
    return assistant && isSameTurnRunItem(assistant, turn) && assistant.segmentIndex !== undefined ? [assistant] : [];
  });
}

function removeDefaultAssistantItemIfSuperseded(
  timeline: SessionTimeline,
  turn: TimelineTurn,
  defaultItemId: string,
): void {
  delete timeline.items[defaultItemId];
  removeValue(turn.outputItemIds, defaultItemId);
}

function nextToolSub(timeline: SessionTimeline, turn: TimelineTurn): number {
  return Object.values(timeline.items).filter((item) => item.kind === 'tool_call' && item.turnId === turn.id).length + 1;
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function removeValue(values: string[], value: string): void {
  const index = values.indexOf(value);
  if (index !== -1) values.splice(index, 1);
}

function detachInputItemFromOtherTurns(timeline: SessionTimeline, itemId: string, retainedTurnId: string): void {
  for (const turn of timeline.turns) {
    if (turn.id !== retainedTurnId) removeValue(turn.inputItemIds, itemId);
  }
}

function neutralizeTurn(turn: TimelineTurn, at: number): void {
  turn.runId = `superseded:${turn.runId}`;
  turn.status = 'aborted';
  turn.finalizedAt = turn.finalizedAt ?? at;
  turn.inputItemIds = [];
  turn.outputItemIds = [];
}

function isPromptOnlyInputTurn(turn: TimelineTurn, inputItemId: string): boolean {
  return turn.outputItemIds.length === 0 && turn.inputItemIds.length === 1 && turn.inputItemIds[0] === inputItemId;
}

function isStaleOptimisticUserRetry(
  timeline: SessionTimeline,
  existing: UserTimelineItem | undefined,
  event: Extract<RuntimeEvent, { type: 'user_message_committed' }>,
): boolean {
  if (event.messageId || !event.idempotencyKey) return false;

  const historyItem = existing ?? Object.values(timeline.items).find((item) =>
    item.kind === 'user_message' &&
    item.idempotencyKey === event.idempotencyKey &&
    Boolean(item.messageId),
  );
  return Boolean(historyItem && historyItem.status === 'complete' && historyItem.source === 'history');
}

function isTerminalItemStatus(status: TimelineItem['status']): boolean {
  return status === 'complete' || status === 'failed' || status === 'aborted';
}

function isTerminalTurnStatus(status: TimelineTurn['status']): boolean {
  return status === 'finalized' || status === 'failed' || status === 'aborted';
}

function groupTerminalStatusForTurn(turn: TimelineTurn): 'finalized' | 'failed' {
  return turn.status === 'failed' || turn.status === 'aborted' ? 'failed' : 'finalized';
}

function shouldIgnoreEventForTerminalTurn(turn: TimelineTurn, event: RuntimeEvent): boolean {
  if (!isTerminalTurnStatus(turn.status)) return false;
  return (
    event.type === 'assistant_delta' ||
    event.type === 'thinking_started' ||
    event.type === 'thinking_delta'
  );
}

function compareItems(left: TimelineItem, right: TimelineItem): number {
  return (
    left.orderKey.turn - right.orderKey.turn ||
    left.orderKey.block - right.orderKey.block ||
    left.orderKey.sub - right.orderKey.sub ||
    left.createdAt - right.createdAt ||
    left.id.localeCompare(right.id)
  );
}

function optimisticRunId(event: Extract<RuntimeEvent, { type: 'user_message_committed' }>): string {
  if (event.messageId) return `optimistic:message:${event.messageId}`;
  if (event.idempotencyKey) return `optimistic:idempotency:${event.idempotencyKey}`;
  return `optimistic:fallback:${event.at}:${fingerprintText(event.text)}`;
}

function advanceTimeline(timeline: SessionTimeline, at: number): SessionTimeline {
  const version = timeline.version + 1;
  return {
    ...timeline,
    version,
    cursor: String(version),
    updatedAt: Math.max(timeline.updatedAt, at),
  };
}
