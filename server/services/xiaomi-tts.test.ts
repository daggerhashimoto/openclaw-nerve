/** Tests for the Xiaomi MiMo TTS provider service. */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

describe('synthesizeXiaomi', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns a clear error when the Xiaomi key is missing', async () => {
    vi.doMock('../lib/config.js', () => ({
      config: { mimoApiKey: '' },
    }));

    vi.doMock('../lib/tts-config.js', () => ({
      getTTSConfig: () => ({ xiaomi: { model: 'mimo-v2-tts', voice: 'mimo_default', style: '' } }),
    }));

    const { synthesizeXiaomi } = await import('./xiaomi-tts.js');
    await expect(synthesizeXiaomi('Hello')).resolves.toMatchObject({
      ok: false,
      status: 500,
      message: expect.stringContaining('Xiaomi'),
    });
  });

  it('posts an assistant message with optional style and decodes WAV audio', async () => {
    vi.doMock('../lib/config.js', () => ({
      config: { mimoApiKey: 'sk-mimo' },
    }));

    vi.doMock('../lib/tts-config.js', () => ({
      getTTSConfig: () => ({ xiaomi: { model: 'mimo-v2-tts', voice: 'default_en', style: 'Happy' } }),
    }));

    const wav = Buffer.from('RIFFdemo');
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { audio: { data: wav.toString('base64') } } }],
        }),
        { status: 200 },
      ),
    );

    const { synthesizeXiaomi } = await import('./xiaomi-tts.js');
    const result = await synthesizeXiaomi('Hello there');

    expect(result).toMatchObject({ ok: true, contentType: 'audio/wav' });
    if (!result.ok) throw new Error('Expected Xiaomi synthesis to succeed');
    expect(result.buf.equals(wav)).toBe(true);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.xiaomimimo.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-mimo',
          'Content-Type': 'application/json',
        }),
      }),
    );

    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('mimo-v2-tts');
    expect(body.audio).toEqual({ format: 'wav', voice: 'default_en' });
    expect(body.messages).toEqual([
      {
        role: 'assistant',
        content: '<style>Happy</style>Hello there',
      },
    ]);
  });

  it('returns a provider error when Xiaomi payload is malformed', async () => {
    vi.doMock('../lib/config.js', () => ({
      config: { mimoApiKey: 'sk-mimo' },
    }));

    vi.doMock('../lib/tts-config.js', () => ({
      getTTSConfig: () => ({ xiaomi: { model: 'mimo-v2-tts', voice: 'mimo_default', style: '' } }),
    }));

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 }),
    );

    const { synthesizeXiaomi } = await import('./xiaomi-tts.js');
    await expect(synthesizeXiaomi('Hello')).resolves.toMatchObject({
      ok: false,
      status: 502,
      message: expect.stringContaining('audio'),
    });
  });
});
