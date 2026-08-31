/**
 * useChatTTS — TTS playback logic extracted from ChatContext
 *
 * Manages voice fallback text generation, TTS marker extraction,
 * auto-speak logic, and played-sound deduplication.
 */
import { useRef, useCallback, useMemo } from 'react';
import { playPing } from '@/features/voice/audio-feedback';
import type { FinalMessageData } from '@/features/chat/operations';

// ─── Constants ──────────────────────────────────────────────────────────────────

export const FALLBACK_MAX_CHARS = 300;

// ─── Pure helpers ───────────────────────────────────────────────────────────────

/** Strip code blocks, markdown noise, and validate text is speakable for TTS fallback. */
export function buildVoiceFallbackText(raw: string): string | null {
  // Strip fenced code blocks
  let text = raw.replace(/```[\s\S]*?```/g, '');
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
  // Cap length
  if (text.length > FALLBACK_MAX_CHARS) {
    text = text.slice(0, FALLBACK_MAX_CHARS).replace(/\s\S*$/, '') + '…';
  }
  return text;
}

// ─── Hook ───────────────────────────────────────────────────────────────────────

interface UseChatTTSDeps {
  ttsEnabled: React.RefObject<boolean>;
  speak: React.RefObject<(text: string) => void>;
}

export function useChatTTS({ ttsEnabled, speak }: UseChatTTSDeps) {
  const lastMessageWasVoiceRef = useRef(false);
  const playedSoundsRef = useRef<Set<string>>(new Set());

  /** Track whether the user sent a voice message (for TTS fallback). */
  const trackVoiceMessage = useCallback((text: string) => {
    lastMessageWasVoiceRef.current = text.startsWith('[voice] ');
  }, []);

  /** Clear the played-sounds dedup set (called on chat_started). */
  const resetPlayedSounds = useCallback(() => {
    playedSoundsRef.current.clear();
    lastMessageWasVoiceRef.current = false;
  }, []);

  /**
   * Handle TTS for a completed assistant turn.
   * Called from chat_final processing when the run is the active run.
   */
  const handleFinalTTS = useCallback((finalData: FinalMessageData | null, isActiveRun: boolean) => {
    if (!isActiveRun) return;

    if (finalData?.ttsText && !playedSoundsRef.current.has(finalData.ttsText)) {
      playedSoundsRef.current.add(finalData.ttsText);
      if (ttsEnabled.current) speak.current(finalData.ttsText);
      else playPing();
    } else if (!finalData?.ttsText && lastMessageWasVoiceRef.current && finalData?.text) {
      // Voice fallback: agent forgot [tts:...] marker — auto-speak cleaned response
      const fallback = buildVoiceFallbackText(finalData.text);
      if (fallback && ttsEnabled.current) speak.current(fallback);
      else playPing();
    } else {
      playPing();
    }
  }, [ttsEnabled, speak]);

  /** Play the completion ping through the independent UI sound channel. */
  const playCompletionPing = useCallback(() => {
    playPing();
  }, []);

  return useMemo(() => ({
    trackVoiceMessage,
    resetPlayedSounds,
    handleFinalTTS,
    playCompletionPing,
  }), [
    trackVoiceMessage,
    resetPlayedSounds,
    handleFinalTTS,
    playCompletionPing,
  ]);
}
