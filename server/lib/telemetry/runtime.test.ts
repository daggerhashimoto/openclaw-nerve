// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyCounts24h, emptyFeaturesUsed24h, type HeartbeatReason, type TelemetryFeatureName, type TelemetryWindowSnapshot } from './types.js';
import { createTelemetryRuntime, type TelemetryMetadataApi } from './runtime.js';
import type { InstallMethodStamp, BootstrapMarker, TelemetryMode } from './install-metadata.js';
import type { RecordToolCompletedInput, TelemetryStore } from './store.js';

interface MemoryStoreController {
  store: TelemetryStore;
  snapshot: TelemetryWindowSnapshot;
}

function createMemoryStore(nowIso = '2026-04-21T00:05:00.000Z'): MemoryStoreController {
  const snapshot: TelemetryWindowSnapshot = {
    windowStart: '2026-04-20T00:05:00.000Z',
    windowEnd: nowIso,
    counts24h: emptyCounts24h(),
    featuresUsed24h: emptyFeaturesUsed24h(),
    active24h: false,
    lastHeartbeatSentAtByReason: {},
    lastHeartbeatAppVersion: undefined,
  };

  const updateActive = () => {
    snapshot.active24h = snapshot.counts24h.sessions_created > 0
      || snapshot.counts24h.messages_sent > 0
      || snapshot.counts24h.tool_calls > 0
      || Object.values(snapshot.featuresUsed24h).some(Boolean);
  };

  const store: TelemetryStore = {
    async recordSessionCreated() {
      snapshot.counts24h.sessions_created += 1;
      snapshot.featuresUsed24h.sessions = true;
      updateActive();
    },

    async recordMessageSubmitted() {
      snapshot.counts24h.messages_sent += 1;
      snapshot.featuresUsed24h.chat = true;
      updateActive();
    },

    async recordToolCompleted(_input: RecordToolCompletedInput) {
      void _input;
      snapshot.counts24h.tool_calls += 1;
      snapshot.featuresUsed24h.chat = true;
      updateActive();
    },

    async markFeatureUsed(feature: TelemetryFeatureName) {
      snapshot.featuresUsed24h[feature] = true;
      updateActive();
    },

    async markSessionSeen(sessionKey: string) {
      return {
        firstSeen: true,
        sessionHash: `sha256:${sessionKey}`,
      };
    },

    async clearSessionSeen() {
      return;
    },

    async readWindow(now) {
      if (now) {
        snapshot.windowEnd = new Date(now).toISOString();
      }
      return {
        ...snapshot,
        counts24h: { ...snapshot.counts24h },
        featuresUsed24h: { ...snapshot.featuresUsed24h },
        lastHeartbeatSentAtByReason: { ...snapshot.lastHeartbeatSentAtByReason },
      };
    },

    async noteHeartbeatSent(input: { reason: HeartbeatReason; sentAt: Date | string | number; appVersion: string }) {
      snapshot.lastHeartbeatSentAtByReason[input.reason] = new Date(input.sentAt).toISOString();
      snapshot.lastHeartbeatAppVersion = input.appVersion;
    },
  };

  return { store, snapshot };
}

function createMetadata(mode: TelemetryMode, bootstrap?: BootstrapMarker): TelemetryMetadataApi {
  const installMethod: InstallMethodStamp = {
    installMethod: 'source',
    stampedAt: '2026-04-20T00:00:00.000Z',
    source: 'setup',
  };

  return {
    ensureInstanceId: vi.fn(() => 'uuid-1234'),
    ensureLegacyUpgradeMarker: vi.fn(() => bootstrap),
    readBootstrapMarker: vi.fn(() => bootstrap),
    readInstallMethod: vi.fn(() => installMethod),
    readInstallMethodOrUnknown: vi.fn((stamp?: InstallMethodStamp) => stamp?.installMethod || 'unknown'),
    resolveTelemetryMode: vi.fn(() => mode),
  };
}

