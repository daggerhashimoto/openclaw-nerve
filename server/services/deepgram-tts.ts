/**
 * Deepgram Text-to-Speech service.
 * 
 * Uses Deepgram Aura 2 models for natural-sounding voice synthesis.
 * Prioritized voices: iris (cheerful, energetic), amalthea (Filipino English, natural).
 */

import type { TTSOptions, TTSResult } from '../lib/provider-interfaces.js';

const DEEPGRAM_TTS_ENDPOINT = 'https://api.deepgram.com/v1/speak';

/**
 * Available Deepgram Aura 2 voice models.
 * Priority order: iris (default), amalthea, cordelia, janus
 */
export const DEEPGRAM_VOICES = [
  'aura-2-iris-en',        // ⭐ Primary: Cheerful, Positive, Approachable (American)
  'aura-2-amalthea-en',    // ⭐ Secondary: Engaging, Natural, Cheerful (Filipino English)
  'aura-2-cordelia-en',    // Approachable, Warm, Polite (American)
  'aura-2-janus-en',       // Southern, Smooth, Trustworthy (American)
  'aura-2-luna-en',        // Professional, confident (American)
  'aura-2-stella-en',      // Warm, friendly (American)
  'aura-2-athena-en',      // Authoritative, clear (American)
  'aura-2-hera-en',        // Mature, sophisticated (American)
  'aura-2-orion-en',       // Masculine, deep (American)
  'aura-2-arcas-en',       // Masculine, friendly (American)
  'aura-2-perseus-en',     // Masculine, energetic (American)
  'aura-2-angus-en',       // Masculine, warm (American)
];

const DEFAULT_VOICE = 'aura-2-iris-en';

export async function synthesizeDeepgram(
  text: string,
  options: TTSOptions = {}
): Promise<TTSResult> {
  const apiKey = options.apiKey || process.env.DEEPGRAM_API_KEY;
  
  if (!apiKey) {
    return {
      ok: false,
      message: 'DEEPGRAM_API_KEY not configured',
      status: 401,
    };
  }

  const voice = options.voice || options.model || DEFAULT_VOICE;
  
  // Validate voice model
  if (!DEEPGRAM_VOICES.includes(voice)) {
    console.warn(`[deepgram-tts] Unknown voice "${voice}", falling back to ${DEFAULT_VOICE}`);
  }

  console.log(`[deepgram-tts] Synthesizing ${text.length} chars with ${voice}`);

  try {
    const response = await fetch(`${DEEPGRAM_TTS_ENDPOINT}?model=${voice}`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[deepgram-tts] API error ${response.status}:`, errorText);
      
      // Handle rate limits gracefully
      if (response.status === 429) {
        return {
          ok: false,
          message: 'Deepgram rate limit reached. Please try again in a moment.',
          status: 429,
        };
      }

      return {
        ok: false,
        message: `Deepgram TTS failed: ${response.status} ${response.statusText}`,
        status: response.status,
      };
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    
    console.log(`[deepgram-tts] Generated ${audioBuffer.length} bytes of audio`);

    return {
      ok: true,
      buf: audioBuffer,
      contentType: 'audio/mpeg', // Deepgram returns MP3
    };
  } catch (err) {
    console.error('[deepgram-tts] Synthesis error:', (err as Error).message);
    return {
      ok: false,
      message: `TTS synthesis failed: ${(err as Error).message}`,
      status: 500,
    };
  }
}

/**
 * Get list of available Deepgram voices.
 */
export function getDeepgramVoices(): string[] {
  return DEEPGRAM_VOICES;
}
