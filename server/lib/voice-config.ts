/**
 * Voice provider configuration management.
 * 
 * Loads and saves voice-providers.json for runtime TTS/STT configuration.
 * This allows changing providers without restarting the server.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VoiceProvidersConfig } from './provider-interfaces.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'voice-providers.json');

/**
 * Default voice providers configuration.
 */
export const DEFAULT_VOICE_CONFIG: VoiceProvidersConfig = {
  tts: {
    provider: 'deepgram',
    deepgram: {
      model: 'aura-2-iris-en',
    },
    openai: {
      model: 'tts-1',
      voice: 'nova',
    },
    edge: {
      voice: 'en-US-AriaNeural',
    },
    replicate: {
      model: 'qwen-tts',
    },
    custom: {
      name: 'custom',
      endpoint: '',
      apiKey: '',
      headers: {} as Record<string, string>,
      requestTemplate: '{"text":"{{text}}","voice":"{{voice}}"}',
      responseParser: '$.audio',
    },
  },
  stt: {
    provider: 'deepgram',
    deepgram: {
      model: 'nova-2',
      keywords: ['Kora:3', 'Erapor:3', 'Philomena:2'],
    },
    openai: {
      model: 'whisper-1',
    },
    local: {
      model: 'tiny.en',
    },
    custom: {
      name: 'custom',
      endpoint: '',
      apiKey: '',
      headers: {} as Record<string, string>,
      requestTemplate: '{"audio":"{{audio_base64}}"}',
      responseParser: '$.text',
    },
  },
};

/**
 * Load voice providers configuration from file.
 * Creates default config if file doesn't exist.
 */
export function loadVoiceConfig(): VoiceProvidersConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      console.log('[voice-config] No config file found, creating default...');
      saveVoiceConfig(DEFAULT_VOICE_CONFIG);
      return DEFAULT_VOICE_CONFIG;
    }

    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw) as VoiceProvidersConfig;
    
    console.log(`[voice-config] Loaded config: TTS=${config.tts.provider}, STT=${config.stt.provider}`);
    return config;
  } catch (err) {
    console.error('[voice-config] Failed to load config:', (err as Error).message);
    console.log('[voice-config] Using default config');
    return DEFAULT_VOICE_CONFIG;
  }
}

/**
 * Save voice providers configuration to file.
 */
export function saveVoiceConfig(config: VoiceProvidersConfig): void {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    console.log(`[voice-config] Saved config: TTS=${config.tts.provider}, STT=${config.stt.provider}`);
  } catch (err) {
    console.error('[voice-config] Failed to save config:', (err as Error).message);
    throw err;
  }
}

/**
 * Update voice providers configuration (partial update).
 * Merges with existing config and saves.
 */
export function updateVoiceConfig(patch: Partial<VoiceProvidersConfig>): VoiceProvidersConfig {
  const current = loadVoiceConfig();
  
  // Deep merge (one level)
  const updated: VoiceProvidersConfig = {
    tts: {
      ...current.tts,
      ...(patch.tts || {}),
    },
    stt: {
      ...current.stt,
      ...(patch.stt || {}),
    },
  };
  
  saveVoiceConfig(updated);
  return updated;
}

/**
 * Validate voice provider configuration.
 * Returns error message if invalid, null if valid.
 */
export function validateVoiceConfig(config: Partial<VoiceProvidersConfig>): string | null {
  // Validate TTS provider
  if (config.tts) {
    const validTtsProviders = ['openai', 'edge', 'replicate', 'deepgram', 'custom'];
    if (!validTtsProviders.includes(config.tts.provider)) {
      return `Invalid TTS provider: ${config.tts.provider}`;
    }
    
    // Validate provider-specific config
    if (config.tts.provider === 'custom' && config.tts.custom) {
      if (!config.tts.custom.endpoint) {
        return 'Custom TTS provider requires endpoint URL';
      }
      if (!config.tts.custom.requestTemplate) {
        return 'Custom TTS provider requires request template';
      }
      if (!config.tts.custom.responseParser) {
        return 'Custom TTS provider requires response parser';
      }
    }
  }
  
  // Validate STT provider
  if (config.stt) {
    const validSttProviders = ['local', 'openai', 'deepgram', 'custom'];
    if (!validSttProviders.includes(config.stt.provider)) {
      return `Invalid STT provider: ${config.stt.provider}`;
    }
    
    // Validate provider-specific config
    if (config.stt.provider === 'custom' && config.stt.custom) {
      if (!config.stt.custom.endpoint) {
        return 'Custom STT provider requires endpoint URL';
      }
      if (!config.stt.custom.requestTemplate) {
        return 'Custom STT provider requires request template';
      }
      if (!config.stt.custom.responseParser) {
        return 'Custom STT provider requires response parser';
      }
    }
  }
  
  return null;
}

/**
 * Get the current active voice configuration.
 * This is a cached version that's loaded once at startup.
 */
let cachedConfig: VoiceProvidersConfig | null = null;

export function getActiveVoiceConfig(): VoiceProvidersConfig {
  if (!cachedConfig) {
    cachedConfig = loadVoiceConfig();
  }
  return cachedConfig;
}

/**
 * Reload voice configuration from disk (hot reload).
 */
export function reloadVoiceConfig(): VoiceProvidersConfig {
  cachedConfig = loadVoiceConfig();
  return cachedConfig;
}
