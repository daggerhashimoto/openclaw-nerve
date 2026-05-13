import type {
  RuntimeTimelineState,
  SessionTimeline,
  TimelineItem,
  TimelinePatch,
  TimelineSnapshot,
  TimelineTurn,
} from './types';

export function createEmptyRuntimeTimelineState(sessionKey: string): RuntimeTimelineState {
  return {
    sessionKey,
    cursor: '0',
    timeline: createEmptyTimeline(sessionKey),
  };
}

export function createEmptyTimeline(sessionKey: string): SessionTimeline {
  return {
    sessionKey,
    version: 0,
    cursor: '0',
    hydrationState: 'cold',
    turns: [],
    items: {},
    updatedAt: 0,
    orderedItems: [],
    itemIndexById: {},
    itemsByTurnId: {},
    turnIndexById: {},
  };
}

export function applyTimelineSnapshot(
  state: RuntimeTimelineState,
  snapshot: TimelineSnapshot,
): RuntimeTimelineState {
  if (snapshot.sessionKey !== state.sessionKey) return state;
  const cursorComparison = compareCursor(snapshot.cursor, state.cursor);
  if (cursorComparison < 0) return state;
  if (cursorComparison === 0 && state.timeline.hydrationState !== 'cold') return state;

  const timeline = cloneTimeline(snapshot.timeline, { cloneItems: true });
  return {
    sessionKey: state.sessionKey,
    cursor: snapshot.cursor,
    timeline: {
      ...timeline,
      cursor: snapshot.cursor,
    },
  };
}

export function applyTimelinePatch(
  state: RuntimeTimelineState,
  patch: TimelinePatch,
): RuntimeTimelineState {
  if (patch.sessionKey !== state.sessionKey) return state;
  if (compareCursor(patch.cursor, state.cursor) <= 0) return state;

  const timeline = cloneTimeline(state.timeline);

  for (const op of patch.ops) {
    if (op.op === 'upsert_turn') {
      upsertTurn(timeline, op.turn);
    } else if (op.op === 'upsert_item') {
      upsertItem(timeline, op.item);
    } else if (op.op === 'bind_user_message_run') {
      bindUserMessageRun(timeline, op);
    } else if (op.op === 'remove_item') {
      removeItem(timeline, op.id);
    } else if (op.op === 'remove_turn') {
      removeTurn(timeline, op.id);
    } else {
      timeline.hydrationState = op.state;
    }
  }

  timeline.cursor = patch.cursor;
  timeline.version = cursorToVersion(patch.cursor, timeline.version);
  timeline.updatedAt = Math.max(timeline.updatedAt, patch.createdAt);

  return {
    sessionKey: state.sessionKey,
    cursor: patch.cursor,
    timeline,
  };
}

export function orderedTimelineItems(timeline: SessionTimeline): TimelineItem[] {
  if (timeline.orderedItems) return timeline.orderedItems;
  const orderedItems = Object.values(timeline.items).sort(compareItems);
  timeline.orderedItems = orderedItems;
  timeline.itemIndexById = buildItemIndex(orderedItems);
  timeline.itemsByTurnId = buildItemsByTurnId(orderedItems);
  return orderedItems;
}

export function timelineItemsByTurnId(timeline: SessionTimeline): Record<string, TimelineItem[]> {
  if (timeline.itemsByTurnId) return timeline.itemsByTurnId;
  timeline.itemsByTurnId = buildItemsByTurnId(orderedTimelineItems(timeline));
  return timeline.itemsByTurnId;
}

export function compareCursor(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);

  if (
    Number.isSafeInteger(leftNumber) &&
    Number.isSafeInteger(rightNumber) &&
    String(leftNumber) === left &&
    String(rightNumber) === right
  ) {
    return leftNumber - rightNumber;
  }

  return left === right ? 0 : 1;
}

function upsertTurn(timeline: SessionTimeline, turn: TimelineTurn): void {
  const turnIndexById = ensureTurnIndex(timeline);
  const index = turnIndexById[turn.id] ?? -1;
  const cloned = cloneTurn(turn);
  if (index !== -1) timeline.turns.splice(index, 1);
  const nextIndex = insertionIndex(timeline.turns, cloned, compareTurns);
  timeline.turns.splice(nextIndex, 0, cloned);
  rebuildTurnIndexFrom(timeline, Math.min(index === -1 ? nextIndex : index, nextIndex));
}

