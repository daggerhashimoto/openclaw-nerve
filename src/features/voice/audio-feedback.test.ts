import { describe, it, expect, beforeEach, vi } from 'vitest';

// Track all instances created by our mock Audio class
const mockAudioInstances: MockAudio[] = [];

class MockAudio {
  src: string;
  currentTime = 0;
  playbackRate = 1;
  play = vi.fn(() => Promise.resolve());

  constructor(src?: string) {
    this.src = src ?? '';
    mockAudioInstances.push(this);
  }
}

vi.stubGlobal('Audio', MockAudio);

describe('audio-feedback', () => {
  let ensureAudioContext: () => void;
  let playWakePing: () => void;
  let playSubmitPing: () => void;
  let playCancelPing: () => void;
  let playPing: () => void;

  beforeEach(async () => {
    mockAudioInstances.length = 0;

    vi.resetModules();
    const mod = await import('./audio-feedback');
    ensureAudioContext = mod.ensureAudioContext;
    playWakePing = mod.playWakePing;
    playSubmitPing = mod.playSubmitPing;
    playCancelPing = mod.playCancelPing;
    playPing = mod.playPing;
  });

  describe('ensureAudioContext', () => {
    it('should be a no-op and not throw', () => {
      expect(() => ensureAudioContext()).not.toThrow();
    });
  });

  describe('playWakePing', () => {
    it('should create an Audio element for /sounds/wake.mp3', () => {
      playWakePing();
      expect(mockAudioInstances).toHaveLength(1);
      expect(mockAudioInstances[0].src).toBe('/sounds/wake.mp3');
    });

    it('should call play()', () => {
      playWakePing();
      expect(mockAudioInstances[0].play).toHaveBeenCalled();
    });

    it('should use default playbackRate of 1', () => {
      playWakePing();
      expect(mockAudioInstances[0].playbackRate).toBe(1);
    });

    it('should reuse the same Audio instance on repeated calls', () => {
      playWakePing();
      playWakePing();
      expect(mockAudioInstances).toHaveLength(1);
    });

    it('should reset currentTime before playing', () => {
      playWakePing();
      const instance = mockAudioInstances[0];
      instance.currentTime = 5;
      playWakePing();
      expect(instance.currentTime).toBe(0);
    });
  });

  describe('playSubmitPing', () => {
    it('should create an Audio element for /sounds/send.mp3', () => {
      playSubmitPing();
      expect(mockAudioInstances).toHaveLength(1);
      expect(mockAudioInstances[0].src).toBe('/sounds/send.mp3');
    });

    it('should call play()', () => {
      playSubmitPing();
      expect(mockAudioInstances[0].play).toHaveBeenCalled();
    });

    it('should use default playbackRate of 1', () => {
      playSubmitPing();
      expect(mockAudioInstances[0].playbackRate).toBe(1);
    });
  });

  describe('playCancelPing', () => {
    it('should create an Audio element for /sounds/cancel.mp3', () => {
      playCancelPing();
      expect(mockAudioInstances).toHaveLength(1);
      expect(mockAudioInstances[0].src).toBe('/sounds/cancel.mp3');
    });

    it('should use default playbackRate', () => {
      playCancelPing();
      expect(mockAudioInstances[0].playbackRate).toBe(1);
    });

    it('should call play()', () => {
      playCancelPing();
      expect(mockAudioInstances[0].play).toHaveBeenCalled();
    });
  });

  describe('playPing', () => {
    it('should create an Audio element for /sounds/notify.mp3', () => {
      playPing();
      expect(mockAudioInstances).toHaveLength(1);
      expect(mockAudioInstances[0].src).toBe('/sounds/notify.mp3');
    });

    it('should call play()', () => {
      playPing();
      expect(mockAudioInstances[0].play).toHaveBeenCalled();
    });

    it('should use default playbackRate of 1', () => {
      playPing();
      expect(mockAudioInstances[0].playbackRate).toBe(1);
    });
  });

  describe('lazy singleton caching', () => {
    it('should create separate Audio instances for different sounds', () => {
      playWakePing();
      playSubmitPing();
      playPing();
      // wake.mp3 + send.mp3 + notify.mp3 = 3 instances
      expect(mockAudioInstances).toHaveLength(3);
    });

    it('playCancelPing creates its own cancel.mp3 singleton', () => {
      playWakePing();
      playCancelPing();
      // wake.mp3 + cancel.mp3 = 2 separate Audio instances
      expect(mockAudioInstances).toHaveLength(2);
    });
  });

  describe('error resilience', () => {
    it('should not throw when play() rejects', () => {
      playWakePing();
      mockAudioInstances[0].play.mockImplementationOnce(() =>
        Promise.reject(new Error('Autoplay blocked')),
      );
      expect(() => playWakePing()).not.toThrow();
    });
  });
});
