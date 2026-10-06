import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { designMiniMaxVoice } from './minimax-voice-design.js';

const settings = vi.hoisted(() => ({ minimaxApiKey: 'test-key' }));
vi.mock('../lib/config.js', () => ({ config: settings }));
const fetchMock = vi.fn();
const input = { prompt: 'A calm narrator', preview_text: 'Welcome.', voice_id: 'custom_voice' };
const success = { voice_id: 'designed_voice', trial_audio: '494433', base_resp: { status_code: 0 } };

beforeEach(() => {
  settings.minimaxApiKey = 'test-key';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('MiniMax voice design', () => {
  it.each([["global_en", "https://api.minimax.io/v1/voice_design"], ["cn_zh", "https://api.minimaxi.com/v1/voice_design"]] as const)('maps the request for %s and returns the generated voice', async (region, endpoint) => {
    fetchMock.mockResolvedValue(Response.json(success));
    expect(await designMiniMaxVoice({ ...input, region })).toEqual({
      ok: true, voice_id: 'designed_voice', trial_audio: '494433',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
      signal: expect.any(AbortSignal),
    }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(input);
  });

  it('defaults to the global endpoint', async () => {
    fetchMock.mockResolvedValue(Response.json(success));
    await designMiniMaxVoice(input);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.minimax.io/v1/voice_design');
  });

  it('does not send a request without configured credentials', async () => {
    settings.minimaxApiKey = '';
    expect(await designMiniMaxVoice(input)).toMatchObject({ ok: false, status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    null, {},
    { ...success, base_resp: { status_code: 1004, status_msg: 'private upstream detail' } },
    { ...success, base_resp: {} },
    { ...success, base_resp: { status_code: '0' } },
    { ...success, voice_id: '' },
    { ...success, voice_id: '  ' },
    { ...success, voice_id: 12 },
    { ...success, trial_audio: '' },
    { ...success, trial_audio: 'f' },
    { ...success, trial_audio: 'zz' },
    { ...success, trial_audio: null },
  ])('rejects unsuccessful or incomplete responses: %j', async payload => {
    fetchMock.mockResolvedValue(Response.json(payload));
    const result = await designMiniMaxVoice(input);
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(JSON.stringify(result)).not.toContain('private upstream detail');
  });

  it.each([502, 429, 401])('handles HTTP %s without exposing or retrying the response', async status => {
    fetchMock.mockResolvedValue(new Response('private upstream detail', { status }));
    const result = await designMiniMaxVoice(input);
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(JSON.stringify(result)).not.toContain('private upstream detail');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('handles malformed JSON', async () => {
    fetchMock.mockResolvedValue(new Response('not-json'));
    expect(await designMiniMaxVoice(input)).toMatchObject({ ok: false, status: 502 });
  });

  it.each([new Error('private network detail'), new DOMException('timeout', 'TimeoutError')])('handles network failures without retrying', async error => {
    fetchMock.mockRejectedValue(error);
    const result = await designMiniMaxVoice(input);
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(JSON.stringify(result)).not.toContain('private network detail');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
