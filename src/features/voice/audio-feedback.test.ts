import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock AudioContext and related Web Audio API
const mockStart = vi.fn();
const mockConnect = vi.fn();
const mockGainConnect = vi.fn();
const mockGain = { gain: { value: 1 }, connect: mockGainConnect };
const mockCreateGain = vi.fn(() => mockGain);
const mockDestination = {};

const mockCreateBufferSource = vi.fn(() => ({
  buffer: null,
  playbackRate: { value: 1 },
  connect: mockConnect,
  start: mockStart,
}));

const mockDecodeAudioData = vi.fn(() =>
  Promise.resolve({ duration: 1, length: 44100, sampleRate: 44100 } as unknown as AudioBuffer),
);

const mockResume = vi.fn(() => Promise.resolve());

class MockAudioContext {
  state = 'running';
  destination = mockDestination;
  createBufferSource = mockCreateBufferSource;
  createGain = mockCreateGain;
  decodeAudioData = mockDecodeAudioData;
  resume = mockResume;
}

vi.stubGlobal('AudioContext', MockAudioContext);

// Mock fetch for preloading
const mockArrayBuffer = new ArrayBuffer(8);
vi.stubGlobal('fetch', vi.fn(() =>
  Promise.resolve({
    ok: true,
    arrayBuffer: () => Promise.resolve(mockArrayBuffer),
  }),
));

