import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

describe('openai-whisper transcribe URL building', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses base whisper URL when no API version is configured', async () => {
    vi.doMock('../lib/config.js', () => ({
      config: { openaiApiKey: 'sk-test', openaiApiVersion: '', language: 'en' },
    }));

    vi.doMock('../lib/constants.js', () => ({
      OPENAI_WHISPER_URL: 'https://api.openai.com/v1/audio/transcriptions',
    }));

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ text: 'ok' }), { status: 200 }),
    );

    const { transcribe } = await import('./openai-whisper.js');
    const result = await transcribe(Buffer.from('abc'), 'sample.webm');

    expect(result).toEqual({ ok: true, text: 'ok' });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('appends api-version when OPENAI_API_VERSION/AZURE_OPENAI_API_VERSION is configured', async () => {
    vi.doMock('../lib/config.js', () => ({
      config: { openaiApiKey: 'sk-test', openaiApiVersion: '2024-06-01', language: 'en' },
    }));

    vi.doMock('../lib/constants.js', () => ({
      OPENAI_WHISPER_URL: 'https://example.cognitiveservices.azure.com/openai/deployments/whisper/audio/transcriptions',
    }));

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ text: 'ok' }), { status: 200 }),
    );

    const { transcribe } = await import('./openai-whisper.js');
    const result = await transcribe(Buffer.from('abc'), 'sample.webm');

    expect(result).toEqual({ ok: true, text: 'ok' });
    expect(fetch).toHaveBeenCalledWith(
      'https://example.cognitiveservices.azure.com/openai/deployments/whisper/audio/transcriptions?api-version=2024-06-01',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does not override existing api-version query parameter', async () => {
    vi.doMock('../lib/config.js', () => ({
      config: { openaiApiKey: 'sk-test', openaiApiVersion: '2024-06-01', language: 'en' },
    }));

    vi.doMock('../lib/constants.js', () => ({
      OPENAI_WHISPER_URL:
        'https://example.cognitiveservices.azure.com/openai/deployments/whisper/audio/transcriptions?api-version=2025-01-01',
    }));

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ text: 'ok' }), { status: 200 }),
    );

    const { transcribe } = await import('./openai-whisper.js');
    const result = await transcribe(Buffer.from('abc'), 'sample.webm');

    expect(result).toEqual({ ok: true, text: 'ok' });
    expect(fetch).toHaveBeenCalledWith(
      'https://example.cognitiveservices.azure.com/openai/deployments/whisper/audio/transcriptions?api-version=2025-01-01',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
