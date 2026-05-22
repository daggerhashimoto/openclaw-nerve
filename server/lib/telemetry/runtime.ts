import { config } from '../config.js';
import {
  buildBranchSwitchedEvent,
  buildKanbanTaskCreatedEvent,
  buildMessageSubmittedEvent,
  buildSessionCreatedEvent,
  buildToolCallCompletedEvent,
  type DetailedEventSurface,
} from './detailed-events.js';
import { buildErrorPayload } from './error-reporting.js';
import {
  buildHeartbeatPayload,
  nextDailyHeartbeatAt,
  shouldSendDailyCatchUp,
  shouldSendFirstSeen,
  shouldSendVersionChange,
} from './heartbeat.js';
import {
  ensureInstanceId,
  ensureLegacyUpgradeMarker,
  readBootstrapMarker,
  readInstallMethod,
  readInstallMethodOrUnknown,
  resolveTelemetryMode,
  type BootstrapMarker,
  type InstallMethod,
  type InstallMethodStamp,
  type TelemetryMode,
} from './install-metadata.js';
import {
  createTelemetryStore,
  type MarkSessionSeenResult,
  type RecordToolCompletedInput,
  type TelemetryStore,
} from './store.js';
import { createTelemetryHttpTransport, type TelemetryTransport } from './http.js';
import type { TelemetryFeatureName, HeartbeatReason } from './types.js';

const DEFAULT_DAILY_JITTER_MS = 10 * 60 * 1000;

export interface TelemetryMetadataApi {
  ensureInstanceId(createdAt?: string): string;
  ensureLegacyUpgradeMarker(params?: { envMode?: string | null; stampedAt?: string }): BootstrapMarker | undefined;
  readBootstrapMarker(): BootstrapMarker | undefined;
  readInstallMethod(): InstallMethodStamp | undefined;
  readInstallMethodOrUnknown(stamp?: InstallMethodStamp): InstallMethod;
  resolveTelemetryMode(params: { envMode?: string | null; bootstrap?: BootstrapMarker }): TelemetryMode;
}

export interface ReportTelemetryErrorInput {
  error: unknown;
  surface?: string;
  errorCode?: string;
  occurredAt?: Date | string | number;
}

export interface RecordSessionCreatedInput {
  sessionKey?: string;
  surface?: DetailedEventSurface;
  explicit?: boolean;
  occurredAt?: Date | string | number;
}

export interface RecordMessageSubmittedInput {
  sessionKey?: string;
  surface?: DetailedEventSurface;
  occurredAt?: Date | string | number;
}

export interface RecordToolTelemetryInput extends RecordToolCompletedInput {
  surface?: DetailedEventSurface;
}

export interface RecordKanbanTaskCreatedInput {
  surface?: DetailedEventSurface;
  success: boolean;
  occurredAt?: Date | string | number;
}

export interface RecordClientDetailedEventInput {
  event: 'branch_switched';
  properties: {
    success: boolean;
  };
}

export interface TelemetryServerInfoDisclosure {
  telemetryMode: TelemetryMode;
  telemetryEnabled: boolean;
  telemetryPublicDocUrl: string;
  showFreshInstallNotice: boolean;
  freshInstallNoticeId: string;
}

export interface TelemetryRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  getMode(): TelemetryMode;
  getServerInfoDisclosure(): TelemetryServerInfoDisclosure;
  recordSessionCreated(input?: RecordSessionCreatedInput | Date | string | number): Promise<void>;
  recordMessageSubmitted(input?: RecordMessageSubmittedInput | Date | string | number): Promise<void>;
  recordToolCompleted(input: RecordToolTelemetryInput): Promise<void>;
  recordKanbanTaskCreated(input: RecordKanbanTaskCreatedInput): Promise<void>;
  recordClientDetailedEvent(input: RecordClientDetailedEventInput): Promise<void>;
  markFeatureUsed(feature: TelemetryFeatureName, at?: Date | string | number): Promise<void>;
  markSessionSeen(sessionKey: string): Promise<MarkSessionSeenResult>;
  clearSessionSeen(sessionKey: string): Promise<void>;
  reportError(input: ReportTelemetryErrorInput): Promise<void>;
}

