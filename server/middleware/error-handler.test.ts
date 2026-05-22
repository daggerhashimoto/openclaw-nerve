// @vitest-environment node

/** Tests for the global error handler middleware. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from './error-handler.js';
import { createTelemetryRuntime, setTelemetryRuntime, type TelemetryMetadataApi } from '../lib/telemetry/runtime.js';
import { emptyCounts24h, emptyFeaturesUsed24h, type HeartbeatReason, type TelemetryFeatureName, type TelemetryWindowSnapshot } from '../lib/telemetry/types.js';
import type { InstallMethodStamp } from '../lib/telemetry/install-metadata.js';
import type { RecordToolCompletedInput, TelemetryStore } from '../lib/telemetry/store.js';

function createMemoryStore(): TelemetryStore {
  const snapshot: TelemetryWindowSnapshot = {
    windowStart: '2026-04-20T00:05:00.000Z',
    windowEnd: '2026-04-21T00:05:00.000Z',
    counts24h: emptyCounts24h(),
    featuresUsed24h: emptyFeaturesUsed24h(),
    active24h: false,
    lastHeartbeatSentAtByReason: {},
    lastHeartbeatAppVersion: undefined,
  };

  return {
    async recordSessionCreated() {
      snapshot.counts24h.sessions_created += 1;
      snapshot.featuresUsed24h.sessions = true;
      snapshot.active24h = true;
    },
    async recordMessageSubmitted() {
      snapshot.counts24h.messages_sent += 1;
      snapshot.featuresUsed24h.chat = true;
      snapshot.active24h = true;
    },
    async recordToolCompleted(_input: RecordToolCompletedInput) {
      void _input;
      snapshot.counts24h.tool_calls += 1;
      snapshot.featuresUsed24h.chat = true;
      snapshot.active24h = true;
    },
    async markFeatureUsed(feature: TelemetryFeatureName) {
      snapshot.featuresUsed24h[feature] = true;
      snapshot.active24h = true;
    },
    async markSessionSeen(sessionKey: string) {
      return { firstSeen: true, sessionHash: `sha256:${sessionKey}` };
    },
    async clearSessionSeen() {
      return;
    },
    async readWindow() {
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
}

function createMetadata(): TelemetryMetadataApi {
  const installMethod: InstallMethodStamp = {
    installMethod: 'source',
    stampedAt: '2026-04-20T00:00:00.000Z',
    source: 'setup',
  };

  return {
    ensureInstanceId: vi.fn(() => 'uuid-1234'),
    ensureLegacyUpgradeMarker: vi.fn(() => ({ kind: 'fresh_install' as const, stampedAt: '2026-04-20T00:00:00.000Z', source: 'setup' as const })),
    readBootstrapMarker: vi.fn(() => ({ kind: 'fresh_install' as const, stampedAt: '2026-04-20T00:00:00.000Z', source: 'setup' as const })),
    readInstallMethod: vi.fn(() => installMethod),
    readInstallMethodOrUnknown: vi.fn((stamp?: InstallMethodStamp) => stamp?.installMethod || 'unknown'),
    resolveTelemetryMode: vi.fn(() => 'minimal'),
  };
}

describe('errorHandler middleware', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let runtime: ReturnType<typeof createTelemetryRuntime> | undefined;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setTelemetryRuntime(null);
  });

  afterEach(async () => {
    await runtime?.stop();
    setTelemetryRuntime(null);
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  function createApp(routePath: string, error: Error) {
    const app = new Hono();
    app.onError(errorHandler);
    app.get(routePath, () => { throw error; });
    return app;
  }

  it('returns JSON 500 for /api/* routes', async () => {
    const app = createApp('/api/foo', new Error('boom'));
    const res = await app.request('/api/foo');
    expect(res.status).toBe(500);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('Internal server error');
  });

  it('returns plain text 500 for non-API routes', async () => {
    const app = createApp('/some-page', new Error('boom'));
    const res = await app.request('/some-page');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe('Internal server error');
  });

  it('does not leak stack traces in the response', async () => {
    const app = createApp('/api/crash', new Error('secret details'));
    const res = await app.request('/api/crash');
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('Internal server error');
    expect(JSON.stringify(json)).not.toContain('secret details');
  });

  it('logs the error message', async () => {
    const app = createApp('/api/test', new Error('test error'));
    await app.request('/api/test');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[server]'),
      expect.stringContaining('test error'),
    );
  });

  it('handles /api path without trailing slash as API', async () => {
    const app = new Hono();
    app.onError(errorHandler);
    app.get('/api', () => { throw new Error('root api'); });
    const res = await app.request('/api');
    expect(res.status).toBe(500);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('Internal server error');
  });

  it('never throws back into the request path when telemetry transport fails', async () => {
    const postJson = vi.fn().mockRejectedValue(new Error('telemetry down'));
    runtime = createTelemetryRuntime({
      appVersion: '1.5.2',
      envMode: 'minimal',
      store: createMemoryStore(),
      transport: { postJson },
      metadata: createMetadata(),
      now: () => new Date('2026-04-21T00:05:00.000Z'),
      phase1BaseUrl: 'https://telemetry.example.com',
      publicDocUrl: 'https://example.com/telemetry',
    });
    setTelemetryRuntime(runtime);

    await runtime.start();

    const app = createApp('/api/crash', new Error('Bearer top-secret from /Users/alice/nerve'));
    const res = await app.request('/api/crash');

    expect(res.status).toBe(500);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('Internal server error');

    await Promise.resolve();
    await Promise.resolve();

    const errorCall = postJson.mock.calls.find(([target]) => target === '/v1/error');
    expect(errorCall).toBeTruthy();
    expect(JSON.stringify(errorCall?.[1])).not.toContain('Bearer top-secret');
    expect(JSON.stringify(errorCall?.[1])).not.toContain('/Users/alice/nerve');
  });
});
