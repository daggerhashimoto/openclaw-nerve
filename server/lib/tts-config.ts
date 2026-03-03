/**
 * TTS voice configuration — reads/writes a JSON config file.
 *
 * All voice-related settings (OpenAI, Qwen/Replicate, Edge) live here
 * instead of env vars or hardcoded values. On first run, default settings
 * are written to `<PROJECT_ROOT>/tts-config.json`. Subsequent reads merge
 * the on-disk config with defaults so new fields are always present.
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getEdgeTtsVoice, getQwen3Language, getFallbackInfo } from './language.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'tts-config.json');

export interface TTSVoiceConfig {
  /** Qwen / Replicate TTS settings */
  qwen: {
    /** TTS mode: 'voice_design' or 'custom_voice' */
    mode: string;
    /** Language for synthesis */
    language: string;
    /** Preset speaker name (for custom_voice mode) */
    speaker: string;
    /** Voice description (for voice_design mode) */
    voiceDescription: string;
    /** Style/emotion instruction */
    styleInstruction: string;
  };
  /** OpenAI TTS settings */
  openai: {
    /** OpenAI TTS model (gpt-4o-mini-tts, tts-1, tts-1-hd) */
    model: string;
    /** Voice name (alloy, ash, ballad, cedar, coral, echo, fable, marin, nova, onyx, sage, shimmer, verse) */
    voice: string;
    /** Natural language instructions for how the voice should sound */
    instructions: string;
  };
  /** Edge TTS settings */
  edge: {
    /** Voice name (e.g. en-US-AriaNeural, en-GB-SoniaNeural) */
    voice: string;
  };
}

const DEFAULTS: TTSVoiceConfig = {
  qwen: {
    mode: 'voice_design',
    language: 'English',
    speaker: 'Serena',
    voiceDescription: '',
    styleInstruction: '',
  },
  openai: {
    model: 'gpt-4o-mini-tts',
    voice: 'nova',
    instructions:
      'Speak naturally and conversationally, like a real person. Warm, friendly tone with a slight British accent. Keep it casual and relaxed, not robotic or overly formal.',
  },
  edge: {
    voice: 'en-US-AriaNeural',
  },
};

let cached: TTSVoiceConfig | null = null;

/** Load TTS config from disk, merging with defaults for any missing fields. */
export function getTTSConfig(): TTSVoiceConfig {
  if (cached) return cached;

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      cached = deepMerge(DEFAULTS, raw) as TTSVoiceConfig;
      return cached;
    }
  } catch (err) {
    console.warn('[tts-config] Failed to read config, using defaults:', (err as Error).message);
  }

  // First run — write defaults to disk
  cached = { ...DEFAULTS };
  saveTTSConfig(cached);
  return cached;
}

/** Save TTS config to disk and update cache. */
export function saveTTSConfig(cfg: TTSVoiceConfig): void {
  cached = cfg;
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
  } catch (err) {
    console.error('[tts-config] Failed to write config:', (err as Error).message);
  }
}

/** Update a partial config (deep merge) and save. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function updateTTSConfig(patch: Record<string, any>): TTSVoiceConfig {
  const current = getTTSConfig();
  const updated = deepMerge(current, patch) as TTSVoiceConfig;
  saveTTSConfig(updated);
  return updated;
}
/** Simple deep merge (target ← source). Only merges plain objects, overwrites everything else. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (
      sv !== undefined &&
      typeof sv === 'object' &&
      sv !== null &&
      !Array.isArray(sv) &&
      typeof tv === 'object' &&
      tv !== null &&
      !Array.isArray(tv)
    ) {
      result[key] = deepMerge(tv, sv);
    } else if (sv !== undefined) {
      result[key] = sv;
    }
  }
  return result;
}

// ─── Language-aware TTS voice resolution ─────────────────────────────────────

export interface ResolvedTTSVoice {
  voice: string;
  language: string;
  fallback: boolean;
  warning?: string;
}

/**
 * Resolve the effective Edge TTS voice considering language preference.
 *
 * Priority chain:
 *   1. Per-voice override in tts-config.json (power users) — if it differs from the English default
 *   2. Language-derived voice (from language registry + gender preference)
 *   3. DEFAULT_VOICE fallback
 */
export function resolveEdgeTTSVoice(): ResolvedTTSVoice {
  const cfg = getTTSConfig();
  const lang = config.language;
  const gender = config.edgeVoiceGender;

  // If user explicitly overrode the voice to something non-default, respect it
  const userVoice = cfg.edge.voice;
  const defaultEnVoice = DEFAULTS.edge.voice; // 'en-US-AriaNeural'
  const isUserOverride = userVoice && userVoice !== defaultEnVoice;

  if (isUserOverride) {
    return { voice: userVoice, language: lang, fallback: false };
  }

  // Use language-derived voice
  const voice = getEdgeTtsVoice(lang, gender);
  return { voice, language: lang, fallback: false };
}

/**
 * Resolve the effective Qwen3 TTS language, falling back to English if unsupported.
 */
export function resolveQwen3Language(): ResolvedTTSVoice {
  const lang = config.language;
  const qwen3Lang = getQwen3Language(lang);

  if (qwen3Lang) {
    return { voice: qwen3Lang, language: lang, fallback: false };
  }

  const info = getFallbackInfo('replicate', lang);
  return {
    voice: 'English',
    language: 'en',
    fallback: true,
    warning: info.warning,
  };
}

/**
 * Get provider-specific language support info for the current language setting.
 */
export function getProviderLanguageSupport(): Record<string, { supported: boolean; warning?: string }> {
  const lang = config.language;
  return {
    edge: getFallbackInfo('edge', lang),
    replicate: getFallbackInfo('replicate', lang),
    openai: getFallbackInfo('openai', lang),
  };
}
