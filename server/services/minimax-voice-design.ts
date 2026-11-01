/** Design a MiniMax voice and return its generated preview. */
import { z } from 'zod';
import { config } from '../lib/config.js';

const ENDPOINTS = {
  "global_en": "https://api.minimax.io/v1/voice_design",
  "cn_zh": "https://api.minimaxi.com/v1/voice_design"
} as const;

export interface MiniMaxVoiceDesignInput {
  prompt: string;
  preview_text: string;
  voice_id: string;
  region?: keyof typeof ENDPOINTS;
}

const responseSchema = z.object({
  voice_id: z.string().trim().min(1),
  trial_audio: z.string().regex(/^(?:[0-9a-fA-F]{2})+$/),
  base_resp: z.object({ status_code: z.literal(0) }),
});

type VoiceDesignResult =
  | { ok: true; voice_id: string; trial_audio: string }
  | { ok: false; status: 502 | 503; message: string };

export async function designMiniMaxVoice(input: MiniMaxVoiceDesignInput): Promise<VoiceDesignResult> {
  if (!config.minimaxApiKey) {
    return { ok: false, status: 503, message: 'MiniMax API key not configured' };
  }

  try {
    const { prompt, preview_text, voice_id, region = 'global_en' } = input;
    const response = await fetch(ENDPOINTS[region], {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.minimaxApiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ prompt, preview_text, voice_id }),
    });
    if (!response.ok) {
      return { ok: false, status: 502, message: 'MiniMax voice design request failed' };
    }

    const result = responseSchema.safeParse(await response.json());
    if (!result.success) {
      return { ok: false, status: 502, message: 'MiniMax returned an invalid voice design response' };
    }
    return { ok: true, voice_id: result.data.voice_id, trial_audio: result.data.trial_audio };
  } catch {
    return { ok: false, status: 502, message: 'MiniMax voice design request failed' };
  }
}
