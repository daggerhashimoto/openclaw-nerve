/** One-shot speech synthesis through OpenAI's Realtime API. */
import WebSocket from 'ws';

export const OPENAI_REALTIME_TTS_MODEL = 'gpt-realtime-2.1-mini';
export const OPENAI_REALTIME_VOICES = [
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar',
] as const;

const REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${OPENAI_REALTIME_TTS_MODEL}`;
const SAMPLE_RATE = 24_000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

export function pcm16ToWav(pcm: Buffer): Buffer {
  const wav = Buffer.allocUnsafe(44 + pcm.length);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16); // PCM format chunk size
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28); // 16-bit mono byte rate
  wav.writeUInt16LE(2, 32); // block alignment
  wav.writeUInt16LE(16, 34); // bits per sample
  wav.write('data', 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}

type RealtimeTTSResult =
  | { ok: true; buf: Buffer; contentType: 'audio/wav' }
  | { ok: false; status: number; message: string };

/** Keep the API key on the server; return a WAV so Nerve's existing player can play it. */
export function synthesizeOpenAIRealtime(
  text: string,
  voice: string,
  styleInstructions: string,
  apiKey: string,
): Promise<RealtimeTTSResult> {
  if (!OPENAI_REALTIME_VOICES.includes(voice as (typeof OPENAI_REALTIME_VOICES)[number])) {
    return Promise.resolve({ ok: false, status: 400, message: `Unsupported Realtime voice: ${voice}` });
  }

  return new Promise((resolve) => {
    const socket = new WebSocket(REALTIME_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      handshakeTimeout: 10_000,
    });
    const chunks: Buffer[] = [];
    let audioBytes = 0;
    let settled = false;
    const timer = setTimeout(() => finish({ ok: false, status: 504, message: 'OpenAI Realtime TTS timed out' }), TIMEOUT_MS);

    function finish(result: RealtimeTTSResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
      if (socket.readyState === WebSocket.OPEN) socket.close();
      else if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
    }

    socket.on('open', () => {
      socket.send(JSON.stringify({
        type: 'response.create',
        response: {
          conversation: 'none',
          output_modalities: ['audio'],
          audio: { output: { voice, format: { type: 'audio/pcm', rate: SAMPLE_RATE } } },
          instructions: [
            'Speak the input text verbatim. Do not answer, paraphrase, or add words.',
            styleInstructions.trim(),
          ].filter(Boolean).join(' '),
          input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text }] }],
        },
      }));
    });

    socket.on('message', (raw) => {
      if (settled) return;
      let event: {
        type?: string;
        delta?: string;
        error?: { message?: string };
        response?: { status?: string; status_details?: { error?: { message?: string } } };
      };
      try {
        event = JSON.parse(raw.toString());
      } catch {
        finish({ ok: false, status: 502, message: 'Invalid OpenAI Realtime response' });
        return;
      }

      if (event.type === 'response.output_audio.delta' && event.delta) {
        const chunk = Buffer.from(event.delta, 'base64');
        audioBytes += chunk.length;
        if (audioBytes > MAX_AUDIO_BYTES) {
          finish({ ok: false, status: 502, message: 'OpenAI Realtime audio exceeded size limit' });
          return;
        }
        chunks.push(chunk);
      } else if (event.type === 'error') {
        finish({ ok: false, status: 502, message: event.error?.message || 'OpenAI Realtime TTS error' });
      } else if (event.type === 'response.done') {
        if (event.response?.status !== 'completed' || audioBytes === 0) {
          finish({
            ok: false,
            status: 502,
            message: event.response?.status_details?.error?.message || 'OpenAI Realtime TTS produced no audio',
          });
          return;
        }
        finish({ ok: true, buf: pcm16ToWav(Buffer.concat(chunks, audioBytes)), contentType: 'audio/wav' });
      }
    });

    socket.on('error', (error) => {
      console.error('[tts:openai-realtime] Connection failed:', error.message);
      finish({ ok: false, status: 502, message: 'OpenAI Realtime TTS connection failed' });
    });
    socket.on('close', () => {
      if (!settled) finish({ ok: false, status: 502, message: 'OpenAI Realtime TTS connection closed early' });
    });
  });
}
