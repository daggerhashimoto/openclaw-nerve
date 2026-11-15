/**
 * OpenAI TTS provider.
 *
 * Supports Realtime TTS and legacy Speech API models.
 * Voice and model settings are read from `tts-config.json` via {@link getTTSConfig}.
 * @module
 */

import { config } from '../lib/config.js';
import { getTTSConfig } from '../lib/tts-config.js';
import { OPENAI_TTS_URL } from '../lib/constants.js';
import { OPENAI_REALTIME_TTS_MODEL, synthesizeOpenAIRealtime } from './openai-realtime-tts.js';

export interface OpenAITTSResult {
  ok: true;
  buf: Buffer;
  contentType?: string;
}

export interface OpenAITTSError {
  ok: false;
  status: number;
  message: string;
}

/**
 * Generate speech via OpenAI TTS API.
 * Returns the audio buffer on success, or an error object.
 */
export async function synthesizeOpenAI(
  text: string,
  voice?: string,
  model?: string,
): Promise<OpenAITTSResult | OpenAITTSError> {
  if (!config.openaiApiKey) {
    return { ok: false, status: 500, message: 'OpenAI API key not configured' };
  }

  const ttsConfig = getTTSConfig().openai;
  const effectiveModel = model || ttsConfig.model;
  if (effectiveModel === OPENAI_REALTIME_TTS_MODEL) {
    return synthesizeOpenAIRealtime(
      text,
      voice || ttsConfig.realtimeVoice || 'marin',
      ttsConfig.instructions,
      config.openaiApiKey,
    );
  }
  const effectiveVoice = voice || ttsConfig.voice;

  const resp = await fetch(OPENAI_TTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: effectiveModel,
      voice: effectiveVoice,
      input: text,
      response_format: 'mp3',
      // instructions only supported by gpt-4o-mini-tts
      ...(effectiveModel === 'gpt-4o-mini-tts' && {
        instructions: ttsConfig.instructions,
      }),
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    console.error('[tts:openai] API error:', resp.status, errBody);
    return { ok: false, status: resp.status, message: errBody };
  }

  const buf = Buffer.from(await resp.arrayBuffer());
  return { ok: true, buf };
}