function createScheduler() {
  const scheduled: Array<{ id: number; delay: number; fn: () => void }> = [];

  const setTimeoutFn = vi.fn(((fn: () => void, delay?: number) => {
    const id = scheduled.length + 1;
    scheduled.push({ id, delay: Number(delay || 0), fn });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);

  const clearTimeoutFn = vi.fn(((id: ReturnType<typeof setTimeout>) => {
    const numericId = id as unknown as number;
    const timer = scheduled.find((entry) => entry.id === numericId);
    if (timer) timer.fn = () => {};
  }) as typeof clearTimeout);

  return { scheduled, setTimeoutFn, clearTimeoutFn };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('telemetry runtime', () => {
  it('gates transport by telemetry mode', async () => {
    for (const mode of ['off', 'minimal', 'detailed'] as const) {
      const { store, snapshot } = createMemoryStore();
      const postJson = vi.fn().mockResolvedValue(true);
      const scheduler = createScheduler();
      const runtime = createTelemetryRuntime({
        appVersion: '1.5.2',
        envMode: mode,
        store,
        transport: { postJson },
        metadata: createMetadata(mode, { kind: 'fresh_install', stampedAt: '2026-04-20T00:00:00.000Z', source: 'setup' }),
        now: () => new Date('2026-04-21T00:05:00.000Z'),
        setTimeoutFn: scheduler.setTimeoutFn,
        clearTimeoutFn: scheduler.clearTimeoutFn,
        dailyJitterMs: 10 * 60 * 1000,
        phase1BaseUrl: 'https://telemetry.example.com',
        publicDocUrl: 'https://example.com/telemetry',
      });

      await runtime.start();
      await runtime.recordMessageSubmitted('2026-04-21T00:05:01.000Z');
      await runtime.recordToolCompleted({
        toolName: 'read',
        success: true,
        startedAt: 0,
        finishedAt: 1,
        occurredAt: '2026-04-21T00:05:02.000Z',
      });
      await runtime.markFeatureUsed('settings', '2026-04-21T00:05:03.000Z');
      await runtime.reportError({ error: new Error('boom'), surface: 'api' });
      await flushAsyncWork();

      if (mode === 'off') {
        expect(snapshot.counts24h).toEqual({ sessions_created: 0, messages_sent: 0, tool_calls: 0 });
        expect(snapshot.featuresUsed24h.settings).toBe(false);
        expect(postJson).not.toHaveBeenCalled();
        expect(scheduler.scheduled).toHaveLength(0);
      } else {
        expect(snapshot.counts24h).toEqual({ sessions_created: 0, messages_sent: 1, tool_calls: 1 });
        expect(snapshot.featuresUsed24h.chat).toBe(true);
        expect(snapshot.featuresUsed24h.settings).toBe(true);
        expect(postJson.mock.calls.map(([target]) => target)).toEqual(['/v1/heartbeat', '/v1/error']);
        expect(postJson.mock.calls[0]?.[1]).toMatchObject({ reason: 'first_seen' });
        expect(postJson.mock.calls[1]?.[1]).toMatchObject({ surface: 'api' });
        expect(scheduler.scheduled[0]?.delay).toBe(5 * 60 * 1000);
      }

      await runtime.stop();
    }
  });

  it('defaults session_created detailed events to the sessions surface', async () => {
    const { store } = createMemoryStore();
    const transportPostJson = vi.fn().mockResolvedValue(true);
    const detailedPostJson = vi.fn().mockResolvedValue(true);
    const runtime = createTelemetryRuntime({
      appVersion: '1.5.2',
      envMode: 'detailed',
      store,
      transport: { postJson: transportPostJson },
      detailedTransport: { postJson: detailedPostJson },
      metadata: createMetadata('detailed', { kind: 'fresh_install', stampedAt: '2026-04-20T00:00:00.000Z', source: 'setup' }),
      now: () => new Date('2026-04-21T00:05:00.000Z'),
      phase1BaseUrl: 'https://telemetry.example.com',
      phase2BaseUrl: 'https://telemetry.example.com',
      publicDocUrl: 'https://example.com/telemetry',
    });

    await runtime.start();
    await runtime.recordSessionCreated({ occurredAt: '2026-04-21T00:05:01.000Z' });
    await flushAsyncWork();

    expect(detailedPostJson).toHaveBeenCalledTimes(1);
    expect(detailedPostJson).toHaveBeenCalledWith('/v1/events', expect.objectContaining({
      event: 'session_created',
      sent_at: '2026-04-21T00:05:01.000Z',
      properties: {
        surface: 'sessions',
        feature_area: 'sessions',
      },
    }));

    await runtime.stop();
  });

  it('relays branch_switched detailed events with the workspace payload shape', async () => {
    const { store } = createMemoryStore();
    const transportPostJson = vi.fn().mockResolvedValue(true);
    const detailedPostJson = vi.fn().mockResolvedValue(true);
    const runtime = createTelemetryRuntime({
      appVersion: '1.5.2',
      envMode: 'detailed',
      store,
      transport: { postJson: transportPostJson },
      detailedTransport: { postJson: detailedPostJson },
      metadata: createMetadata('detailed', { kind: 'fresh_install', stampedAt: '2026-04-20T00:00:00.000Z', source: 'setup' }),
      now: () => new Date('2026-04-21T00:05:00.000Z'),
      phase1BaseUrl: 'https://telemetry.example.com',
      phase2BaseUrl: 'https://telemetry.example.com',
      publicDocUrl: 'https://example.com/telemetry',
    });

    await runtime.start();
    await runtime.recordClientDetailedEvent({ event: 'branch_switched', properties: { success: true } });
    await flushAsyncWork();

    expect(detailedPostJson).toHaveBeenCalledTimes(1);
    expect(detailedPostJson).toHaveBeenCalledWith('/v1/events', expect.objectContaining({
      event: 'branch_switched',
      sent_at: '2026-04-21T00:05:00.000Z',
      properties: {
        surface: 'workspace',
        feature_area: 'workspace',
        success: true,
      },
    }));

    await runtime.stop();
  });

  it.each(['off', 'minimal'] as const)('does not emit branch_switched detailed events in %s mode', async (mode) => {
    const { store } = createMemoryStore();
    const transportPostJson = vi.fn().mockResolvedValue(true);
    const detailedPostJson = vi.fn().mockResolvedValue(true);
    const runtime = createTelemetryRuntime({
      appVersion: '1.5.2',
      envMode: mode,
      store,
      transport: { postJson: transportPostJson },
      detailedTransport: { postJson: detailedPostJson },
      metadata: createMetadata(mode, { kind: 'fresh_install', stampedAt: '2026-04-20T00:00:00.000Z', source: 'setup' }),
      now: () => new Date('2026-04-21T00:05:00.000Z'),
      phase1BaseUrl: 'https://telemetry.example.com',
      phase2BaseUrl: 'https://telemetry.example.com',
      publicDocUrl: 'https://example.com/telemetry',
    });

    await runtime.start();
    await runtime.recordClientDetailedEvent({ event: 'branch_switched', properties: { success: true } });
    await flushAsyncWork();

    expect(detailedPostJson).not.toHaveBeenCalled();

    await runtime.stop();
  });

  it('sends a version_change heartbeat when the app version changes', async () => {
    const { store, snapshot } = createMemoryStore();
    snapshot.lastHeartbeatSentAtByReason.first_seen = '2026-04-20T00:00:00.000Z';
    snapshot.lastHeartbeatAppVersion = '1.5.1';

    const postJson = vi.fn().mockResolvedValue(true);
    const runtime = createTelemetryRuntime({
      appVersion: '1.5.2',
      envMode: 'minimal',
      store,
      transport: { postJson },
      metadata: createMetadata('minimal', { kind: 'fresh_install', stampedAt: '2026-04-20T00:00:00.000Z', source: 'setup' }),
      now: () => new Date('2026-04-21T00:05:00.000Z'),
      phase1BaseUrl: 'https://telemetry.example.com',
      publicDocUrl: 'https://example.com/telemetry',
    });

    await runtime.start();
    await flushAsyncWork();

    expect(postJson).toHaveBeenCalledTimes(1);
    expect(postJson.mock.calls[0]?.[0]).toBe('/v1/heartbeat');
    expect(postJson.mock.calls[0]?.[1]).toMatchObject({ reason: 'version_change' });

    await runtime.stop();
  });

  it('sends a catch-up daily heartbeat on startup after the daily target has passed', async () => {
    const { store, snapshot } = createMemoryStore();
    snapshot.lastHeartbeatSentAtByReason.first_seen = '2026-04-20T00:00:00.000Z';
    snapshot.lastHeartbeatSentAtByReason.daily = '2026-04-20T00:10:00.000Z';
    snapshot.lastHeartbeatAppVersion = '1.5.2';

    const postJson = vi.fn().mockResolvedValue(true);
    const runtime = createTelemetryRuntime({
      appVersion: '1.5.2',
      envMode: 'minimal',
      store,
      transport: { postJson },
      metadata: createMetadata('minimal', { kind: 'fresh_install', stampedAt: '2026-04-20T00:00:00.000Z', source: 'setup' }),
      now: () => new Date('2026-04-21T12:00:00.000Z'),
      phase1BaseUrl: 'https://telemetry.example.com',
      publicDocUrl: 'https://example.com/telemetry',
    });

    await runtime.start();
    await flushAsyncWork();

    expect(postJson).toHaveBeenCalledTimes(1);
    expect(postJson.mock.calls[0]?.[1]).toMatchObject({ reason: 'daily' });
    expect(snapshot.lastHeartbeatSentAtByReason.daily).toBe('2026-04-21T12:00:00.000Z');

    await runtime.stop();
  });

  it('retries startup heartbeats until delivery is confirmed', async () => {
    const { store, snapshot } = createMemoryStore();

    const failedDelivery = vi.fn().mockResolvedValue(false);
    const firstRuntime = createTelemetryRuntime({
      appVersion: '1.5.2',
      envMode: 'minimal',
      store,
      transport: { postJson: failedDelivery },
      metadata: createMetadata('minimal', { kind: 'fresh_install', stampedAt: '2026-04-20T00:00:00.000Z', source: 'setup' }),
      now: () => new Date('2026-04-21T00:05:00.000Z'),
      phase1BaseUrl: 'https://telemetry.example.com',
      publicDocUrl: 'https://example.com/telemetry',
    });

    await firstRuntime.start();
    await flushAsyncWork();

    expect(failedDelivery).toHaveBeenCalledTimes(1);
    expect(failedDelivery.mock.calls[0]?.[1]).toMatchObject({ reason: 'first_seen' });
    expect(snapshot.lastHeartbeatSentAtByReason.first_seen).toBeUndefined();
    expect(snapshot.lastHeartbeatAppVersion).toBeUndefined();

    await firstRuntime.stop();

    const confirmedDelivery = vi.fn().mockResolvedValue(true);
    const secondRuntime = createTelemetryRuntime({
      appVersion: '1.5.2',
      envMode: 'minimal',
      store,
      transport: { postJson: confirmedDelivery },
      metadata: createMetadata('minimal', { kind: 'fresh_install', stampedAt: '2026-04-20T00:00:00.000Z', source: 'setup' }),
      now: () => new Date('2026-04-21T00:05:00.000Z'),
      phase1BaseUrl: 'https://telemetry.example.com',
      publicDocUrl: 'https://example.com/telemetry',
    });

    await secondRuntime.start();
    await flushAsyncWork();

    expect(confirmedDelivery).toHaveBeenCalledTimes(1);
    expect(confirmedDelivery.mock.calls[0]?.[1]).toMatchObject({ reason: 'first_seen' });
    expect(snapshot.lastHeartbeatSentAtByReason.first_seen).toBe('2026-04-21T00:05:00.000Z');
    expect(snapshot.lastHeartbeatAppVersion).toBe('1.5.2');

    await secondRuntime.stop();
  });

  it('still emits detailed events when Phase 1 store writes fail', async () => {
    const { store } = createMemoryStore();
    const transportPostJson = vi.fn().mockResolvedValue(true);
    const detailedPostJson = vi.fn().mockResolvedValue(true);
    const runtime = createTelemetryRuntime({
      appVersion: '1.5.2',
      envMode: 'detailed',
      store: {
        ...store,
        recordSessionCreated: vi.fn(async () => {
          throw new Error('disk full');
        }),
        recordMessageSubmitted: vi.fn(async () => {
          throw new Error('disk full');
        }),
        recordToolCompleted: vi.fn(async () => {
          throw new Error('disk full');
        }),
      },
      transport: { postJson: transportPostJson },
      detailedTransport: { postJson: detailedPostJson },
      metadata: createMetadata('detailed', { kind: 'fresh_install', stampedAt: '2026-04-20T00:00:00.000Z', source: 'setup' }),
      now: () => new Date('2026-04-21T00:05:00.000Z'),
      phase1BaseUrl: 'https://telemetry.example.com',
      phase2BaseUrl: 'https://telemetry.example.com',
      publicDocUrl: 'https://example.com/telemetry',
    });

    await runtime.start();
    await expect(runtime.recordSessionCreated({ occurredAt: '2026-04-21T00:05:01.000Z' })).resolves.toBeUndefined();
    await expect(runtime.recordMessageSubmitted('2026-04-21T00:05:02.000Z')).resolves.toBeUndefined();
    await expect(runtime.recordToolCompleted({
      toolName: 'read',
      success: true,
      startedAt: 0,
      finishedAt: 1,
      occurredAt: '2026-04-21T00:05:03.000Z',
    })).resolves.toBeUndefined();
    await flushAsyncWork();

    expect(detailedPostJson.mock.calls.map(([, payload]) => (payload as { event: string }).event)).toEqual([
      'session_created',
      'message_submitted',
      'tool_call_completed',
    ]);

    await runtime.stop();
  });

  it('schedules daily heartbeats and clears the timer on stop', async () => {
    const { store, snapshot } = createMemoryStore();
    snapshot.lastHeartbeatSentAtByReason.first_seen = '2026-04-20T00:00:00.000Z';
    snapshot.lastHeartbeatAppVersion = '1.5.2';

    const postJson = vi.fn().mockResolvedValue(true);
    const scheduler = createScheduler();
    const runtime = createTelemetryRuntime({
      appVersion: '1.5.2',
      envMode: 'minimal',
      store,
      transport: { postJson },
      metadata: createMetadata('minimal', { kind: 'fresh_install', stampedAt: '2026-04-20T00:00:00.000Z', source: 'setup' }),
      now: () => new Date('2026-04-21T00:05:00.000Z'),
      setTimeoutFn: scheduler.setTimeoutFn,
      clearTimeoutFn: scheduler.clearTimeoutFn,
      dailyJitterMs: 10 * 60 * 1000,
      phase1BaseUrl: 'https://telemetry.example.com',
      publicDocUrl: 'https://example.com/telemetry',
    });

    await runtime.start();
    await flushAsyncWork();

    expect(postJson).not.toHaveBeenCalled();
    expect(scheduler.scheduled).toHaveLength(1);
    expect(scheduler.scheduled[0]?.delay).toBe(5 * 60 * 1000);

    scheduler.scheduled[0]?.fn();
    await flushAsyncWork();

    expect(postJson).toHaveBeenCalledTimes(1);
    expect(postJson.mock.calls[0]?.[1]).toMatchObject({ reason: 'daily' });
    expect(snapshot.lastHeartbeatSentAtByReason.daily).toBe('2026-04-21T00:05:00.000Z');
    expect(scheduler.scheduled).toHaveLength(2);

    await runtime.stop();

    expect(scheduler.clearTimeoutFn).toHaveBeenCalled();
  });

  it('skips startup heartbeats that finish reading after stop is called', async () => {
    const { store: baseStore } = createMemoryStore();
    const baseReadWindow = baseStore.readWindow.bind(baseStore);
    let releaseReadWindow: (() => void) | undefined;

    const store: TelemetryStore = {
      ...baseStore,
      async readWindow(now) {
        await new Promise<void>((resolve) => {
          releaseReadWindow = resolve;
        });
        return baseReadWindow(now);
      },
    };

    const postJson = vi.fn().mockResolvedValue(true);
    const runtime = createTelemetryRuntime({
      appVersion: '1.5.2',
      envMode: 'minimal',
      store,
      transport: { postJson },
      metadata: createMetadata('minimal', { kind: 'fresh_install', stampedAt: '2026-04-20T00:00:00.000Z', source: 'setup' }),
      now: () => new Date('2026-04-21T00:05:00.000Z'),
      phase1BaseUrl: 'https://telemetry.example.com',
      publicDocUrl: 'https://example.com/telemetry',
    });

    await runtime.start();
    await runtime.stop();
    releaseReadWindow?.();
    await flushAsyncWork();

    expect(postJson).not.toHaveBeenCalled();
  });

  it('discloses telemetry mode and fresh-install notice state for server info', async () => {
    const { store } = createMemoryStore();
    const runtime = createTelemetryRuntime({
      appVersion: '1.5.2',
      envMode: 'minimal',
      store,
      transport: { postJson: vi.fn().mockResolvedValue(true) },
      metadata: createMetadata('minimal', { kind: 'fresh_install', stampedAt: '2026-04-20T00:00:00.000Z', source: 'setup' }),
      now: () => new Date('2026-04-21T00:05:00.000Z'),
      phase1BaseUrl: 'https://telemetry.example.com',
      publicDocUrl: 'https://example.com/telemetry',
    });

    await runtime.start();

    expect(runtime.getServerInfoDisclosure()).toEqual({
      telemetryMode: 'minimal',
      telemetryEnabled: true,
      telemetryPublicDocUrl: 'https://example.com/telemetry',
      showFreshInstallNotice: true,
      freshInstallNoticeId: '2026-04-20T00:00:00.000Z',
    });

    await runtime.stop();
  });
});
