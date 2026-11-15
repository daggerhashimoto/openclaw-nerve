import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { extractTTSMarkers, migrateTTSProvider, useTTS } from './useTTS';
import { setUiSoundVolume } from '@/features/voice/audio-feedback';

describe('extractTTSMarkers', () => {
  it('should extract a single TTS marker', () => {
    const result = extractTTSMarkers('Hello [tts:world] there');
    expect(result.cleaned).toBe('Hello  there');
    expect(result.ttsText).toBe('world');
  });

  it('should extract only the first TTS marker text', () => {
    const result = extractTTSMarkers('[tts:first] and [tts:second]');
    expect(result.ttsText).toBe('first');
  });

  it('should remove all TTS markers from cleaned text', () => {
    const result = extractTTSMarkers('[tts:one] some [tts:two] text');
    expect(result.cleaned).toBe('some  text');
  });

  it('should return null ttsText when no markers present', () => {
    const result = extractTTSMarkers('No markers here');
    expect(result.cleaned).toBe('No markers here');
    expect(result.ttsText).toBeNull();
  });

  it('should handle empty string', () => {
    const result = extractTTSMarkers('');
    expect(result.cleaned).toBe('');
    expect(result.ttsText).toBeNull();
  });

  it('should handle marker at start of string', () => {
    const result = extractTTSMarkers('[tts:hello] world');
    expect(result.cleaned).toBe('world');
    expect(result.ttsText).toBe('hello');
  });

  it('should handle marker at end of string', () => {
    const result = extractTTSMarkers('hello [tts:world]');
    expect(result.cleaned).toBe('hello');
    expect(result.ttsText).toBe('world');
  });

  it('should handle marker with spaces in content', () => {
    const result = extractTTSMarkers('[tts:hello world] text');
    expect(result.ttsText).toBe('hello world');
  });

  it('should handle marker with special characters', () => {
    const result = extractTTSMarkers('[tts:say "hello!"] text');
    expect(result.ttsText).toBe('say "hello!"');
  });

  it('should not match incomplete brackets', () => {
    const result = extractTTSMarkers('[tts:unclosed text');
    expect(result.cleaned).toBe('[tts:unclosed text');
    expect(result.ttsText).toBeNull();
  });

  it('should handle string that is only a marker', () => {
    const result = extractTTSMarkers('[tts:entire string]');
    expect(result.cleaned).toBe('');
    expect(result.ttsText).toBe('entire string');
  });
});

describe('migrateTTSProvider', () => {
  it('should migrate "qwen" to "replicate"', () => {
    expect(migrateTTSProvider('qwen')).toBe('replicate');
  });

  it('should keep "openai" as-is', () => {
    expect(migrateTTSProvider('openai')).toBe('openai');
  });

  it('should keep "replicate" as-is', () => {
    expect(migrateTTSProvider('replicate')).toBe('replicate');
  });

  it('should keep "edge" as-is', () => {
    expect(migrateTTSProvider('edge')).toBe('edge');
  });

  it('should keep "xiaomi" as-is', () => {
    expect(migrateTTSProvider('xiaomi')).toBe('xiaomi');
  });

  it('should default unknown values to "openai"', () => {
    expect(migrateTTSProvider('unknown')).toBe('openai');
    expect(migrateTTSProvider('')).toBe('openai');
  });
});

describe('useTTS and the UI sound volume', () => {
  afterEach(() => {
    setUiSoundVolume(1);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('speaks at full volume while UI sounds are set to 0', async () => {
    const played: Array<{ volume: number; muted: boolean }> = [];
    class FakeAudio extends EventTarget {
      volume = 1;
      muted = false;
      src: string;
      constructor(src: string) {
        super();
        this.src = src;
      }
      play() {
        played.push({ volume: this.volume, muted: this.muted });
        return Promise.resolve();
      }
      pause() {}
    }
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: new Headers({ 'Content-Type': 'audio/mpeg' }),
    })));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:tts');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    setUiSoundVolume(0);
    const { result } = renderHook(() => useTTS(true, 'edge'));
    await act(() => result.current.speak('Task complete'));

    expect(played).toEqual([{ volume: 1, muted: false }]);
  });
});
