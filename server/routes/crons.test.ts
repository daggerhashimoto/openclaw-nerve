import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import fs from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';

describe('cron routes', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function buildApp() {
    const invokeGatewayTool = vi.fn(async () => ({ ok: true }));
    const gatewayRpcCall = vi.fn(async (): Promise<unknown> => ({ ok: true }));
    const tempHome = await fs.mkdtemp(join(os.tmpdir(), 'nerve-crons-test-'));

    vi.doMock('../lib/gateway-client.js', () => ({
      invokeGatewayTool,
    }));

    vi.doMock('../lib/gateway-rpc.js', () => ({
      gatewayRpcCall,
    }));

    vi.doMock('../lib/config.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../lib/config.js')>();
      return {
        ...actual,
        config: {
          ...actual.config,
          home: tempHome,
        },
      };
    });

    vi.doMock('../middleware/rate-limit.js', () => ({
      rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
    }));

    const mod = await import('./crons.js');
    const app = new Hono();
    app.route('/', mod.default);
    return { app, invokeGatewayTool, gatewayRpcCall, tempHome };
  }

  it('derives agentId from sessionKey when creating a cron', async () => {
    const { app, gatewayRpcCall } = await buildApp();

    const res = await app.request('/api/crons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job: {
          sessionTarget: 'isolated',
          sessionKey: 'agent:reviewer:main',
          payload: { kind: 'agentTurn', message: 'summarize inbox' },
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(gatewayRpcCall).toHaveBeenCalledWith('cron.add', {
      agentId: 'reviewer',
      payload: { kind: 'agentTurn', message: 'summarize inbox' },
      sessionKey: 'agent:reviewer:main',
      sessionTarget: 'isolated',
    });
  });

  it('derives agentId from sessionKey when updating a cron', async () => {
    const { app, gatewayRpcCall } = await buildApp();

    const res = await app.request('/api/crons/job-123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patch: {
          sessionTarget: 'main',
          sessionKey: 'agent:ops:main',
          payload: { kind: 'systemEvent', text: 'Reminder: deploy window opens in 10 minutes.' },
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(gatewayRpcCall).toHaveBeenCalledWith('cron.update', {
      id: 'job-123',
      patch: {
        agentId: 'ops',
        payload: { kind: 'systemEvent', text: 'Reminder: deploy window opens in 10 minutes.' },
        sessionKey: 'agent:ops:main',
        sessionTarget: 'main',
      },
    });
  });

  it('runs isolated agentTurn jobs through sessions_spawn', async () => {
    const { app, invokeGatewayTool, gatewayRpcCall, tempHome } = await buildApp();
    gatewayRpcCall.mockImplementation(async (method: string) => {
      if (method === 'cron.list') {
        return {
          jobs: [{
            id: 'job-123',
            agentId: 'main',
            sessionKey: 'agent:main:main',
            name: 'test cron',
            sessionTarget: 'isolated',
            payload: {
              kind: 'agentTurn',
              message: 'say hello',
              model: 'anthropic/claude-opus-4-6',
              thinking: 'medium',
            },
          }],
        };
      }
      return { ok: true };
    });
    invokeGatewayTool.mockImplementation(async (tool: string) => {
      if (tool === 'sessions_spawn') {
        return {
          details: {
            status: 'accepted',
            childSessionKey: 'agent:main:subagent:test-child',
          },
        };
      }
      return { ok: true };
    });

    const res = await app.request('/api/crons/job-123/run', { method: 'POST' });
    const data = await res.json() as { ok: boolean };

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(gatewayRpcCall).toHaveBeenCalledWith('cron.list', { includeDisabled: true }, 60000);
    expect(invokeGatewayTool).toHaveBeenCalledWith('sessions_spawn', {
      task: 'say hello',
      mode: 'run',
      label: expect.stringMatching(/^Cron · test cron · \d{2}:\d{2}$/),
      model: 'anthropic/claude-opus-4-6',
      thinking: 'medium',
      agentId: 'main',
    }, 60000);
    const runLedger = await fs.readFile(join(tempHome, '.openclaw', 'cron', 'nerve-manual-runs', 'job-123.jsonl'), 'utf8');
    expect(runLedger).toContain('"summary":"Manual run started in a separate cron session."');
    expect(gatewayRpcCall).not.toHaveBeenCalledWith('cron.run', expect.anything(), expect.anything());
    expect(invokeGatewayTool).not.toHaveBeenCalledWith('cron', expect.anything(), expect.anything());
  });

  it('merges manual run history entries into cron runs', async () => {
    const { app, gatewayRpcCall, tempHome } = await buildApp();
    gatewayRpcCall.mockImplementation(async (method: string) => {
      if (method === 'cron.runs') {
        return {
          entries: [{
            ts: 1000,
            status: 'ok',
            summary: 'Gateway entry',
            durationMs: 500,
          }],
          total: 1,
        };
      }
      return { ok: true };
    });
    await fs.mkdir(join(tempHome, '.openclaw', 'cron', 'nerve-manual-runs'), { recursive: true });
    await fs.writeFile(
      join(tempHome, '.openclaw', 'cron', 'nerve-manual-runs', 'job-123.jsonl'),
      '{"ts":2000,"jobId":"job-123","action":"spawned","status":"ok","summary":"Manual run started in a separate cron session.","runAtMs":2000,"manual":true}\n',
      'utf8',
    );

    const res = await app.request('/api/crons/job-123/runs');
    const data = await res.json() as {
      ok: boolean;
      result: { entries: Array<{ summary?: string; ts?: number }> };
    };

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.result.entries).toHaveLength(2);
    expect(data.result.entries[0]?.summary).toBe('Manual run started in a separate cron session.');
    expect(data.result.entries[1]?.summary).toBe('Gateway entry');
    expect(gatewayRpcCall).toHaveBeenCalledWith('cron.runs', { id: 'job-123', limit: 10 });
  });

  it('lists jobs through cron.list and merges manual last-run timestamps into state', async () => {
    const { app, gatewayRpcCall, tempHome } = await buildApp();
    gatewayRpcCall.mockImplementation(async (method: string) => {
      if (method === 'cron.list') {
        return {
          jobs: [{
            id: 'job-123',
            agentId: 'main',
            sessionKey: 'agent:main:main',
            name: 'test cron',
            enabled: true,
            schedule: { kind: 'every', everyMs: 300000 },
            sessionTarget: 'isolated',
            payload: { kind: 'agentTurn', message: 'say hello' },
            state: {},
          }],
          total: 1,
          hasMore: false,
        };
      }
      return { ok: true };
    });
    await fs.mkdir(join(tempHome, '.openclaw', 'cron', 'nerve-manual-runs'), { recursive: true });
    await fs.writeFile(
      join(tempHome, '.openclaw', 'cron', 'nerve-manual-runs', 'job-123.jsonl'),
      '{"ts":2000,"jobId":"job-123","action":"spawned","status":"ok","summary":"Manual run started in a separate cron session.","runAtMs":2000,"manual":true}\n',
      'utf8',
    );

    const res = await app.request('/api/crons');
    const data = await res.json() as {
      ok: boolean;
      result: { jobs?: Array<{ state?: { lastRunAtMs?: number } }>; total?: number };
    };

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(gatewayRpcCall).toHaveBeenCalledWith('cron.list', { includeDisabled: true });
    expect(data.result.jobs?.[0]?.state?.lastRunAtMs).toBe(2000);
    expect(data.result.total).toBe(1);
  });

  it('toggles a cron through cron.update', async () => {
    const { app, gatewayRpcCall } = await buildApp();

    const res = await app.request('/api/crons/job-123/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    expect(res.status).toBe(200);
    expect(gatewayRpcCall).toHaveBeenCalledWith('cron.update', {
      id: 'job-123',
      patch: { enabled: false },
    });
  });

  it('deletes a cron through cron.remove', async () => {
    const { app, gatewayRpcCall } = await buildApp();

    const res = await app.request('/api/crons/job-123', { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(gatewayRpcCall).toHaveBeenCalledWith('cron.remove', { id: 'job-123' });
  });

  it('runs non-isolated jobs natively through cron.run', async () => {
    const { app, invokeGatewayTool, gatewayRpcCall } = await buildApp();
    gatewayRpcCall.mockImplementation(async (method: string) => {
      if (method === 'cron.list') {
        return {
          jobs: [{
            id: 'job-123',
            name: 'main-session cron',
            sessionTarget: 'main',
            payload: { kind: 'systemEvent', text: 'ping' },
          }],
        };
      }
      return { ok: true, ran: true };
    });

    const res = await app.request('/api/crons/job-123/run', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(gatewayRpcCall).toHaveBeenCalledWith('cron.run', { id: 'job-123', mode: 'force' }, 60000);
    expect(invokeGatewayTool).not.toHaveBeenCalled();
  });

  it('still returns success when manual run history cannot be persisted', async () => {
    const { app, invokeGatewayTool, gatewayRpcCall } = await buildApp();
    gatewayRpcCall.mockImplementation(async (method: string) => {
      if (method === 'cron.list') {
        return {
          jobs: [{
            id: 'job-123',
            agentId: 'main',
            sessionKey: 'agent:main:main',
            name: 'test cron',
            sessionTarget: 'isolated',
            payload: {
              kind: 'agentTurn',
              message: 'say hello',
            },
          }],
        };
      }
      return { ok: true };
    });
    invokeGatewayTool.mockImplementation(async (tool: string) => {
      if (tool === 'sessions_spawn') {
        return {
          details: {
            status: 'accepted',
            childSessionKey: 'agent:main:subagent:test-child',
          },
        };
      }
      return { ok: true };
    });

    const appendSpy = vi.spyOn(fs, 'appendFile').mockRejectedValueOnce(new Error('disk full'));

    const res = await app.request('/api/crons/job-123/run', { method: 'POST' });
    const data = await res.json() as { ok: boolean };

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(appendSpy).toHaveBeenCalled();
  });

  it('falls back to manual history when gateway runs lookup fails', async () => {
    const { app, gatewayRpcCall, tempHome } = await buildApp();
    gatewayRpcCall.mockImplementation(async (method: string) => {
      if (method === 'cron.runs') {
        throw new Error('gateway unavailable');
      }
      return { ok: true };
    });
    await fs.mkdir(join(tempHome, '.openclaw', 'cron', 'nerve-manual-runs'), { recursive: true });
    await fs.writeFile(
      join(tempHome, '.openclaw', 'cron', 'nerve-manual-runs', 'job-123.jsonl'),
      '{"ts":2000,"jobId":"job-123","action":"spawned","status":"ok","summary":"Manual run started in a separate cron session.","runAtMs":2000,"manual":true}\n',
      'utf8',
    );

    const res = await app.request('/api/crons/job-123/runs');
    const data = await res.json() as {
      ok: boolean;
      result: { entries: Array<{ summary?: string; ts?: number }> };
    };

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.result.entries).toHaveLength(1);
    expect(data.result.entries[0]?.summary).toBe('Manual run started in a separate cron session.');
  });

  it('surfaces gateway RPC failures as a 502 on list', async () => {
    const { app, gatewayRpcCall } = await buildApp();
    gatewayRpcCall.mockRejectedValueOnce(new Error('Gateway connection not ready'));

    const res = await app.request('/api/crons');
    const data = await res.json() as { ok: boolean; error: string };

    expect(res.status).toBe(502);
    expect(data.ok).toBe(false);
    expect(data.error).toBe('Gateway connection not ready');
  });
});
