import { adaptGatewayEvent, adaptHistorySnapshot, type AdapterGatewayEvent } from './adapter.js';
import { ChatTimelineStore } from './store.js';
import type { ReplayResult } from './replay-buffer.js';
import type { HistoryMessage, RuntimeEvent, TimelinePatch, TimelineSnapshot } from './types.js';

export type ChatRuntimeRpc = (method: string, params: unknown) => Promise<unknown>;

export interface ChatRuntimeOptions {
  rpc: ChatRuntimeRpc;
  maxPatchesPerSession: number;
}

export interface OptimisticUserMessageInput {
  sessionKey: string;
  runId?: string;
  text: string;
  idempotencyKey: string;
  at?: number;
}

type TimelineSubscriber = (patch: TimelinePatch) => void;

export class ChatRuntime {
  private readonly rpc: ChatRuntimeRpc;
  private readonly store: ChatTimelineStore;
  private readonly hydratingSessions = new Map<string, Promise<void>>();
  private readonly queuedGatewayEvents = new Map<string, RuntimeEvent[]>();

  constructor(options: ChatRuntimeOptions) {
    this.rpc = options.rpc;
    this.store = new ChatTimelineStore({ maxPatchesPerSession: options.maxPatchesPerSession });
  }

  applyGatewayEvent(event: AdapterGatewayEvent): TimelinePatch[] {
    const patches: TimelinePatch[] = [];
    for (const runtimeEvent of adaptGatewayEvent(event)) {
      if (this.hydratingSessions.has(runtimeEvent.sessionKey)) {
        this.queueGatewayEvent(runtimeEvent);
        continue;
      }

      patches.push(this.store.applyEvent(runtimeEvent));
    }

    return patches;
  }

  hydrateSession(sessionKey: string, limit = 500): Promise<void> {
    const existingHydration = this.hydratingSessions.get(sessionKey);
    if (existingHydration) return existingHydration;

    let resolveHydration!: () => void;
    let rejectHydration!: (reason?: unknown) => void;
    const hydration = new Promise<void>((resolve, reject) => {
      resolveHydration = resolve;
      rejectHydration = reject;
    });
    this.hydratingSessions.set(sessionKey, hydration);
    void this.hydrateSessionFromRpc(sessionKey, limit).then(resolveHydration, rejectHydration);
    void hydration.then(
      () => this.scheduleHydrationCleanup(sessionKey, hydration, 'flush'),
      () => this.scheduleHydrationCleanup(sessionKey, hydration, 'drop'),
    );
    return hydration;
  }

  private async hydrateSessionFromRpc(sessionKey: string, limit: number): Promise<void> {
    try {
      const result = await this.rpc('chat.history', { sessionKey, limit });
      this.applyRuntimeEvents(adaptHistorySnapshot(sessionKey, historyMessagesFromRpcResult(result)));
      this.flushQueuedGatewayEvents(sessionKey);
    } catch (error) {
      this.queuedGatewayEvents.delete(sessionKey);
      throw error;
    }
  }

  snapshot(sessionKey: string, reason: TimelineSnapshot['reason']): TimelineSnapshot {
    return this.store.snapshot(sessionKey, reason);
  }

  replayAfter(sessionKey: string, cursor?: string | null): ReplayResult {
    return this.store.replayAfter(sessionKey, cursor);
  }

  subscribe(sessionKey: string, subscriber: TimelineSubscriber): () => void {
    return this.store.subscribe(sessionKey, subscriber);
  }

  applyOptimisticUserMessage(input: OptimisticUserMessageInput): TimelinePatch {
    const event: Extract<RuntimeEvent, { type: 'user_message_committed' }> = {
      type: 'user_message_committed',
      sessionKey: input.sessionKey,
      text: input.text,
      idempotencyKey: input.idempotencyKey,
      at: input.at ?? Date.now(),
    };

    if (input.runId !== undefined) event.runId = input.runId;

    return this.store.applyEvent(event);
  }

  private applyRuntimeEvents(events: RuntimeEvent[]): TimelinePatch[] {
    return this.store.applyEvents(events);
  }

  private queueGatewayEvent(event: RuntimeEvent): void {
    const queuedEvents = this.queuedGatewayEvents.get(event.sessionKey) ?? [];
    queuedEvents.push(event);
    this.queuedGatewayEvents.set(event.sessionKey, queuedEvents);
  }

  private flushQueuedGatewayEvents(sessionKey: string): void {
    while (true) {
      const queuedEvents = this.queuedGatewayEvents.get(sessionKey);
      if (!queuedEvents) return;

      this.queuedGatewayEvents.delete(sessionKey);
      this.applyRuntimeEvents(queuedEvents);
    }
  }

  private scheduleHydrationCleanup(
    sessionKey: string,
    hydration: Promise<void>,
    queuedEventMode: 'flush' | 'drop',
  ): void {
    queueMicrotask(() => {
      if (this.hydratingSessions.get(sessionKey) !== hydration) return;

      if (queuedEventMode === 'flush') {
        this.flushQueuedGatewayEvents(sessionKey);
      } else {
        this.queuedGatewayEvents.delete(sessionKey);
      }

      if (this.hydratingSessions.get(sessionKey) === hydration) {
        this.hydratingSessions.delete(sessionKey);
      }
    });
  }
}

function historyMessagesFromRpcResult(result: unknown): HistoryMessage[] {
  if (!isRecord(result)) return [];
  return Array.isArray(result.messages) ? result.messages.filter(isHistoryMessageLike) : [];
}

function isHistoryMessageLike(value: unknown): value is HistoryMessage {
  if (!isRecord(value)) return false;

  return (
    isHistoryRole(value.role) &&
    (typeof value.content === 'string' || Array.isArray(value.content))
  );
}

function isHistoryRole(value: unknown): value is HistoryMessage['role'] {
  return (
    value === 'user' ||
    value === 'assistant' ||
    value === 'tool' ||
    value === 'toolResult' ||
    value === 'system'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
