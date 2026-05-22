// @vitest-environment node

/** Tests for voice phrase routes. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

const telemetryRuntimeMock = {
  markFeatureUsed: vi.fn(async () => undefined),
};

function resetTelemetryRuntimeMock(): void {
  telemetryRuntimeMock.markFeatureUsed.mockReset();
  telemetryRuntimeMock.markFeatureUsed.mockResolvedValue(undefined);
}

describe('voice-phrases routes', () => {
  beforeEach(() => {
    vi.resetModules();
    resetTelemetryRuntimeMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockDeps() {
    const phrases = new Map<string, {
      stopPhrases: string[];
      cancelPhrases: string[];
      wakePhrases?: string[];
    }>();
    const defaults = {
      en: {
        stopPhrases: ['stop'],
        cancelPhrases: ['cancel'],
        wakePhrases: ['nerve'],
      },
      de: {
        stopPhrases: ['halt'],
        cancelPhrases: ['abbrechen'],
        wakePhrases: ['nerva'],
      },
    };

    vi.doMock('../lib/config.js', () => ({
      config: { language: 'en' },
    }));

    vi.doMock('../lib/constants.js', () => ({
      DEFAULT_VOICE_PHRASES: defaults,
      SUPPORTED_LANGUAGES: [
        { code: 'en' },
        { code: 'de' },
      ],
    }));

    vi.doMock('../lib/voice-phrases.js', () => ({
      getVoicePhrases: vi.fn((lang: string) => phrases.get(lang) || defaults[lang as keyof typeof defaults] || {
        stopPhrases: [],
        cancelPhrases: [],
        wakePhrases: [],
      }),
      getLanguagePhrases: vi.fn((lang: string) => phrases.get(lang) || null),
      hasCustomPhrases: vi.fn((lang: string) => phrases.has(lang)),
      setLanguagePhrases: vi.fn((lang: string, value: { stopPhrases: string[]; cancelPhrases: string[]; wakePhrases?: string[] }) => {
        phrases.set(lang, value);
      }),
    }));

    vi.doMock('../lib/telemetry/runtime.js', () => ({
      getTelemetryRuntime: vi.fn(() => telemetryRuntimeMock),
    }));
  }

  async function buildApp() {
    const mod = await import('./voice-phrases.js');
    const app = new Hono();
    app.route('/', mod.default);
    return app;
  }

  it('marks settings used when voice phrases are updated', async () => {
    mockDeps();
    const app = await buildApp();

    const res = await app.request('/api/voice-phrases/de', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stopPhrases: ['anhalten'] }),
    });

    expect(res.status).toBe(200);
    expect(telemetryRuntimeMock.markFeatureUsed).toHaveBeenCalledTimes(1);
    expect(telemetryRuntimeMock.markFeatureUsed).toHaveBeenCalledWith('settings');
    expect(await res.json()).toEqual({ ok: true, lang: 'de' });
  });

  it('emits no settings telemetry when voice phrase updates fail', async () => {
    mockDeps();
    const app = await buildApp();

    const res = await app.request('/api/voice-phrases/xx', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stopPhrases: ['nope'] }),
    });

    expect(res.status).toBe(400);
    expect(telemetryRuntimeMock.markFeatureUsed).not.toHaveBeenCalled();
  });
});
