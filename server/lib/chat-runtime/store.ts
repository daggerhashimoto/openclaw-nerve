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
    const current = this.getOrCreateTimeline(event.sessionKey);
    const next = reduceRuntimeEvent(current, event);
    this.timelines.set(event.sessionKey, next);

    const patch = this.replayBuffer.append(event.sessionKey, buildPatchFromTimeline(next), event.at);
    this.publish(event.sessionKey, patch);
    return cloneTimelinePatch(patch);
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
