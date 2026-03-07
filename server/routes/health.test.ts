/** Tests for /health and /healthcheck endpoint contracts. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

describe('health routes', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function importHealthApp() {
    const mod = await import('./health.js');
    const app = new Hono();
    app.route('/', mod.default);
    return app;
  }

  it('should return status ok and uptime', async () => {
    // Mock fetch to simulate gateway being reachable
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

    const app = await importHealthApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.status).toBe('ok');
    expect(typeof json.uptime).toBe('number');
    expect(json.gateway).toBe('ok');
  });

  it('should report gateway unreachable when fetch fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const app = await importHealthApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.status).toBe('ok');
    expect(json.gateway).toBe('unreachable');
  });

  it('should report gateway unreachable when response is not ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    const app = await importHealthApp();
    const res = await app.request('/health');
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.gateway).toBe('unreachable');
  });

  it('should call gateway health endpoint with abort signal', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

    const app = await importHealthApp();
    await app.request('/health');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain('/health');
    expect(callArgs[1]).toHaveProperty('signal');
  });

  it('should return explicit /healthcheck ready contract when gateway is reachable', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

    const app = await importHealthApp();
    const res = await app.request('/healthcheck');
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.service).toBe('nerve');
    expect(json.status).toBe('ready');
    expect(json.ready).toBe(true);
    expect(typeof json.uptime).toBe('number');
    expect(json.gateway).toBe('ok');
  });

  it('should return explicit /healthcheck initializing contract when gateway is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const app = await importHealthApp();
    const res = await app.request('/healthcheck');
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.service).toBe('nerve');
    expect(json.status).toBe('initializing');
    expect(json.ready).toBe(false);
    expect(typeof json.uptime).toBe('number');
    expect(json.gateway).toBe('unreachable');
  });
});