function upsertItem(timeline: SessionTimeline, item: TimelineItem): void {
  const cloned = cloneItem(item);
  const previous = timeline.items[item.id];
  timeline.items[item.id] = cloned;
  removeFromOrderedItems(timeline, item.id);
  insertOrderedItem(timeline, cloned);
  if (previous?.turnId && previous.turnId !== cloned.turnId) {
    removeFromTurnItems(timeline, previous.turnId, item.id);
  }
  if (cloned.turnId) {
    removeFromTurnItems(timeline, cloned.turnId, item.id);
    insertTurnItem(timeline, cloned.turnId, cloned);
  }
}

function removeItem(timeline: SessionTimeline, itemId: string): void {
  const previous = timeline.items[itemId];
  delete timeline.items[itemId];
  removeFromOrderedItems(timeline, itemId);
  if (previous?.turnId) removeFromTurnItems(timeline, previous.turnId, itemId);
  for (const turn of timeline.turns) {
    turn.inputItemIds = turn.inputItemIds.filter((candidate) => candidate !== itemId);
    turn.outputItemIds = turn.outputItemIds.filter((candidate) => candidate !== itemId);
  }
}

function removeTurn(timeline: SessionTimeline, turnId: string): void {
  timeline.turns = timeline.turns.filter((turn) => turn.id !== turnId);
  timeline.turnIndexById = buildTurnIndex(timeline.turns);
  const removedItemIds = new Set<string>();
  for (const [itemId, item] of Object.entries(timeline.items)) {
    if (item.turnId === turnId) {
      delete timeline.items[itemId];
      removedItemIds.add(itemId);
    }
  }
  if (removedItemIds.size > 0 && timeline.orderedItems) {
    timeline.orderedItems = timeline.orderedItems.filter((item) => !removedItemIds.has(item.id));
    timeline.itemIndexById = buildItemIndex(timeline.orderedItems);
  }
  if (timeline.itemsByTurnId) delete timeline.itemsByTurnId[turnId];
}

function bindUserMessageRun(
  timeline: SessionTimeline,
  op: Extract<TimelinePatch['ops'][number], { op: 'bind_user_message_run' }>,
): void {
  const item = Object.values(timeline.items).find((candidate) =>
    candidate.kind === 'user_message' &&
    candidate.idempotencyKey === op.idempotencyKey
  );
  if (!item || item.kind !== 'user_message') return;

  upsertItem(timeline, {
    ...item,
    runId: op.runId,
    updatedAt: Math.max(item.updatedAt, op.at),
  });

  const turn = item.turnId
    ? timeline.turns[ensureTurnIndex(timeline)[item.turnId]]
    : undefined;
  if (turn && !isTerminalTurnStatus(turn.status)) {
    turn.runId = op.runId;
  }
}

function cloneTimeline(
  timeline: SessionTimeline,
  options: { cloneItems?: boolean } = {},
): SessionTimeline {
  const orderedItems = timeline.orderedItems
    ? timeline.orderedItems
    : Object.values(timeline.items).sort(compareItems);
  const items = options.cloneItems
    ? Object.fromEntries(Object.entries(timeline.items).map(([id, item]) => [id, cloneItem(item)]))
    : { ...timeline.items };
  const nextOrderedItems = options.cloneItems
    ? orderedItems.map((item) => items[item.id])
    : [...orderedItems];

  return {
    ...timeline,
    turns: timeline.turns.map(cloneTurn),
    items,
    orderedItems: nextOrderedItems,
    itemIndexById: buildItemIndex(nextOrderedItems),
    itemsByTurnId: buildItemsByTurnId(nextOrderedItems),
    turnIndexById: buildTurnIndex(timeline.turns),
  };
}

function cloneTurn(turn: TimelineTurn): TimelineTurn {
  return {
    ...turn,
    inputItemIds: [...turn.inputItemIds],
    outputItemIds: [...turn.outputItemIds],
    orderBase: { ...turn.orderBase },
  };
}

function cloneItem<TItem extends TimelineItem>(item: TItem): TItem {
  if (item.kind === 'tool_group') {
    return {
      ...item,
      orderKey: { ...item.orderKey },
      childItemIds: [...item.childItemIds],
    } as TItem;
  }

  return {
    ...item,
    orderKey: { ...item.orderKey },
  };
}

