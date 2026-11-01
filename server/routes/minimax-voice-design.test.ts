import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimitTTS } from '../middleware/rate-limit.js';
import { designMiniMaxVoice } from '../services/minimax-voice-design.js';
import routes from './minimax-voice-design.js';

const state = vi.hoisted(() => ({ auth: false }));
vi.mock('../lib/config.js', () => ({ config: state, SESSION_COOKIE_NAME: 'test_session' }));
vi.mock('../services/minimax-voice-design.js', () => ({ designMiniMaxVoice: vi.fn() }));
vi.mock('../middleware/rate-limit.js', () => ({
  rateLimitTTS: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
}));

const app = new Hono();
app.use('*', authMiddleware);
app.route('/', routes);
const input = { prompt: 'A calm narrator', preview_text: 'Welcome.', voice_id: 'custom_voice' };
const request = (body: unknown) => app.request('/api/tts/minimax/voice-design', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  state.auth = false;
  vi.mocked(designMiniMaxVoice).mockResolvedValue({
    ok: true, voice_id: 'designed_voice', trial_audio: '494433',
  });
});

describe('POST /api/tts/minimax/voice-design', () => {
  it('passes validated fields and returns the voice and preview', async () => {
    const response = await request({ ...input, region: 'cn_zh', ignored: 'value' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ voice_id: 'designed_voice', trial_audio: '494433' });
    expect(designMiniMaxVoice).toHaveBeenCalledWith({ ...input, region: 'cn_zh' });
    expect(rateLimitTTS).toHaveBeenCalledTimes(1);
  });

  it('accepts 500 preview characters and an omitted region', async () => {
    const response = await request({ ...input, preview_text: 'a'.repeat(500) });
    expect(response.status).toBe(200);
  });

  it.each([
    {}, { ...input, prompt: '  ' }, { ...input, prompt: 'a'.repeat(5001) },
    { ...input, voice_id: '' }, { ...input, voice_id: null },
    { ...input, preview_text: undefined }, { ...input, preview_text: '  ' },
    { ...input, preview_text: 'a'.repeat(501) }, { ...input, region: 'invalid' },
  ])('rejects invalid input before invoking the service: %j', async body => {
    const response = await request(body);
    expect(response.status).toBe(400);
    expect(designMiniMaxVoice).not.toHaveBeenCalled();
  });

  it('does not design a voice without a session when authentication is enabled', async () => {
    state.auth = true;
    expect((await request(input)).status).toBe(401);
    expect(designMiniMaxVoice).not.toHaveBeenCalled();
  });

  it.each([502, 503] as const)('returns service failure status %s', async status => {
    vi.mocked(designMiniMaxVoice).mockResolvedValue({ ok: false, status, message: 'Voice design unavailable' });
    const response = await request(input);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: 'Voice design unavailable' });
  });
});
