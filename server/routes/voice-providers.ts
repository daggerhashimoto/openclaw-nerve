/**
 * Voice provider configuration API.
 * 
 * GET /api/voice-providers - Get current configuration
 * PUT /api/voice-providers - Update configuration
 * POST /api/voice-providers/test-tts - Test TTS with sample text
 * POST /api/voice-providers/test-stt - Test STT with sample audio
 * GET /api/voice-providers/voices - Get available voices for a provider
 * GET /api/voice-providers/models - Get available models for a provider
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { VoiceProvidersConfig } from '../lib/provider-interfaces.js';
import { 
  getActiveVoiceConfig, 
  updateVoiceConfig, 
  validateVoiceConfig,
  reloadVoiceConfig 
} from '../lib/voice-config.js';
import { synthesizeDeepgram, DEEPGRAM_VOICES } from '../services/deepgram-tts.js';
import { transcribeDeepgram, DEEPGRAM_STT_MODELS } from '../services/deepgram-stt.js';
import { synthesizeOpenAI } from '../services/openai-tts.js';
import { synthesizeEdge } from '../services/edge-tts.js';
import { synthesizeCustom, transcribeCustom } from '../services/custom-provider.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const app = new Hono();

// Schema for config updates
const voiceConfigSchema = z.object({
  tts: z.object({
    provider: z.enum(['openai', 'edge', 'replicate', 'deepgram', 'custom']),
    deepgram: z.object({
      model: z.string(),
      apiKey: z.string().optional(),
    }).optional(),
    openai: z.object({
      model: z.string(),
      voice: z.string(),
      apiKey: z.string().optional(),
    }).optional(),
    edge: z.object({
      voice: z.string(),
    }).optional(),
    replicate: z.object({
      model: z.string(),
      apiKey: z.string().optional(),
    }).optional(),
    custom: z.object({
      name: z.string(),
      endpoint: z.string(),
      apiKey: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      requestTemplate: z.string(),
      responseParser: z.string(),
    }).optional(),
  }).optional(),
  stt: z.object({
    provider: z.enum(['local', 'openai', 'deepgram', 'custom']),
    deepgram: z.object({
      model: z.string(),
      keywords: z.array(z.string()).optional(),
      apiKey: z.string().optional(),
    }).optional(),
    openai: z.object({
      model: z.string(),
      apiKey: z.string().optional(),
    }).optional(),
    local: z.object({
      model: z.string(),
    }).optional(),
    custom: z.object({
      name: z.string(),
      endpoint: z.string(),
      apiKey: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      requestTemplate: z.string(),
      responseParser: z.string(),
    }).optional(),
  }).optional(),
});

/**
 * GET /api/voice-providers
 * Get current voice provider configuration.
 */
app.get('/api/voice-providers', rateLimitGeneral, (c) => {
  const config = getActiveVoiceConfig();
  return c.json(config);
});

/**
 * PUT /api/voice-providers
 * Update voice provider configuration.
 */
app.put(
  '/api/voice-providers',
  rateLimitGeneral,
  zValidator('json', voiceConfigSchema, (result, c) => {
    if (!result.success) {
      return c.text(result.error.issues[0]?.message || 'Invalid configuration', 400);
    }
  }),
  async (c) => {
    try {
      const patch = c.req.valid('json');
      
      // Validate configuration
      const validationError = validateVoiceConfig(patch);
      if (validationError) {
        return c.text(validationError, 400);
      }
      
      // Update and save
      const updated = updateVoiceConfig(patch);
      
      // Reload config cache
      reloadVoiceConfig();
      
      return c.json(updated);
    } catch (err) {
      console.error('[voice-providers] Update error:', (err as Error).message);
      return c.text('Failed to update configuration', 500);
    }
  }
);

/**
 * POST /api/voice-providers/test-tts
 * Test TTS with sample text.
 */
