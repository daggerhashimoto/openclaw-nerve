import { useRef, useCallback, useEffect } from 'react';
import { ensureAudioContext } from '@/features/voice/audio-feedback';

// ─── Audio autoplay unlock ─────────────────────────────────────────────────────
// Browsers block audio.play() until the user has interacted with the page.
// We "unlock" audio by resuming the shared AudioContext on the first user gesture,
// which whitelists the origin for subsequent programmatic playback.
if (typeof document !== 'undefined') {
  const events = ['click', 'touchstart', 'keydown'] as const;
  const handler = () => {
    ensureAudioContext();
    events.forEach(e => document.removeEventListener(e, handler, true));
  };
  events.forEach(e => document.addEventListener(e, handler, { capture: true, once: false }));
}

export type TTSProvider = 'openai' | 'replicate' | 'edge' | 'xiaomi';

/** @deprecated Use 'replicate' instead. Kept for migration. */
export type LegacyTTSProvider = 'qwen';

/** Migrate legacy provider names to current ones. */
export function migrateTTSProvider(provider: string): TTSProvider {
  if (provider === 'qwen') return 'replicate';
  if (provider === 'openai' || provider === 'replicate' || provider === 'edge' || provider === 'xiaomi') return provider;
  return 'openai';
}

async function fetchTTS(text: string, provider: TTSProvider = 'openai', model?: string): Promise<Blob> {
  const body: Record<string, string> = { text, provider };
  if (model) body.model = model;
  const resp = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`TTS failed: ${resp.status}`);
  // Use the server's content type (audio/mpeg for MP3, audio/wav for WAV)
  const arrayBuffer = await resp.arrayBuffer();
  const ct = resp.headers.get('Content-Type') || 'audio/mpeg';
  const blob = new Blob([arrayBuffer], { type: ct });
  return blob;
}

// Keep each request short enough for speech providers that synthesize in real time.
// This is a per-request size, never a limit on the length of a spoken reply.
export const TTS_CHUNK_CHARS = 800;

export function splitTTSChunks(text: string, maxChars = TTS_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars);
    const sentence = Math.max(
      window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '),
      window.lastIndexOf('.\n'), window.lastIndexOf('!\n'), window.lastIndexOf('?\n'),
    );
    const whitespace = Math.max(window.lastIndexOf(' '), window.lastIndexOf('\n'));
    const cut = sentence >= maxChars / 3 ? sentence + 1 : whitespace > 0 ? whitespace : maxChars;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * Hook that provides a `speak` function for text-to-speech playback.
 *
 * Audio is fetched from `/api/tts` and played via an `HTMLAudioElement`.
 * Successive calls cancel the previous utterance automatically.
 */
export function useTTS(enabled: boolean, provider: TTSProvider = 'openai', model?: string) {
  const currentAudio = useRef<{ audio: HTMLAudioElement; url: string } | null>(null);
  const generationRef = useRef(0);

  const cleanupAudio = useCallback(() => {
    generationRef.current += 1;
    const current = currentAudio.current;
    if (!current) return;
    current.audio.pause();
    current.audio.src = '';
    URL.revokeObjectURL(current.url);
    currentAudio.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, [cleanupAudio]);

  const speak = useCallback(async (text: string) => {
    if (!enabled || !text) return;
    cleanupAudio();
    const gen = generationRef.current;
    const chunks = splitTTSChunks(text);
    let prefetched: Promise<Blob> | null = null;
    const playChunk = async (index: number): Promise<void> => {
      if (gen !== generationRef.current || index >= chunks.length) return;
      try {
        const blob = await (prefetched ?? fetchTTS(chunks[index], provider, model));
        prefetched = null;
        if (gen !== generationRef.current) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudio.current = { audio, url };
        let revoked = false;
        const revoke = () => {
          if (revoked) return;
          revoked = true;
          URL.revokeObjectURL(url);
          if (currentAudio.current?.audio === audio) currentAudio.current = null;
        };
        audio.addEventListener('ended', () => {
          revoke();
          void playChunk(index + 1);
        }, { once: true });
        audio.addEventListener('error', () => {
          revoke();
          console.error('[TTS] audio playback error');
        }, { once: true });
        try {
          await audio.play();
          if (gen === generationRef.current && index + 1 < chunks.length) {
            prefetched = fetchTTS(chunks[index + 1], provider, model);
            // The next clip may finish loading before this one ends.
            void prefetched.catch(() => {});
          }
        } catch (err) {
          revoke();
          throw err;
        }
      } catch (err: unknown) {
        if (gen === generationRef.current) {
          console.error('[TTS] play failed:', err instanceof Error ? err.message : String(err));
        }
      }
    };
    await playChunk(0);
  }, [enabled, provider, model, cleanupAudio]);

  return { speak };
}

/** Strip [tts:...] markers from text, returning cleaned text and the first TTS text found */
export function extractTTSMarkers(text: string): { cleaned: string; ttsText: string | null } {
  let ttsText: string | null = null;
  const cleaned = text.replace(/\[tts:([^\]]+)\]/g, (_, t) => {
    if (ttsText === null) ttsText = t;
    return '';
  });
  // A streaming reply can spend seconds inside a long marker. Never render
  // its unfinished contents as a second copy of the assistant's answer.
  return { cleaned: cleaned.replace(/\[tts:[\s\S]*$/g, '').trim(), ttsText };
}
