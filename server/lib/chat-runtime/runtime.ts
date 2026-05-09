import { createHash } from 'node:crypto';
import { adaptGatewayEvent, adaptHistorySnapshot, type AdapterGatewayEvent } from './adapter.js';
import { ChatTimelineStore } from './store.js';
import type { ReplayResult } from './replay-buffer.js';
import type { HistoryMessage, RuntimeEvent, TimelinePatch, TimelineSnapshot } from './types.js';

const ACTIVE_HISTORY_SYNC_INTERVAL_MS = 1500;
const ACTIVE_HISTORY_BINDING_CLOCK_SKEW_MS = 30_000;

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

export interface FailedOptimisticUserMessageInput {
  sessionKey: string;
  idempotencyKey: string;
  error: string;
  at?: number;
}

type TimelineSubscriber = (patch: TimelinePatch) => void;

interface ActiveHistoryBinding {
  runId: string;
  idempotencyKey?: string;
}

export class ChatRuntime {
  private readonly rpc: ChatRuntimeRpc;
  private readonly store: ChatTimelineStore;
  private readonly hydratingSessions = new Map<string, Promise<void>>();
  private readonly queuedGatewayEvents = new Map<string, RuntimeEvent[]>();
  private readonly sessionKeyByRunId = new Map<string, string>();
  private readonly pendingAgentEventsByRunId = new Map<string, AdapterGatewayEvent[]>();
  private readonly historyFingerprintBySession = new Map<string, string>();
  private readonly activeHistorySyncTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly activeHistorySyncInFlight = new Set<string>();

  constructor(options: ChatRuntimeOptions) {
    this.rpc = options.rpc;
    this.store = new ChatTimelineStore({ maxPatchesPerSession: options.maxPatchesPerSession });
  }

  applyGatewayEvent(event: AdapterGatewayEvent): TimelinePatch[] {
    const pendingRunId = runIdForSessionlessAgentEvent(event);
    if (pendingRunId && !this.sessionKeyByRunId.has(pendingRunId)) {
      this.queuePendingAgentEvent(pendingRunId, event);
      return [];
    }

    const patches: TimelinePatch[] = [];
    const affectedSessionKeys = new Set<string>();
    for (const runtimeEvent of adaptGatewayEvent(this.withKnownSessionKey(event))) {
      this.rememberRunSession(runtimeEvent);
      if (this.hydratingSessions.has(runtimeEvent.sessionKey)) {
        this.queueGatewayEvent(runtimeEvent);
        continue;
      }

      patches.push(this.store.applyEvent(runtimeEvent));
      affectedSessionKeys.add(runtimeEvent.sessionKey);
      patches.push(...this.flushPendingAgentEvents(runtimeEvent));
    }

    for (const sessionKey of affectedSessionKeys) this.updateActiveHistorySync(sessionKey);
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
      const messages = historyMessagesFromRpcResult(result);
      const fingerprint = historyMessagesFingerprint(messages);
      if (this.hasRunningTurn(sessionKey)) {
        if (this.historyFingerprintBySession.get(sessionKey) === fingerprint) {
          this.flushQueuedGatewayEvents(sessionKey);
          this.updateActiveHistorySync(sessionKey);
          return;
        }

        this.historyFingerprintBySession.set(sessionKey, fingerprint);
        this.applyRuntimeEvents(this.adaptActiveHistorySnapshot(sessionKey, messages));
        this.flushQueuedGatewayEvents(sessionKey);
        this.updateActiveHistorySync(sessionKey);
        return;
      }

      this.historyFingerprintBySession.set(sessionKey, fingerprint);
      const events = adaptHistorySnapshot(sessionKey, messages);
      this.rememberRunSessions(events);
      this.store.replaceEvents(sessionKey, events);
      this.flushQueuedGatewayEvents(sessionKey);
      this.updateActiveHistorySync(sessionKey);
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
    this.rememberRunSession(event);

    const patch = this.store.applyEvent(event);
    this.updateActiveHistorySync(input.sessionKey);
    return patch;
  }

  failOptimisticUserMessage(input: FailedOptimisticUserMessageInput): TimelinePatch {
    const patch = this.store.applyEvent({
      type: 'user_message_failed',
      sessionKey: input.sessionKey,
      idempotencyKey: input.idempotencyKey,
      error: input.error,
      at: input.at ?? Date.now(),
    });
    this.updateActiveHistorySync(input.sessionKey);
    return patch;
  }

  private applyRuntimeEvents(events: RuntimeEvent[]): TimelinePatch[] {
    this.rememberRunSessions(events);
    const patches = this.store.applyEvents(events);
    for (const event of events) {
      patches.push(...this.flushPendingAgentEvents(event));
    }
    for (const sessionKey of new Set(events.map((event) => event.sessionKey))) {
      this.updateActiveHistorySync(sessionKey);
    }
    return patches;
  }