export interface CreateTelemetryRuntimeOptions {
  appVersion: string;
  envMode?: string | null;
  telemetryDir?: string;
  phase1BaseUrl?: string;
  phase2BaseUrl?: string;
  publicDocUrl?: string;
  store?: TelemetryStore;
  transport?: TelemetryTransport;
  detailedTransport?: TelemetryTransport;
  metadata?: TelemetryMetadataApi;
  now?: () => Date;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  dailyJitterMs?: number;
}

const defaultMetadata: TelemetryMetadataApi = {
  ensureInstanceId,
  ensureLegacyUpgradeMarker,
  readBootstrapMarker,
  readInstallMethod,
  readInstallMethodOrUnknown,
  resolveTelemetryMode,
};

let activeTelemetryRuntime: TelemetryRuntime | null = null;

function createDefaultStore(options: CreateTelemetryRuntimeOptions): TelemetryStore {
  return createTelemetryStore({ telemetryDir: options.telemetryDir || config.telemetryDir });
}

function createDefaultTransport(options: CreateTelemetryRuntimeOptions): TelemetryTransport {
  return createTelemetryHttpTransport({
    baseUrl: options.phase1BaseUrl || config.telemetryPhase1BaseUrl,
  });
}

function createDefaultDetailedTransport(options: CreateTelemetryRuntimeOptions): TelemetryTransport {
  return createTelemetryHttpTransport({
    baseUrl: options.phase2BaseUrl || config.telemetryPhase2BaseUrl,
  });
}

function resolveSurface(surface?: string): string {
  return surface || 'server';
}

function isTimestampInput(value: unknown): value is Date | string | number {
  return value instanceof Date || typeof value === 'string' || typeof value === 'number';
}

function normalizeSessionCreatedInput(
  input?: RecordSessionCreatedInput | Date | string | number,
): RecordSessionCreatedInput {
  if (input === undefined || isTimestampInput(input)) {
    return { occurredAt: input };
  }
  return input;
}

function normalizeMessageSubmittedInput(
  input?: RecordMessageSubmittedInput | Date | string | number,
): RecordMessageSubmittedInput {
  if (input === undefined || isTimestampInput(input)) {
    return { occurredAt: input };
  }
  return input;
}

export function getTelemetryRuntime(): TelemetryRuntime | null {
  return activeTelemetryRuntime;
}

export function setTelemetryRuntime(runtime: TelemetryRuntime | null): void {
  activeTelemetryRuntime = runtime;
}

