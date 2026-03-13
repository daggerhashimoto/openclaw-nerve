/** Tests for the GET /api/connect-defaults endpoint. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

describe('GET /api/connect-defaults', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Build a Hono app with mocked config for testing. */
  async function buildApp(
    configOverrides: Record<string, unknown> = {},
    remoteAddress: string = '127.0.0.1',
  ) {
    vi.doMock('../lib/config.js', () => ({
      config: {
        gatewayUrl: 'http://127.0.0.1:18789',
        gatewayToken: 'test-token',
        agentName: 'test-agent',
        auth: false,
        ...configOverrides,
      },
    }));

    vi.doMock('../middleware/rate-limit.js', () => ({
      rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
    }));

    vi.doMock('@hono/node-server/conninfo', () => ({
      getConnInfo: vi.fn(() => ({
        remote: { address: remoteAddress },
      })),
    }));

    const mod = await import('./connect-defaults.js');
    const app = new Hono();
    app.route('/', mod.default);
    return app;
  }

  it('derives wsUrl from an http gatewayUrl and returns token: null', async () => {
    const app = await buildApp({ gatewayUrl: 'http://localhost:18789' });
    const res = await app.request('/api/connect-defaults');
    expect(res.status).toBe(200);

    const json = (await res.json()) as { wsUrl: string; token: string | null; agentName: string; authEnabled: boolean; serverSideAuth: boolean };
    expect(json.wsUrl).toBe('ws://localhost:18789/ws');
    expect(json.token).toBeNull();
    expect(json.agentName).toBe('test-agent');
    expect(json.authEnabled).toBe(false);
    expect(json.serverSideAuth).toBe(true); // default mock has token and it's loopback
  });

  it('derives wsUrl from an https gatewayUrl as wss://', async () => {
    const app = await buildApp({ gatewayUrl: 'https://example.com:8443' });
    const res = await app.request('/api/connect-defaults');
    expect(res.status).toBe(200);

    const json = (await res.json()) as { wsUrl: string };
    expect(json.wsUrl).toBe('wss://example.com:8443/ws');
  });

  it('includes authEnabled reflecting server config', async () => {
    const app = await buildApp({ auth: true });
    const res = await app.request('/api/connect-defaults');
    const json = (await res.json()) as { authEnabled: boolean; serverSideAuth: boolean };

    expect(json.authEnabled).toBe(true);
    expect(json.serverSideAuth).toBe(true); // auth: true -> trusted -> serverSideAuth: true
  });

  it('sets serverSideAuth: false when gateway token is missing', async () => {
    const app = await buildApp({ gatewayToken: '' });
    const res = await app.request('/api/connect-defaults');
    const json = (await res.json()) as { serverSideAuth: boolean };

    expect(json.serverSideAuth).toBe(false);
  });

  it('sets serverSideAuth: false for external IP when auth is disabled', async () => {
    const app = await buildApp({ auth: false }, '203.0.113.5');
    const res = await app.request('/api/connect-defaults');
    const json = (await res.json()) as { serverSideAuth: boolean };

    expect(json.serverSideAuth).toBe(false);
  });
});
