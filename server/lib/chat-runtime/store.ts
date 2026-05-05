import { buildPatchFromTimeline, createEmptyTimeline, reduceRuntimeEvent } from './reducer.js';
import { ReplayBuffer, type ReplayResult } from './replay-buffer.js';
import type { RuntimeEvent, SessionTimeline, TimelinePatch, TimelineSnapshot } from './types.js';

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

  private applySessionEvents(events: RuntimeEvent[]): TimelinePatch | undefined {
    const firstEvent = events[0];
    if (!firstEvent) return undefined;

    const current = this.getOrCreateTimeline(firstEvent.sessionKey);
    let next = current;
    let createdAt = firstEvent.at;

    for (const event of events) {
      next = reduceRuntimeEvent(next, event);
      createdAt = Math.max(createdAt, event.at);
    }

    const version = current.version + 1;
    next = {
      ...next,
      version,
      cursor: String(version),
      updatedAt: Math.max(next.updatedAt, createdAt),
    };
    this.timelines.set(firstEvent.sessionKey, next);

    const patch = this.replayBuffer.append(firstEvent.sessionKey, buildPatchFromTimeline(next), createdAt);
    this.publish(firstEvent.sessionKey, patch);
    return cloneTimelinePatch(patch);
  }

  private publish(sessionKey: string, patch: TimelinePatch): void {
    const sessionSubscribers = this.subscribers.get(sessionKey);
    if (!sessionSubscribers) return;

    for (const subscriber of [...sessionSubscribers]) {
      if (!sessionSubscribers.has(subscriber)) continue;

      try {
        subscriber(cloneTimelinePatch(patch));
      } catch {
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
