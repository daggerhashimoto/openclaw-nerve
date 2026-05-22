// @vitest-environment node

/** Tests for the transcribe config and language routes. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

const telemetryRuntimeMock = {
  markFeatureUsed: vi.fn(async () => undefined),
};

function resetTelemetryRuntimeMock(): void {
  telemetryRuntimeMock.markFeatureUsed.mockReset();
  telemetryRuntimeMock.markFeatureUsed.mockResolvedValue(undefined);
}

describe('transcribe routes', () => {
  beforeEach(() => {
    vi.resetModules();
    resetTelemetryRuntimeMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockDeps(overrides: {
    sttProvider?: string;
    openaiKey?: string;
    language?: string;
  } = {}) {
    const mockConfig: Record<string, unknown> = {
      auth: false, port: 3000, host: '127.0.0.1', sslPort: 3443,
      sttProvider: overrides.sttProvider || 'local',
      openaiApiKey: overrides.openaiKey || '',
      replicateApiToken: '',
      language: overrides.language || 'en',
      edgeVoiceGender: 'female',
      limits: { transcribe: 12 * 1024 * 1024 },
    };
    vi.doMock('../lib/config.js', () => ({
      config: mockConfig,
      updateConfig: (key: string, value: unknown) => { mockConfig[key] = value; },
      SESSION_COOKIE_NAME: 'nerve_session_3000',
    }));
    vi.doMock('../middleware/rate-limit.js', () => ({
      rateLimitTranscribe: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
      rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
    }));
    vi.doMock('../lib/constants.js', () => ({
      SUPPORTED_LANGUAGES: [
        { code: 'en', name: 'English', nativeName: 'English', edgeTtsVoices: { female: 'v1', male: 'v2' }, qwen3Language: null },
        { code: 'de', name: 'German', nativeName: 'Deutsch', edgeTtsVoices: { female: 'v3', male: 'v4' }, qwen3Language: 'de' },
      ],
    }));
    vi.doMock('../lib/env-file.js', () => ({
      writeEnvKey: vi.fn(async () => {}),
    }));
    vi.doMock('../lib/language.js', () => ({
      isLanguageSupported: vi.fn(() => true),
    }));
    vi.doMock('../lib/telemetry/runtime.js', () => ({
      getTelemetryRuntime: vi.fn(() => telemetryRuntimeMock),
    }));
    vi.doMock('../services/openai-whisper.js', () => ({
      transcribe: vi.fn(async () => ({ ok: true, text: 'openai transcription' })),
    }));
    vi.doMock('../services/whisper-local.js', () => ({
      transcribeLocal: vi.fn(async () => ({ ok: true, text: 'local transcription' })),
      isModelAvailable: vi.fn((model?: string) => !model || model === 'base.en'),
      getActiveModel: vi.fn(() => 'base.en'),
      setWhisperModel: vi.fn(async (model: string) => {
        if (model === 'bad-model') return { ok: false, message: 'Unknown model' };
        return { ok: true, message: `Model set to ${model}` };
      }),
      getDownloadProgress: vi.fn(() => null),
      getSystemInfo: vi.fn(() => ({ hasGpu: false })),
    }));
  }

  async function buildApp() {
    const mod = await import('./transcribe.js');
    const app = new Hono();
    app.route('/', mod.default);
    return app;
  }

  describe('GET /api/transcribe/config', () => {
    it('returns current STT config', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/transcribe/config');
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.provider).toBe('local');
      expect(json.model).toBe('base.en');
      expect(json.language).toBe('en');
      expect(json).toHaveProperty('availableModels');
      expect(json).toHaveProperty('hasGpu');
    });

    it('includes model ready status', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/transcribe/config');
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.modelReady).toBe(true);
    });
  });

  describe('PUT /api/transcribe/config', () => {
    it('switches provider', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/transcribe/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai' }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.provider).toBe('openai');
    });

    it('marks settings used when language updates succeed', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/transcribe/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'de' }),
      });

      expect(res.status).toBe(200);
      expect(telemetryRuntimeMock.markFeatureUsed).toHaveBeenCalledTimes(1);
      expect(telemetryRuntimeMock.markFeatureUsed).toHaveBeenCalledWith('settings');
    });

    it('marks settings used when provider updates succeed', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/transcribe/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai' }),
      });

      expect(res.status).toBe(200);
      expect(telemetryRuntimeMock.markFeatureUsed).toHaveBeenCalledTimes(1);
      expect(telemetryRuntimeMock.markFeatureUsed).toHaveBeenCalledWith('settings');
    });

    it('marks settings used when model updates succeed', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/transcribe/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'small' }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.message).toBe('Model set to small');
      expect(telemetryRuntimeMock.markFeatureUsed).toHaveBeenCalledTimes(1);
      expect(telemetryRuntimeMock.markFeatureUsed).toHaveBeenCalledWith('settings');
    });

    it('rejects unsupported language', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/transcribe/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'xx' }),
      });
      expect(res.status).toBe(400);
    });

    it('emits no settings telemetry when transcription config updates fail', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/transcribe/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'xx' }),
      });

      expect(res.status).toBe(400);
      expect(telemetryRuntimeMock.markFeatureUsed).not.toHaveBeenCalled();
    });

    it('accepts valid language', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/transcribe/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'de' }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.language).toBe('de');
    });

    it('rejects bad model without emitting settings telemetry', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/transcribe/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'bad-model' }),
      });

      expect(res.status).toBe(400);
      expect(telemetryRuntimeMock.markFeatureUsed).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid JSON', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/transcribe/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/language', () => {
    it('returns language info with supported list', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/language');
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.language).toBe('en');
      expect(json.edgeVoiceGender).toBe('female');
      expect(Array.isArray(json.supported)).toBe(true);
      expect(json).toHaveProperty('providers');
    });
  });

  describe('PUT /api/language', () => {
    it('rejects unsupported language code', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/language', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'xx' }),
      });
      expect(res.status).toBe(400);
    });

    it('accepts valid language code', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/language', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'de' }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json.language).toBe('de');
      expect(telemetryRuntimeMock.markFeatureUsed).toHaveBeenCalledTimes(1);
      expect(telemetryRuntimeMock.markFeatureUsed).toHaveBeenCalledWith('settings');
    });

    it('rejects invalid edgeVoiceGender', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/language', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edgeVoiceGender: 'other' }),
      });
      expect(res.status).toBe(400);
    });

    it('accepts valid edgeVoiceGender', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/language', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edgeVoiceGender: 'male' }),
      });
      expect(res.status).toBe(200);
      expect(telemetryRuntimeMock.markFeatureUsed).toHaveBeenCalledTimes(1);
      expect(telemetryRuntimeMock.markFeatureUsed).toHaveBeenCalledWith('settings');
    });

    it('returns 400 for invalid JSON', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/language', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
      expect(telemetryRuntimeMock.markFeatureUsed).not.toHaveBeenCalled();
    });

    it('emits no settings telemetry when language updates fail', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/language', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'xx' }),
      });

      expect(res.status).toBe(400);
      expect(telemetryRuntimeMock.markFeatureUsed).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/language/support', () => {
    it('returns full compatibility matrix', async () => {
      mockDeps();
      const app = await buildApp();
      const res = await app.request('/api/language/support');
      expect(res.status).toBe(200);
      const json = (await res.json()) as { languages: Array<Record<string, unknown>>; currentModel: string; isMultilingual: boolean };
      expect(Array.isArray(json.languages)).toBe(true);
      expect(json.currentModel).toBe('base.en');
      expect(json.isMultilingual).toBe(false);  // base.en ends with .en
    });
  });
});