app.post(
  '/api/voice-providers/test-tts',
  rateLimitGeneral,
  zValidator('json', z.object({
    provider: z.enum(['openai', 'edge', 'replicate', 'deepgram', 'custom']),
    text: z.string().min(1).max(200).default('Hello, this is a test.'),
    voice: z.string().optional(),
    model: z.string().optional(),
  })),
  async (c) => {
    try {
      const { provider, text, voice, model } = c.req.valid('json');
      const config = getActiveVoiceConfig();
      
      let result;
      
      switch (provider) {
        case 'deepgram':
          result = await synthesizeDeepgram(text, { 
            voice: voice || config.tts.deepgram?.model || 'aura-2-iris-en',
            apiKey: config.tts.deepgram?.apiKey,
          });
          break;
          
        case 'openai':
          result = await synthesizeOpenAI(
            text, 
            voice || config.tts.openai?.voice || 'nova',
            model || config.tts.openai?.model || 'tts-1'
          );
          break;
          
        case 'edge':
          result = await synthesizeEdge(text, voice || config.tts.edge?.voice);
          break;
          
        case 'custom':
          if (!config.tts.custom?.endpoint) {
            return c.text('Custom TTS not configured', 400);
          }
          result = await synthesizeCustom(text, config.tts.custom, { voice, model });
          break;
          
        default:
          return c.text('Invalid provider', 400);
      }
      
      if (!result.ok) {
        return c.text(result.message || 'TTS test failed', (result.status || 500) as ContentfulStatusCode);
      }
      
      if (!result.buf) {
        return c.text('No audio generated', 500);
      }
      
      // Return audio
      const contentType = 'contentType' in result ? (result as { contentType?: string }).contentType || 'audio/mpeg' : 'audio/mpeg';
      return new Response(result.buf, {
        status: 200,
        headers: {
          'Content-Type': contentType,
        },
      });
    } catch (err) {
      console.error('[voice-providers] TTS test error:', (err as Error).message);
      return c.text('TTS test failed', 500);
    }
  }
);

/**
 * POST /api/voice-providers/test-stt
 * Test STT with sample audio (accepts base64 audio).
 */
app.post(
  '/api/voice-providers/test-stt',
  rateLimitGeneral,
  zValidator('json', z.object({
    provider: z.enum(['local', 'openai', 'deepgram', 'custom']),
    audio: z.string().min(1), // base64 encoded audio
    model: z.string().optional(),
  })),
  async (c) => {
    try {
      const { provider, audio, model } = c.req.valid('json');
      const config = getActiveVoiceConfig();
      
      // Decode base64 audio
      const audioBuffer = Buffer.from(audio, 'base64');
      
      let result;
      
      switch (provider) {
        case 'deepgram':
          result = await transcribeDeepgram(audioBuffer, {
            model: model || config.stt.deepgram?.model || 'nova-2',
            keywords: config.stt.deepgram?.keywords,
            apiKey: config.stt.deepgram?.apiKey,
          });
          break;
          
        case 'custom':
          if (!config.stt.custom?.endpoint) {
            return c.text('Custom STT not configured', 400);
          }
          result = await transcribeCustom(audioBuffer, config.stt.custom, { model });
          break;
          
        default:
          return c.text('Provider not yet implemented for testing', 501);
      }
      
      if (!result.ok) {
        return c.text(result.message || 'STT test failed', (result.status || 500) as ContentfulStatusCode);
      }
      
      return c.json({ text: result.text });
    } catch (err) {
      console.error('[voice-providers] STT test error:', (err as Error).message);
      return c.text('STT test failed', 500);
    }
  }
);

/**
 * GET /api/voice-providers/voices
 * Get available voices for a provider.
 */
app.get('/api/voice-providers/voices', rateLimitGeneral, (c) => {
  const provider = c.req.query('provider');
  
  const voices: Record<string, string[]> = {
    deepgram: DEEPGRAM_VOICES,
    openai: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
    edge: [
      'en-US-AriaNeural',
      'en-US-GuyNeural',
      'en-US-JennyNeural',
      'en-GB-SoniaNeural',
      'en-GB-RyanNeural',
    ],
  };
  
  if (!provider || !voices[provider]) {
    return c.json({ voices: [] });
  }
  
  return c.json({ voices: voices[provider] });
});

/**
 * GET /api/voice-providers/models
 * Get available models for a provider.
 */
app.get('/api/voice-providers/models', rateLimitGeneral, (c) => {
  const provider = c.req.query('provider');
  const type = c.req.query('type'); // 'tts' or 'stt'
  
  const models: Record<string, Record<string, string[]>> = {
    tts: {
      deepgram: DEEPGRAM_VOICES,
      openai: ['tts-1', 'tts-1-hd'],
      replicate: ['qwen-tts'],
    },
    stt: {
      deepgram: DEEPGRAM_STT_MODELS,
      openai: ['whisper-1'],
      local: ['tiny.en', 'base.en', 'small.en'],
    },
  };
  
  if (!provider || !type || !models[type]?.[provider]) {
    return c.json({ models: [] });
  }
  
  return c.json({ models: models[type][provider] });
});

export default app;
