import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { extractTTSMarkers, migrateTTSProvider, splitTTSChunks, useTTS } from './useTTS';
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

  it('hides an incomplete streaming marker without speaking it yet', () => {
    const result = extractTTSMarkers('[tts:unclosed text');
    expect(result.cleaned).toBe('');
    expect(result.ttsText).toBeNull();
  });

  it('hides an unfinished long marker while preserving preceding reply text', () => {
    const result = extractTTSMarkers('Story text.\n\n[tts:Story text and more');
    expect(result.cleaned).toBe('Story text.');
    expect(result.ttsText).toBeNull();
  });

  it('should handle string that is only a marker', () => {
    const result = extractTTSMarkers('[tts:entire string]');
    expect(result.cleaned).toBe('');
    expect(result.ttsText).toBe('entire string');
  });
});

describe('splitTTSChunks', () => {
  it('splits a long reply into complete, request-sized pieces', () => {
    const story = Array.from({ length: 120 }, (_, i) => `Sentence ${i} has enough words to be read aloud.`).join(' ');
    const chunks = splitTTSChunks(story);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => chunk.length > 0 && chunk.length <= 800)).toBe(true);
    expect(chunks.join(' ')).toBe(story);
  });

  it('handles an unbroken string without looping or exceeding the request size', () => {
    const chunks = splitTTSChunks('x'.repeat(1700));
    expect(chunks.map(chunk => chunk.length)).toEqual([800, 800, 100]);
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

  it('plays a long reply in order and fetches each chunk under the endpoint limit', async () => {
    const players: FakeAudio[] = [];
    class FakeAudio extends EventTarget {
      src: string;
      constructor(src: string) {
        super();
        this.src = src;
        players.push(this);
      }
      play = vi.fn(() => Promise.resolve());
      pause = vi.fn();
    }
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: new Headers({ 'Content-Type': 'audio/mpeg' }),
    }));
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:tts');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const story = Array.from({ length: 50 }, (_, i) => `Sentence ${i} is spoken in order.`).join(' ');
    const expected = splitTTSChunks(story);
    const { result } = renderHook(() => useTTS(true, 'openai'));
    await act(() => result.current.speak(story));
    for (let i = 1; i < expected.length; i++) {
      await act(async () => { players[i - 1].dispatchEvent(new Event('ended')); });
      await waitFor(() => expect(players).toHaveLength(i + 1));
    }
    const requested = fetchMock.mock.calls.map(([, options]) =>
      JSON.parse((options as RequestInit).body as string).text as string);
    expect(requested).toEqual(expected);
    expect(players.every(player => player.play.mock.calls.length === 1)).toBe(true);
  });

  it('does not continue an old reply after a newer utterance starts', async () => {
    const players: FakeAudio[] = [];
    class FakeAudio extends EventTarget {
      src: string;
      constructor(src: string) {
        super();
        this.src = src;
        players.push(this);
      }
      play = vi.fn(() => Promise.resolve());
      pause = vi.fn();
    }
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: new Headers({ 'Content-Type': 'audio/mpeg' }),
    }));
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:tts');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const { result } = renderHook(() => useTTS(true, 'openai'));
    await act(() => result.current.speak('Old sentence. '.repeat(100)));
    await act(() => result.current.speak('New answer.'));
    const count = players.length;
    await act(async () => { players[0].dispatchEvent(new Event('ended')); });
    expect(players).toHaveLength(count);
    expect(players[0].pause).toHaveBeenCalled();
  });
});
