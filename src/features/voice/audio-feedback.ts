// Audio feedback using pre-recorded MP3/OGG files served from /sounds/
// Files are preloaded into AudioBuffers for instant, glitch-free playback.

let audioCtx: AudioContext | null = null;
const bufferCache = new Map<string, AudioBuffer>();
const loadingCache = new Map<string, Promise<AudioBuffer | null>>();

type AudioContextConstructor = new () => AudioContext;
type WindowWithWebkitAudioContext = Window & {
  webkitAudioContext?: AudioContextConstructor;
};

function getAudioContextConstructor(): AudioContextConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.AudioContext ?? (window as WindowWithWebkitAudioContext).webkitAudioContext;
}

function getAudioContext(): AudioContext | null {
  if (audioCtx) return audioCtx;

  const AudioContextCtor = getAudioContextConstructor();
  if (!AudioContextCtor) return null;

  audioCtx = new AudioContextCtor();
  return audioCtx;
}

/** Preload an audio file into an AudioBuffer. */
function preloadSound(path: string): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(path);
  if (cached) return Promise.resolve(cached);

  const existing = loadingCache.get(path);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const ctx = getAudioContext();
      if (!ctx) return null;

      const resp = await fetch(path);
      if (!resp.ok) return null;
      const arrayBuffer = await resp.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arrayBuffer);
      bufferCache.set(path, buffer);
      return buffer;
    } catch {
      return null;
    }
  })();

  loadingCache.set(path, promise);
  void promise.finally(() => {
    loadingCache.delete(path);
  });
  return promise;
}

// Preload all sound effects on module load (OGG/Opus — no MP3 encoder delay artifacts)
const SOUND_PATHS = ['/sounds/wake.mp3', '/sounds/send.ogg', '/sounds/cancel.ogg', '/sounds/notify.ogg'];
if (typeof window !== 'undefined') {
  SOUND_PATHS.forEach(p => void preloadSound(p));
}

function playSound(path: string, playbackRate = 1): void {
  void playSoundAsync(path, playbackRate);
}

async function playSoundAsync(path: string, playbackRate = 1): Promise<void> {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') await ctx.resume();

    const buffer = bufferCache.get(path) ?? await preloadSound(path);
    if (!buffer) return;

    if (ctx.state === 'suspended') await ctx.resume();

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // AudioContext not available, silently skip
  }
}

/** Initialize or resume the AudioContext (call on user interaction to unlock). */
export function ensureAudioContext(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') void ctx.resume();
    // Re-trigger preloads if they failed before context existed
    SOUND_PATHS.forEach(p => { if (!bufferCache.has(p)) void preloadSound(p); });
  } catch {
    // AudioContext not available
  }
}

/** Play ascending ping when wake-word is detected. */
export function playWakePing(): void {
  playSound('/sounds/wake.mp3');
}

/** Play confirmation sound when voice input is submitted. */
export function playSubmitPing(): void {
  playSound('/sounds/send.ogg');
}

/** Play cancel sound when voice input is cancelled. */
export function playCancelPing(): void {
  playSound('/sounds/cancel.ogg');
}

/** Simple notification ping (used for chat completion sounds) */
export function playPing(): void {
  playSound('/sounds/notify.ogg');
}
