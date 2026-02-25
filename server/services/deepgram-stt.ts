/**
 * Deepgram Speech-to-Text service.
 * 
 * Supports both file-based transcription and live streaming.
 * Uses Nova-2 model by default for best accuracy.
 */

import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import type { STTOptions, STTResult } from '../lib/provider-interfaces.js';

export const DEEPGRAM_STT_MODELS = [
  'nova-2',      // ⭐ Best quality (default)
  'nova',        // Good balance
  'base',        // Fast, lower cost
  'whisper-medium', // OpenAI Whisper via Deepgram
  'whisper-large', // OpenAI Whisper large via Deepgram
];

const DEFAULT_MODEL = 'nova-2';
const DEFAULT_KEYWORDS = [
  'Kora:3',       // Maximum boost for agent name
  'Erapor:3',     // Project name
  'Philomena:2',  // Related term
];

/**
 * Transcribe audio file (non-streaming).
 */
export async function transcribeDeepgram(
  audio: Buffer,
  options: STTOptions = {}
): Promise<STTResult> {
  const apiKey = options.apiKey || process.env.DEEPGRAM_API_KEY;
  
  if (!apiKey) {
    return {
      ok: false,
      message: 'DEEPGRAM_API_KEY not configured',
      status: 401,
    };
  }

  const model = options.model || DEFAULT_MODEL;
  const language = options.language || 'en';
  const keywords = options.keywords || DEFAULT_KEYWORDS;

  console.log(`[deepgram-stt] Transcribing ${audio.length} bytes with model ${model}`);

  try {
    const deepgram = createClient(apiKey);

    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      audio,
      {
        model,
        language,
        smart_format: true,
        keywords,
      }
    );

    if (error) {
      console.error('[deepgram-stt] API error:', error);
      return {
        ok: false,
        message: `Deepgram STT failed: ${error.message || error}`,
        status: 500,
      };
    }

    const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
    
    console.log(`[deepgram-stt] Transcribed: "${transcript.substring(0, 100)}"`);

    return {
      ok: true,
      text: transcript,
    };
  } catch (err) {
    console.error('[deepgram-stt] Transcription error:', (err as Error).message);
    return {
      ok: false,
      message: `STT transcription failed: ${(err as Error).message}`,
      status: 500,
    };
  }
}

/**
 * Create live transcription connection.
 * Returns connection object for streaming audio.
 */
export function createLiveDeepgramConnection(options: STTOptions = {}) {
  const apiKey = options.apiKey || process.env.DEEPGRAM_API_KEY;
  
  if (!apiKey) {
    throw new Error('DEEPGRAM_API_KEY not configured');
  }

  const model = options.model || DEFAULT_MODEL;
  const language = options.language || 'en';
  const keywords = options.keywords || DEFAULT_KEYWORDS;
  const utteranceEndMs = options.utteranceEndMs || 4000;
  const interim = options.interim !== false; // Default true

  console.log(`[deepgram-stt] Creating live connection: model=${model}, utteranceEndMs=${utteranceEndMs}`);

  const deepgram = createClient(apiKey);

  const connection = deepgram.listen.live({
    model,
    language,
    smart_format: true,
    interim_results: interim,
    utterance_end_ms: utteranceEndMs,
    vad_events: true, // Voice activity detection
    keywords,
  });

  return connection;
}

/**
 * Get list of available Deepgram STT models.
 */
export function getDeepgramSTTModels(): string[] {
  return DEEPGRAM_STT_MODELS;
}

/**
 * Deepgram live transcription events (re-export for convenience).
 */
export { LiveTranscriptionEvents };
