import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { synthesizeMiniMax } from './minimax-tts.js';

vi.mock('../lib/config.js', () => ({ config: { minimaxApiKey: 'test-key' } }));
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe('MiniMax speech synthesis', () => {
  it.each([["global_en", "https://api.minimax.io/v1/t2a_v2"], ["cn_zh", "https://api.minimaxi.com/v1/t2a_v2"]] as const)('uses the %s endpoint and decodes completed hex audio', async (region, endpoint) => {
    fetchMock.mockResolvedValue(Response.json({ base_resp: { status_code: 0 }, data: { status: 2, audio: '494433' } }));
    const result = await synthesizeMiniMax('Hello', { voice: 'test-voice', region });
    expect(result).toEqual({ ok: true, buf: Buffer.from('ID3'), contentType: 'audio/mpeg' });
    expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      model: "speech-2.8-hd", text: 'Hello', stream: false, output_format: 'hex',
      voice_setting: { voice_id: 'test-voice' }, audio_setting: { format: 'mp3' },
    });
  });
  it('passes the selected speech model', async () => {
    fetchMock.mockResolvedValue(Response.json({ base_resp: { status_code: 0 }, data: { status: 2, audio: 'ff' } }));
    await synthesizeMiniMax('Hello', { voice: 'test-voice', model: "speech-2.8-turbo" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("speech-2.8-turbo");
  });
  it.each([
    null, {}, { base_resp: { status_code: 1000 } },
    { base_resp: { status_code: 0 }, data: { status: 1, audio: 'ff' } },
    { base_resp: { status_code: 0 }, data: { status: 2, audio: 'f' } },
    { base_resp: { status_code: 0 }, data: { status: 2, audio: 'zz' } },
    { base_resp: { status_code: 0 }, data: { status: 2, audio: '' } },
  ])('rejects invalid responses: %j', async payload => {
    fetchMock.mockResolvedValue(Response.json(payload));
    expect(await synthesizeMiniMax('Hello', { voice: 'test-voice' })).toMatchObject({ ok: false, status: 502 });
  });
  it('rejects missing voice IDs and unsupported models before sending', async () => {
    expect(await synthesizeMiniMax('Hello')).toMatchObject({ ok: false, status: 400 });
    expect(await synthesizeMiniMax('Hello', { voice: 'test-voice', model: 'invalid' })).toMatchObject({ ok: false, status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([new Response('failure', { status: 503 }), new Response('not-json')])('handles HTTP and malformed JSON failures', async response => {
    fetchMock.mockResolvedValue(response);
    expect(await synthesizeMiniMax('Hello', { voice: 'test-voice' })).toMatchObject({ ok: false, status: 502 });
  });
  it('handles network errors', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await synthesizeMiniMax('Hello', { voice: 'test-voice' })).toMatchObject({ ok: false, status: 502 });
  });
});