  private adaptActiveHistorySnapshot(sessionKey: string, messages: HistoryMessage[]): RuntimeEvent[] {
    const activeBindings = this.activeHistoryBindings(sessionKey, messages);
    const activeRunIds = new Set([...activeBindings.values()].map((binding) => binding.runId));
    if (activeBindings.size === 0) return [];

    const enrichedMessages: HistoryMessage[] = [];
    let currentBinding: ActiveHistoryBinding | undefined;
    messages.forEach((message, index) => {
      const userBinding = activeBindings.get(index);
      if (message.role === 'user') {
        currentBinding = userBinding;
        enrichedMessages.push(userBinding ? bindHistoryMessageToActiveRun(message, userBinding) : message);
        return;
      }

      if (currentBinding && isAssistantOrToolHistoryMessage(message)) {
        enrichedMessages.push(bindHistoryMessageToActiveRun(message, currentBinding));
        return;
      }

      enrichedMessages.push(message);
    });

    const events = adaptHistorySnapshot(sessionKey, enrichedMessages);
    const activeRunsWithAssistantFinal = new Set(
      events
        .filter((event): event is Extract<RuntimeEvent, { type: 'assistant_final' }> =>
          event.type === 'assistant_final' && activeRunIds.has(event.runId),
        )
        .map((event) => event.runId),
    );

    return events.filter((event) => {
      if (event.type === 'history_snapshot') return true;
      const runId = runtimeEventRunId(event);
      if (!runId || !activeRunIds.has(runId)) return false;
      if (event.type !== 'turn_finalized') return true;
      return activeRunsWithAssistantFinal.has(event.runId);
    });
  }

  private activeHistoryBindings(sessionKey: string, messages: HistoryMessage[]): Map<number, ActiveHistoryBinding> {
    const timeline = this.store.getTimeline(sessionKey);
    const activeTurns = [...timeline.turns]
      .filter((turn) => turn.status === 'running')
      .sort((left, right) => right.startedAt - left.startedAt)
      .flatMap((turn) => {
        const input = turn.inputItemIds
          .map((itemId) => timeline.items[itemId])
          .find((item) => item?.kind === 'user_message');
        if (!input || input.kind !== 'user_message') return [];

        const normalizedText = normalizeHistoryText(input.text);
        if (!normalizedText) return [];

        return [{
          runId: turn.runId,
          startedAt: turn.startedAt,
          normalizedText,
          idempotencyKey: input.idempotencyKey,
        }];
      });
    const claimedIndexes = new Set<number>();
    const bindings = new Map<number, ActiveHistoryBinding>();

    for (const turn of activeTurns) {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (claimedIndexes.has(index)) continue;

        const message = messages[index];
        if (message?.role !== 'user') continue;
        if (normalizeHistoryText(historyMessageText(message)) !== turn.normalizedText) continue;
        if (!isPlausibleActiveHistoryUserMessage(message, turn.startedAt, turn.runId)) continue;

        claimedIndexes.add(index);
        const binding: ActiveHistoryBinding = { runId: turn.runId };
        if (turn.idempotencyKey) binding.idempotencyKey = turn.idempotencyKey;
        bindings.set(index, binding);
        break;
      }
    }