function compareTurns(left: TimelineTurn, right: TimelineTurn): number {
  return (
    left.orderBase.turn - right.orderBase.turn ||
    left.startedAt - right.startedAt ||
    left.id.localeCompare(right.id)
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

function isTerminalTurnStatus(status: TimelineTurn['status']): boolean {
  return status === 'finalized' || status === 'failed' || status === 'aborted';
}

function ensureItemIndex(timeline: SessionTimeline): Record<string, number> {
  if (timeline.itemIndexById) return timeline.itemIndexById;
  timeline.itemIndexById = buildItemIndex(orderedTimelineItems(timeline));
  return timeline.itemIndexById;
}

function ensureTurnIndex(timeline: SessionTimeline): Record<string, number> {
  if (timeline.turnIndexById) return timeline.turnIndexById;
  timeline.turnIndexById = buildTurnIndex(timeline.turns);
  return timeline.turnIndexById;
}

function removeFromOrderedItems(timeline: SessionTimeline, itemId: string): void {
  const orderedItems = orderedTimelineItems(timeline);
  const indexById = ensureItemIndex(timeline);
  const index = indexById[itemId];
  if (index === undefined) return;
  orderedItems.splice(index, 1);
  delete indexById[itemId];
  rebuildItemIndexFrom(timeline, index);
}

function insertOrderedItem(timeline: SessionTimeline, item: TimelineItem): void {
  const orderedItems = orderedTimelineItems(timeline);
  const index = insertionIndex(orderedItems, item, compareItems);
  orderedItems.splice(index, 0, item);
  rebuildItemIndexFrom(timeline, index);
}

function insertTurnItem(timeline: SessionTimeline, turnId: string, item: TimelineItem): void {
  const itemsByTurnId = timelineItemsByTurnId(timeline);
  const turnItems = itemsByTurnId[turnId] ? [...itemsByTurnId[turnId]] : [];
  const index = insertionIndex(turnItems, item, compareItems);
  turnItems.splice(index, 0, item);
  itemsByTurnId[turnId] = turnItems;
}

function removeFromTurnItems(timeline: SessionTimeline, turnId: string, itemId: string): void {
  const itemsByTurnId = timelineItemsByTurnId(timeline);
  const current = itemsByTurnId[turnId];
  if (!current) return;
  const next = current.filter((item) => item.id !== itemId);
  if (next.length === 0) {
    delete itemsByTurnId[turnId];
  } else {
    itemsByTurnId[turnId] = next;
  }
}

function buildItemIndex(items: TimelineItem[]): Record<string, number> {
  const index: Record<string, number> = {};
  items.forEach((item, itemIndex) => { index[item.id] = itemIndex; });
  return index;
}

function buildTurnIndex(turns: TimelineTurn[]): Record<string, number> {
  const index: Record<string, number> = {};
  turns.forEach((turn, turnIndex) => { index[turn.id] = turnIndex; });
  return index;
}

function buildItemsByTurnId(items: TimelineItem[]): Record<string, TimelineItem[]> {
  const byTurnId: Record<string, TimelineItem[]> = {};
  for (const item of items) {
    if (!item.turnId) continue;
    const turnItems = byTurnId[item.turnId] ?? [];
    turnItems.push(item);
    byTurnId[item.turnId] = turnItems;
  }
  return byTurnId;
}

function rebuildItemIndexFrom(timeline: SessionTimeline, startIndex: number): void {
  const orderedItems = orderedTimelineItems(timeline);
  const itemIndexById = ensureItemIndex(timeline);
  for (let index = Math.max(0, startIndex); index < orderedItems.length; index++) {
    itemIndexById[orderedItems[index].id] = index;
  }
}

function rebuildTurnIndexFrom(timeline: SessionTimeline, startIndex: number): void {
  const turnIndexById = ensureTurnIndex(timeline);
  for (let index = Math.max(0, startIndex); index < timeline.turns.length; index++) {
    turnIndexById[timeline.turns[index].id] = index;
  }
}

function insertionIndex<T>(items: T[], value: T, compare: (left: T, right: T) => number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (compare(items[mid], value) <= 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function cursorToVersion(cursor: string, fallback: number): number {
  const version = Number(cursor);
  return Number.isSafeInteger(version) && String(version) === cursor
    ? version
    : fallback + 1;
}