describe('audio-feedback', () => {
  let ensureAudioContext: () => void;
  let playWakePing: () => void;
  let playSubmitPing: () => void;
  let playCancelPing: () => void;
  let playPing: () => void;
  let setUiSoundVolume: (volume: number) => void;
  let normalizeUiSoundVolume: (volume: number) => number;

  beforeEach(async () => {
    mockStart.mockClear();
    mockConnect.mockClear();
    mockGainConnect.mockClear();
    mockCreateGain.mockClear();
    mockGain.gain.value = 1;
    mockCreateBufferSource.mockClear();
    mockDecodeAudioData.mockClear();
    mockResume.mockClear();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();

    vi.resetModules();
    const mod = await import('./audio-feedback');
    ensureAudioContext = mod.ensureAudioContext;
    playWakePing = mod.playWakePing;
    playSubmitPing = mod.playSubmitPing;
    playCancelPing = mod.playCancelPing;
    playPing = mod.playPing;
    setUiSoundVolume = mod.setUiSoundVolume;
    normalizeUiSoundVolume = mod.normalizeUiSoundVolume;

    // Wait for preloads to complete
    await new Promise(r => setTimeout(r, 10));
  });

  describe('ensureAudioContext', () => {
    it('should not throw', () => {
      expect(() => ensureAudioContext()).not.toThrow();
    });
  });

  describe('preloading', () => {
    it('should fetch all 4 sound files on module load', () => {
      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const urls = fetchCalls.map((c: string[]) => c[0]);
      expect(urls).toContain('/sounds/wake.mp3');
      expect(urls).toContain('/sounds/send.ogg');
      expect(urls).toContain('/sounds/cancel.ogg');
      expect(urls).toContain('/sounds/notify.ogg');
    });

    it('should decode audio data for each file', () => {
      expect(mockDecodeAudioData).toHaveBeenCalled();
    });
  });

  describe('playWakePing', () => {
    it('should create a buffer source and start it', () => {
      playWakePing();
      expect(mockCreateBufferSource).toHaveBeenCalled();
      expect(mockConnect).toHaveBeenCalled();
      expect(mockStart).toHaveBeenCalledWith(0);
    });

    it('should use default playbackRate of 1', () => {
      playWakePing();
      const source = mockCreateBufferSource.mock.results[0].value;
      expect(source.playbackRate.value).toBe(1);
    });

    it('routes UI audio through its independent volume control', () => {
      setUiSoundVolume(0.25);
      playWakePing();

      expect(mockGain.gain.value).toBe(0.25);
      expect(mockConnect).toHaveBeenCalledWith(mockGain);
      expect(mockGainConnect).toHaveBeenCalledWith(mockDestination);
    });

    it('does not start an audio source when UI sounds are muted', () => {
      setUiSoundVolume(0);
      playWakePing();

      expect(mockCreateBufferSource).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
    });

    it('clamps UI sound volume to the supported range', () => {
      expect(normalizeUiSoundVolume(-1)).toBe(0);
      expect(normalizeUiSoundVolume(2)).toBe(1);
      expect(normalizeUiSoundVolume(Number.NaN)).toBe(1);
    });

    it('rounds UI sound volume to whole percent, so a value that reads 0% is silent', () => {
      expect(normalizeUiSoundVolume(0.004)).toBe(0);
      expect(normalizeUiSoundVolume(0.333)).toBe(0.33);
      expect(normalizeUiSoundVolume(0.35)).toBe(0.35);

      setUiSoundVolume(0.004);
      playPing();
      expect(mockStart).not.toHaveBeenCalled();
    });
  });

  describe('UI sound volume', () => {
    const playEverySound = () => {
      playWakePing();
      playSubmitPing();
      playCancelPing();
      playPing();
    };

    it('plays every UI sound at full gain when no volume has been set', () => {
      playEverySound();

      expect(mockStart).toHaveBeenCalledTimes(4);
      expect(mockCreateGain).toHaveBeenCalledOnce();
      expect(mockGain.gain.value).toBe(1);
      expect(mockConnect).toHaveBeenCalledTimes(4);
      for (const [target] of mockConnect.mock.calls) expect(target).toBe(mockGain);
    });

    it('scales every UI sound through the one gain node', () => {
      setUiSoundVolume(0.4);
      playEverySound();

      expect(mockCreateGain).toHaveBeenCalledOnce();
      expect(mockGain.gain.value).toBe(0.4);
      for (const [target] of mockConnect.mock.calls) expect(target).toBe(mockGain);
    });

    it('starts no UI sound at all at volume 0', () => {
      setUiSoundVolume(0);
      playEverySound();

      expect(mockCreateBufferSource).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
    });

    it('silences a sound already playing when the volume drops to 0', () => {
      playPing();
      expect(mockGain.gain.value).toBe(1);

      setUiSoundVolume(0);

      expect(mockGain.gain.value).toBe(0);
    });

    it('plays again once the volume comes back up from 0', () => {
      setUiSoundVolume(0);
      playPing();
      setUiSoundVolume(0.6);
      playPing();

      expect(mockStart).toHaveBeenCalledOnce();
      expect(mockGain.gain.value).toBe(0.6);
    });
  });

  describe('playSubmitPing', () => {
    it('should create a buffer source and start it', () => {
      playSubmitPing();
      expect(mockCreateBufferSource).toHaveBeenCalled();
      expect(mockStart).toHaveBeenCalledWith(0);
    });
  });

  describe('playCancelPing', () => {
    it('should create a buffer source and start it', () => {
      playCancelPing();
      expect(mockCreateBufferSource).toHaveBeenCalled();
      expect(mockStart).toHaveBeenCalledWith(0);
    });
  });

  describe('playPing', () => {
    it('should create a buffer source and start it', () => {
      playPing();
      expect(mockCreateBufferSource).toHaveBeenCalled();
      expect(mockStart).toHaveBeenCalledWith(0);
    });
  });

  describe('multiple plays', () => {
    it('should create a new buffer source each time (not singleton)', () => {
      playWakePing();
      playWakePing();
      // AudioBufferSourceNode is one-shot — new source per play
      expect(mockCreateBufferSource).toHaveBeenCalledTimes(2);
    });
  });

  describe('error resilience', () => {
    it('should not throw when AudioContext is unavailable', () => {
      // Even if something goes wrong internally, functions should not throw
      expect(() => playWakePing()).not.toThrow();
      expect(() => playSubmitPing()).not.toThrow();
      expect(() => playCancelPing()).not.toThrow();
      expect(() => playPing()).not.toThrow();
    });
  });
});
