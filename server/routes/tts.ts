/**
 * POST /api/tts — Text-to-speech synthesis.
 *
 * Supports OpenAI TTS, Replicate (Qwen, etc.), Deepgram, Edge TTS, and Custom providers.
 * Body: { text: string, provider?: string, model?: string, voice?: string }
 * Response: audio/mpeg binary
 *
 * Provider selection priority:
 *  - Explicit provider choice is always honoured
 *  - "openai" → OpenAI TTS (requires OPENAI_API_KEY)
 *  - "replicate" → Replicate-hosted models (requires REPLICATE_API_TOKEN)
 *  - "deepgram" → Deepgram Aura 2 models (requires DEEPGRAM_API_KEY)
 *  - "custom" → User-configured custom HTTP endpoint
 *  - "edge" → Microsoft Edge Read-Aloud TTS (free, no key needed)
 *  - Auto fallback: deepgram (if key) → openai (if key) → replicate (if key) → edge (always available)
 *
 * Backward compat: provider "qwen" is treated as replicate + model "qwen-tts".
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import crypto from 'node:crypto';
import { config } from '../lib/config.js';
import { getTTSConfig, updateTTSConfig } from '../lib/tts-config.js';
import { getTtsCache, setTtsCache } from '../services/tts-cache.js';
import { synthesizeOpenAI } from '../services/openai-tts.js';
import { synthesizeReplicate } from '../services/replicate-tts.js';
import { synthesizeEdge } from '../services/edge-tts.js';
import { synthesizeDeepgram } from '../services/deepgram-tts.js';
import { synthesizeCustom } from '../services/custom-provider.js';
import { rateLimitTTS, rateLimitGeneral } from '../middleware/rate-limit.js';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { CustomProviderConfig } from '../lib/provider-interfaces.js';

const app = new Hono();

const MAX_TEXT_LENGTH = 5000;

const ttsSchema = z.object({
  text: z
    .string()
    .min(1, 'Text is required')
    .max(MAX_TEXT_LENGTH, `Text too long (max ${MAX_TEXT_LENGTH} chars)`)
    .refine((s) => s.trim().length > 0, 'Text cannot be empty or whitespace'),
  voice: z.string().optional(),
  // Accept all provider values including new ones
  provider: z.enum(['openai', 'replicate', 'qwen', 'edge', 'deepgram', 'custom']).optional(),
  model: z.string().optional(),
});

function audioResponse(buf: Buffer, contentType = 'audio/mpeg'): Response {
  return new Response(buf, {
    status: 200,
    headers: { 'Content-Type': contentType },
  });
}

app.post(
  '/api/tts',
  rateLimitTTS,
  zValidator('json', ttsSchema, (result, c) => {
    if (!result.success) {
      return c.text(result.error.issues[0]?.message || 'Invalid request', 400);
    }
  }),
  async (c) => {
    try {
      const { text, voice: rawVoice, provider: rawProvider, model: rawModel } = c.req.valid('json');

      // Normalize "qwen" → "replicate" + model "qwen-tts" for backward compat
      const isLegacyQwen = rawProvider === 'qwen';
      const provider = isLegacyQwen ? 'replicate' : rawProvider;
      const model = rawModel || (isLegacyQwen ? 'qwen-tts' : undefined);

      // Voice is passed through — each provider resolves its own default from config
      const voice = rawVoice;

      // Resolve effective provider: explicit > deepgram (if key) > openai (if key) > replicate (if key) > edge
      const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
      const useDeepgram =
        provider === 'deepgram' ||
        (!provider && !!deepgramApiKey);
      const useReplicate =
        provider === 'replicate' ||
        (!provider && !deepgramApiKey && !config.openaiApiKey && !!config.replicateApiToken);
      const useCustom = provider === 'custom';
      const useEdge =
        provider === 'edge' ||
        (!provider && !deepgramApiKey && !config.openaiApiKey && !config.replicateApiToken);
      
      let effectiveProvider = 'openai';
      if (useEdge) effectiveProvider = 'edge';
      else if (useReplicate) effectiveProvider = 'replicate';
      else if (useDeepgram) effectiveProvider = 'deepgram';
      else if (useCustom) effectiveProvider = 'custom';
      
      console.log(`[tts] provider=${effectiveProvider} voice=${voice} text="${text.slice(0, 50)}..."`);

      // Cache key includes provider + model + voice for proper isolation
      const hash = crypto
        .createHash('md5')
        .update(`${effectiveProvider}:${model || ''}:${voice}:${text}`)
        .digest('hex');

      const cached = getTtsCache(hash);
      if (cached) {
        // Detect WAV (starts with "RIFF") vs MP3 for correct content type
        const cachedCt = cached.length > 4 && cached.toString('ascii', 0, 4) === 'RIFF' ? 'audio/wav' : 'audio/mpeg';
        return audioResponse(cached, cachedCt);
      }

      let result;
      if (effectiveProvider === 'edge') {
        result = await synthesizeEdge(text, voice);
      } else if (effectiveProvider === 'replicate') {
        result = await synthesizeReplicate(text, { model, voice });
      } else if (effectiveProvider === 'deepgram') {
        result = await synthesizeDeepgram(text, { voice, model });
      } else if (effectiveProvider === 'custom') {
        // TODO: Load custom config from voice-providers.json
        const customConfig: CustomProviderConfig = {
          name: 'custom',
          endpoint: process.env.CUSTOM_TTS_ENDPOINT || '',
          apiKey: process.env.CUSTOM_TTS_API_KEY,
          requestTemplate: process.env.CUSTOM_TTS_REQUEST_TEMPLATE || '{"text":"{{text}}"}',
          responseParser: process.env.CUSTOM_TTS_RESPONSE_PATH || '$.audio',
        };
        result = await synthesizeCustom(text, customConfig, { voice, model });
      } else {
        result = await synthesizeOpenAI(text, voice, model);
      }

      if (!result.ok) {
        return c.text(result.message || 'TTS failed', result.status as ContentfulStatusCode);
      }

      if (!result.buf) {
        return c.text('TTS generated no audio', 500);
      }

      const ct = 'contentType' in result ? (result as { contentType: string }).contentType : 'audio/mpeg';
      setTtsCache(hash, result.buf);
      return audioResponse(result.buf, ct);
    } catch (err) {
      console.error('[tts] error:', (err as Error).message || err);
      return c.text('TTS failed', 500);
    }
  },
);

// ---------------------------------------------------------------------------
// TTS voice config API — read & update tts-config.json
// ---------------------------------------------------------------------------

/** GET /api/tts/config — return current TTS voice config */
app.get('/api/tts/config', rateLimitGeneral, (c) => {
  return c.json(getTTSConfig());
});

