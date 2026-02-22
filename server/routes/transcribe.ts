/**
 * POST /api/transcribe — Audio transcription.
 *
 * Routes to local Whisper (default, no API key needed) or OpenAI Whisper API.
 * Body: multipart/form-data with a "file" field containing audio data.
 * Response: { text: string }
 */

import { Hono } from 'hono';
import { config } from '../lib/config.js';
import { transcribe as transcribeOpenAI } from '../services/openai-whisper.js';
import { transcribeLocal, isModelAvailable, getActiveModel, setWhisperModel, getDownloadProgress, getSystemInfo } from '../services/whisper-local.js';
import { rateLimitTranscribe } from '../middleware/rate-limit.js';
import { getActiveVoiceConfig, saveVoiceConfig, reloadVoiceConfig } from '../lib/voice-config.js';
import { transcribeDeepgram } from '../services/deepgram-stt.js';
import { transcribeCustom } from '../services/custom-provider.js';

const MAX_FILE_SIZE = config.limits.transcribe; // 12 MB

/** MIME types accepted for transcription */
const ALLOWED_AUDIO_TYPES = new Set([
  'audio/webm',
  'audio/mp3',
  'audio/mpeg',
  'audio/mp4',
  'audio/m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/flac',
  'audio/x-flac',
]);

const app = new Hono();

app.post('/api/transcribe', rateLimitTranscribe, async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file || !(file instanceof File)) {
      return c.text('No file found in request', 400);
    }

    if (file.size > MAX_FILE_SIZE) {
      return c.text(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`, 413);
    }

    if (file.type && !ALLOWED_AUDIO_TYPES.has(file.type)) {
      return c.text(`Unsupported audio format: ${file.type}`, 415);
    }

    const arrayBuf = await file.arrayBuffer();
    const fileData = Buffer.from(arrayBuf);
    const filename = file.name || 'audio.webm';

    // Route to configured STT provider (check voice config first, fall back to env)
    const voiceConfig = getActiveVoiceConfig();
    const sttProvider = voiceConfig.stt.provider || config.sttProvider;
    
    console.log(`[transcribe] Using STT provider: ${sttProvider} (from voice config: ${voiceConfig.stt.provider})`);

    let result;
    
    if (sttProvider === 'deepgram') {
      const deepgramConfig = voiceConfig.stt.deepgram;
      const model = deepgramConfig?.model || config.deepgramSttModel;
      const keywords = deepgramConfig?.keywords;
      result = await transcribeDeepgram(fileData, { model, keywords, apiKey: config.deepgramApiKey });
    } else if (sttProvider === 'custom') {
      const customConfig = voiceConfig.stt.custom;
      if (!customConfig) {
        return c.text('Custom STT provider not configured. Please configure endpoint in Settings.', 400);
      }
      result = await transcribeCustom(fileData, customConfig);
    } else if (sttProvider === 'openai') {
      if (!config.openaiApiKey) {
        return c.text('OpenAI API key not configured. Set OPENAI_API_KEY in .env or switch STT provider in Settings', 500);
      }
      result = await transcribeOpenAI(fileData, filename, file.type || 'audio/webm');
    } else {
      // Default to local Whisper
      result = await transcribeLocal(fileData, filename);
    }

    if (!result.ok) {
      return c.text(result.message || 'Transcription failed', result.status as 400 | 500);
    }

    return c.json({ text: result.text });
  } catch (err) {
    console.error('[transcribe] error:', (err as Error).message || err);
    return c.text('Transcription failed', 500);
  }
});

/** GET /api/transcribe/config — current STT provider info + download progress */
app.get('/api/transcribe/config', (c) => {
  const whisperModel = getActiveModel();
  const download = getDownloadProgress();
  const { hasGpu } = getSystemInfo();
  const voiceConfig = getActiveVoiceConfig();
  
  // Use voice config if set, otherwise fall back to env vars
  const activeProvider = voiceConfig.stt.provider || config.sttProvider;
  
  // Get active model based on provider
  let activeModel: string;
  if (activeProvider === 'deepgram') {
    activeModel = voiceConfig.stt.deepgram?.model || config.deepgramSttModel;
  } else if (activeProvider === 'openai') {
    activeModel = voiceConfig.stt.openai?.model || 'whisper-1';
  } else if (activeProvider === 'local') {
    activeModel = whisperModel;
  } else {
    activeModel = 'custom';
  }
  
  return c.json({
    provider: activeProvider,
    model: activeModel,
    modelReady: activeProvider === 'local' ? isModelAvailable() : true,
    openaiKeySet: !!config.openaiApiKey,
    replicateKeySet: !!config.replicateApiToken,
    deepgramKeySet: !!config.deepgramApiKey,
    hasGpu,
    availableModels: {
      'tiny.en':  { size: '75MB',  ready: isModelAvailable('tiny.en') },
      'base.en':  { size: '142MB', ready: isModelAvailable('base.en') },
      'small.en': { size: '466MB', ready: isModelAvailable('small.en') },
    },
    download: download ? {
      model: download.model,
      downloading: download.downloading,
      percent: download.percent,
      error: download.error,
    } : null,
  });
});

/** PUT /api/transcribe/config — switch STT provider or model at runtime */
app.put('/api/transcribe/config', async (c) => {
  try {
    const body = await c.req.json() as { model?: string; provider?: string };
    const messages: string[] = [];
    const voiceConfig = getActiveVoiceConfig();

    // Switch provider (update voice config for persistence)
    if (body.provider) {
      if (['local', 'openai', 'deepgram', 'custom'].includes(body.provider)) {
        voiceConfig.stt.provider = body.provider as 'local' | 'openai' | 'deepgram' | 'custom';
        // Also update runtime config for backward compatibility
        (config as Record<string, unknown>).sttProvider = body.provider;
        messages.push(`STT provider set to ${body.provider}`);
      }
    }

    // Switch model
    if (body.model) {
      if (voiceConfig.stt.provider === 'local') {
        const result = await setWhisperModel(body.model);
        if (!result.ok) return c.text(result.message, 400);
        messages.push(result.message);
      } else if (voiceConfig.stt.provider === 'deepgram') {
        if (!voiceConfig.stt.deepgram) {
          voiceConfig.stt.deepgram = { model: 'nova-2' };
        }
        voiceConfig.stt.deepgram.model = body.model;
        messages.push(`Deepgram STT model set to ${body.model}`);
      } else if (voiceConfig.stt.provider === 'openai') {
        if (!voiceConfig.stt.openai) {
          voiceConfig.stt.openai = { model: 'whisper-1' };
        }
        voiceConfig.stt.openai.model = body.model;
        messages.push(`OpenAI STT model set to ${body.model}`);
      }
    }

    // Save updated config to disk
    saveVoiceConfig(voiceConfig);
    
    // Reload cache so next requests use updated config
    reloadVoiceConfig();

    // Get active model for response
    let activeModel: string;
    const provider = voiceConfig.stt.provider || config.sttProvider;
    if (provider === 'deepgram') {
      activeModel = voiceConfig.stt.deepgram?.model || config.deepgramSttModel;
    } else if (provider === 'openai') {
      activeModel = voiceConfig.stt.openai?.model || 'whisper-1';
    } else if (provider === 'local') {
      activeModel = getActiveModel();
    } else {
      activeModel = 'custom';
    }

    return c.json({
      provider: voiceConfig.stt.provider || config.sttProvider,
      model: activeModel,
      message: messages.join(', ') || 'No changes',
    });
  } catch {
    return c.text('Invalid request', 400);
  }
});

export default app;
