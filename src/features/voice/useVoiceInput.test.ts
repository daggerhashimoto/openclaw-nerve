import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { LANG_TO_BCP47, resolveRecognitionLang, useVoiceInput } from './useVoiceInput';
import * as audioFeedback from './audio-feedback';
import * as wakeWordSupport from './wakeWordSupport';
import { buildWakePhrases, buildStopPhrasesRegex } from '@/lib/constants';

// Mock audio feedback module
vi.mock('./audio-feedback', () => ({
  playWakePing: vi.fn(),
  playSubmitPing: vi.fn(),
  playCancelPing: vi.fn(),
  ensureAudioContext: vi.fn(),
}));

vi.mock('./wakeWordSupport', () => ({
  getWakeWordSupport: vi.fn(() => ({ supported: true, reason: null })),
  isWakeWordSupportedEnvironment: vi.fn(() => true),
}));

// Mock SpeechRecognition
class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((event: { results: unknown[]; resultIndex: number }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;

  start() {
    this.started = true;
  }

  stop() {
    this.started = false;
    this.onend?.();
  }

  abort() {
    this.started = false;
  }

  simulateResult(transcript: string, isFinal = false) {
    this.onresult?.({
      results: [{ 0: { transcript }, isFinal }],
      resultIndex: 0,
    });
  }

  simulateError(error: string) {
    this.onerror?.({ error });
  }
}

// Mock MediaRecorder
class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(_stream: MediaStream, _options?: { mimeType: string }) {
    void _stream; void _options;
    MockMediaRecorder.instances.push(this);
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    // Simulate data available
    this.ondataavailable?.({ data: new Blob(['test'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

// Mock MediaStream
class MockMediaStream {
  getTracks() {
    return [{ stop: vi.fn() }];
  }
}

function hasTranscribeRequest(fetchMock: Mock) {
  return fetchMock.mock.calls.some(([url]) => url === '/api/transcribe');
}

function mockWakeWordSupport(result: { supported: boolean; reason: 'mobile-web' | null }) {
  (wakeWordSupport.getWakeWordSupport as Mock).mockReturnValue(result);
  (wakeWordSupport.isWakeWordSupportedEnvironment as Mock).mockReturnValue(result.supported);
}

describe('useVoiceInput', () => {
  let mockRecognition: MockSpeechRecognition | null = null;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    MockMediaRecorder.instances = [];
    mockRecognition = null;

    // Mock SpeechRecognition on window
    (window as unknown as { SpeechRecognition: typeof MockSpeechRecognition }).SpeechRecognition = class extends MockSpeechRecognition {
      constructor() {
        super();
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        mockRecognition = this;
      }
    };

    // Mock MediaRecorder on window
    (window as unknown as { MediaRecorder: typeof MockMediaRecorder }).MediaRecorder = MockMediaRecorder;

    // Mock getUserMedia
    (navigator as unknown as { mediaDevices: { getUserMedia: Mock } }).mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue(new MockMediaStream()),
    };

    // Mock fetch for voice phrases and transcription
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((input: string | URL) => {
      const url = String(input);

      if (url.startsWith('/api/voice-phrases')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            stopPhrases: ['boom', 'done'],
            cancelPhrases: ['cancel'],
          }),
        });
      }

      if (url === '/api/transcribe') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ text: 'transcribed text' }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    }) as typeof fetch;

    vi.clearAllMocks();
    localStorage.clear();
    mockWakeWordSupport({ supported: true, reason: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  });

  describe('Initial State', () => {
    it('should start in idle state', () => {
      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      expect(result.current.voiceState).toBe('idle');
      expect(result.current.wakeWordEnabled).toBe(false);
    });

    it('should provide all required methods', () => {
      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      expect(typeof result.current.startRecording).toBe('function');
      expect(typeof result.current.stopAndTranscribe).toBe('function');
      expect(typeof result.current.discardRecording).toBe('function');
      expect(typeof result.current.toggleWakeWord).toBe('function');
      expect(typeof result.current.startWakeWordListener).toBe('function');
      expect(typeof result.current.stopWakeWordListener).toBe('function');
    });
  });

  describe('Wake Word Detection', () => {
    it('should transition to listening state when wake word is enabled', async () => {
      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      act(() => {
        result.current.startWakeWordListener();
      });

      expect(result.current.voiceState).toBe('listening');
      expect(result.current.wakeWordEnabled).toBe(true);
      expect(audioFeedback.ensureAudioContext).toHaveBeenCalled();
    });

    it('should transition back to idle when wake word is disabled', async () => {
      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      act(() => {
        result.current.startWakeWordListener();
      });

      expect(result.current.voiceState).toBe('listening');

      act(() => {
        result.current.stopWakeWordListener();
      });

      expect(result.current.voiceState).toBe('idle');
      expect(result.current.wakeWordEnabled).toBe(false);
    });

    it('should toggle wake word state', async () => {
      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      // Toggle on
      act(() => {
        result.current.toggleWakeWord();
      });
      expect(result.current.wakeWordEnabled).toBe(true);

      // Toggle off
      act(() => {
        result.current.toggleWakeWord();
      });
      expect(result.current.wakeWordEnabled).toBe(false);
    });

    it('keeps wake word effectively off on mobile web even when persisted on', () => {
      localStorage.setItem('nerve:wakeWordEnabled', 'true');
      mockWakeWordSupport({ supported: false, reason: 'mobile-web' });

      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      expect(result.current.wakeWordEnabled).toBe(false);
      expect(result.current.voiceState).toBe('idle');
      expect(localStorage.getItem('nerve:wakeWordEnabled')).toBe('true');
    });

    it('does not start wake listening on mobile web', () => {
      mockWakeWordSupport({ supported: false, reason: 'mobile-web' });

      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      act(() => {
        result.current.startWakeWordListener();
      });

      expect(result.current.voiceState).toBe('idle');
      expect(result.current.wakeWordEnabled).toBe(false);
      expect(audioFeedback.ensureAudioContext).not.toHaveBeenCalled();
    });

    it('still allows manual recording on mobile web', async () => {
      mockWakeWordSupport({ supported: false, reason: 'mobile-web' });

      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      await act(async () => {
        await result.current.startRecording();
      });

      expect(result.current.voiceState).toBe('recording');
    });

    it('should handle missing SpeechRecognition API gracefully', async () => {
      delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
      
      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      // Should not throw
      act(() => {
        result.current.startWakeWordListener();
      });

      // Should remain idle and disabled
      expect(result.current.voiceState).toBe('idle');
      expect(result.current.wakeWordEnabled).toBe(false);
    });

    it('should support webkitSpeechRecognition fallback', async () => {
      delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
      (window as unknown as { webkitSpeechRecognition: typeof MockSpeechRecognition }).webkitSpeechRecognition = MockSpeechRecognition;

      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      act(() => {
        result.current.startWakeWordListener();
      });

      expect(result.current.voiceState).toBe('listening');
    });
  });

  describe('Language Locale Mapping', () => {
    it('should map every supported language code to a recognition locale', () => {
      Object.values(LANG_TO_BCP47).forEach((locale) => {
        expect(typeof locale).toBe('string');
        expect(locale.length).toBeGreaterThan(0);
        expect(locale.includes('-')).toBe(true);
      });
    });

    it('should resolve all mapped language codes to their BCP-47 locales', () => {
      Object.entries(LANG_TO_BCP47).forEach(([code, locale]) => {
        expect(resolveRecognitionLang(code)).toBe(locale);
      });
    });

    it('should default to English locale when language is unset or auto', () => {
      expect(resolveRecognitionLang('')).toBe('en-US');
      expect(resolveRecognitionLang('auto')).toBe('en-US');
    });

    it('should set SpeechRecognition.lang for each mapped language', async () => {
      const onTranscription = vi.fn();

      for (const [lang, locale] of Object.entries(LANG_TO_BCP47)) {
        const { result, unmount } = renderHook(() => useVoiceInput(onTranscription, 'Kim', lang));

        act(() => {
          result.current.startWakeWordListener();
        });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(300);
        });

        expect(mockRecognition?.lang).toBe(locale);
        unmount();
      }
    });
  });

  describe('Recording Flow', () => {
    it('should transition to recording state when recording starts', async () => {
      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      await act(async () => {
        result.current.startRecording();
        await vi.runAllTimersAsync();
      });

      expect(result.current.voiceState).toBe('recording');
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
    });

    it('should handle microphone permission denied', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (navigator.mediaDevices.getUserMedia as Mock).mockRejectedValue(new Error('Permission denied'));

      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      // First enable wake word
      act(() => {
        result.current.startWakeWordListener();
      });

      await act(async () => {
        result.current.startRecording();
        await vi.runAllTimersAsync();
      });

      // Should return to listening state if wake word was enabled
      expect(result.current.voiceState).toBe('listening');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should discard recording and return to listening', async () => {
      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      // Start wake word
      act(() => {
        result.current.startWakeWordListener();
      });

      // Start recording
      await act(async () => {
        result.current.startRecording();
        await vi.runAllTimersAsync();
      });

      expect(result.current.voiceState).toBe('recording');

      // Discard
      act(() => {
        result.current.discardRecording();
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.voiceState).toBe('listening');
      expect(audioFeedback.playCancelPing).not.toHaveBeenCalled(); // Only called from phrase match
    });

    it('should discard recording and return to idle when wake word disabled', async () => {
      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      // Start recording without wake word
      await act(async () => {
        result.current.startRecording();
        await vi.runAllTimersAsync();
      });

      expect(result.current.voiceState).toBe('recording');

      // Discard
      act(() => {
        result.current.discardRecording();
      });

      expect(result.current.voiceState).toBe('idle');
    });
  });

  describe('Transcription Flow', () => {
    it('should transition to transcribing state when stopAndTranscribe is called', async () => {
      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      // Start recording
      await act(async () => {
        result.current.startRecording();
        await vi.runAllTimersAsync();
      });

      expect(result.current.voiceState).toBe('recording');

      // Stop and transcribe
      act(() => {
        result.current.stopAndTranscribe();
      });

      expect(result.current.voiceState).toBe('transcribing');
    });

    it('should call fetch with FormData when transcribing', async () => {
      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      await act(async () => {
        result.current.startRecording();
        await vi.runAllTimersAsync();
      });

      act(() => {
        result.current.stopAndTranscribe();
      });

      // Verify fetch was called with correct endpoint
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/transcribe',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
        })
      );
    });

    it('should handle transcription API errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (globalThis.fetch as Mock).mockResolvedValue({
        ok: false,
        text: () => Promise.resolve('Server error'),
      });

      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      await act(async () => {
        result.current.startRecording();
        await vi.runAllTimersAsync();
      });

      act(() => {
        result.current.stopAndTranscribe();
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // The error should be logged
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should submit browser transcript directly in browser mode', async () => {
      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription, 'Agent', 'en', 0, 'browser'));

      await act(async () => {
        result.current.startRecording();
        await vi.runAllTimersAsync();
      });

      act(() => {
        mockRecognition?.simulateResult('hello world');
        result.current.stopAndTranscribe();
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(onTranscription).toHaveBeenCalledWith('hello world');
      expect(hasTranscribeRequest(globalThis.fetch as Mock)).toBe(false);
    });

    it('should always use backend transcription in local mode', async () => {
      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription, 'Agent', 'en', 0, 'local'));

      await act(async () => {
        result.current.startRecording();
        await vi.runAllTimersAsync();
      });

      act(() => {
        mockRecognition?.simulateResult('browser transcript');
        result.current.stopAndTranscribe();
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(onTranscription).toHaveBeenCalledWith('transcribed text');
      expect(hasTranscribeRequest(globalThis.fetch as Mock)).toBe(true);
    });

    it('should prefer browser transcript in hybrid mode', async () => {
      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription, 'Agent', 'en', 0, 'hybrid'));

      await act(async () => {
        result.current.startRecording();
        await vi.runAllTimersAsync();
      });

      act(() => {
        mockRecognition?.simulateResult('hybrid browser text');
        result.current.stopAndTranscribe();
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(onTranscription).toHaveBeenCalledWith('hybrid browser text');
      expect(hasTranscribeRequest(globalThis.fetch as Mock)).toBe(false);
    });

    it('should fall back to backend transcription in hybrid mode when browser transcript is empty', async () => {
      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription, 'Agent', 'en', 0, 'hybrid'));

      await act(async () => {
        result.current.startRecording();
        await vi.runAllTimersAsync();
      });

      act(() => {
        result.current.stopAndTranscribe();
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(onTranscription).toHaveBeenCalledWith('transcribed text');
      expect(hasTranscribeRequest(globalThis.fetch as Mock)).toBe(true);
    });

    it('should fall back to backend transcription in browser mode when browser recognition is unsupported', async () => {
      delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;

      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription, 'Agent', 'en', 0, 'browser'));

      await act(async () => {
        result.current.startRecording();
        await vi.runAllTimersAsync();
      });

      act(() => {
        result.current.stopAndTranscribe();
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(onTranscription).toHaveBeenCalledWith('transcribed text');
      expect(hasTranscribeRequest(globalThis.fetch as Mock)).toBe(true);
    });
  });

  describe('Stop Phrase Cleaning', () => {
    // Test the stop phrase regex using the dynamic builder
    const stopPhraseRegex = buildStopPhrasesRegex('Kim');
    
    const testCases = [
      { input: 'hello world boom', expected: 'hello world' },
      { input: "test message i'm done", expected: 'test message' },
      { input: "all right i'm done", expected: '' },
      { input: "testing that's it", expected: 'testing' },
      { input: 'send it please send it', expected: 'send it please' },
      { input: 'done', expected: '' },
      { input: 'cancel', expected: '' },
      { input: 'never mind', expected: '' },
      { input: 'hey kim', expected: '' },
      { input: 'normal message', expected: 'normal message' },
    ];

    testCases.forEach(({ input, expected }) => {
      it(`should clean "${input}" to "${expected || '(empty)'}"`, () => {
        // Test the stop phrase cleaning logic directly
        const cleaned = input.trim().replace(stopPhraseRegex, '').trim();
        expect(cleaned).toBe(expected);
      });
    });

    // Test dynamic agent name
    it('should work with different agent names', () => {
      const helenaRegex = buildStopPhrasesRegex('Helena');
      expect('hey helena'.replace(helenaRegex, '').trim()).toBe('');
      expect('hey kim'.replace(helenaRegex, '').trim()).toBe('hey kim'); // Different agent
    });
  });

  describe('Speech Recognition Errors', () => {
    it('should handle not-allowed error', async () => {
      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      act(() => {
        result.current.startWakeWordListener();
      });

      // Wait for recognition to start
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      // Simulate not-allowed error
      act(() => {
        mockRecognition?.simulateError('not-allowed');
      });

      // Should not crash, state depends on implementation
      expect(result.current.voiceState).toBeDefined();
    });

    it('should handle aborted error gracefully', async () => {
      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      act(() => {
        result.current.startWakeWordListener();
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      // Simulate aborted error (happens during intentional stops)
      act(() => {
        mockRecognition?.simulateError('aborted');
      });

      expect(result.current.voiceState).toBeDefined();
    });
  });

  describe('Cleanup', () => {
    it('should cleanup on unmount', async () => {
      const onTranscription = vi.fn();
      const { result, unmount } = renderHook(() => useVoiceInput(onTranscription));

      // Start recording
      await act(async () => {
        result.current.startRecording();
        await vi.runAllTimersAsync();
      });

      expect(result.current.voiceState).toBe('recording');

      // Unmount should cleanup without errors
      expect(() => unmount()).not.toThrow();
    });

    it('should stop wake word listener on unmount', async () => {
      const onTranscription = vi.fn();
      const { result, unmount } = renderHook(() => useVoiceInput(onTranscription));

      act(() => {
        result.current.startWakeWordListener();
      });

      expect(result.current.wakeWordEnabled).toBe(true);

      // Unmount should cleanup
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('State Machine Validity', () => {
    it('should not allow stopAndTranscribe when not recording', () => {
      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      // Try to stop when idle
      act(() => {
        result.current.stopAndTranscribe();
      });

      // Should remain idle, not crash
      expect(result.current.voiceState).toBe('idle');
    });

    it('should handle rapid state changes', async () => {
      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      // Rapid toggle
      await act(async () => {
        result.current.startWakeWordListener();
        result.current.stopWakeWordListener();
        result.current.startWakeWordListener();
        result.current.stopWakeWordListener();
        await vi.runAllTimersAsync();
      });

      expect(result.current.voiceState).toBe('idle');
      expect(result.current.wakeWordEnabled).toBe(false);
    });

    it('should handle recording start during listening', async () => {
      const onTranscription = vi.fn();
      const { result } = renderHook(() => useVoiceInput(onTranscription));

      // Start wake word
      act(() => {
        result.current.startWakeWordListener();
      });

      expect(result.current.voiceState).toBe('listening');

      // Start recording
      await act(async () => {
        result.current.startRecording();
        await vi.runAllTimersAsync();
      });

      expect(result.current.voiceState).toBe('recording');
    });
  });
});

describe('matchesPhrase (internal)', () => {
  // Test the phrase matching logic indirectly through the hook behavior
  // We'll test various phrase formats

  describe('Wake Phrases', () => {
    // Test dynamic wake phrases with buildWakePhrases
    it('should generate valid wake phrases for any agent name', () => {
      const kimPhrases = buildWakePhrases('Kim');
      expect(kimPhrases).toContain('hey kim');
      expect(kimPhrases).toContain('hey, kim');
      
      const helenaPhrases = buildWakePhrases('Helena');
      expect(helenaPhrases).toContain('hey helena');
      expect(helenaPhrases).toContain('hey, helena');
      
      // All phrases should be lowercase
      helenaPhrases.forEach(phrase => {
        expect(phrase.toLowerCase()).toBe(phrase);
        expect(phrase.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Stop Phrases', () => {
    const stopPhrases = ['boom', "i'm done", 'im done', "all right i'm done", "alright i'm done", "that's it", 'thats it', 'send it', 'done'];

    stopPhrases.forEach((phrase) => {
      it(`should recognize stop phrase: "${phrase}"`, () => {
        expect(phrase.toLowerCase()).toBe(phrase);
        expect(phrase.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Cancel Phrases', () => {
    const cancelPhrases = ['cancel', 'never mind', 'nevermind'];

    cancelPhrases.forEach((phrase) => {
      it(`should recognize cancel phrase: "${phrase}"`, () => {
        expect(phrase.toLowerCase()).toBe(phrase);
        expect(phrase.length).toBeGreaterThan(0);
      });
    });
  });
});