    return bindings;
  }

  private withKnownSessionKey(event: AdapterGatewayEvent): AdapterGatewayEvent {
    if (event.event !== 'agent' || !isRecord(event.payload)) return event;
    if (readNonEmptyString(event.payload, 'sessionKey')) return event;

    const data = event.payload.data;
    const runId = readNonEmptyString(event.payload, 'runId')
      ?? readNonEmptyString(event.payload, 'id')
      ?? (isRecord(data) ? readNonEmptyString(data, 'runId') : undefined);
    if (!runId) return event;

    const sessionKey = this.sessionKeyByRunId.get(runId);
    if (!sessionKey) return event;

    return {
      ...event,
      payload: {
        ...event.payload,
        sessionKey,
      },
    };
  }

  private rememberRunSessions(events: RuntimeEvent[]): void {
    for (const event of events) this.rememberRunSession(event);
  }

  private rememberRunSession(event: RuntimeEvent): void {
    const runId = runtimeEventRunId(event);
    if (runId) this.sessionKeyByRunId.set(runId, event.sessionKey);
  }

  private hasRunningTurn(sessionKey: string): boolean {
    return this.store.getTimeline(sessionKey).turns.some((turn) => turn.status === 'running');
  }

  private queueGatewayEvent(event: RuntimeEvent): void {
    const queuedEvents = this.queuedGatewayEvents.get(event.sessionKey) ?? [];
    queuedEvents.push(event);
    this.queuedGatewayEvents.set(event.sessionKey, queuedEvents);
  }

  private queuePendingAgentEvent(runId: string, event: AdapterGatewayEvent): void {
    const queuedEvents = this.pendingAgentEventsByRunId.get(runId) ?? [];
    queuedEvents.push(event);
    this.pendingAgentEventsByRunId.set(runId, queuedEvents);
  }

  private flushPendingAgentEvents(event: RuntimeEvent): TimelinePatch[] {
    const runId = runtimeEventRunId(event);
    if (!runId || !this.sessionKeyByRunId.has(runId)) return [];

    const queuedEvents = this.pendingAgentEventsByRunId.get(runId);
    if (!queuedEvents?.length) return [];

    this.pendingAgentEventsByRunId.delete(runId);
    return queuedEvents.flatMap((queuedEvent) => this.applyGatewayEvent(queuedEvent));
  }

  private flushQueuedGatewayEvents(sessionKey: string): void {
    while (true) {
      const queuedEvents = this.queuedGatewayEvents.get(sessionKey);
      if (!queuedEvents) return;

      this.queuedGatewayEvents.delete(sessionKey);
      this.applyRuntimeEvents(queuedEvents);
    }
  }

  private updateActiveHistorySync(sessionKey: string): void {
    if (this.hasRunningTurn(sessionKey)) {
      this.scheduleActiveHistorySync(sessionKey);
      return;
    }

    this.clearActiveHistorySync(sessionKey);
  }

  private scheduleActiveHistorySync(sessionKey: string): void {
    if (this.activeHistorySyncTimers.has(sessionKey)) return;

    const timer = setTimeout(() => {
      this.activeHistorySyncTimers.delete(sessionKey);
      void this.runActiveHistorySync(sessionKey);
    }, ACTIVE_HISTORY_SYNC_INTERVAL_MS);
    timer.unref?.();
    this.activeHistorySyncTimers.set(sessionKey, timer);
  }

  private async runActiveHistorySync(sessionKey: string): Promise<void> {
    if (this.activeHistorySyncInFlight.has(sessionKey)) return;
    if (!this.hasRunningTurn(sessionKey)) return;

    this.activeHistorySyncInFlight.add(sessionKey);
    try {
      await this.hydrateSession(sessionKey);
    } catch (error) {
      console.warn('[chat-runtime] Active history sync failed:', error);
    } finally {
      this.activeHistorySyncInFlight.delete(sessionKey);
      this.updateActiveHistorySync(sessionKey);
    }
  }

  private clearActiveHistorySync(sessionKey: string): void {
    const timer = this.activeHistorySyncTimers.get(sessionKey);
    if (!timer) return;

    clearTimeout(timer);
    this.activeHistorySyncTimers.delete(sessionKey);
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

function readNonEmptyString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function bindHistoryMessageToActiveRun(message: HistoryMessage, binding: ActiveHistoryBinding): HistoryMessage {
  const enriched: HistoryMessage & { idempotencyKey?: string } = {
    ...message,
    runId: binding.runId,
  };
  if (binding.idempotencyKey) enriched.idempotencyKey = binding.idempotencyKey;
  return enriched;
}

function isAssistantOrToolHistoryMessage(message: HistoryMessage): boolean {
  return message.role === 'assistant' || message.role === 'tool' || message.role === 'toolResult';
}

function historyMessagesFingerprint(messages: HistoryMessage[]): string {
  const hash = createHash('sha256');
  for (const message of messages) {
    hash.update(JSON.stringify({
      role: message.role,
      id: message.id,
      messageId: message.messageId,
      runId: message.runId,
      timestamp: message.timestamp,
      createdAt: message.createdAt,
      ts: message.ts,
      content: message.content,
    }));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function historyMessageText(message: HistoryMessage): string | undefined {
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return undefined;

  const parts = message.content.flatMap((block) => {
    if (!isRecord(block)) return [];
    if (block.type === 'text' && typeof block.text === 'string') return [block.text];
    return [];
  });
  return parts.length > 0 ? parts.join('\n') : undefined;
}

function normalizeHistoryText(text: string | undefined): string {
  return text?.replace(/\s+/g, ' ').trim() ?? '';
}

function isPlausibleActiveHistoryUserMessage(
  message: HistoryMessage,
  activeStartedAt: number,
  activeRunId: string,
): boolean {
  if (message.runId === activeRunId) return true;

  const at = historyMessageTime(message);
  if (at === undefined) return false;
  return at >= activeStartedAt - ACTIVE_HISTORY_BINDING_CLOCK_SKEW_MS;
}

function historyMessageTime(message: HistoryMessage): number | undefined {
  return historyTimeValue(message.timestamp)
    ?? historyTimeValue(message.createdAt)
    ?? historyTimeValue(message.ts);
}

function historyTimeValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function runIdForSessionlessAgentEvent(event: AdapterGatewayEvent): string | undefined {
  if (event.event !== 'agent' || !isRecord(event.payload)) return undefined;
  const data = event.payload.data;
  const sessionKey = readNonEmptyString(event.payload, 'sessionKey')
    ?? (isRecord(data) ? readNonEmptyString(data, 'sessionKey') : undefined);
  if (sessionKey) return undefined;

  return readNonEmptyString(event.payload, 'runId')
    ?? readNonEmptyString(event.payload, 'id')
    ?? (isRecord(data) ? readNonEmptyString(data, 'runId') : undefined);
}

function runtimeEventRunId(event: RuntimeEvent): string | undefined {
  if (!('runId' in event) || typeof event.runId !== 'string') return undefined;
  const runId = event.runId.trim();
  return runId || undefined;
}
