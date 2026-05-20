import { buildPatchFromTimeline, createEmptyTimeline, reduceRuntimeEvent, timelineItemsInOrder } from './reducer.js';
import { ReplayBuffer, type ReplayResult } from './replay-buffer.js';
import type { RuntimeEvent, SessionTimeline, TimelineItem, TimelinePatch, TimelinePatchOp, TimelineSnapshot, TimelineTurn, UserTimelineItem } from './types.js';

interface ChatTimelineStoreOptions {
  maxPatchesPerSession: number;
}

type TimelineSubscriber = (patch: TimelinePatch) => void;

export class ChatTimelineStore {
  private readonly replayBuffer: ReplayBuffer;

  private readonly timelines = new Map<string, SessionTimeline>();
  private readonly subscribers = new Map<string, Set<TimelineSubscriber>>();

  constructor(options: ChatTimelineStoreOptions) {
    this.replayBuffer = new ReplayBuffer(options);
  }

  getTimeline(sessionKey: string): SessionTimeline {
    return cloneSessionTimeline(this.getOrCreateTimeline(sessionKey));
  }

  applyEvent(event: RuntimeEvent): TimelinePatch {
    const [patch] = this.applyEvents([event]);
    if (!patch) throw new Error('failed to apply runtime event');
    return patch;
  }

  applyEvents(events: RuntimeEvent[]): TimelinePatch[] {
    const patches: TimelinePatch[] = [];
    let groupStart = 0;

    while (groupStart < events.length) {
      const sessionKey = events[groupStart]?.sessionKey;
      if (!sessionKey) break;

      let groupEnd = groupStart + 1;
      while (events[groupEnd]?.sessionKey === sessionKey) groupEnd += 1;

      const patch = this.applySessionEvents(events.slice(groupStart, groupEnd));
      if (patch) patches.push(patch);
      groupStart = groupEnd;
    }

    return patches;
  }

  replaceEvents(sessionKey: string, events: RuntimeEvent[]): TimelinePatch {
    if (events.some((event) => event.sessionKey !== sessionKey)) {
      throw new Error('cannot replace a timeline with events from another session');
    }

    return this.applySessionEvents(events, { mode: 'replace', sessionKey })
      ?? this.replaceWithEmptyTimeline(sessionKey);
  }

  snapshot(sessionKey: string, reason: TimelineSnapshot['reason']): TimelineSnapshot {
    return {
      type: 'snapshot',
      sessionKey,
      cursor: this.replayBuffer.latestCursor(sessionKey),
      timeline: cloneSessionTimeline(this.getOrCreateTimeline(sessionKey)),
      reason,
    };
  }

  replayAfter(sessionKey: string, cursor?: string | null): ReplayResult {
    return this.replayBuffer.replayAfter(sessionKey, cursor);
  }

