/** Tests for API key status and persistence routes. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

describe('api-keys routes', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockDeps(overrides: { mimoKey?: string } = {}) {
    const mockConfig: Record<string, unknown> = {
      openaiApiKey: '',
      replicateApiToken: '',
      mimoApiKey: overrides.mimoKey || '',
    };

    vi.doMock('../lib/config.js', () => ({
      config: mockConfig,
    }));

    vi.doMock('../lib/env-file.js', () => ({
      writeEnvKey: vi.fn(async () => {}),
    }));

    vi.doMock('../middleware/rate-limit.js', () => ({
      rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
    }));
  }

  async function buildApp() {
    const mod = await import('./api-keys.js');
    const app = new Hono();
    app.route('/', mod.default);
    return app;
  }

  it('reports xiaomiKeySet from config', async () => {
    mockDeps({ mimoKey: 'sk-mimo' });
    const app = await buildApp();

    const res = await app.request('/api/keys');
    expect(res.status).toBe(200);

    const json = await res.json() as Record<string, unknown>;
    expect(json.xiaomiKeySet).toBe(true);
  });

  it('writes MIMO_API_KEY from mimoApiKey input', async () => {
    mockDeps();
    const app = await buildApp();

    const res = await app.request('/api/keys', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mimoApiKey: 'sk-mimo' }),
    });

    expect(res.status).toBe(200);

    const json = await res.json() as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.xiaomiKeySet).toBe(true);
  });
});
