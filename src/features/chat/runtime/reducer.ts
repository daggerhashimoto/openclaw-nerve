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

  const timeline = cloneTimeline(snapshot.timeline);
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
      timeline.items[op.item.id] = cloneItem(op.item);
    } else if (op.op === 'remove_item') {
      removeItem(timeline, op.id);
    } else if (op.op === 'remove_turn') {
      removeTurn(timeline, op.id);
    } else {
      timeline.hydrationState = op.state;
    }
  }

  timeline.turns.sort(compareTurns);
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
  return Object.values(timeline.items).sort(compareItems);
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
  const index = timeline.turns.findIndex((candidate) => candidate.id === turn.id);
  const cloned = cloneTurn(turn);
  if (index === -1) {
    timeline.turns.push(cloned);
  } else {
    timeline.turns[index] = cloned;
  }
}

function removeItem(timeline: SessionTimeline, itemId: string): void {
  delete timeline.items[itemId];
  for (const turn of timeline.turns) {
    turn.inputItemIds = turn.inputItemIds.filter((candidate) => candidate !== itemId);
    turn.outputItemIds = turn.outputItemIds.filter((candidate) => candidate !== itemId);
  }
}

function removeTurn(timeline: SessionTimeline, turnId: string): void {
  timeline.turns = timeline.turns.filter((turn) => turn.id !== turnId);
  for (const [itemId, item] of Object.entries(timeline.items)) {
    if (item.turnId === turnId) delete timeline.items[itemId];
  }
}

function cloneTimeline(timeline: SessionTimeline): SessionTimeline {
  return {
    ...timeline,
    turns: timeline.turns.map(cloneTurn),
    items: Object.fromEntries(
      Object.entries(timeline.items).map(([id, item]) => [id, cloneItem(item)]),
    ),
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

function cursorToVersion(cursor: string, fallback: number): number {
  const version = Number(cursor);
  return Number.isSafeInteger(version) && String(version) === cursor
    ? version
    : fallback + 1;
}
