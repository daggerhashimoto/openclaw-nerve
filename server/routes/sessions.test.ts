// @vitest-environment node

/** Tests for the sessions API routes. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('sessions routes', () => {
  let tmpDir: string;
  let spawnSubagentMock: ReturnType<typeof vi.fn>;
  const telemetryRuntimeMock = {
    recordSessionCreated: vi.fn(async () => undefined),
    recordMessageSubmitted: vi.fn(async () => undefined),
  };

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sessions-test-'));
    spawnSubagentMock = vi.fn();
    telemetryRuntimeMock.recordSessionCreated.mockReset();
    telemetryRuntimeMock.recordSessionCreated.mockResolvedValue(undefined);
    telemetryRuntimeMock.recordMessageSubmitted.mockReset();
    telemetryRuntimeMock.recordMessageSubmitted.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function buildApp() {
    // Mock config to use our temp sessions dir
    vi.doMock('../lib/config.js', () => ({
      config: {
        home: tmpDir,
        sessionsDir: tmpDir,
        auth: false,
        port: 3000,
        host: '127.0.0.1',
        sslPort: 3443,
      },
      SESSION_COOKIE_NAME: 'nerve_session_3000',
    }));
    vi.doMock('../middleware/rate-limit.js', () => ({
      rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
    }));
    vi.doMock('../lib/subagent-spawn.js', () => ({
      spawnSubagent: spawnSubagentMock,
    }));
    vi.doMock('../lib/telemetry/runtime.js', () => ({
      getTelemetryRuntime: vi.fn(() => telemetryRuntimeMock),
    }));

    const mod = await import('./sessions.js');
    const app = new Hono();
    app.route('/', mod.default);
    return app;
  }

  it('rejects invalid session IDs (not UUID)', async () => {
    const app = await buildApp();
    const res = await app.request('/api/sessions/not-a-uuid/model');
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(false);
    expect(json.error).toContain('Invalid session ID');
  });

  it('returns 200 with missing=true when transcript does not exist', async () => {
    const app = await buildApp();
    const uuid = '12345678-1234-1234-1234-123456789abc';
    const res = await app.request(`/api/sessions/${uuid}/model`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.model).toBeNull();
    expect(json.thinking).toBeNull();
    expect(json.missing).toBe(true);
  });

  it('returns runtime defaults from transcript entries near the top', async () => {
    const app = await buildApp();
    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const transcript = [
      JSON.stringify({ type: 'session_start', ts: Date.now() }),
      JSON.stringify({ type: 'model_change', modelId: 'anthropic/claude-opus-4', ts: Date.now() }),
      JSON.stringify({ type: 'thinking_level_change', thinkingLevel: 'medium', ts: Date.now() }),
      JSON.stringify({ type: 'message', role: 'user', content: 'hello' }),
    ].join('\n');
    await fs.writeFile(path.join(tmpDir, `${uuid}.jsonl`), transcript);

    const res = await app.request(`/api/sessions/${uuid}/model`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.model).toBe('anthropic/claude-opus-4');
    expect(json.thinking).toBe('medium');
    expect(json.missing).toBe(false);
  });

  it('returns model: null when transcript has no runtime defaults', async () => {
    const app = await buildApp();
    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const transcript = [
      JSON.stringify({ type: 'session_start', ts: Date.now() }),
      JSON.stringify({ type: 'message', role: 'user', content: 'hello' }),
    ].join('\n');
    await fs.writeFile(path.join(tmpDir, `${uuid}.jsonl`), transcript);

    const res = await app.request(`/api/sessions/${uuid}/model`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.model).toBeNull();
    expect(json.thinking).toBeNull();
    expect(json.missing).toBe(false);
  });

  it('finds deleted transcripts', async () => {
    const app = await buildApp();
    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const transcript = JSON.stringify({ type: 'model_change', modelId: 'openai/gpt-4o', ts: Date.now() });
    await fs.writeFile(path.join(tmpDir, `${uuid}.jsonl.deleted-1234`), transcript);

    const res = await app.request(`/api/sessions/${uuid}/model`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.model).toBe('openai/gpt-4o');
    expect(json.thinking).toBeNull();
    expect(json.missing).toBe(false);
  });

  it('reads non-main agent transcripts when agentId is provided', async () => {
    const app = await buildApp();
    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const agentSessionsDir = path.join(tmpDir, '.openclaw', 'agents', 'smoke257', 'sessions');
    await fs.mkdir(agentSessionsDir, { recursive: true });
    await fs.writeFile(path.join(agentSessionsDir, `${uuid}.jsonl`), [
      JSON.stringify({ type: 'model_change', modelId: 'openai-codex/gpt-5.4', ts: Date.now() }),
      JSON.stringify({ type: 'thinking_level_change', thinkingLevel: 'medium', ts: Date.now() }),
    ].join('\n'));

    const res = await app.request(`/api/sessions/${uuid}/model?agentId=smoke257`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.model).toBe('openai-codex/gpt-5.4');
    expect(json.thinking).toBe('medium');
    expect(json.missing).toBe(false);
  });

  it('resolves runtime defaults by sessionKey for non-main agents', async () => {
    const app = await buildApp();
    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const sessionKey = 'agent:smoke257:main';
    const agentSessionsDir = path.join(tmpDir, '.openclaw', 'agents', 'smoke257', 'sessions');
    await fs.mkdir(agentSessionsDir, { recursive: true });
    await fs.writeFile(path.join(agentSessionsDir, 'sessions.json'), JSON.stringify({
      [sessionKey]: { sessionId: uuid },
    }));
    await fs.writeFile(path.join(agentSessionsDir, `${uuid}.jsonl`), [
      JSON.stringify({ type: 'model_change', modelId: 'openai-codex/gpt-5.4', ts: Date.now() }),
      JSON.stringify({ type: 'thinking_level_change', thinkingLevel: 'medium', ts: Date.now() }),
    ].join('\n'));

    const res = await app.request(`/api/sessions/runtime?sessionKey=${encodeURIComponent(sessionKey)}`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.model).toBe('openai-codex/gpt-5.4');
    expect(json.thinking).toBe('medium');
    expect(json.missing).toBe(false);
  });

  it('serves omitted image bytes from a session transcript', async () => {
    const app = await buildApp();
    const sessionKey = 'agent:main:main';
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const timestamp = 1775131617235;
    const base64 = Buffer.from('hello-image').toString('base64');

    await fs.writeFile(path.join(tmpDir, 'sessions.json'), JSON.stringify({
      [sessionKey]: { sessionId },
    }));
    await fs.writeFile(path.join(tmpDir, `${sessionId}.jsonl`), [
      JSON.stringify({ type: 'session_start', ts: Date.now() }),
      JSON.stringify({
        type: 'message',
        message: {
          timestamp,
          content: [
            { type: 'text', text: 'testing' },
            { type: 'image', mimeType: 'image/png', data: base64 },
          ],
        },
      }),
    ].join('\n'));

    const res = await app.request(`/api/sessions/media?sessionKey=${encodeURIComponent(sessionKey)}&timestamp=${timestamp}&imageIndex=0`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-disposition')).toContain(`message-${timestamp}-image-0.png`);
    const body = Buffer.from(await res.arrayBuffer()).toString('utf-8');
    expect(body).toBe('hello-image');
  });

  it('returns 404 when session transcript media cannot be resolved', async () => {
    const app = await buildApp();
    const sessionKey = 'agent:main:main';
    await fs.writeFile(path.join(tmpDir, 'sessions.json'), JSON.stringify({
      [sessionKey]: { sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    }));

    const res = await app.request(`/api/sessions/media?sessionKey=${encodeURIComponent(sessionKey)}&timestamp=1775131617235&imageIndex=0`);
    expect(res.status).toBe(404);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(false);
  });

  // ── POST /api/sessions/spawn-subagent ────────────────────────────

  it('rejects missing body with 400', async () => {
    const app = await buildApp();
    const res = await app.request('/api/sessions/spawn-subagent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(false);
    expect(typeof json.error).toBe('string');
  });

  it('rejects body with missing required fields', async () => {
    const app = await buildApp();
    const res = await app.request('/api/sessions/spawn-subagent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'do something' }), // missing parentSessionKey
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(false);
    expect(String(json.error)).toContain('parentSessionKey');
  });

  it('rejects parentSessionKey that is not a top-level root key', async () => {
    const app = await buildApp();
    const res = await app.request('/api/sessions/spawn-subagent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentSessionKey: 'agent:reviewer:subagent:child',
        task: 'do something',
      }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(false);
    expect(String(json.error)).toContain('parentSessionKey');
  });

  it('rejects empty task string', async () => {
    const app = await buildApp();
    const res = await app.request('/api/sessions/spawn-subagent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentSessionKey: 'agent:reviewer:main',
        task: '',
      }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(false);
  });

  it('returns direct success payload when helper succeeds with direct mode', async () => {
    spawnSubagentMock.mockResolvedValueOnce({
      sessionKey: 'agent:reviewer:subagent:abc-123',
      runId: 'run-xyz',
      mode: 'direct',
    });

    const app = await buildApp();
    const res = await app.request('/api/sessions/spawn-subagent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentSessionKey: 'agent:reviewer:main',
        task: 'Reply with exactly: OK',
        label: 'audit-auth-flow',
        model: 'claude-sonnet-4-6',
        thinking: 'medium',
        cleanup: 'keep',
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.sessionKey).toBe('agent:reviewer:subagent:abc-123');
    expect(json.runId).toBe('run-xyz');
    expect(json.mode).toBe('direct');
  });

  it('records session_created exactly once after a successful spawn-subagent response', async () => {
    spawnSubagentMock.mockResolvedValueOnce({
      sessionKey: 'agent:reviewer:subagent:spawned-1',
      runId: 'run-spawned-1',
      mode: 'direct',
    });

    const app = await buildApp();
    const res = await app.request('/api/sessions/spawn-subagent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentSessionKey: 'agent:reviewer:main',
        task: 'do something useful',
      }),
    });

    expect(res.status).toBe(200);
    expect(telemetryRuntimeMock.recordSessionCreated).toHaveBeenCalledTimes(1);
    expect(telemetryRuntimeMock.recordSessionCreated).toHaveBeenCalledWith({
      sessionKey: 'agent:reviewer:subagent:spawned-1',
      surface: 'sessions',
      explicit: true,
    });
    expect(telemetryRuntimeMock.recordMessageSubmitted).not.toHaveBeenCalled();
  });

  it('still returns success when spawn-subagent telemetry recording fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    spawnSubagentMock.mockResolvedValueOnce({
      sessionKey: 'agent:reviewer:subagent:spawned-telemetry-failure',
      runId: 'run-telemetry-failure',
      mode: 'direct',
    });
    telemetryRuntimeMock.recordSessionCreated.mockRejectedValueOnce(new Error('telemetry write failed'));

    const app = await buildApp();
    const res = await app.request('/api/sessions/spawn-subagent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentSessionKey: 'agent:reviewer:main',
        task: 'do something useful',
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toEqual({
      ok: true,
      sessionKey: 'agent:reviewer:subagent:spawned-telemetry-failure',
      runId: 'run-telemetry-failure',
      mode: 'direct',
    });

    await Promise.resolve();

    expect(telemetryRuntimeMock.recordSessionCreated).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('[sessions] spawn-subagent telemetry failed:', 'telemetry write failed');
  });

  it('returns marker success payload when helper falls back to marker mode', async () => {
    spawnSubagentMock.mockResolvedValueOnce({
      sessionKey: 'agent:reviewer:subagent:from-marker',
      mode: 'marker',
    });

    const app = await buildApp();
    const res = await app.request('/api/sessions/spawn-subagent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentSessionKey: 'agent:reviewer:main',
        task: 'do something',
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.sessionKey).toBe('agent:reviewer:subagent:from-marker');
    expect(json.mode).toBe('marker');
    expect(json.runId).toBeUndefined();
  });

  it('returns 500 with error message when helper throws', async () => {
    spawnSubagentMock.mockRejectedValueOnce(new Error('Gateway connection failed'));

    const app = await buildApp();
    const res = await app.request('/api/sessions/spawn-subagent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentSessionKey: 'agent:reviewer:main',
        task: 'do something',
      }),
    });
    expect(res.status).toBe(500);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(false);
    expect(String(json.error)).toContain('Gateway connection failed');
  });

  it('defaults cleanup to keep when not specified', async () => {
    spawnSubagentMock.mockResolvedValueOnce({
      sessionKey: 'agent:reviewer:subagent:test',
      mode: 'direct',
    });

    const app = await buildApp();
    await app.request('/api/sessions/spawn-subagent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentSessionKey: 'agent:reviewer:main',
        task: 'do something',
      }),
    });

    expect(spawnSubagentMock).toHaveBeenCalledWith(expect.objectContaining({
      cleanup: 'keep',
    }));
  });
});
