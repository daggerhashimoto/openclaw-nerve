/** Tests for local Docker instance discovery and token retrieval routes. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

let execFileImpl: (...args: unknown[]) => void;

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const mock = { ...actual, execFile: (...args: unknown[]) => execFileImpl(...args) };
  return { ...mock, default: mock };
});

vi.mock('../middleware/rate-limit.js', () => ({
  rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
}));

import instancesRoutes from './instances.js';

function buildApp() {
  const app = new Hono();
  app.route('/', instancesRoutes);
  return app;
}

describe('instances routes', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('lists only openclaw-like containers', async () => {
    execFileImpl = (bin: unknown, args: unknown, _opts: unknown, cb: unknown) => {
      expect(bin).toBe('docker');
      const dockerArgs = args as string[];
      if (dockerArgs[0] === 'ps') {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, 'cid-open\ncid-nginx\n', '');
        return;
      }
      if (dockerArgs[0] === 'inspect') {
        const payload = JSON.stringify([
          {
            Id: 'cid-open',
            Name: '/openclaw-gateway',
            Created: '2026-03-01T00:00:00Z',
            Config: {
              Image: 'ghcr.io/openclaw/openclaw-gateway:latest',
              Env: ['OPENCLAW_GATEWAY_TOKEN=test-token'],
              Labels: { 'com.docker.compose.project': 'openclaw' },
            },
            State: { Status: 'running' },
            NetworkSettings: {
              Ports: { '18789/tcp': [{ HostIp: '0.0.0.0', HostPort: '18789' }] },
            },
          },
          {
            Id: 'cid-nginx',
            Name: '/web',
            Config: { Image: 'nginx:latest', Env: ['FOO=bar'], Labels: {} },
            State: { Status: 'running' },
            NetworkSettings: { Ports: { '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }] } },
          },
        ]);
        (cb as (err: null, stdout: string, stderr: string) => void)(null, payload, '');
        return;
      }
      (cb as (err: Error, stdout: string, stderr: string) => void)(new Error('unexpected args'), '', '');
    };

    const app = buildApp();
    const res = await app.request('/api/instances');
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      source: string;
      instances: Array<{ id: string; name: string; hasGatewayToken: boolean }>;
    };
    expect(json.source).toBe('local-docker');
    expect(json.instances).toHaveLength(1);
    expect(json.instances[0].id).toBe('cid-open');
    expect(json.instances[0].name).toBe('openclaw-gateway');
    expect(json.instances[0].hasGatewayToken).toBe(true);
  });

  it('returns docker unavailable error on discovery', async () => {
    execFileImpl = (_bin: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      const err = Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' });
      (cb as (err: Error, stdout: string, stderr: string) => void)(err, '', '');
    };

    const app = buildApp();
    const res = await app.request('/api/instances');
    expect(res.status).toBe(503);
    const json = (await res.json()) as {
      instances: unknown[];
      error: { code: string };
    };
    expect(json.instances).toEqual([]);
    expect(json.error.code).toBe('docker_unavailable');
  });

  it('retrieves a token using allowlisted keys only', async () => {
    execFileImpl = (_bin: unknown, args: unknown, _opts: unknown, cb: unknown) => {
      const dockerArgs = args as string[];
      if (dockerArgs[0] === 'inspect') {
        const payload = JSON.stringify([
          {
            Id: 'cid-open',
            Name: '/openclaw-main',
            Config: {
              Image: 'openclaw/gateway:latest',
              Env: ['IRRELEVANT_TOKEN=do-not-expose', 'GATEWAY_TOKEN=abc123'],
              Labels: {},
            },
            State: { Status: 'running' },
            NetworkSettings: { Ports: {} },
          },
        ]);
        (cb as (err: null, stdout: string, stderr: string) => void)(null, payload, '');
        return;
      }
      (cb as (err: Error, stdout: string, stderr: string) => void)(new Error('unexpected args'), '', '');
    };

    const app = buildApp();
    const res = await app.request('/api/instances/cid-open/token');
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      instanceId: string;
      found: boolean;
      token: string | null;
      tokenKey: string | null;
    };
    expect(json.instanceId).toBe('cid-open');
    expect(json.found).toBe(true);
    expect(json.token).toBe('abc123');
    expect(json.tokenKey).toBe('GATEWAY_TOKEN');
  });

  it('validates instance id format', async () => {
    const app = buildApp();
    const res = await app.request('/api/instances/bad$id/token');
    expect(res.status).toBe(400);
  });

  it('proxies request to selected instance using loopback and published port', async () => {
    execFileImpl = (_bin: unknown, args: unknown, _opts: unknown, cb: unknown) => {
      const dockerArgs = args as string[];
      if (dockerArgs[0] === 'inspect') {
        const payload = JSON.stringify([
          {
            Id: 'cid-open',
            Name: '/openclaw-main',
            Config: {
              Image: 'openclaw/gateway:latest',
              Env: ['GATEWAY_TOKEN=abc123'],
              Labels: {},
            },
            State: { Status: 'running' },
            NetworkSettings: {
              Ports: { '18789/tcp': [{ HostIp: '0.0.0.0', HostPort: '28789' }] },
            },
          },
        ]);
        (cb as (err: null, stdout: string, stderr: string) => void)(null, payload, '');
        return;
      }
      (cb as (err: Error, stdout: string, stderr: string) => void)(new Error('unexpected args'), '', '');
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'x-internal-debug': 'ignore-me',
        },
      }),
    );

    const app = buildApp();
    const res = await app.request('/api/instances/cid-open/proxy/api/gateway/models?limit=5', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test',
        'X-Forwarded-For': '203.0.113.2',
      },
      body: JSON.stringify({ hello: 'world' }),
    });

    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-internal-debug')).toBeNull();

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:28789/api/gateway/models?limit=5');
    expect(init.method).toBe('POST');
    const forwardedHeaders = new Headers(init.headers);
    expect(forwardedHeaders.get('authorization')).toBe('Bearer test');
    expect(forwardedHeaders.get('content-type')).toBe('application/json');
    expect(forwardedHeaders.get('x-forwarded-for')).toBeNull();
    expect(init.body).toBeTruthy();
  });

  it('blocks master-pinned instance-management paths from proxying', async () => {
    execFileImpl = (_bin: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: Error, stdout: string, stderr: string) => void)(new Error('should not inspect'), '', '');
    };

    const app = buildApp();
    const res = await app.request('/api/instances/cid-open/proxy/api/instances');
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('master_pinned_path');
  });

  it('blocks encoded master-pinned paths from proxying', async () => {
    const app = buildApp();
    const res = await app.request('/api/instances/cid-open/proxy/%61pi/instances');
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('master_pinned_path');
  });

  it('blocks unsafe proxy path encodings', async () => {
    const app = buildApp();
    const res = await app.request('/api/instances/cid-open/proxy/%2e%2e/secrets');
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('invalid_proxy_path');
  });

  it('returns clear error when instance is unavailable for proxy', async () => {
    execFileImpl = (_bin: unknown, args: unknown, _opts: unknown, cb: unknown) => {
      const dockerArgs = args as string[];
      if (dockerArgs[0] === 'inspect') {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, '[]', '');
        return;
      }
      (cb as (err: Error, stdout: string, stderr: string) => void)(new Error('unexpected args'), '', '');
    };

    const app = buildApp();
    const res = await app.request('/api/instances/cid-open/proxy/api/gateway/models');
    expect(res.status).toBe(404);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('instance_unavailable');
  });

  it('returns clear error when no published target port exists', async () => {
    execFileImpl = (_bin: unknown, args: unknown, _opts: unknown, cb: unknown) => {
      const dockerArgs = args as string[];
      if (dockerArgs[0] === 'inspect') {
        const payload = JSON.stringify([
          {
            Id: 'cid-open',
            Name: '/openclaw-main',
            Config: {
              Image: 'openclaw/gateway:latest',
              Env: ['GATEWAY_TOKEN=abc123'],
              Labels: {},
            },
            State: { Status: 'running' },
            NetworkSettings: {
              Ports: { '18789/tcp': null },
            },
          },
        ]);
        (cb as (err: null, stdout: string, stderr: string) => void)(null, payload, '');
        return;
      }
      (cb as (err: Error, stdout: string, stderr: string) => void)(new Error('unexpected args'), '', '');
    };

    const app = buildApp();
    const res = await app.request('/api/instances/cid-open/proxy/api/gateway/models');
    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('target_port_unavailable');
  });
});
