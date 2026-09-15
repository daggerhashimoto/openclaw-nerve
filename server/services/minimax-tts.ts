/** Non-streaming MiniMax speech synthesis. */
import { config } from '../lib/config.js';

const ENDPOINTS = {
  "global_en": "https://api.minimax.io/v1/t2a_v2",
  "cn_zh": "https://api.minimaxi.com/v1/t2a_v2"
} as const;
const DEFAULT_MODEL = "speech-2.8-hd";
const MODELS: readonly string[] = ["speech-2.8-hd", "speech-2.8-turbo", "speech-2.6-hd", "speech-2.6-turbo", "speech-02-hd", "speech-02-turbo", "speech-01-hd", "speech-01-turbo"];

type Result = { ok: true; buf: Buffer; contentType: 'audio/mpeg' }
  | { ok: false; status: number; message: string };

export async function synthesizeMiniMax(
  text: string,
  opts: { voice?: string; model?: string; region?: 'global_en' | 'cn_zh' } = {},
): Promise<Result> {
  if (!config.minimaxApiKey) {
    return { ok: false, status: 500, message: 'MiniMax API key not configured' };
  }
  if (!opts.voice?.trim()) {
    return { ok: false, status: 400, message: 'MiniMax requires a voice ID' };
  }
  const model = opts.model || DEFAULT_MODEL;
  if (!MODELS.includes(model)) {
    return { ok: false, status: 400, message: 'Unsupported MiniMax speech model' };
  }
  try {
    const response = await fetch(ENDPOINTS[opts.region || 'global_en'], {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.minimaxApiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model, text, stream: false, output_format: 'hex',
        voice_setting: { voice_id: opts.voice },
        audio_setting: { format: 'mp3' },
      }),
    });
    if (!response.ok) {
      return { ok: false, status: 502, message: 'MiniMax speech request failed' };
    }
    const payload = await response.json() as {
      base_resp?: { status_code?: number };
      data?: { status?: number; audio?: unknown };
    } | null;
    const audio = payload?.data?.audio;
    if (payload?.base_resp?.status_code !== 0 || payload?.data?.status !== 2
      || typeof audio !== 'string' || !/^(?:[0-9a-fA-F]{2})+$/.test(audio)) {
      return { ok: false, status: 502, message: 'MiniMax returned invalid or incomplete audio' };
    }
    return { ok: true, buf: Buffer.from(audio, 'hex'), contentType: 'audio/mpeg' };
  } catch {
    return { ok: false, status: 502, message: 'MiniMax speech request failed' };
  }
}