  subscribe(sessionKey: string, subscriber: TimelineSubscriber): () => void {
    let sessionSubscribers = this.subscribers.get(sessionKey);
    if (!sessionSubscribers) {
      sessionSubscribers = new Set();
      this.subscribers.set(sessionKey, sessionSubscribers);
    }

    sessionSubscribers.add(subscriber);

    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;

      const currentSubscribers = this.subscribers.get(sessionKey);
      if (!currentSubscribers) return;

      currentSubscribers.delete(subscriber);
      if (currentSubscribers.size === 0) this.subscribers.delete(sessionKey);
    };
  }

  private getOrCreateTimeline(sessionKey: string): SessionTimeline {
    const existing = this.timelines.get(sessionKey);
    if (existing) return existing;

    const timeline = createEmptyTimeline(sessionKey);
    this.timelines.set(sessionKey, timeline);
    return timeline;
  }

  private applySessionEvents(
    events: RuntimeEvent[],
    options: { mode: 'append' } | { mode: 'replace'; sessionKey: string } = { mode: 'append' },
  ): TimelinePatch | undefined {
    const firstEvent = events[0];
    if (!firstEvent) return undefined;

    const sessionKey = options.mode === 'replace' ? options.sessionKey : firstEvent.sessionKey;
    const current = this.getOrCreateTimeline(sessionKey);
    let next = options.mode === 'replace' ? createEmptyTimeline(sessionKey) : current;
    let createdAt = firstEvent.at;

    for (const event of events) {
      next = reduceRuntimeEvent(next, event);
      createdAt = Math.max(createdAt, event.at);
    }

    const version = current.version + 1;
    next = {
      ...next,
      // Replace always represents a hydration / reset boundary, so the timeline
      // is by definition ready after the replay completes — regardless of
      // whether the input contained an explicit history_snapshot event.
      hydrationState: options.mode === 'replace' ? 'ready' : next.hydrationState,
      version,
      cursor: String(version),
      updatedAt: Math.max(next.updatedAt, createdAt),
    };
    this.timelines.set(sessionKey, next);

    const patch = this.replayBuffer.append(
      sessionKey,
      this.patchOpsForTimelineChange(current, next, options.mode),
      createdAt,
    );
    this.publish(sessionKey, patch);
    return cloneTimelinePatch(patch);
  }

  private replaceWithEmptyTimeline(sessionKey: string): TimelinePatch {
    const current = this.getOrCreateTimeline(sessionKey);
    const next = {
      ...createEmptyTimeline(sessionKey),
      hydrationState: 'ready' as const,
      version: current.version + 1,
      cursor: String(current.version + 1),
      updatedAt: Date.now(),
    };
    this.timelines.set(sessionKey, next);

    const patch = this.replayBuffer.append(sessionKey, this.patchOpsForTimelineChange(current, next, 'replace'), next.updatedAt);
    this.publish(sessionKey, patch);
    return cloneTimelinePatch(patch);
  }

  private patchOpsForTimelineChange(
    current: SessionTimeline,
    next: SessionTimeline,
    mode: 'append' | 'replace',
  ): TimelinePatchOp[] {
    const nextTurnIds = new Set(next.turns.map((turn) => turn.id));
    const nextItemIds = new Set(Object.keys(next.items));
    const turnRemovals = current.turns
      .filter((turn) => !nextTurnIds.has(turn.id))
      .map((turn) => ({ op: 'remove_turn' as const, id: turn.id, reason: 'compaction' as const }));
    const removals = Object.keys(current.items)
      .filter((itemId) => !nextItemIds.has(itemId))
      .map((id) => ({ op: 'remove_item' as const, id, reason: 'compaction' as const }));

    if (mode === 'replace') {
      return [
        ...turnRemovals,
        ...removals,
        ...buildPatchFromTimeline(next),
      ];
    }

    const currentTurnsById = new Map(current.turns.map((turn) => [turn.id, turn]));
    const currentItems = current.items;
    const ops: TimelinePatchOp[] = [];

    if (current.hydrationState !== next.hydrationState) {
      ops.push({ op: 'set_hydration_state', state: next.hydrationState });
    }

    const bindRunOp = bindUserMessageRunPatchOp(current, next);
    if (bindRunOp) return [bindRunOp];

    for (const turn of next.turns) {
      const previous = currentTurnsById.get(turn.id);
      if (!previous || !sameTimelineValue(previous, turn)) {
        ops.push({ op: 'upsert_turn', turn });
      }
    }

    for (const item of timelineItemsInOrder(next)) {
      const previous = currentItems[item.id];
      if (!previous || !sameTimelineValue(previous, item)) {
        ops.push({ op: 'upsert_item', item });
      }
    }

    return [
      ...turnRemovals,
      ...removals,
      ...ops,
    ];
  }

  private publish(sessionKey: string, patch: TimelinePatch): void {
    const sessionSubscribers = this.subscribers.get(sessionKey);
    if (!sessionSubscribers) return;

    for (const subscriber of [...sessionSubscribers]) {
      if (!sessionSubscribers.has(subscriber)) continue;

      try {
        subscriber(cloneTimelinePatch(patch));
      } catch (err) {
        console.error(
          `chat-runtime subscriber threw for sessionKey=${sessionKey} cursor=${patch.cursor}; removing.`,
          err,
        );
        sessionSubscribers.delete(subscriber);
      }
    }

    if (sessionSubscribers.size === 0) this.subscribers.delete(sessionKey);
  }
}

function cloneTimelinePatch(patch: TimelinePatch): TimelinePatch {
  return structuredClone(patch);
}

function cloneSessionTimeline(timeline: SessionTimeline): SessionTimeline {
  return structuredClone(timeline);
}

function sameTimelineValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function bindUserMessageRunPatchOp(current: SessionTimeline, next: SessionTimeline): TimelinePatchOp | undefined {
  if (current.hydrationState !== next.hydrationState) return undefined;
  if (current.turns.length !== next.turns.length) return undefined;
  if (!sameItemKeySet(current.items, next.items)) return undefined;

  const candidate = findRunBindingCandidatePair(current, next);
  if (!candidate) return undefined;

  const [previousItem, nextItem] = candidate;
  if (!isUserTimelineItem(previousItem) || !isUserTimelineItem(nextItem)) return undefined;
  if (!nextItem.idempotencyKey || !nextItem.runId) return undefined;
  if (previousItem.id !== nextItem.id || previousItem.idempotencyKey !== nextItem.idempotencyKey) return undefined;
  if (sameTimelineValue(userItemWithoutRunBinding(previousItem), userItemWithoutRunBinding(nextItem)) === false) return undefined;

  const currentTurnsById = new Map(current.turns.map((turn) => [turn.id, turn]));
  const changedTurns: Array<readonly [TimelineTurn, TimelineTurn]> = [];
  for (let index = 0; index < next.turns.length; index += 1) {
    if (current.turns[index]?.id !== next.turns[index]?.id) return undefined;

    const nextTurn = next.turns[index];
    const previousTurn = currentTurnsById.get(nextTurn.id);
    if (!previousTurn) return undefined;
    if (sameTurnValue(previousTurn, nextTurn)) continue;
    changedTurns.push([previousTurn, nextTurn] as const);
  }
  if (changedTurns.length > 1) return undefined;
  if (changedTurns.length === 1) {
    const [previousTurn, nextTurn] = changedTurns[0];
    if (previousTurn.id !== previousItem.turnId || nextTurn.id !== nextItem.turnId) return undefined;
    if (!sameTurnExceptRunBinding(previousTurn, nextTurn)) return undefined;
  }

  return {
    op: 'bind_user_message_run',
    idempotencyKey: nextItem.idempotencyKey,
    runId: nextItem.runId,
    at: nextItem.updatedAt,
  };
}

function sameItemKeySet(
  currentItems: Record<string, TimelineItem>,
  nextItems: Record<string, TimelineItem>,
): boolean {
  const currentItemIds = Object.keys(currentItems);
  const nextItemIds = Object.keys(nextItems);
  if (currentItemIds.length !== nextItemIds.length) return false;
  return nextItemIds.every((itemId) => Object.prototype.hasOwnProperty.call(currentItems, itemId));
}

function findRunBindingCandidatePair(
  current: SessionTimeline,
  next: SessionTimeline,
): readonly [UserTimelineItem, UserTimelineItem] | undefined {
  let candidate: readonly [UserTimelineItem, UserTimelineItem] | undefined;

  for (const itemId of Object.keys(next.items)) {
    const previousItem = current.items[itemId];
    const nextItem = next.items[itemId];
    if (previousItem === nextItem) continue;
    if (!isUserTimelineItem(previousItem) || !isUserTimelineItem(nextItem)) return undefined;
    if (previousItem.runId === nextItem.runId) return undefined;
    if (!previousItem.runId?.startsWith('optimistic:') || !nextItem.runId) return undefined;
    if (!nextItem.idempotencyKey || previousItem.idempotencyKey !== nextItem.idempotencyKey) return undefined;
    if (candidate) return undefined;
    candidate = [previousItem, nextItem] as const;
  }

  return candidate;
}

function isUserTimelineItem(item: TimelineItem | undefined): item is UserTimelineItem {
  return item?.kind === 'user_message';
}

function userItemWithoutRunBinding(item: UserTimelineItem): unknown {
  return { ...item, runId: undefined, updatedAt: undefined };
}

function sameTurnValue(left: TimelineTurn, right: TimelineTurn): boolean {
  return left.runId === right.runId && sameTurnExceptRunBinding(left, right);
}

function sameTurnExceptRunBinding(left: TimelineTurn, right: TimelineTurn): boolean {
  return left.id === right.id &&
    left.sessionKey === right.sessionKey &&
    left.status === right.status &&
    left.startedAt === right.startedAt &&
    left.finalizedAt === right.finalizedAt &&
    sameOrderKey(left.orderBase, right.orderBase) &&
    sameStringArray(left.inputItemIds, right.inputItemIds) &&
    sameStringArray(left.outputItemIds, right.outputItemIds);
}

function sameOrderKey(left: TimelineTurn['orderBase'], right: TimelineTurn['orderBase']): boolean {
  return left.turn === right.turn && left.block === right.block && left.sub === right.sub;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
