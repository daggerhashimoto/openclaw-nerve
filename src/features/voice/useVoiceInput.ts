import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { buildPrimaryWakePhrase, buildStopPhrasesRegex } from '@/lib/constants';
import { playWakePing, playSubmitPing, playCancelPing, ensureAudioContext } from './audio-feedback';
import type { STTInputMode } from '@/contexts/SettingsContext';
import { getWakeWordSupport } from './wakeWordSupport';
import { matchesCoarsePointer } from './coarsePointer';

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

export interface RecorderMimeOption {
  /** MIME type passed to the MediaRecorder constructor. */
  mimeType: string;
  /** Base MIME type attached to the recorded Blob (accepted by /api/transcribe). */
  blobType: string;
  /** File extension used for the multipart upload. */
  extension: string;
}

/**
 * Candidate recording formats, most preferred first.
 *
 * Chrome/Firefox record WebM/Opus. iOS Safari's MediaRecorder does not support
 * WebM at all and records MP4/AAC instead, so WebM must never be assumed.
 */
export const RECORDER_MIME_OPTIONS: readonly RecorderMimeOption[] = [
  { mimeType: 'audio/webm;codecs=opus', blobType: 'audio/webm', extension: 'webm' },
  { mimeType: 'audio/webm', blobType: 'audio/webm', extension: 'webm' },
  { mimeType: 'audio/mp4', blobType: 'audio/mp4', extension: 'mp4' },
  { mimeType: 'audio/m4a', blobType: 'audio/m4a', extension: 'm4a' },
  { mimeType: 'audio/ogg;codecs=opus', blobType: 'audio/ogg', extension: 'ogg' },
];

const AUDIO_MIME_EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/m4a': 'm4a',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
};

/** Strip codec parameters so the Blob type matches the server's allow-list. */
export function normalizeAudioMimeType(mimeType: string): string {
  const base = (mimeType || '').split(';')[0].trim().toLowerCase();
  return base || 'audio/webm';
}

/**
 * Pick the best recording format this browser supports.
 *
 * Returns null when the browser exposes no `isTypeSupported`; callers then
 * construct MediaRecorder without options and read `recorder.mimeType` instead.
 */
export function pickRecorderMimeOption(
  isTypeSupported?: (type: string) => boolean,
): RecorderMimeOption | null {
  let supports = isTypeSupported;
  if (!supports) {
    const Ctor = typeof window === 'undefined' ? undefined : window.MediaRecorder;
    if (!Ctor || typeof Ctor.isTypeSupported !== 'function') return null;
    supports = (type) => Ctor.isTypeSupported(type);
  }

  for (const option of RECORDER_MIME_OPTIONS) {
    try {
      if (supports(option.mimeType)) return option;
    } catch {
      // Keep checking the remaining candidates.
    }
  }
  return null;
}