/** Allowed top-level keys and their allowed child keys (all must be strings) */
const TTS_CONFIG_SCHEMA: Record<string, string[]> = {
  qwen: ['mode', 'language', 'speaker', 'voiceDescription', 'styleInstruction'],
  openai: ['model', 'voice', 'instructions'],
  edge: ['voice'],
};

/** Validate TTS config patch — only allow known keys with string values */
function validateTTSPatch(patch: unknown): string | null {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return 'Body must be a JSON object';
  }
  for (const [key, val] of Object.entries(patch as Record<string, unknown>)) {
    if (!(key in TTS_CONFIG_SCHEMA)) return `Unknown section: "${key}"`;
    if (typeof val !== 'object' || val === null || Array.isArray(val)) {
      return `"${key}" must be an object`;
    }
    const allowed = TTS_CONFIG_SCHEMA[key];
    for (const [subKey, subVal] of Object.entries(val as Record<string, unknown>)) {
      if (!allowed.includes(subKey)) return `Unknown key: "${key}.${subKey}"`;
      if (typeof subVal !== 'string') return `"${key}.${subKey}" must be a string`;
      if (subVal.length > 2000) return `"${key}.${subKey}" exceeds max length (2000)`;
    }
  }
  return null;
}

/** PUT /api/tts/config — partial update TTS voice config */
app.put('/api/tts/config', rateLimitGeneral, async (c) => {
  try {
    const patch = await c.req.json();
    const err = validateTTSPatch(patch);
    if (err) return c.text(err, 400);
    const updated = updateTTSConfig(patch);
    return c.json(updated);
  } catch (err) {
    console.error('[tts-config] update error:', (err as Error).message);
    return c.text('Invalid config', 400);
  }
});

export default app;
