/**
 * Xiaomi MiMo TTS provider.
 *
 * Generates non-streaming WAV audio through Xiaomi's OpenAI-compatible
 * chat completions endpoint.
 * @module
 */

import { config } from '../lib/config.js';
import { getTTSConfig } from '../lib/tts-config.js';

const XIAOMI_TTS_URL = 'https://api.xiaomimimo.com/v1/chat/completions';

export interface XiaomiTTSResult {
  ok: true;
  buf: Buffer;
  contentType: 'audio/wav';
}

export interface XiaomiTTSError {
  ok: false;
  status: number;
  message: string;
}

export async function synthesizeXiaomi(
  text: string,
  opts?: { voice?: string; model?: string },
): Promise<XiaomiTTSResult | XiaomiTTSError> {
  if (!config.mimoApiKey) {
    return { ok: false, status: 500, message: 'Xiaomi MiMo API key not configured' };
  }

  const xiaomi = getTTSConfig().xiaomi;
  const effectiveModel = opts?.model || xiaomi.model;
  const effectiveVoice = opts?.voice || xiaomi.voice;
  const trimmedStyle = xiaomi.style.trim();
  const content = trimmedStyle ? `<style>${trimmedStyle}</style>${text}` : text;

  const resp = await fetch(XIAOMI_TTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.mimoApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: effectiveModel,
      messages: [
        {
          role: 'assistant',
          content,
        },
      ],
      audio: {
        format: 'wav',
        voice: effectiveVoice,
      },
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    console.error('[tts:xiaomi] API error:', resp.status, errBody);
    return { ok: false, status: resp.status, message: errBody || 'Xiaomi MiMo TTS failed' };
  }

  let payload: unknown;
  try {
    payload = await resp.json();
  } catch (err) {
    console.error('[tts:xiaomi] Failed to parse JSON:', (err as Error).message);
    return { ok: false, status: 502, message: 'Xiaomi MiMo returned invalid JSON' };
  }

  const audioData = (payload as {
    choices?: Array<{
      message?: {
        audio?: {
          data?: string;
        };
      };
    }>;
  }).choices?.[0]?.message?.audio?.data;

  if (!audioData) {
    console.error('[tts:xiaomi] Missing audio data in response:', JSON.stringify(payload));
    return { ok: false, status: 502, message: 'Xiaomi MiMo response missing audio data' };
  }

  try {
    const buf = Buffer.from(audioData, 'base64');
    return { ok: true, buf, contentType: 'audio/wav' };
  } catch (err) {
    console.error('[tts:xiaomi] Failed to decode audio:', (err as Error).message);
    return { ok: false, status: 502, message: 'Xiaomi MiMo returned invalid audio data' };
  }
}
