// Audio feedback using pre-recorded MP3 files served from /sounds/

/** Lazy-loaded Audio singletons keyed by file path */
const audioCache = new Map<string, HTMLAudioElement>();

function getAudio(path: string): HTMLAudioElement {
  let audio = audioCache.get(path);
  if (!audio) {
    audio = new Audio(path);
    audioCache.set(path, audio);
  }
  return audio;
}

function playSound(path: string, playbackRate = 1): void {
  try {
    const audio = getAudio(path);
    audio.playbackRate = playbackRate;
    // Rewind if already playing or finished
    audio.currentTime = 0;
    audio.play().catch(() => {
      // Autoplay blocked or audio unavailable — silently skip
    });
  } catch {
    // Audio not available, silently skip
  }
}

/** Backward-compatible no-op. Consumers may call this to "warm up" audio. */
export function ensureAudioContext(): void {
  // No-op: HTMLAudioElement doesn't need an AudioContext.
  // Kept for backward compatibility with existing callers.
}

/** Play ascending ping when wake-word is detected. */
export function playWakePing(): void {
  playSound('/sounds/wake.mp3');
}

/** Play confirmation sound when voice input is submitted. */
export function playSubmitPing(): void {
  playSound('/sounds/send.mp3');
}

/** Play cancel sound when voice input is cancelled. */
export function playCancelPing(): void {
  playSound('/sounds/cancel.mp3');
}

/** Simple notification ping (used for chat completion sounds) */
export function playPing(): void {
  playSound('/sounds/notify.mp3');
}
