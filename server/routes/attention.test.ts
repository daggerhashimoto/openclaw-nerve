/** Tests for POST /api/attention/summaries and POST /api/attention/day-summary. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('attention routes', () => {
  let tmpDir: string;
  let gatewayRpcCallMock: ReturnType<typeof vi.fn>;
  let idle: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attention-route-'));
    process.env.NERVE_DATA_DIR = tmpDir;
    gatewayRpcCallMock = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'chat.history') {
        return { messages: [{ role: 'user', content: `Hello from ${params.sessionKey as string}`, __openclaw: { id: 'm1' } }] };
      }
      if (method === 'agent') return { status: 'ok', result: { payloads: [{ text: 'It said hello.' }] } };
      throw new Error('unexpected');
    });
  });

  afterEach(async () => {
    await idle?.();
    idle = null;
    delete process.env.NERVE_DATA_DIR;
    delete process.env.NERVE_ATTENTION_SUMMARY_MODEL;
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function buildApp() {
    vi.doMock('../middleware/rate-limit.js', () => ({
      rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
    }));
    vi.doMock('../lib/gateway-rpc.js', () => ({ gatewayRpcCall: gatewayRpcCallMock }));
    const mod = await import('./attention.js');
    idle = mod.whenSummariesIdle;
    const app = new Hono();
    app.route('/', mod.default);
    return app;
  }

  function post(app: Hono, body: unknown) {
    return app.request('/api/attention/summaries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('rejects a body without sessionKeys', async () => {
    const app = await buildApp();
    expect((await post(app, {})).status).toBe(400);
    expect((await post(app, { sessionKeys: [1] })).status).toBe(400);
  });

  it('answers pending first and ready once generated, with the env model as the override', async () => {
    process.env.NERVE_ATTENTION_SUMMARY_MODEL = 'opencode-go/deepseek-v4.1-flash';
    const app = await buildApp();
    const first = await (await post(app, { sessionKeys: ['agent:main:main'] })).json() as { summaries: Record<string, { status: string; text?: string }> };
    expect(first.summaries['agent:main:main'].status).toBe('pending');

    await vi.waitFor(async () => {
      const next = await (await post(app, { sessionKeys: ['agent:main:main'] })).json() as typeof first;
      expect(next.summaries['agent:main:main']).toMatchObject({ status: 'ready', text: 'It said hello.' });
    });

    const agentCalls = gatewayRpcCallMock.mock.calls.filter(([method]) => method === 'agent');
    expect(agentCalls).toHaveLength(1);
    expect(agentCalls[0][1]).toMatchObject({ provider: 'opencode-go', model: 'deepseek-v4.1-flash', modelRun: true, promptMode: 'none' });
    expect(agentCalls[0][3]).toEqual({ expectFinal: true });
  });

  it('dedupes keys and caps how many are answered', async () => {
    const app = await buildApp();
    // Today asks for every chat of the day in one call.
    const keys = Array.from({ length: 60 }, (_, i) => `agent:main:s${i}`);
    const res = await (await post(app, { sessionKeys: [...keys, keys[0]] })).json() as { summaries: Record<string, unknown> };
    expect(Object.keys(res.summaries)).toHaveLength(50);
  });

  describe('day summary', () => {
    const facts = {
      day: '2026-11-28',
      counts: { sessions: 2, done: 1, merged: 1, cronOk: 3, cronFailed: 0 },
      done: ['14:56 PR #458 merged (Render flow cards)'],
      chats: ['Linus, cli'],
      missing: [],
    };

    function postDay(app: Hono, body: unknown) {
      return app.request('/api/attention/day-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    it('rejects facts that are missing or too large', async () => {
      const app = await buildApp();
      expect((await postDay(app, {})).status).toBe(400);
      expect((await postDay(app, { facts: { ...facts, day: 'today' } })).status).toBe(400);
      expect((await postDay(app, { facts: { ...facts, done: Array.from({ length: 61 }, () => 'x') } })).status).toBe(400);
      expect((await postDay(app, { facts: { ...facts, chats: ['x'.repeat(301)] } })).status).toBe(400);
      expect(gatewayRpcCallMock).not.toHaveBeenCalled();
    });

    it('answers pending, then the text, then the cache for the same facts, with the env model', async () => {
      process.env.NERVE_ATTENTION_SUMMARY_MODEL = 'opencode-go/deepseek-v4.1-flash';
      const app = await buildApp();
      const first = await (await postDay(app, { facts })).json() as { summary: { status: string; text?: string } };
      expect(first.summary.status).toBe('pending');

      await vi.waitFor(async () => {
        const next = await (await postDay(app, { facts })).json() as typeof first;
        expect(next.summary).toMatchObject({ status: 'ready', text: 'It said hello.' });
      });
      await postDay(app, { facts });

      const agentCalls = gatewayRpcCallMock.mock.calls.filter(([method]) => method === 'agent');
      expect(agentCalls).toHaveLength(1);
      expect(agentCalls[0][1]).toMatchObject({ agentId: 'main', provider: 'opencode-go', model: 'deepseek-v4.1-flash', modelRun: true, promptMode: 'none' });
      expect(String((agentCalls[0][1] as { message: string }).message)).toContain('14:56 PR #458 merged');
      await idle?.();
      const saved = JSON.parse(await fs.readFile(path.join(tmpDir, 'attention', 'day-summary.json'), 'utf-8')) as { entries: Record<string, { text: string }> };
      expect(saved.entries['2026-11-28'].text).toBe('It said hello.');
    });

    it('answers error when the model call fails, so the client shows its facts alone', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      gatewayRpcCallMock.mockImplementation(async () => { throw new Error('gateway down'); });
      const app = await buildApp();
      expect((await (await postDay(app, { facts })).json() as { summary: { status: string } }).summary.status).toBe('pending');
      await idle?.();
      expect((await (await postDay(app, { facts })).json() as { summary: unknown }).summary).toEqual({ status: 'error' });
      warn.mockRestore();
    });
  });
});
