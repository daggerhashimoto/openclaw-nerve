// Audio feedback using pre-recorded MP3 files served from /sounds/
// Files are preloaded into AudioBuffers for instant, glitch-free playback.

let audioCtx: AudioContext | null = null;
let outputGain: GainNode | null = null;
let uiSoundVolume = 1;
const bufferCache = new Map<string, AudioBuffer>();
const loadingCache = new Map<string, Promise<AudioBuffer | null>>();

export function normalizeUiSoundVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  return Math.min(1, Math.max(0, volume));
}

/** Set the volume used by UI sound effects without affecting TTS playback. */
export function setUiSoundVolume(volume: number): void {
  uiSoundVolume = normalizeUiSoundVolume(volume);
  if (outputGain) outputGain.gain.value = uiSoundVolume;
}

function getOutputGain(): GainNode {
  if (!audioCtx) audioCtx = new AudioContext();
  if (!outputGain) {
    outputGain = audioCtx.createGain();
    outputGain.gain.value = uiSoundVolume;
    outputGain.connect(audioCtx.destination);
  }
  return outputGain;
}

/** Preload an audio file into an AudioBuffer. */
function preloadSound(path: string): Promise<AudioBuffer | null> {
  const existing = loadingCache.get(path);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const resp = await fetch(path);
      if (!resp.ok) return null;
      const arrayBuffer = await resp.arrayBuffer();
      if (!audioCtx) audioCtx = new AudioContext();
      const buffer = await audioCtx.decodeAudioData(arrayBuffer);
      bufferCache.set(path, buffer);
      return buffer;
    } catch {
      return null;
    }
  })();

  loadingCache.set(path, promise);
  return promise;
}

// Preload all sound effects on module load (OGG/Opus — no MP3 encoder delay artifacts)
const SOUND_PATHS = ['/sounds/wake.mp3', '/sounds/send.ogg', '/sounds/cancel.ogg', '/sounds/notify.ogg'];
if (typeof window !== 'undefined') {
  SOUND_PATHS.forEach(p => void preloadSound(p));
}

function playSound(path: string, playbackRate = 1): void {
  try {
    if (uiSoundVolume === 0) return;
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const buffer = bufferCache.get(path);
    if (!buffer) {
      // Not yet loaded — trigger preload for next time, skip this play
      preloadSound(path);
      return;
    }

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    source.connect(getOutputGain());
    source.start(0);
  } catch {
    // AudioContext not available, silently skip
  }
}

/** Initialize or resume the AudioContext (call on user interaction to unlock). */
export function ensureAudioContext(): void {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    // Re-trigger preloads if they failed before context existed
    SOUND_PATHS.forEach(p => { if (!bufferCache.has(p)) preloadSound(p); });
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
