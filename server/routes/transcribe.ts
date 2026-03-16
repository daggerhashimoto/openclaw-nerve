/**
 * POST /api/transcribe — Audio transcription.
 *
 * Routes to local Whisper (default, no API key needed) or OpenAI Whisper API.
 * Body: multipart/form-data with a "file" field containing audio data.
 * Response: { text: string }
 */

import { Hono } from 'hono';
import { config, updateConfig } from '../lib/config.js';
import { SUPPORTED_LANGUAGES } from '../lib/constants.js';
import { writeEnvKey } from '../lib/env-file.js';
import { isLanguageSupported } from '../lib/language.js';
import { transcribe as transcribeOpenAI } from '../services/openai-whisper.js';
import { transcribeLocal, isModelAvailable, getActiveModel, setWhisperModel, getDownloadProgress, getSystemInfo } from '../services/whisper-local.js';
import { rateLimitTranscribe, rateLimitGeneral } from '../middleware/rate-limit.js';

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

    // Validate magic bytes to prevent polyglot file attacks
    if (fileData.length >= 4) {
      const head = fileData.subarray(0, 12);
      const isRIFF = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46; // WAV
      const isID3  = head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33;                     // MP3 (ID3)
      const isMP3  = head[0] === 0xFF && (head[1] & 0xE0) === 0xE0;                                // MP3 (sync)
      const isOgg  = head[0] === 0x4F && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53; // OGG
      const isFLAC = head[0] === 0x66 && head[1] === 0x4C && head[2] === 0x61 && head[3] === 0x43; // FLAC
      const isFtyp = head.length >= 8 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70; // MP4/M4A
      const isWebM = head.length >= 4 && head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3; // WebM/MKV
      if (!isRIFF && !isID3 && !isMP3 && !isOgg && !isFLAC && !isFtyp && !isWebM) {
        return c.text('File content does not match a supported audio format', 415);
      }
    }
    const filename = file.name || 'audio.webm';

    // Route to configured STT provider (pass language hint)
    const lang = config.language;
    let result;
    if (config.sttProvider === 'openai') {
      if (!config.openaiApiKey) {
        return c.text('OpenAI API key not configured. Set OPENAI_API_KEY in .env or switch to STT_PROVIDER=local', 500);
      }
      result = await transcribeOpenAI(fileData, filename, file.type || 'audio/webm', lang);
    } else {
      result = await transcribeLocal(fileData, filename, lang);
    }

    if (!result.ok) {
      return c.text(result.message, result.status as 400 | 500);
    }

    return c.json({ text: result.text });
  } catch (err) {
    console.error('[transcribe] error:', (err as Error).message || err);
    return c.text('Transcription failed', 500);
  }
});

/** GET /api/transcribe/config — current STT provider info + download progress */
app.get('/api/transcribe/config', (c) => {
  const model = getActiveModel();
  const download = getDownloadProgress();
  const { hasGpu } = getSystemInfo();
  return c.json({
    provider: config.sttProvider,
    model,
    language: config.language,
    modelReady: config.sttProvider === 'local' ? isModelAvailable() : true,
    openaiKeySet: !!config.openaiApiKey,
    replicateKeySet: !!config.replicateApiToken,
    hasGpu,
    availableModels: {
      'tiny.en':  { size: '75MB',  ready: isModelAvailable('tiny.en'),  multilingual: false },
      'base.en':  { size: '142MB', ready: isModelAvailable('base.en'),  multilingual: false },
      'small.en': { size: '466MB', ready: isModelAvailable('small.en'), multilingual: false },
      'tiny':     { size: '75MB',  ready: isModelAvailable('tiny'),     multilingual: true },
      'base':     { size: '142MB', ready: isModelAvailable('base'),     multilingual: true },
      'small':    { size: '466MB', ready: isModelAvailable('small'),    multilingual: true },
    },
    download: download ? {
      model: download.model,
      downloading: download.downloading,
      percent: download.percent,
      error: download.error,
    } : null,
  });
});

