// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const telemetryRuntimeMock = {
  markFeatureUsed: vi.fn(async () => undefined),
  recordClientDetailedEvent: vi.fn(async () => undefined),
};

function resetTelemetryRuntimeMock(): void {
  telemetryRuntimeMock.markFeatureUsed.mockReset();
  telemetryRuntimeMock.markFeatureUsed.mockResolvedValue(undefined);
  telemetryRuntimeMock.recordClientDetailedEvent.mockReset();
  telemetryRuntimeMock.recordClientDetailedEvent.mockResolvedValue(undefined);
}

describe('telemetry relay routes', () => {
  beforeEach(() => {
    vi.resetModules();
    resetTelemetryRuntimeMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockDeps() {
    vi.doMock('../middleware/rate-limit.js', () => ({
      rateLimitGeneral: vi.fn(async (_c: unknown, next: () => Promise<void>) => next()),
    }));

    vi.doMock('../lib/telemetry/runtime.js', () => ({
      getTelemetryRuntime: vi.fn(() => telemetryRuntimeMock),
    }));
  }

  async function buildApp() {
    const mod = await import('./telemetry.js');
    const app = new Hono();
    app.route('/', mod.default);
    return app;
  }

  it('serves the build-matched telemetry documentation', async () => {
    mockDeps();
    const app = await buildApp();

    const res = await app.request('/api/telemetry/docs');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    expect(await res.text()).toContain('# Telemetry');
  });

  it('rejects invalid event values with a 400', async () => {
    mockDeps();
    const app = await buildApp();

    const res = await app.request('/api/telemetry/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'workspace_opened' }),
    });

    expect(res.status).toBe(400);
    expect(telemetryRuntimeMock.markFeatureUsed).not.toHaveBeenCalled();
    expect(telemetryRuntimeMock.recordClientDetailedEvent).not.toHaveBeenCalled();
  });

  it('rejects unknown properties with a 400', async () => {
    mockDeps();
    const app = await buildApp();

    const res = await app.request('/api/telemetry/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'branch_switched', properties: { success: true, extra: 'nope' } }),
    });

    expect(res.status).toBe(400);
    expect(telemetryRuntimeMock.markFeatureUsed).not.toHaveBeenCalled();
    expect(telemetryRuntimeMock.recordClientDetailedEvent).not.toHaveBeenCalled();
  });

  it('handles session_opened locally', async () => {
    mockDeps();
    const app = await buildApp();

    const res = await app.request('/api/telemetry/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'session_opened' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(telemetryRuntimeMock.markFeatureUsed).toHaveBeenCalledTimes(1);
    expect(telemetryRuntimeMock.markFeatureUsed).toHaveBeenCalledWith('sessions');
    expect(telemetryRuntimeMock.recordClientDetailedEvent).not.toHaveBeenCalled();
  });

  it('handles branch_created locally', async () => {
    mockDeps();
    const app = await buildApp();

    const res = await app.request('/api/telemetry/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'branch_created' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(telemetryRuntimeMock.markFeatureUsed).toHaveBeenCalledTimes(1);
    expect(telemetryRuntimeMock.markFeatureUsed).toHaveBeenCalledWith('branches');
    expect(telemetryRuntimeMock.recordClientDetailedEvent).not.toHaveBeenCalled();
  });

  it('marks branches and relays branch_switched through the telemetry runtime', async () => {
    mockDeps();
    const app = await buildApp();

    const payload = { event: 'branch_switched', properties: { success: true } };
    const res = await app.request('/api/telemetry/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(telemetryRuntimeMock.markFeatureUsed).toHaveBeenCalledTimes(1);
    expect(telemetryRuntimeMock.markFeatureUsed).toHaveBeenCalledWith('branches');
    expect(telemetryRuntimeMock.recordClientDetailedEvent).toHaveBeenCalledTimes(1);
    expect(telemetryRuntimeMock.recordClientDetailedEvent).toHaveBeenCalledWith(payload);
  });

  it('keeps branch_switched best-effort when feature marking fails', async () => {
    mockDeps();
    telemetryRuntimeMock.markFeatureUsed.mockRejectedValueOnce(new Error('boom'));
    const app = await buildApp();

    const payload = { event: 'branch_switched', properties: { success: true } };
    const res = await app.request('/api/telemetry/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(telemetryRuntimeMock.markFeatureUsed).toHaveBeenCalledTimes(1);
    expect(telemetryRuntimeMock.markFeatureUsed).toHaveBeenCalledWith('branches');
    expect(telemetryRuntimeMock.recordClientDetailedEvent).toHaveBeenCalledTimes(1);
    expect(telemetryRuntimeMock.recordClientDetailedEvent).toHaveBeenCalledWith(payload);
  });
});
