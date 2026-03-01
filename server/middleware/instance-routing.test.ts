import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

let execFileImpl: (...args: unknown[]) => void;

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const mock = { ...actual, execFile: (...args: unknown[]) => execFileImpl(...args) };
  return { ...mock, default: mock };
});

import { instanceRoutingMiddleware } from './instance-routing.js';

function buildApp() {
  const app = new Hono();
  app.use('/api/*', instanceRoutingMiddleware);
  app.get('/api/files/read', (c) => c.json({ source: 'master', path: c.req.query('path') || '' }));
  app.get('/api/instances', (c) => c.json({ source: 'master' }));
  app.get('/api/unknown', (c) => c.json({ source: 'master-unknown' }));
  return app;
}

describe('instanceRoutingMiddleware', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('routes file-style endpoints to selected instance via header metadata', async () => {
    execFileImpl = (_bin: unknown, args: unknown, _opts: unknown, cb: unknown) => {
      const dockerArgs = args as string[];
      if (dockerArgs[0] === 'inspect') {
        const payload = JSON.stringify([
          {
            Id: 'cid-a',
            Name: '/openclaw-target',
            Config: {
              Image: 'openclaw/gateway:latest',
              Env: ['GATEWAY_TOKEN=abc123'],
              Labels: {},
            },
            State: { Status: 'running' },
            NetworkSettings: {
              Ports: {
                '18789/tcp': [{ HostIp: '0.0.0.0', HostPort: '28789' }],
                '3080/tcp': [{ HostIp: '0.0.0.0', HostPort: '23080' }],
              },
            },
          },
        ]);
        (cb as (err: null, stdout: string, stderr: string) => void)(null, payload, '');
        return;
      }
      (cb as (err: Error, stdout: string, stderr: string) => void)(new Error('unexpected args'), '', '');
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, source: 'instance' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const app = buildApp();
    const res = await app.request('/api/files/read?path=README.md', {
      headers: { 'X-Instance-Id': 'cid-a' },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, source: 'instance' });

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:28789/api/files/read?path=README.md');
  });

  it('keeps /api/instances master-pinned even when instance metadata is present', async () => {
    globalThis.fetch = vi.fn();
    const app = buildApp();
    const res = await app.request('/api/instances', {
      headers: { 'X-Instance-Id': 'cid-a' },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ source: 'master' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('defaults unknown paths to master', async () => {
    globalThis.fetch = vi.fn();
    const app = buildApp();
    const res = await app.request('/api/unknown', {
      headers: { 'X-Instance-Id': 'cid-a' },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ source: 'master-unknown' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