/** PUT /api/transcribe/config — switch STT provider, model, or language at runtime */
app.put('/api/transcribe/config', async (c) => {
  try {
    const body = await c.req.json() as { model?: string; provider?: string; language?: string };
    const messages: string[] = [];

    // Switch provider
    if (body.provider === 'local' || body.provider === 'openai') {
      updateConfig('sttProvider', body.provider);
      messages.push(`Provider set to ${body.provider}`);
    }

    // Switch model
    if (body.model) {
      const result = await setWhisperModel(body.model);
      if (!result.ok) return c.text(result.message, 400);
      messages.push(result.message);
    }

    // Switch language
    if (body.language !== undefined) {
      const lang = body.language;
      if (!SUPPORTED_LANGUAGES.find((l) => l.code === lang)) {
        return c.text(`Unsupported language: ${lang}. Available: ${SUPPORTED_LANGUAGES.map((l) => l.code).join(', ')}`, 400);
      }
      updateConfig('language', lang);
      await writeEnvKey('NERVE_LANGUAGE', lang);
      messages.push(`Language set to ${lang}`);
    }

    return c.json({
      provider: config.sttProvider,
      model: getActiveModel(),
      language: config.language,
      message: messages.join(', ') || 'No changes',
    });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return c.text('Invalid request', 400);
    }
    console.error('[transcribe-config] update failed:', err);
    return c.text('Failed to update transcription config', 500);
  }
});

// ─── Language API ────────────────────────────────────────────────────────────

/** GET /api/language — current language + supported list + provider compatibility */
app.get('/api/language', rateLimitGeneral, (c) => {
  return c.json({
    language: config.language,
    edgeVoiceGender: config.edgeVoiceGender,
    supported: SUPPORTED_LANGUAGES.map((l) => ({
      code: l.code,
      name: l.name,
      nativeName: l.nativeName,
    })),
    providers: {
      edge: isLanguageSupported('edge', config.language),
      qwen3: isLanguageSupported('qwen3', config.language),
      openai: isLanguageSupported('openai', config.language),
    },
  });
});

/** PUT /api/language — switch language at runtime (hot-reload) */
app.put('/api/language', rateLimitGeneral, async (c) => {
  try {
    const body = await c.req.json() as { language?: string; edgeVoiceGender?: string };

    if (body.language !== undefined) {
      const lang = body.language;
      if (!SUPPORTED_LANGUAGES.find((l) => l.code === lang)) {
        return c.text(`Unsupported language: ${lang}. Available: ${SUPPORTED_LANGUAGES.map((l) => l.code).join(', ')}`, 400);
      }
      updateConfig('language', lang);
      await writeEnvKey('NERVE_LANGUAGE', lang);
    }

    if (body.edgeVoiceGender !== undefined) {
      const gender = body.edgeVoiceGender;
      if (gender !== 'female' && gender !== 'male') {
        return c.text('edgeVoiceGender must be "female" or "male"', 400);
      }
      updateConfig('edgeVoiceGender', gender);
      await writeEnvKey('EDGE_VOICE_GENDER', gender);
    }

    return c.json({
      language: config.language,
      edgeVoiceGender: config.edgeVoiceGender,
      providers: {
        edge: isLanguageSupported('edge', config.language),
        qwen3: isLanguageSupported('qwen3', config.language),
        openai: isLanguageSupported('openai', config.language),
      },
    });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return c.text('Invalid request', 400);
    }
    console.error('[language] update failed:', err);
    return c.text('Failed to update language settings', 500);
  }
});

/** GET /api/language/support — full compatibility matrix (provider × language) */
app.get('/api/language/support', rateLimitGeneral, (c) => {
  const model = getActiveModel();
  const isMultilingual = !model.endsWith('.en');

  const languages = SUPPORTED_LANGUAGES.map((l) => ({
    code: l.code,
    name: l.name,
    nativeName: l.nativeName,
    edgeTtsVoices: l.edgeTtsVoices,
    stt: {
      local: l.code === 'en' || isMultilingual,
      openai: true, // OpenAI Whisper supports all languages
    },
    tts: {
      edge: true, // All supported languages have Edge voices
      qwen3: l.qwen3Language !== null,
      openai: true, // OpenAI auto-detects
    },
  }));

  return c.json({ languages, currentModel: model, isMultilingual });
});

export default app;
