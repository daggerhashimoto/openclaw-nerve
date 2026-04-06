/** Tests for the gateway routes (models, session-info, session-patch). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';

let execFileImpl: (...args: unknown[]) => void;
let readFileImpl: (...args: unknown[]) => Promise<string>;
let invokeGatewayImpl: (tool: string, args: Record<string, unknown>) => unknown;

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const mock = { ...actual, execFile: (...args: unknown[]) => execFileImpl(...args) };
  return { ...mock, default: mock };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const mock = { ...actual, readFile: (...args: unknown[]) => readFileImpl(...args) };
  return { ...mock, default: mock };
});

vi.mock('../lib/config.js', () => ({
  config: {
    auth: false, port: 3000, host: '127.0.0.1', sslPort: 3443,
    gatewayUrl: 'http://localhost:3100', gatewayToken: 'test-token',
  },
  SESSION_COOKIE_NAME: 'nerve_session_3000',
}));

vi.mock('../middleware/rate-limit.js', () => ({
  rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
  rateLimitRestart: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
}));

vi.mock('../lib/openclaw-bin.js', () => ({
  resolveOpenclawBin: () => '/usr/bin/openclaw',
}));

vi.mock('../lib/gateway-client.js', () => ({
  invokeGatewayTool: vi.fn(async (tool: string, args: Record<string, unknown>) => invokeGatewayImpl(tool, args)),
}));

const socketMock = vi.hoisted(() => ({
  connectOk: false as boolean,
}));

vi.mock('node:net', () => {
  class MockSocket {
    private handlers: Record<string, (() => void)[]> = {};
    setTimeout() { return this; }
    connect(_port: number, _host: string, cb: () => void) {
      queueMicrotask(() => {
        if (socketMock.connectOk) { cb(); }
        else { this.emit('error'); }
      });
      return this;
    }
    on(event: string, handler: () => void) {
      (this.handlers[event] ??= []).push(handler);
      return this;
    }
    end() {}
    destroy() {}
    private emit(event: string) {
      for (const h of this.handlers[event] ?? []) h();
    }
  }
  return { Socket: MockSocket, default: { Socket: MockSocket } };
});

const OPENCLAW_CONFIG = {
  agents: {
    defaults: {
      model: {
        primary: 'zai/glm-4.7',
        fallbacks: [
          'openrouter/xiaomi/mimo-v2-pro',
          'zai/glm-4.5',
          'ollama/qwen2.5:7b-instruct-q5_K_M',
        ],
      },
      models: {
        'zai/glm-4.7': { alias: 'glm-4.7' },
        'openrouter/xiaomi/mimo-v2-pro': { alias: 'mimo-v2-pro' },
        'zai/glm-4.5': { alias: 'glm-4.5' },
        'ollama/qwen2.5:7b-instruct-q5_K_M': { alias: 'qwen-local' },
      },
    },
  },
};

import gatewayRoutes from './gateway.js';

function buildApp() {
  const app = new Hono();
  app.route('/', gatewayRoutes);
  return app;
}

describe('gateway routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENCLAW_CONFIG_PATH;
  });

  function setDefaults() {
    execFileImpl = (_bin: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, stdout: string) => void)(null, '');
    };
    readFileImpl = async () => JSON.stringify(OPENCLAW_CONFIG);
    invokeGatewayImpl = () => ({});
  }

  describe('GET /api/gateway/models', () => {
    it('returns the configured primary model', async () => {
      setDefaults();
      process.env.OPENCLAW_CONFIG_PATH = '/tmp/openclaw.json';
      readFileImpl = async (path: unknown) => {
        expect(path).toBe('/tmp/openclaw.json');
        return JSON.stringify({
          agents: {
            defaults: {
              model: {
                primary: 'zai/glm-4.7',
              },
            },
          },
        });
      };

      const app = buildApp();
      const res = await app.request('/api/gateway/models');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        models: [
          {
            id: 'zai/glm-4.7',
            label: 'glm-4.7',
            provider: 'zai',
            configured: true,
            role: 'primary',
          },
        ],
        error: null,
        source: 'config',
      });
    });

    it('returns primary plus fallbacks in declared order', async () => {
      setDefaults();
      readFileImpl = async () => JSON.stringify({
        agents: {
          defaults: {
            model: {
              primary: 'zai/glm-4.7',
              fallbacks: [
                'openrouter/xiaomi/mimo-v2-pro',
                'zai/glm-4.5',
              ],
            },
            models: {
              'zai/glm-4.7': { alias: 'glm-4.7' },
              'openrouter/xiaomi/mimo-v2-pro': { alias: 'mimo-v2-pro' },
              'zai/glm-4.5': { alias: 'glm-4.5' },
            },
          },
        },
      });

      const app = buildApp();
      const res = await app.request('/api/gateway/models');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        models: [
          {
            id: 'zai/glm-4.7',
            label: 'glm-4.7',
            provider: 'zai',
            alias: 'glm-4.7',
            configured: true,
            role: 'primary',
          },
          {
            id: 'openrouter/xiaomi/mimo-v2-pro',
            label: 'mimo-v2-pro',
            provider: 'openrouter',
            alias: 'mimo-v2-pro',
            configured: true,
            role: 'fallback',
          },
          {
            id: 'zai/glm-4.5',
            label: 'glm-4.5',
            provider: 'zai',
            alias: 'glm-4.5',
            configured: true,
            role: 'fallback',
          },
        ],
        error: null,
        source: 'config',
      });
    });

    it('includes remaining allowlist entries after primary and fallbacks', async () => {
      setDefaults();
      readFileImpl = async () => JSON.stringify({
        agents: {
          defaults: {
            model: {
              primary: 'zai/glm-4.7',
              fallbacks: [
                'openrouter/xiaomi/mimo-v2-pro',
                'zai/glm-4.5',
                'ollama/qwen2.5:7b-instruct-q5_K_M',
              ],
            },
            models: {
              'zai/glm-4.7': { alias: 'glm-4.7' },
              'openrouter/xiaomi/mimo-v2-pro': { alias: 'mimo-v2-pro' },
              'zai/glm-4.5': { alias: 'glm-4.5' },
              'ollama/qwen2.5:7b-instruct-q5_K_M': { alias: 'qwen-local' },
              'anthropic/claude-sonnet-4': { alias: 'claude-sonnet-4' },
              'openai/gpt-4o-mini': { alias: 'gpt-4o-mini' },
            },
          },
        },
      });

      const app = buildApp();
      const res = await app.request('/api/gateway/models');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        models: [
          {
            id: 'zai/glm-4.7',
            label: 'glm-4.7',
            provider: 'zai',
            alias: 'glm-4.7',
            configured: true,
            role: 'primary',
          },
          {
            id: 'openrouter/xiaomi/mimo-v2-pro',
            label: 'mimo-v2-pro',
            provider: 'openrouter',
            alias: 'mimo-v2-pro',
            configured: true,
            role: 'fallback',
          },
          {
            id: 'zai/glm-4.5',
            label: 'glm-4.5',
            provider: 'zai',
            alias: 'glm-4.5',
            configured: true,
            role: 'fallback',
          },
          {
            id: 'ollama/qwen2.5:7b-instruct-q5_K_M',
            label: 'qwen-local',
            provider: 'ollama',
            alias: 'qwen-local',
            configured: true,
            role: 'fallback',
          },
          {
            id: 'anthropic/claude-sonnet-4',
            label: 'claude-sonnet-4',
            provider: 'anthropic',
            alias: 'claude-sonnet-4',
            configured: true,
            role: 'allowed',
          },
          {
            id: 'openai/gpt-4o-mini',
            label: 'gpt-4o-mini',
            provider: 'openai',
            alias: 'gpt-4o-mini',
            configured: true,
            role: 'allowed',
          },
        ],
        error: null,
        source: 'config',
      });
    });

    it('dedupes repeated model refs while preserving stable role order', async () => {
      setDefaults();
      readFileImpl = async () => JSON.stringify({
        agents: {
          defaults: {
            model: {
              primary: 'zai/glm-4.7',
              fallbacks: [
                'zai/glm-4.7',
                'openrouter/xiaomi/mimo-v2-pro',
                'openrouter/xiaomi/mimo-v2-pro',
              ],
            },
            models: {
              'zai/glm-4.7': { alias: 'glm-4.7' },
              'openrouter/xiaomi/mimo-v2-pro': { alias: 'mimo-v2-pro' },
              'anthropic/claude-sonnet-4': { alias: 'claude-sonnet-4' },
            },
          },
        },
      });

      const app = buildApp();
      const res = await app.request('/api/gateway/models');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        models: [
          {
            id: 'zai/glm-4.7',
            label: 'glm-4.7',
            provider: 'zai',
            alias: 'glm-4.7',
            configured: true,
            role: 'primary',
          },
          {
            id: 'openrouter/xiaomi/mimo-v2-pro',
            label: 'mimo-v2-pro',
            provider: 'openrouter',
            alias: 'mimo-v2-pro',
            configured: true,
            role: 'fallback',
          },
          {
            id: 'anthropic/claude-sonnet-4',
            label: 'claude-sonnet-4',
            provider: 'anthropic',
            alias: 'claude-sonnet-4',
            configured: true,
            role: 'allowed',
          },
        ],
        error: null,
        source: 'config',
      });
    });

    it('returns an explicit error when the config has no configured models', async () => {
      setDefaults();
      readFileImpl = async () => JSON.stringify({
        agents: {
          defaults: {},
        },
      });

      const app = buildApp();
      const res = await app.request('/api/gateway/models');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        models: [],
        error: 'No models configured in OpenClaw config.',
        source: 'config',
      });
    });

    it('returns configured models when the OpenClaw config uses JSON5 syntax', async () => {
      setDefaults();
      readFileImpl = async () => `
        {
          // OpenClaw config often includes comments and trailing commas
          agents: {
            defaults: {
              model: {
                primary: 'zai/glm-4.7',
                fallbacks: [
                  'openrouter/xiaomi/mimo-v2-pro',
                ],
              },
              models: {
                'zai/glm-4.7': { alias: 'glm-4.7' },
                'openrouter/xiaomi/mimo-v2-pro': { alias: 'mimo-v2-pro' },
              },
            },
          },
        }
      `;

      const app = buildApp();
      const res = await app.request('/api/gateway/models');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        models: [
          {
            id: 'zai/glm-4.7',
            label: 'glm-4.7',
            provider: 'zai',
            alias: 'glm-4.7',
            configured: true,
            role: 'primary',
          },
          {
            id: 'openrouter/xiaomi/mimo-v2-pro',
            label: 'mimo-v2-pro',
            provider: 'openrouter',
            alias: 'mimo-v2-pro',
            configured: true,
            role: 'fallback',
          },
        ],
        error: null,
        source: 'config',
      });
    });

    it('returns an explicit error when the config is unreadable', async () => {
      setDefaults();
      readFileImpl = async () => {
        throw new Error('ENOENT: no such file or directory');
      };

      const app = buildApp();
      const res = await app.request('/api/gateway/models');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        models: [],
        error: 'Could not read OpenClaw config.',
        source: 'config',
      });
    });

    it('uses a long enough timeout for model catalog fetches', async () => {
      vi.resetModules();
      vi.doMock('node:child_process', () => ({
        execFile: (...args: unknown[]) => execFileImpl(...args),
      }));
      vi.doMock('node:fs/promises', () => ({
        readFile: (...args: unknown[]) => readFileImpl(...args),
      }));
      vi.doMock('../lib/config.js', () => ({
        config: {
          auth: false, port: 3000, host: '127.0.0.1', sslPort: 3443,
          gatewayUrl: 'http://localhost:3100', gatewayToken: 'test-token',
        },
        SESSION_COOKIE_NAME: 'nerve_session_3000',
      }));
      vi.doMock('../middleware/rate-limit.js', () => ({
        rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
        rateLimitRestart: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
      }));
      vi.doMock('../lib/openclaw-bin.js', () => ({
        resolveOpenclawBin: () => '/usr/bin/openclaw',
      }));
      vi.doMock('../lib/gateway-client.js', () => ({
        invokeGatewayTool: vi.fn(async (tool: string, args: Record<string, unknown>) => invokeGatewayImpl(tool, args)),
      }));

      const mod = await import('./gateway.js');
      expect(mod.MODEL_LIST_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
    });
  });

  describe('GET /api/gateway/session-info', () => {
    it('returns model and thinking from sessions_list', async () => {
      setDefaults();
      invokeGatewayImpl = (tool: string) => {
        if (tool === 'sessions_list') {
          return {
            sessions: [{
              sessionKey: 'agent:main:main',
              model: 'anthropic/claude-opus-4',
              thinking: 'high',
            }],
          };
        }
        return {};
      };
      const app = buildApp();
      const res = await app.request('/api/gateway/session-info');
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.model).toBe('anthropic/claude-opus-4');
      expect(json.thinking).toBe('high');
    });

    it('returns empty object when gateway is unreachable', async () => {
      setDefaults();
      invokeGatewayImpl = () => { throw new Error('ECONNREFUSED'); };
      const app = buildApp();
      const res = await app.request('/api/gateway/session-info');
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json).toBeDefined();
    });

    it('accepts custom sessionKey query param', async () => {
      setDefaults();
      const invokedCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];
      invokeGatewayImpl = (tool: string, args: Record<string, unknown>) => {
        invokedCalls.push({ tool, args });
        if (tool === 'sessions_list') {
          return {
            sessions: [{
              sessionKey: 'agent:cron:test',
              model: 'openai/gpt-4o',
              thinking: 'low',
            }],
          };
        }
        return {};
      };
      const app = buildApp();
      const res = await app.request('/api/gateway/session-info?sessionKey=agent:cron:test');
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.model).toBe('openai/gpt-4o');
      // Verify the gateway was invoked with the correct tool
      expect(invokedCalls.some(c => c.tool === 'sessions_list')).toBe(true);
    });

    it('falls back to the first top-level root when main is absent', async () => {
      setDefaults();
      invokeGatewayImpl = (tool: string) => {
        if (tool === 'sessions_list') {
          return {
            sessions: [{
              sessionKey: 'agent:reviewer:main',
              model: 'anthropic/claude-sonnet-4',
              thinking: 'medium',
            }],
          };
        }
        return {};
      };
      const app = buildApp();
      const res = await app.request('/api/gateway/session-info');
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.model).toBe('anthropic/claude-sonnet-4');
      expect(json.thinking).toBe('medium');
    });
  });

  describe('POST /api/gateway/session-patch', () => {
    it('returns 400 for invalid JSON', async () => {
      setDefaults();
      const app = buildApp();
      const res = await app.request('/api/gateway/session-patch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
    });

    it('changes model via session_status tool', async () => {
      setDefaults();
      invokeGatewayImpl = () => ({});
      const app = buildApp();
      const res = await app.request('/api/gateway/session-patch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'anthropic/claude-opus-4', sessionKey: 'agent:main:main' }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(true);
      expect(json.model).toBe('anthropic/claude-opus-4');
    });

    it('uses the first top-level root when sessionKey is omitted and main is absent', async () => {
      setDefaults();
      const invokedCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];
      invokeGatewayImpl = (tool: string, args: Record<string, unknown>) => {
        invokedCalls.push({ tool, args });
        if (tool === 'sessions_list') {
          return {
            sessions: [
              { sessionKey: 'agent:reviewer:main' },
              { sessionKey: 'agent:reviewer:subagent:123' },
            ],
          };
        }
        return {};
      };
      const app = buildApp();
      const res = await app.request('/api/gateway/session-patch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'openai/gpt-4o' }),
      });
      expect(res.status).toBe(200);
      expect(invokedCalls).toContainEqual({
        tool: 'session_status',
        args: { model: 'openai/gpt-4o', sessionKey: 'agent:reviewer:main' },
      });
    });

    it('treats whitespace-only sessionKey as missing and falls back to discovery', async () => {
      setDefaults();
      const invokedCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];
      invokeGatewayImpl = (tool: string, args: Record<string, unknown>) => {
        invokedCalls.push({ tool, args });
        if (tool === 'sessions_list') {
          return {
            sessions: [
              { sessionKey: 'agent:reviewer:main' },
            ],
          };
        }
        return {};
      };
      const app = buildApp();
      const res = await app.request('/api/gateway/session-patch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'openai/gpt-4o', sessionKey: '   ' }),
      });
      expect(res.status).toBe(200);
      expect(invokedCalls).toContainEqual({
        tool: 'session_status',
        args: { model: 'openai/gpt-4o', sessionKey: 'agent:reviewer:main' },
      });
    });

    it('returns 409 when no root session can be resolved', async () => {
      setDefaults();
      invokeGatewayImpl = (tool: string) => {
        if (tool === 'sessions_list') {
          return { sessions: [] };
        }
        return {};
      };
      const app = buildApp();
      const res = await app.request('/api/gateway/session-patch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'openai/gpt-4o' }),
      });
      expect(res.status).toBe(409);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.ok).toBe(false);
      expect(json.error).toBe('No active root session available. Provide sessionKey explicitly.');
    });

    it('returns 501 for thinking-only changes', async () => {
      setDefaults();
      const app = buildApp();
      const res = await app.request('/api/gateway/session-patch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thinkingLevel: 'high', sessionKey: 'agent:main:main' }),
      });
      expect(res.status).toBe(501);
    });

    it('returns 502 when gateway tool fails', async () => {
      setDefaults();
      invokeGatewayImpl = () => { throw new Error('gateway down'); };
      const app = buildApp();
      const res = await app.request('/api/gateway/session-patch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'openai/gpt-4o', sessionKey: 'agent:main:main' }),
      });
      expect(res.status).toBe(502);
    });

    it('validates body schema', async () => {
      setDefaults();
      const app = buildApp();
      const res = await app.request('/api/gateway/session-patch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'x'.repeat(300) }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/gateway/restart', () => {
    afterEach(() => {
      socketMock.connectOk = false;
      vi.useRealTimers();
    });

    it('returns 500 when restart command fails', async () => {
      vi.useFakeTimers();
      execFileImpl = (_bin: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: Error, stdout: string) => void)(new Error('restart failed'), '');
      };
      const app = buildApp();
      const resPromise = app.request('/api/gateway/restart', { method: 'POST' });
      await vi.runAllTimersAsync();
      const res = await resPromise;
      expect(res.status).toBe(500);
      const json = await res.json() as { ok: boolean; output: string };
      expect(json.ok).toBe(false);
    });

    it('returns 500 when status indicates stopped', async () => {
      vi.useFakeTimers();
      let call = 0;
      execFileImpl = (_bin: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        if (call === 0) {
          call++;
          (cb as (err: null, stdout: string) => void)(null, 'Restarted');
        } else {
          (cb as (err: null, stdout: string) => void)(null, 'Runtime: stopped\nlast exit 1');
        }
      };
      const app = buildApp();
      const resPromise = app.request('/api/gateway/restart', { method: 'POST' });
      await vi.runAllTimersAsync();
      const res = await resPromise;
      expect(res.status).toBe(500);
      const json = await res.json() as { ok: boolean; output: string };
      expect(json.ok).toBe(false);
      expect(json.output).toMatch(/Status:/);
      expect(json.output).toMatch(/Runtime: stopped/);
    });

    it('provides DBus session env fallbacks when vars are missing', async () => {
      vi.useFakeTimers();
      const origXdg = process.env.XDG_RUNTIME_DIR;
      const origDbus = process.env.DBUS_SESSION_BUS_ADDRESS;
      delete process.env.XDG_RUNTIME_DIR;
      delete process.env.DBUS_SESSION_BUS_ADDRESS;

      let capturedEnv: Record<string, string> | undefined;
      execFileImpl = (_bin: unknown, _args: unknown, opts: unknown, cb: unknown) => {
        capturedEnv = (opts as { env: Record<string, string> }).env;
        (cb as (err: Error, stdout: string) => void)(new Error('restart failed'), '');
      };
      const app = buildApp();
      const resPromise = app.request('/api/gateway/restart', { method: 'POST' });
      await vi.runAllTimersAsync();
      await resPromise;

      expect(capturedEnv).toBeDefined();
      expect(capturedEnv!.XDG_RUNTIME_DIR).toMatch(/^\/run\/user\/\d+$/);
      expect(capturedEnv!.DBUS_SESSION_BUS_ADDRESS).toMatch(/^unix:path=\/run\/user\/\d+\/bus$/);

      // Restore
      if (origXdg !== undefined) process.env.XDG_RUNTIME_DIR = origXdg;
      if (origDbus !== undefined) process.env.DBUS_SESSION_BUS_ADDRESS = origDbus;
    });

    it('returns 200 on successful restart with port reachable', async () => {
      vi.useFakeTimers();
      socketMock.connectOk = true;
      let call = 0;
      execFileImpl = (_bin: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        if (call === 0) {
          call++;
          (cb as (err: null, stdout: string) => void)(null, 'Restarted');
        } else {
          (cb as (err: null, stdout: string) => void)(null, 'Runtime: running');
        }
      };
      const app = buildApp();
      const resPromise = app.request('/api/gateway/restart', { method: 'POST' });
      await vi.runAllTimersAsync();
      const res = await resPromise;
      expect(res.status).toBe(200);
      const json = await res.json() as { ok: boolean; output: string };
      expect(json.ok).toBe(true);
      expect(json.output).toMatch(/successfully/i);
    });

    it('returns 500 when status says running but port is not reachable', async () => {
      vi.useFakeTimers();
      socketMock.connectOk = false;
      let call = 0;
      execFileImpl = (_bin: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        if (call === 0) {
          call++;
          (cb as (err: null, stdout: string) => void)(null, 'Restarted');
        } else {
          (cb as (err: null, stdout: string) => void)(null, 'Runtime: running');
        }
      };
      const app = buildApp();
      const resPromise = app.request('/api/gateway/restart', { method: 'POST' });
      await vi.runAllTimersAsync();
      const res = await resPromise;
      expect(res.status).toBe(500);
      const json = await res.json() as { ok: boolean; output: string };
      expect(json.ok).toBe(false);
      expect(json.output).toMatch(/port not ready/);
    });
  });
});
