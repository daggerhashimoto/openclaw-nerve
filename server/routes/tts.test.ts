/** Tests for the TTS route (POST /api/tts, GET/PUT /api/tts/config). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

describe('TTS routes', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockDeps(overrides: {
    openaiKey?: string;
    replicateToken?: string;
    mimoKey?: string;
    edgeResult?: { ok: boolean; buf?: Buffer; message?: string; status?: number; contentType?: string };
    openaiResult?: { ok: boolean; buf?: Buffer; message?: string; status?: number };
    replicateResult?: { ok: boolean; buf?: Buffer; message?: string; status?: number };
    xiaomiResult?: { ok: boolean; buf?: Buffer; message?: string; status?: number; contentType?: string };
  } = {}) {
    vi.doMock('../lib/config.js', () => ({
      config: {
        auth: false, port: 3000, host: '127.0.0.1', sslPort: 3443,
        openaiApiKey: overrides.openaiKey || '',
        replicateApiToken: overrides.replicateToken || '',
        mimoApiKey: overrides.mimoKey || '',
      },
      SESSION_COOKIE_NAME: 'nerve_session_3000',
    }));
    vi.doMock('../middleware/rate-limit.js', () => ({
      rateLimitTTS: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
      rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
    }));
    vi.doMock('../services/tts-cache.js', () => ({
      getTtsCache: vi.fn(() => null),
      setTtsCache: vi.fn(),
    }));
    vi.doMock('../services/edge-tts.js', () => ({
      synthesizeEdge: vi.fn(async () =>
        overrides.edgeResult || { ok: true, buf: Buffer.from('fake-audio'), contentType: 'audio/mpeg' }
      ),
    }));
    vi.doMock('../services/openai-tts.js', () => ({
      synthesizeOpenAI: vi.fn(async () =>
        overrides.openaiResult || { ok: true, buf: Buffer.from('fake-openai-audio') }
      ),
    }));
    vi.doMock('../services/replicate-tts.js', () => ({
      synthesizeReplicate: vi.fn(async () =>
        overrides.replicateResult || { ok: true, buf: Buffer.from('fake-replicate-audio') }
      ),
    }));
    vi.doMock('../services/xiaomi-tts.js', () => ({
      synthesizeXiaomi: vi.fn(async () =>
        overrides.xiaomiResult || { ok: true, buf: Buffer.from('RIFFdemo'), contentType: 'audio/wav' }
      ),
    }));
    vi.doMock('../lib/tts-config.js', () => ({
      getTTSConfig: vi.fn(() => ({
        openai: { voice: 'alloy', model: 'tts-1', instructions: '' },
        edge: { voice: 'en-US-JennyNeural' },
        qwen: {},
        xiaomi: { model: 'mimo-v2-tts', voice: 'mimo_default', style: 'Happy' },
      })),
      updateTTSConfig: vi.fn((patch: unknown) => patch),
    }));
  }

  async function buildApp() {
    const mod = await import('./tts.js');
    const app = new Hono();
    app.route('/', mod.default);
    return app;
  }

  describe('POST /api/tts', () => {
    it('returns 400 when text is missing', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when text is empty', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '   ' }),
      });
      expect(res.status).toBe(400);
    });

    it('falls back to edge TTS when no API keys set', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello world' }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('audio');
    });

    it('uses OpenAI when key is set and no explicit provider', async () => {
      mockDeps({ openaiKey: 'sk-test' });
      const app = await buildApp();
      const res = await app.request('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello' }),
      });
      expect(res.status).toBe(200);
    });

    it('uses explicit edge provider even when OpenAI key exists', async () => {
      mockDeps({ openaiKey: 'sk-test' });
      const app = await buildApp();
      const res = await app.request('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello', provider: 'edge' }),
      });
      expect(res.status).toBe(200);
    });

    it('uses explicit Xiaomi provider and returns WAV audio', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello', provider: 'xiaomi' }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('audio/wav');
    });

    it('honors explicit Xiaomi provider even when other keys exist', async () => {
      mockDeps({ openaiKey: 'sk-test', replicateToken: 'r8-test', mimoKey: 'sk-mimo' });
      const app = await buildApp();
      const res = await app.request('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello', provider: 'xiaomi' }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('audio/wav');
    });

    it('returns Xiaomi provider errors', async () => {
      mockDeps({ xiaomiResult: { ok: false, message: 'Xiaomi failed', status: 502 } });
      const app = await buildApp();
      const res = await app.request('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello', provider: 'xiaomi' }),
      });
      expect(res.status).toBe(502);
    });

    it('returns error from provider failure', async () => {
      mockDeps({ edgeResult: { ok: false, message: 'Edge TTS failed', status: 500 } });
      const app = await buildApp();
      const res = await app.request('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello' }),
      });
      expect(res.status).toBe(500);
    });

    it('returns 400 for text exceeding max length', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'a'.repeat(5001) }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/tts/config', () => {
    it('returns current TTS config', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/tts/config');
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json).toHaveProperty('openai');
      expect(json).toHaveProperty('edge');
    });
  });

  describe('PUT /api/tts/config', () => {
    it('rejects unknown sections', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/tts/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unknown_section: { voice: 'test' } }),
      });
      expect(res.status).toBe(400);
    });

    it('accepts valid config patch', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/tts/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edge: { voice: 'en-US-GuyNeural' } }),
      });
      expect(res.status).toBe(200);
    });

    it('accepts valid Xiaomi config patch', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/tts/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xiaomi: { model: 'mimo-v2-tts', voice: 'default_en', style: 'Happy' } }),
      });
      expect(res.status).toBe(200);
    });

    it('rejects non-string values', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/tts/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openai: { voice: 123 } }),
      });
      expect(res.status).toBe(400);
    });
  });
});
