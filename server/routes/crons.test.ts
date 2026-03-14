import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

describe('cron routes', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function buildApp() {
    const invokeGatewayTool = vi.fn(async () => ({ ok: true }));

    vi.doMock('../lib/gateway-client.js', () => ({
      invokeGatewayTool,
    }));

    vi.doMock('../middleware/rate-limit.js', () => ({
      rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
    }));

    const mod = await import('./crons.js');
    const app = new Hono();
    app.route('/', mod.default);
    return { app, invokeGatewayTool };
  }

  it('derives agentId from sessionKey when creating a cron', async () => {
    const { app, invokeGatewayTool } = await buildApp();

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
    expect(invokeGatewayTool).toHaveBeenCalledWith('cron', {
      action: 'add',
      job: {
        agentId: 'reviewer',
        payload: { kind: 'agentTurn', message: 'summarize inbox' },
        sessionKey: 'agent:reviewer:main',
        sessionTarget: 'isolated',
      },
    });
  });

  it('derives agentId from sessionKey when updating a cron', async () => {
    const { app, invokeGatewayTool } = await buildApp();

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
    expect(invokeGatewayTool).toHaveBeenCalledWith('cron', {
      action: 'update',
      jobId: 'job-123',
      patch: {
        agentId: 'ops',
        payload: { kind: 'systemEvent', text: 'Reminder: deploy window opens in 10 minutes.' },
        sessionKey: 'agent:ops:main',
        sessionTarget: 'main',
      },
    });
  });
});
