import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const realtimeSpeech = vi.fn(async () => ({
  ok: true as const,
  buf: Buffer.from('RIFFdemo'),
  contentType: 'audio/wav' as const,
}));

describe('OpenAI TTS model routing', () => {
  beforeEach(() => {
    vi.resetModules();
    realtimeSpeech.mockClear();
    vi.doMock('../lib/config.js', () => ({ config: { openaiApiKey: 'test-key' } }));
    vi.doMock('../lib/tts-config.js', () => ({
      getTTSConfig: () => ({ openai: {
        model: 'gpt-realtime-2.1-mini',
        voice: 'nova',
        realtimeVoice: 'marin',
        instructions: 'Speak warmly.',
      } }),
    }));
    vi.doMock('./openai-realtime-tts.js', () => ({
      OPENAI_REALTIME_TTS_MODEL: 'gpt-realtime-2.1-mini',
      synthesizeOpenAIRealtime: realtimeSpeech,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('./openai-realtime-tts.js');
  });

  it('uses Realtime with its own voice for the new default', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { synthesizeOpenAI } = await import('./openai-tts.js');

    const result = await synthesizeOpenAI('Hello Shaun');

    expect(result.ok).toBe(true);
    expect(realtimeSpeech).toHaveBeenCalledWith('Hello Shaun', 'marin', 'Speak warmly.', 'test-key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves the legacy Speech API path and voice', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => ({
      ok: true,
      arrayBuffer: async () => Uint8Array.of(1, 2, 3).buffer,
    } as Response));
    vi.stubGlobal('fetch', fetchMock);
    const { synthesizeOpenAI } = await import('./openai-tts.js');

    const result = await synthesizeOpenAI('Hello Shaun', undefined, 'gpt-4o-mini-tts');

    expect(result.ok).toBe(true);
    expect(realtimeSpeech).not.toHaveBeenCalled();
    const payload = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(payload).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'nova', input: 'Hello Shaun' });
  });
});
