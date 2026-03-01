/** Tests for local Docker instance discovery and token retrieval routes. */
import { describe, it, expect, vi, afterEach } from 'vitest';
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
  afterEach(() => {
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
});
