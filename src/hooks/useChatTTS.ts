/**
 * useChatTTS — TTS playback logic extracted from ChatContext
 *
 * Manages voice fallback text generation, TTS marker extraction,
 * auto-speak logic, and played-sound deduplication.
 */
import { useRef, useCallback, useMemo } from 'react';
import { playPing } from '@/features/voice/audio-feedback';
import { extractTTSMarkers } from '@/features/tts/useTTS';
import type { FinalMessageData } from '@/features/chat/operations';

// ─── Constants ──────────────────────────────────────────────────────────────────

// ─── Pure helpers ───────────────────────────────────────────────────────────────

/** Strip code blocks, markdown noise, and validate text is speakable for TTS fallback. */
export function buildVoiceFallbackText(raw: string): string | null {
  // Strip fenced code blocks
  let text = extractTTSMarkers(raw).cleaned.replace(/```[\s\S]*?```/g, '');
  // Strip inline code
  text = text.replace(/`[^`]+`/g, '');
  // Strip markdown images/links
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Strip markdown formatting (bold, italic, headers, hr)
  text = text.replace(/#{1,6}\s+/g, '');
  text = text.replace(/[*_~]{1,3}/g, '');
  text = text.replace(/^---+$/gm, '');
  // Collapse whitespace
  text = text.replace(/\n{2,}/g, '. ').replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
  // Must have at least 3 letter characters (unicode-aware for non-Latin scripts)
  if (!/\p{L}{3,}/u.test(text)) return null;
  return text;
}

// ─── Hook ───────────────────────────────────────────────────────────────────────

interface UseChatTTSDeps {
  soundEnabled: React.RefObject<boolean>;
  speak: React.RefObject<(text: string) => void>;
}

export function useChatTTS({ soundEnabled, speak }: UseChatTTSDeps) {
  const lastMessageWasVoiceRef = useRef(false);
  const playedSoundsRef = useRef<Set<string>>(new Set());

  /** Track whether the user sent a voice message (for TTS fallback). */
  const trackVoiceMessage = useCallback((text: string) => {
    lastMessageWasVoiceRef.current = text.startsWith('[voice] ');
  }, []);

  /** Drop voice tracking for a run that ended without a final reply. */
  const clearVoiceMessage = useCallback(() => {
    lastMessageWasVoiceRef.current = false;
  }, []);

  /** Clear the played-sounds dedup set (called on chat_started). */
  const resetPlayedSounds = useCallback(() => {
    playedSoundsRef.current.clear();
  }, []);

  /** Directly committed assistant messages can bypass the chat-final stream. */
  const handleCommittedTTS = useCallback((text: string) => {
    const { ttsText } = extractTTSMarkers(text);
    if (!ttsText || playedSoundsRef.current.has(ttsText)) return;
    playedSoundsRef.current.add(ttsText);
    speak.current(ttsText);
  }, [speak]);

  /**
   * Handle TTS for a completed assistant turn.
   * Called from chat_final processing when the run is the active run.
   * `ownsVoiceFallback` is true only for the run whose send set the voice
   * marker, so an earlier active run cannot consume a newer voice send's
   * fallback. Explicit ttsText is independent of that ownership.
   */
  const handleFinalTTS = useCallback((
    finalData: FinalMessageData | null,
    isActiveRun: boolean,
    ownsVoiceFallback = true,
  ) => {
    const wasVoice = ownsVoiceFallback && lastMessageWasVoiceRef.current;
    if (wasVoice) lastMessageWasVoiceRef.current = false;

    if (!isActiveRun) return;

    if (finalData?.ttsText && !playedSoundsRef.current.has(finalData.ttsText)) {
      playedSoundsRef.current.add(finalData.ttsText);
      speak.current(finalData.ttsText);
    } else if (!finalData?.ttsText && wasVoice && finalData?.text) {
      // Voice fallback: agent forgot [tts:...] marker — auto-speak cleaned response
      const fallback = buildVoiceFallbackText(finalData.text);
      if (fallback) speak.current(fallback);
    } else if (soundEnabled.current) {
      playPing();
    }
  }, [soundEnabled, speak]);

  /** Play the completion ping sound if sound is enabled. */
  const playCompletionPing = useCallback(() => {
    if (soundEnabled.current) playPing();
  }, [soundEnabled]);

  return useMemo(() => ({
    trackVoiceMessage,
    clearVoiceMessage,
    resetPlayedSounds,
    handleCommittedTTS,
    handleFinalTTS,
    playCompletionPing,
  }), [
    trackVoiceMessage,
    clearVoiceMessage,
    resetPlayedSounds,
    handleCommittedTTS,
    handleFinalTTS,
    playCompletionPing,
  ]);
}