/** Turn getUserMedia/MediaRecorder failures into an actionable message. */
export function describeMicrophoneError(err: unknown): string {
  const name = err instanceof DOMException
    ? err.name
    : (typeof err === 'object' && err !== null && 'name' in err
      ? String((err as { name?: unknown }).name ?? '')
      : '');

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Microphone access was blocked. Allow microphone access for this site in your browser settings, then tap the mic again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found. Connect a microphone and try again.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The microphone is in use by another app. Close it and try again.';
    case 'OverconstrainedError':
      return 'The available microphone does not support the requested audio settings.';
    default:
      return 'Could not start recording. Check microphone access and try again.';
  }
}

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
  const [isStarting, setIsStarting] = useState(false);
  const isStartingRef = useRef(false);
  const disposedRef = useRef(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingMetaRef = useRef<{ blobType: string; extension: string }>({ blobType: 'audio/webm', extension: 'webm' });
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const lastCapsTimeRef = useRef(0);
  const onTranscriptionRef = useRef(onTranscription);
  onTranscriptionRef.current = onTranscription;
  const sttInputModeRef = useRef(sttInputMode);
  sttInputModeRef.current = sttInputMode;

  // Single persistent recognition instance
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const recognitionStartTokenRef = useRef(0);
  const wakeWordSupport = useMemo(() => getWakeWordSupport(), []);
  const wakeWordSupported = wakeWordSupport.supported;
  const [storedWakeWordEnabled, setStoredWakeWordEnabled] = useState(() => {
    try { return localStorage.getItem(WAKE_WORD_KEY) === 'true'; } catch { return false; }
  });
  const wakeWordEnabled = wakeWordSupported ? storedWakeWordEnabled : false;
  const wakeWordEnabledRef = useRef(wakeWordEnabled);

  useEffect(() => {
    wakeWordEnabledRef.current = wakeWordEnabled;
  }, [wakeWordEnabled]);

  // Persist raw desktop preference to localStorage without mutating it on unsupported mobile web.
  useEffect(() => {
    try { localStorage.setItem(WAKE_WORD_KEY, String(storedWakeWordEnabled)); } catch { /* noop */ }
  }, [storedWakeWordEnabled]);

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
    const startToken = ++recognitionStartTokenRef.current;

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
        setStoredWakeWordEnabled(false);
        if (stateRef.current === 'listening') {
          setVoiceState('idle');
        }
      }
      return;
    }

    // Small delay to let the previous instance fully release
    trackedTimeout(() => {
      // Re-check state — might have changed during the delay
      if (startToken !== recognitionStartTokenRef.current) return;
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
              // Delay mic acquisition until wake chime finishes (~0.35s)
              trackedTimeout(() => doStartRecording(), 370);
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
    if (stateRef.current === 'recording' || stateRef.current === 'transcribing' || isStartingRef.current) return;
    setError(null);

    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      setError('Voice input needs a secure HTTPS connection. Open Nerve over HTTPS and try again.');
      return;
    }

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      setError('Voice input is not available in this browser. Try Safari on iOS or Chrome on Android.');
      return;
    }

    const MediaRecorderCtor = typeof window === 'undefined' ? undefined : window.MediaRecorder;
    if (!MediaRecorderCtor) {
      setError('This browser cannot record audio. Update Safari (iOS 14.3+) or Chrome and try again.');
      return;
    }

    // Initialize AudioContext on user interaction
    ensureAudioContext();
    // Stop recognition intentionally — we'll restart in stop mode after recording starts
    recognitionStartTokenRef.current += 1;
    intentionalStopRef.current = true;
    try { recognitionRef.current?.abort(); } catch { /* already stopped */ }
    recognitionRef.current = null;

    isStartingRef.current = true;
    setIsStarting(true);
    let stream: MediaStream | null = null;

    try {
      stream = await mediaDevices.getUserMedia({ audio: true });
      if (disposedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      chunksRef.current = [];
      resetBrowserTranscript();
      setInterimTranscript('');

      // iOS Safari records MP4/AAC; Chrome records WebM/Opus. Never assume WebM.
      const option = pickRecorderMimeOption();
      let mr: MediaRecorder | null = null;
      if (option) {
        try {
          mr = new MediaRecorderCtor(stream, { mimeType: option.mimeType });
        } catch {
          mr = null;
        }
      }
      if (!mr) {
        try {
          mr = new MediaRecorderCtor(stream);
        } catch {
          mr = null;
        }
      }

      if (!mr) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setError('This browser cannot record audio. Update Safari (iOS 14.3+) or Chrome and try again.');
        return;
      }

      const actualMime = normalizeAudioMimeType(mr.mimeType || option?.blobType || 'audio/webm');
      recordingMetaRef.current = {
        blobType: actualMime,
        extension: AUDIO_MIME_EXTENSIONS[actualMime] || option?.extension || 'webm',
      };

      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start();
      setError(null);
      setVoiceState('recording');
      // Stop-phrase recognition shares the microphone. On iOS Safari the
      // recorder produces MP4; starting Web Speech there can steal the audio
      // pipeline, so let the tap-to-stop flow own the recording and rely on the
      // server transcript. WebM recorders (Android Chrome) keep live interim text.
      if (!matchesCoarsePointer() || recordingMetaRef.current.blobType === 'audio/webm') {
        ensureRecognitionRef.current('stop');
      }
    } catch (err) {
      console.error('Mic access denied:', err);
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      mediaRecorderRef.current = null;
      setVoiceState(wakeWordEnabledRef.current ? 'listening' : 'idle');
      setError(describeMicrophoneError(err));
      if (wakeWordEnabledRef.current) {
        ensureRecognitionRef.current('wake');
      }
    } finally {
      isStartingRef.current = false;
      setIsStarting(false);
    }
  }, [resetBrowserTranscript, setVoiceState]);

  const doDiscard = useCallback(() => {
    setInterimTranscript('');
    resetBrowserTranscript();
    wakeTriggeredRef.current = false;
    recognitionStartTokenRef.current += 1;
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

  const transcribeWithBackend = useCallback(async (blob: Blob, filename = 'audio.webm') => {
    const fd = new FormData();
    fd.append('file', blob, filename);
    const resp = await fetch('/api/transcribe', { method: 'POST', body: fd, credentials: 'include' });
    if (!resp.ok) {
      const detail = (await resp.text().catch(() => '')).trim().slice(0, 300);
      if (/empty result/i.test(detail)) {
        throw new Error('No speech was detected. Tap the mic and try again.');
      }
      throw new Error(detail || `Transcription request failed (${resp.status})`);
    }
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
    recognitionStartTokenRef.current += 1;
    intentionalStopRef.current = true;
    try {
      recognitionRef.current?.stop();
    } catch {
      try { recognitionRef.current?.abort(); } catch { /* already stopped */ }
    }
    recognitionRef.current = null;

    setVoiceState('transcribing');
    mr.onstop = async () => {
      const { blobType, extension } = recordingMetaRef.current;
      const blob = new Blob(chunksRef.current, { type: blobType });
      stopStream();
      try {
        let browserTranscript = browserTranscriptRef.current.trim();
        let cleaned = '';

        if (sttInputModeRef.current === 'local') {
          cleaned = await transcribeWithBackend(blob, `audio.${extension}`);
        } else {
          if (!browserTranscript) {
            browserTranscript = await waitForBrowserTranscript();
          }

          if (browserTranscript) {
            cleaned = browserTranscript;
          } else {
            // Mobile browsers may expose SpeechRecognition but return nothing
            // (iOS standalone/PWA, service-not-allowed, flaky network STT).
            // Always fall back to the recorded audio instead of failing.
            try {
              cleaned = await transcribeWithBackend(blob, `audio.${extension}`);
            } catch (backendErr) {
              const detail = backendErr instanceof Error ? backendErr.message : String(backendErr);
              throw new Error(`No speech was recognized in the browser, and server transcription failed: ${detail}`);
            }
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
    if (!wakeWordSupported) {
      wakeWordEnabledRef.current = false;
      if (stateRef.current === 'listening') {
        setVoiceState('idle');
      }
      return;
    }

    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      console.warn('[VOICE] SpeechRecognition not available');
      wakeWordEnabledRef.current = false;
      setStoredWakeWordEnabled(false);
      setVoiceState('idle');
      setError('Speech recognition is not supported in this browser');
      return;
    }
    // Initialize AudioContext on user interaction
    ensureAudioContext();
    wakeWordEnabledRef.current = true;
    setStoredWakeWordEnabled(true);
    setVoiceState('listening');
    ensureRecognitionRef.current('wake');
  }, [setVoiceState, wakeWordSupported]);

  const stopWakeWordListener = useCallback(() => {
    wakeWordEnabledRef.current = false;
    recognitionStartTokenRef.current += 1;
    intentionalStopRef.current = true;
    try { recognitionRef.current?.abort(); } catch { /* already stopped */ }
    recognitionRef.current = null;
    if (stateRef.current === 'listening') {
      setVoiceState('idle');
    }
    if (wakeWordSupported) {
      setStoredWakeWordEnabled(false);
    }
  }, [setVoiceState, wakeWordSupported]);

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
    if (!wakeWordSupported || !wakeWordEnabled) return;

    const clearPersistedWakeWord = () => {
      stopWakeWordListener();
      try { localStorage.removeItem(WAKE_WORD_KEY); } catch { /* noop */ }
    };

    const autoStartWakeWord = () => {
      if (!wakeWordEnabledRef.current || stateRef.current !== 'idle') return;
      startWakeWordRef.current();
    };

    // Only auto-start if mic permission was previously granted (avoid surprise prompts)
    const permissionQuery = navigator.permissions?.query?.({ name: 'microphone' as PermissionName });
    if (!permissionQuery) {
      // Permissions API not available — try starting anyway (user interaction may be required)
      autoStartWakeWord();
      return;
    }

    // Any start, stop, or unmount while the query is pending bumps the startup token;
    // a result for a superseded token must not override the newer wake state.
    const permissionStartToken = recognitionStartTokenRef.current;
    const isSuperseded = () => permissionStartToken !== recognitionStartTokenRef.current;

    permissionQuery.then((result) => {
      if (isSuperseded()) return;
      if (result.state === 'granted') {
        autoStartWakeWord();
      } else {
        // Permission not granted — clear persisted state so toggle shows off on supported environments
        clearPersistedWakeWord();
      }
    }).catch(() => {
      if (isSuperseded()) return;
      // Permissions API failed — try starting anyway (user interaction may be required)
      autoStartWakeWord();
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
    disposedRef.current = false;
    const timers = pendingTimersRef.current;
    return () => {
      disposedRef.current = true;
      // Clear all pending timers
      for (const id of timers) clearTimeout(id);
      timers.clear();
      wakeWordEnabledRef.current = false;
      recognitionStartTokenRef.current += 1;
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
    isStarting,
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
