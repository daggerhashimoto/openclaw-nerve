/** Tests for the sessions API route (GET /api/sessions/:id/model). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('GET /api/sessions/:id/model', () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sessions-test-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function buildApp() {
    // Mock config to use our temp sessions dir
    vi.doMock('../lib/config.js', () => ({
      config: {
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
    expect(json.missing).toBe(true);
  });

  it('returns model from transcript with model_change entry', async () => {
    const app = await buildApp();
    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const transcript = [
      JSON.stringify({ type: 'session_start', ts: Date.now() }),
      JSON.stringify({ type: 'model_change', modelId: 'anthropic/claude-opus-4', ts: Date.now() }),
      JSON.stringify({ type: 'message', role: 'user', content: 'hello' }),
    ].join('\n');
    await fs.writeFile(path.join(tmpDir, `${uuid}.jsonl`), transcript);

    const res = await app.request(`/api/sessions/${uuid}/model`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.model).toBe('anthropic/claude-opus-4');
    expect(json.missing).toBe(false);
  });

  it('returns model: null when transcript has no model_change', async () => {
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
    expect(json.missing).toBe(false);
  });
});
