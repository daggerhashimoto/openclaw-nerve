/** POST /api/tts/minimax/voice-design — create a voice from a description. */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { rateLimitTTS } from '../middleware/rate-limit.js';
import { designMiniMaxVoice } from '../services/minimax-voice-design.js';

const app = new Hono();
const voiceDesignSchema = z.object({
  prompt: z.string().trim().min(1).max(5000),
  preview_text: z.string().trim().min(1).max(500),
  voice_id: z.string().trim().min(1),
  region: z.enum(['global_en', 'cn_zh']).optional(),
});

app.post(
  '/api/tts/minimax/voice-design',
  rateLimitTTS,
  zValidator('json', voiceDesignSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: result.error.issues[0]?.message || 'Invalid request' }, 400);
    }
  }),
  async (c) => {
    const result = await designMiniMaxVoice(c.req.valid('json'));
    if (!result.ok) {
      return c.json({ error: result.message }, result.status);
    }
    return c.json({ voice_id: result.voice_id, trial_audio: result.trial_audio });
  },
);

export default app;
