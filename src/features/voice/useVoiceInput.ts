import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { buildPrimaryWakePhrase, buildStopPhrasesRegex } from '@/lib/constants';
import { playWakePing, playSubmitPing, playCancelPing, ensureAudioContext } from './audio-feedback';
import type { STTInputMode } from '@/contexts/SettingsContext';

// ─── Phrases from server config ──────────────────────────────────────────────

interface VoicePhrases {
  stopPhrases: string[];
  cancelPhrases: string[];
  wakePhrases?: string[];
}

const DEFAULT_PHRASES: VoicePhrases = {
  stopPhrases: ["boom", "i'm done", "im done", "all right i'm done", "alright i'm done", "that's it", "thats it", "send it", "done"],
  cancelPhrases: ['cancel', 'never mind', 'nevermind'],
};

let phrasesCache: { lang: string; phrases: VoicePhrases } | null = null;

/** Fetch effective voice phrases for the given language (no English merge). */
async function fetchVoicePhrases(lang?: string): Promise<VoicePhrases> {
  const effectiveLang = lang || 'en';
  if (phrasesCache && phrasesCache.lang === effectiveLang) return phrasesCache.phrases;
  try {
    const resp = await fetch(`/api/voice-phrases?lang=${effectiveLang}`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return DEFAULT_PHRASES;
    const data = await resp.json();
    const phrases: VoicePhrases = {
      stopPhrases: Array.isArray(data.stopPhrases) ? data.stopPhrases : DEFAULT_PHRASES.stopPhrases,
      cancelPhrases: Array.isArray(data.cancelPhrases) ? data.cancelPhrases : DEFAULT_PHRASES.cancelPhrases,
      wakePhrases: Array.isArray(data.wakePhrases) ? data.wakePhrases : undefined,
    };
    phrasesCache = { lang: effectiveLang, phrases };
    return phrases;
  } catch {
    return DEFAULT_PHRASES;
  }
}

/** Invalidate the phrase cache (call when language changes). */
export function invalidatePhrasesCache(): void {
  phrasesCache = null;
}

const WAKE_WORD_KEY = 'nerve:wakeWordEnabled';

/** Get SpeechRecognition constructor with webkit prefix fallback. */
function getSpeechRecognition(): SpeechRecognitionConstructor | undefined {
  const w = window as WindowWithSpeechRecognition;
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}

export type VoiceState = 'idle' | 'listening' | 'recording' | 'transcribing';

function normalizeForMatch(text: string, language: string): string {
  const normalized = (text || '')
    .normalize('NFKC')
    .replace(/[’`´]/g, "'")
    .replace(/[.,!?،؟。！？؛…]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return '';

  const code = (language || '').trim();
  if (code) {
    try {
      return normalized.toLocaleLowerCase(code);
    } catch {
      // Fall back to default lowercasing below.
    }
  }

  return normalized.toLowerCase();
}

function matchesPhrase(transcript: string, phrases: string[], language: string): boolean {
  const normalizedTranscript = normalizeForMatch(transcript, language);
  if (!normalizedTranscript) return false;

  return phrases.some((phrase) => {
    const normalizedPhrase = normalizeForMatch(phrase, language);
    return normalizedPhrase.length > 0 && normalizedTranscript.includes(normalizedPhrase);
  });
}

function cleanTranscript(text: string, stopPhrasesRegex: RegExp): string {
  return (text || '').trim().replace(stopPhrasesRegex, '').trim();
}

/**
 * Hook that manages voice input via the Web Speech API and MediaRecorder.
 *
 * Supports wake-word activation, stop/cancel phrases, and double-tap left-Shift
 * as a keyboard shortcut. Audio is recorded as WebM/Opus and sent to
 * `/api/transcribe` for server-side speech-to-text.
 *
 * @param onTranscription - Callback invoked with the cleaned transcription text.
 * @param agentName - Agent display name used to build dynamic wake phrases.
 * @param language - Active language code used for recognition and phrase matching.
 * @param phrasesVersion - Incrementing token to force phrase reloads after config edits.
 * @param sttInputMode - Finalization strategy for browser vs backend transcription.
 */
/** Map ISO 639-1 language code to BCP-47 locale for Web Speech API. */
export const LANG_TO_BCP47: Record<string, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  hi: 'hi-IN',
  es: 'es-ES',
  fr: 'fr-FR',
  ar: 'ar-SA',
  bn: 'bn-IN',
  pt: 'pt-BR',
  ru: 'ru-RU',
  ja: 'ja-JP',
  de: 'de-DE',
  tr: 'tr-TR',
};

/** Resolve UI language setting to a valid recognition locale. */
export function resolveRecognitionLang(language: string): string {
  const normalized = (language || '').trim().toLowerCase();

  if (!normalized || normalized === 'auto') {
    return LANG_TO_BCP47.en;
  }

  if (LANG_TO_BCP47[normalized]) {
    return LANG_TO_BCP47[normalized];
  }

  // Already a locale-like value (e.g. en-GB)
  if (language.includes('-')) {
    return language;
  }

  return LANG_TO_BCP47.en;
}

export function useVoiceInput(
  onTranscription: (text: string) => void,
  agentName: string = 'Agent',
  language: string = 'en',
  phrasesVersion: number = 0,
  sttInputMode: STTInputMode = 'hybrid',
) {
  const [state, setState] = useState<VoiceState>('idle');
  const stateRef = useRef<VoiceState>('idle');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const lastCapsTimeRef = useRef(0);
  const onTranscriptionRef = useRef(onTranscription);
  onTranscriptionRef.current = onTranscription;
  const sttInputModeRef = useRef(sttInputMode);
  sttInputModeRef.current = sttInputMode;

  // Single persistent recognition instance
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const wakeWordEnabledRef = useRef(false);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(() => {
    try { return localStorage.getItem(WAKE_WORD_KEY) === 'true'; } catch { return false; }
  });
  
  // Persist wake word state to localStorage
  useEffect(() => {
    try { localStorage.setItem(WAKE_WORD_KEY, String(wakeWordEnabled)); } catch { /* noop */ }
  }, [wakeWordEnabled]);

  // Single primary wake phrase based on agent name + selected language.
  const defaultWakePhrase = useMemo(() => buildPrimaryWakePhrase(agentName, language), [agentName, language]);

  // Phrases loaded from server config — refetch when language or phrase config changes
  const [phrases, setPhrases] = useState<VoicePhrases>(phrasesCache?.phrases || DEFAULT_PHRASES);
  useEffect(() => {
    invalidatePhrasesCache();
    fetchVoicePhrases(language).then(setPhrases);
  }, [language, phrasesVersion]);

  // Use a single wake phrase per language (custom phrase wins over generated default).
  const wakePhrases = useMemo(() => {
    const primaryWake = buildPrimaryWakePhrase(agentName, language, phrases.wakePhrases);
    return primaryWake ? [primaryWake] : [defaultWakePhrase];
  }, [agentName, language, phrases.wakePhrases, defaultWakePhrase]);

  const stopPhrasesRegex = useMemo(
    () => buildStopPhrasesRegex(agentName, {
      language,
      stopPhrases: phrases.stopPhrases,
      cancelPhrases: phrases.cancelPhrases,
      wakePhrases,
    }),
    [agentName, language, phrases.cancelPhrases, phrases.stopPhrases, wakePhrases],
  );
  // Refs to access current values in callbacks without stale closures
  // (event handlers are set up once but need fresh phrase values)
  const wakePhrasesRef = useRef(wakePhrases);
  wakePhrasesRef.current = wakePhrases;
  const stopPhrasesRegexRef = useRef(stopPhrasesRegex);
  stopPhrasesRegexRef.current = stopPhrasesRegex;
  const phrasesRef = useRef(phrases);
  phrasesRef.current = phrases;
  const languageRef = useRef(language);
  languageRef.current = language;
  const wakeTriggeredRef = useRef(false);
  const browserTranscriptRef = useRef('');
  // Track intentional stops to avoid restart loops
  const intentionalStopRef = useRef(false);
  // Mode: 'wake' = listening for wake word, 'stop' = listening for stop/cancel phrases
  const modeRef = useRef<'wake' | 'stop'>('wake');
  // Track pending timeouts for cleanup
  const pendingTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const setVoiceState = useCallback((s: VoiceState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  const trackedTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      pendingTimersRef.current.delete(id);
      fn();
    }, ms);
    pendingTimersRef.current.add(id);
    return id;
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const resetBrowserTranscript = useCallback(() => {
    browserTranscriptRef.current = '';
  }, []);

  // Start or restart the single recognition instance
  const ensureRecognition = useCallback((mode: 'wake' | 'stop') => {
    modeRef.current = mode;

    // If we already have a running instance, abort it first
    if (recognitionRef.current) {
      intentionalStopRef.current = true;
      try { recognitionRef.current.abort(); } catch { /* already stopped */ }
      recognitionRef.current = null;
    }

    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      console.warn('[VOICE] SpeechRecognition not available');
      if (mode === 'wake') {
        wakeWordEnabledRef.current = false;
        setWakeWordEnabled(false);
        if (stateRef.current === 'listening') {
          setVoiceState('idle');
        }
      }
      return;
    }

    // Small delay to let the previous instance fully release
    trackedTimeout(() => {
      // Re-check state — might have changed during the delay
      if (mode === 'wake' && !wakeWordEnabledRef.current) return;
      if (mode === 'stop' && stateRef.current !== 'recording') return;

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = resolveRecognitionLang(languageRef.current);
      recognitionRef.current = recognition;
      intentionalStopRef.current = false;

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const currentMode = modeRef.current;
        if (currentMode === 'stop') {
          let full = '';
          for (let j = 0; j < event.results.length; j++) {
            full += event.results[j][0].transcript;
          }
          const cleaned = cleanTranscript(full, stopPhrasesRegexRef.current);
          browserTranscriptRef.current = cleaned;
          setInterimTranscript(cleaned);
        }

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (currentMode === 'stop') {
            if (matchesPhrase(transcript, phrasesRef.current.cancelPhrases, languageRef.current)) {
              playCancelPing();
              doDiscard();
              return;
            }
            if (matchesPhrase(transcript, phrasesRef.current.stopPhrases, languageRef.current)) {
              playSubmitPing();
              doStopAndTranscribe();
              return;
            }
          } else if (currentMode === 'wake') {
            if (matchesPhrase(transcript, wakePhrasesRef.current, languageRef.current)) {
              // Guard against double-trigger from interim + final results
              if (wakeTriggeredRef.current) return;
              wakeTriggeredRef.current = true;
              // Stop recognition immediately — no longer needed and it uses the audio pipeline
              intentionalStopRef.current = true;
              try { recognitionRef.current?.abort(); } catch { /* already stopped */ }
              recognitionRef.current = null;
              playWakePing();
              // Delay mic acquisition until wake chime finishes (~0.75s)
              trackedTimeout(() => doStartRecording(), 800);
              return;
            }
          }
        }
      };

      recognition.onerror = (event: { error: string }) => {
        console.warn('[VOICE] error:', event.error, 'mode:', modeRef.current, 'intentional:', intentionalStopRef.current);
        if (intentionalStopRef.current) return;
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') return;
        if (event.error === 'aborted') return;
        // Transient error — restart
        scheduleRestart();
      };

      recognition.onend = () => {
        console.debug('[VOICE] onend, mode:', modeRef.current, 'intentional:', intentionalStopRef.current, 'state:', stateRef.current);
        if (intentionalStopRef.current) return;
        // Unexpected end — restart
        scheduleRestart();
      };

      try {
        recognition.start();
        console.debug('[VOICE] started in mode:', mode);
      } catch (e) {
        console.warn('[VOICE] failed to start:', e);
        // Try again after a delay
        trackedTimeout(() => {
          if (wakeWordEnabledRef.current || stateRef.current === 'recording') {
            ensureRecognitionRef.current(modeRef.current);
          }
        }, 2000);
      }
    }, 200);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable, deps are intentionally minimal to avoid recreation
  }, [trackedTimeout]);

  const ensureRecognitionRef = useRef(ensureRecognition);
  ensureRecognitionRef.current = ensureRecognition;

  const scheduleRestart = useCallback(() => {
    const mode = modeRef.current;
    const delay = 500;
    console.debug('[VOICE] scheduling restart in', delay, 'ms, mode:', mode, 'state:', stateRef.current);
    trackedTimeout(() => {
      if (mode === 'wake' && wakeWordEnabledRef.current && (stateRef.current === 'listening' || stateRef.current === 'idle')) {
        stateRef.current = 'listening';
        setState('listening');
        ensureRecognitionRef.current('wake');
      } else if (mode === 'stop' && stateRef.current === 'recording' && wakeTriggeredRef.current) {
        ensureRecognitionRef.current('stop');
      }
    }, delay);
  }, [trackedTimeout]);

  // Action functions that use refs to avoid stale closures
  const doStartRecording = useCallback(async () => {
    // Initialize AudioContext on user interaction
    ensureAudioContext();
    // Stop recognition intentionally — we'll restart in stop mode after recording starts
    intentionalStopRef.current = true;
    try { recognitionRef.current?.abort(); } catch { /* already stopped */ }
    recognitionRef.current = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      resetBrowserTranscript();
      setInterimTranscript('');
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start();
      setError(null);
      setVoiceState('recording');
      // Now start listening for stop phrases
      ensureRecognitionRef.current('stop');
    } catch (err) {
      console.error('Mic access denied:', err);
      const msg = err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Microphone permission denied'
        : 'Failed to access microphone';
      setError(msg);
      if (wakeWordEnabledRef.current) {
        setVoiceState('listening');
        ensureRecognitionRef.current('wake');
      }
    }
  }, [resetBrowserTranscript, setVoiceState]);

  const doDiscard = useCallback(() => {
    setInterimTranscript('');
    resetBrowserTranscript();
    wakeTriggeredRef.current = false;
    intentionalStopRef.current = true;
    try { recognitionRef.current?.abort(); } catch { /* already stopped */ }
    recognitionRef.current = null;

    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    stopStream();
    if (wakeWordEnabledRef.current) {
      setVoiceState('listening');
      ensureRecognitionRef.current('wake');
    } else {
      setVoiceState('idle');
    }
  }, [resetBrowserTranscript, stopStream, setVoiceState]);

  const transcribeWithBackend = useCallback(async (blob: Blob) => {
    const fd = new FormData();
    fd.append('file', blob, 'audio.webm');
    const resp = await fetch('/api/transcribe', { method: 'POST', body: fd, credentials: 'include' });
    if (!resp.ok) throw new Error(await resp.text());
    const { text } = await resp.json();
    return cleanTranscript(text || '', stopPhrasesRegexRef.current);
  }, []);

  const waitForBrowserTranscript = useCallback(async (timeoutMs = 350, stepMs = 25) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const current = browserTranscriptRef.current.trim();
      if (current) return current;
      await new Promise((resolve) => setTimeout(resolve, stepMs));
    }
    return browserTranscriptRef.current.trim();
  }, []);

  const doStopAndTranscribe = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state !== 'recording') return;
    setInterimTranscript('');
    wakeTriggeredRef.current = false;
    intentionalStopRef.current = true;
    try {
      recognitionRef.current?.stop();
    } catch {
      try { recognitionRef.current?.abort(); } catch { /* already stopped */ }
    }
    recognitionRef.current = null;

    setVoiceState('transcribing');
    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      stopStream();
      try {
        const browserRecognitionSupported = Boolean(getSpeechRecognition());
        let browserTranscript = browserTranscriptRef.current.trim();
        let cleaned = '';

        if (sttInputModeRef.current === 'local') {
          cleaned = await transcribeWithBackend(blob);
        } else {
          if (!browserTranscript) {
            browserTranscript = await waitForBrowserTranscript();
          }

          if (browserTranscript) {
            cleaned = browserTranscript;
          } else if (sttInputModeRef.current === 'hybrid' || !browserRecognitionSupported) {
            cleaned = await transcribeWithBackend(blob);
          } else {
            throw new Error('Browser speech recognition did not produce a transcript');
          }
        }

        if (cleaned) onTranscriptionRef.current(cleaned);
        setError(null);
      } catch (err) {
        console.error('Transcription failed:', err);
        setError(`Transcription failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        resetBrowserTranscript();
      }
      // Resume wake word listener
      if (wakeWordEnabledRef.current) {
        setVoiceState('listening');
        ensureRecognitionRef.current('wake');
      } else {
        setVoiceState('idle');
      }
    };
    mr.stop();
  }, [resetBrowserTranscript, stopStream, setVoiceState, transcribeWithBackend, waitForBrowserTranscript]);

  const startWakeWordListener = useCallback(() => {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      console.warn('[VOICE] SpeechRecognition not available');
      wakeWordEnabledRef.current = false;
      setWakeWordEnabled(false);
      setVoiceState('idle');
      setError('Speech recognition is not supported in this browser');
      return;
    }
    // Initialize AudioContext on user interaction
    ensureAudioContext();
    wakeWordEnabledRef.current = true;
    setWakeWordEnabled(true);
    setVoiceState('listening');
    ensureRecognitionRef.current('wake');
  }, [setVoiceState]);

  const stopWakeWordListener = useCallback(() => {
    wakeWordEnabledRef.current = false;
    setWakeWordEnabled(false);
    intentionalStopRef.current = true;
    try { recognitionRef.current?.abort(); } catch { /* already stopped */ }
    recognitionRef.current = null;
    if (stateRef.current === 'listening') {
      setVoiceState('idle');
    }
  }, [setVoiceState]);

  const toggleWakeWord = useCallback(() => {
    if (wakeWordEnabledRef.current) stopWakeWordListener();
    else startWakeWordListener();
  }, [startWakeWordListener, stopWakeWordListener]);

  // Restart recognition when language changes (so Web Speech API uses new locale)
  useEffect(() => {
    if (wakeWordEnabledRef.current && stateRef.current === 'listening') {
      ensureRecognitionRef.current('wake');
    }
  }, [language]);

  // Auto-start wake word listener if persisted as enabled (only if mic already granted)
  const startWakeWordRef = useRef(startWakeWordListener);
  startWakeWordRef.current = startWakeWordListener;
  useEffect(() => {
    if (!wakeWordEnabled || wakeWordEnabledRef.current) return;
    // Only auto-start if mic permission was previously granted (avoid surprise prompts)
    navigator.permissions?.query({ name: 'microphone' as PermissionName }).then((result) => {
      if (result.state === 'granted') {
        startWakeWordRef.current();
      } else {
        // Permission not granted — clear persisted state so toggle shows off
        try { localStorage.removeItem(WAKE_WORD_KEY); } catch { /* noop */ }
      }
    }).catch(() => {
      // Permissions API not available — try starting anyway (user interaction required)
      startWakeWordRef.current();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // Double-tap left Shift support
  const startRef = useRef(doStartRecording);
  const discardRef = useRef(doDiscard);
  const stopRef = useRef(doStopAndTranscribe);
  startRef.current = doStartRecording;
  discardRef.current = doDiscard;
  stopRef.current = doStopAndTranscribe;

  useEffect(() => {
    let shiftDownAlone = false;
    const keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && e.location === 1) {
        shiftDownAlone = true;
      } else {
        shiftDownAlone = false;
      }
    };
    const keyupHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' || e.location !== 1 || !shiftDownAlone) return;
      shiftDownAlone = false;
      const now = Date.now();
      const isDouble = (now - lastCapsTimeRef.current) < 300;
      lastCapsTimeRef.current = now;

      if (isDouble) {
        if (stateRef.current === 'recording') {
          discardRef.current();
        } else if (stateRef.current === 'idle' || stateRef.current === 'listening') {
          startRef.current();
        }
      } else {
        if (stateRef.current === 'recording') {
          trackedTimeout(() => {
            if (Date.now() - lastCapsTimeRef.current >= 290) {
              stopRef.current();
            }
          }, 300);
        }
      }
    };

    window.addEventListener('keydown', keydownHandler);
    window.addEventListener('keyup', keyupHandler);
    return () => {
      window.removeEventListener('keydown', keydownHandler);
      window.removeEventListener('keyup', keyupHandler);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only effect, trackedTimeout is stable ref-based
  }, []);

  useEffect(() => {
    const timers = pendingTimersRef.current;
    return () => {
      // Clear all pending timers
      for (const id of timers) clearTimeout(id);
      timers.clear();
      wakeWordEnabledRef.current = false;
      intentionalStopRef.current = true;
      try { recognitionRef.current?.abort(); } catch { /* already stopped */ }
      recognitionRef.current = null;
      if (mediaRecorderRef.current?.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch { /* already stopped */ }
      }
      stopStream();
    };
  }, [stopStream]);

  return {
    voiceState: state,
    interimTranscript,
    startRecording: doStartRecording,
    stopAndTranscribe: doStopAndTranscribe,
    discardRecording: doDiscard,
    wakeWordEnabled,
    toggleWakeWord,
    startWakeWordListener,
    stopWakeWordListener,
    error,
    clearError,
  };
}