export function createTelemetryRuntime(options: CreateTelemetryRuntimeOptions): TelemetryRuntime {
  const store = options.store || createDefaultStore(options);
  const transport = options.transport || createDefaultTransport(options);
  const detailedTransport = options.detailedTransport || createDefaultDetailedTransport(options);
  const metadata = options.metadata || defaultMetadata;
  const now = options.now || (() => new Date());
  const setTimeoutFn = options.setTimeoutFn || setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn || clearTimeout;
  const dailyJitterMs = options.dailyJitterMs ?? DEFAULT_DAILY_JITTER_MS;
  const envMode = options.envMode ?? config.telemetryModeRaw;
  const publicDocUrl = options.publicDocUrl || config.telemetryPublicDocUrl;

  let instanceId = '';
  let installMethod: InstallMethod = 'unknown';
  let bootstrap: BootstrapMarker | undefined;
  let mode: TelemetryMode = 'off';
  let started = false;
  let stopped = false;
  let dailyTimer: ReturnType<typeof setTimeout> | undefined;

  function clearDailyTimer(): void {
    if (dailyTimer !== undefined) {
      clearTimeoutFn(dailyTimer);
      dailyTimer = undefined;
    }
  }

  function runInBackground(work: Promise<void>): void {
    void work.catch(() => {});
  }

  function detailedTelemetryEnabled(): boolean {
    return mode === 'detailed' && !!instanceId;
  }

  function sendDetailedEvent(payload: unknown): void {
    if (!detailedTelemetryEnabled()) {
      return;
    }

    runInBackground((async () => {
      await detailedTransport.postJson('/v1/events', payload);
    })());
  }

  async function runStoreWrite(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch {
      return;
    }
  }

  async function sendHeartbeat(reason: HeartbeatReason, sentAt = now()): Promise<void> {
    if (mode === 'off' || !instanceId || stopped) {
      return;
    }

    try {
      const snapshot = await store.readWindow(sentAt);
      if (stopped) {
        return;
      }

      const payload = buildHeartbeatPayload({
        identity: { instanceId },
        installMethod,
        appVersion: options.appVersion,
        reason,
        sentAt: sentAt.toISOString(),
        snapshot,
      });

      const delivered = await transport.postJson('/v1/heartbeat', payload);
      if (!delivered) {
        return;
      }

      await store.noteHeartbeatSent({
        reason,
        sentAt: payload.sent_at,
        appVersion: options.appVersion,
      });
    } catch {
      return;
    }
  }

  function scheduleDailyHeartbeat(): void {
    clearDailyTimer();

    if (mode === 'off' || stopped) {
      return;
    }

    const current = now();
    const target = nextDailyHeartbeatAt(current, dailyJitterMs);
    const delayMs = Math.max(0, target.getTime() - current.getTime());

    dailyTimer = setTimeoutFn(() => {
      runInBackground((async () => {
        if (mode === 'off' || stopped) {
          return;
        }

        await sendHeartbeat('daily', now());
        if (!stopped) {
          scheduleDailyHeartbeat();
        }
      })());
    }, delayMs);
  }

  async function initialize(): Promise<void> {
    const stampedAt = now().toISOString();
    instanceId = metadata.ensureInstanceId(stampedAt);
    bootstrap = metadata.readBootstrapMarker() || metadata.ensureLegacyUpgradeMarker({ envMode, stampedAt });
    const installMethodStamp = metadata.readInstallMethod();
    installMethod = metadata.readInstallMethodOrUnknown(installMethodStamp);
    mode = metadata.resolveTelemetryMode({ envMode, bootstrap });
  }

  async function sendStartupHeartbeats(): Promise<void> {
    if (mode === 'off' || stopped) {
      return;
    }

    const sentAt = now();
    const snapshot = await store.readWindow(sentAt);
    if (stopped) {
      return;
    }

    if (shouldSendFirstSeen(snapshot.lastHeartbeatSentAtByReason)) {
      await sendHeartbeat('first_seen', sentAt);
    } else if (shouldSendVersionChange({
      appVersion: options.appVersion,
      lastHeartbeatAppVersion: snapshot.lastHeartbeatAppVersion,
    })) {
      await sendHeartbeat('version_change', sentAt);
    }

    if (stopped) {
      return;
    }

    if (shouldSendDailyCatchUp({
      now: sentAt,
      jitterMs: dailyJitterMs,
      lastHeartbeatSentAtByReason: snapshot.lastHeartbeatSentAtByReason,
    })) {
      await sendHeartbeat('daily', sentAt);
    }
  }

  function telemetryEnabled(): boolean {
    return mode !== 'off';
  }

  return {
    async start() {
      if (started && !stopped) {
        return;
      }

      started = true;
      stopped = false;
      await initialize();

      if (!telemetryEnabled()) {
        clearDailyTimer();
        return;
      }

      scheduleDailyHeartbeat();
      runInBackground(sendStartupHeartbeats());
    },

    async stop() {
      stopped = true;
      started = false;
      clearDailyTimer();
    },

    getMode() {
      return mode;
    },

    getServerInfoDisclosure() {
      const showFreshInstallNotice = mode === 'minimal' && bootstrap?.kind === 'fresh_install';
      return {
        telemetryMode: mode,
        telemetryEnabled: telemetryEnabled(),
        telemetryPublicDocUrl: publicDocUrl,
        showFreshInstallNotice,
        freshInstallNoticeId: showFreshInstallNotice ? bootstrap?.stampedAt || '' : '',
      };
    },

    async recordSessionCreated(input) {
      if (!telemetryEnabled()) {
        return;
      }

      const normalized = normalizeSessionCreatedInput(input);
      await runStoreWrite(() => store.recordSessionCreated(normalized.occurredAt));

      sendDetailedEvent(buildSessionCreatedEvent({
        identity: { instanceId },
        appVersion: options.appVersion,
        installMethod,
        surface: normalized.surface || 'sessions',
        sentAt: normalized.occurredAt,
      }));
    },

    async recordMessageSubmitted(input) {
      if (!telemetryEnabled()) {
        return;
      }

      const normalized = normalizeMessageSubmittedInput(input);
      await runStoreWrite(() => store.recordMessageSubmitted(normalized.occurredAt));

      sendDetailedEvent(buildMessageSubmittedEvent({
        identity: { instanceId },
        appVersion: options.appVersion,
        installMethod,
        surface: normalized.surface || 'chat',
        sentAt: normalized.occurredAt,
      }));
    },

    async recordToolCompleted(input) {
      if (!telemetryEnabled()) {
        return;
      }

      await runStoreWrite(() => store.recordToolCompleted(input));

      sendDetailedEvent(buildToolCallCompletedEvent({
        identity: { instanceId },
        appVersion: options.appVersion,
        installMethod,
        surface: input.surface || 'chat',
        toolName: input.toolName,
        success: input.success,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        sentAt: input.occurredAt ?? input.finishedAt,
      }));
    },

    async recordKanbanTaskCreated(input) {
      if (!detailedTelemetryEnabled()) {
        return;
      }

      sendDetailedEvent(buildKanbanTaskCreatedEvent({
        identity: { instanceId },
        appVersion: options.appVersion,
        installMethod,
        surface: input.surface || 'kanban',
        success: input.success,
        sentAt: input.occurredAt,
      }));
    },

    async recordClientDetailedEvent(input) {
      if (!detailedTelemetryEnabled()) {
        return;
      }

      if (input.event === 'branch_switched') {
        sendDetailedEvent(buildBranchSwitchedEvent({
          identity: { instanceId },
          appVersion: options.appVersion,
          installMethod,
          success: input.properties.success,
          sentAt: now(),
        }));
      }
    },

    async markFeatureUsed(feature, at) {
      if (!telemetryEnabled()) {
        return;
      }

      await runStoreWrite(() => store.markFeatureUsed(feature, at));
    },

    async markSessionSeen(sessionKey) {
      if (!telemetryEnabled()) {
        return {
          firstSeen: false,
          sessionHash: '',
        };
      }

      try {
        return await store.markSessionSeen(sessionKey);
      } catch {
        return {
          firstSeen: false,
          sessionHash: '',
        };
      }
    },

    async clearSessionSeen(sessionKey) {
      if (!telemetryEnabled()) {
        return;
      }

      await runStoreWrite(() => store.clearSessionSeen(sessionKey));
    },

    async reportError(input) {
      if (!telemetryEnabled() || !instanceId) {
        return;
      }

      try {
        const payload = buildErrorPayload({
          identity: { instanceId },
          appVersion: options.appVersion,
          installMethod,
          surface: resolveSurface(input.surface),
          error: input.error,
          errorCode: input.errorCode,
          occurredAt: input.occurredAt,
        });

        await transport.postJson('/v1/error', payload);
      } catch {
        return;
      }
    },
  };
}
