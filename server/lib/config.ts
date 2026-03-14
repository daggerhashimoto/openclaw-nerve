/**
 * Server configuration — all env vars, paths, and constants.
 *
 * Single source of truth for every tuneable value in the Nerve server.
 * Validated at startup via {@link validateConfig}. Also exports the
 * startup banner printer and a non-blocking gateway health probe.
 * @module
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_GATEWAY_URL,
  DEFAULT_PORT,
  DEFAULT_SSL_PORT,
  DEFAULT_HOST,
  WHISPER_MODEL_FILES,
  WHISPER_DEFAULT_MODEL,
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
} from './constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const HOME = process.env.HOME || os.homedir();
const SUPPORTED_LANGUAGE_CODES = new Set(SUPPORTED_LANGUAGES.map((l) => l.code));

const LANGUAGE_ENV_VALUE = process.env.NERVE_LANGUAGE ?? process.env.LANGUAGE;

function normalizeLanguagePreference(language: string | undefined): string {
  const normalized = (language || DEFAULT_LANGUAGE).trim().toLowerCase();
  if (!normalized || normalized === 'auto') return DEFAULT_LANGUAGE;

  const code = normalized.split('-')[0] || DEFAULT_LANGUAGE;
  if (!SUPPORTED_LANGUAGE_CODES.has(code)) return DEFAULT_LANGUAGE;

  return code;
}

export const config = {
  port: Number(process.env.PORT || DEFAULT_PORT),
  sslPort: Number(process.env.SSL_PORT || DEFAULT_SSL_PORT),

  // Bind address — defaults to localhost for safety; set HOST=0.0.0.0 for remote access
  host: process.env.HOST || DEFAULT_HOST,

  openaiApiKey: process.env.OPENAI_API_KEY || '',
  replicateApiToken: process.env.REPLICATE_API_TOKEN || '',

  // Speech-to-text
  sttProvider: (process.env.STT_PROVIDER || 'local') as 'local' | 'openai',
  whisperModel: process.env.WHISPER_MODEL || WHISPER_DEFAULT_MODEL,
  whisperModelDir: process.env.WHISPER_MODEL_DIR || path.join(HOME, '.nerve', 'models'),

  // Language preference (ISO 639-1). Invalid/auto values are normalized to English.
  // Primary env key: NERVE_LANGUAGE. Legacy LANGUAGE is still accepted as fallback.
  language: normalizeLanguagePreference(LANGUAGE_ENV_VALUE),
  edgeVoiceGender:
    process.env.EDGE_VOICE_GENDER === 'male' || process.env.EDGE_VOICE_GENDER === 'female'
      ? process.env.EDGE_VOICE_GENDER
      : 'female',

  // Gateway connection
  gatewayUrl: process.env.GATEWAY_URL || DEFAULT_GATEWAY_URL,
  gatewayToken: process.env.GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN || '',

  // Agent identity (used in UI)
  agentName: process.env.AGENT_NAME || 'Agent',

  home: HOME,

  // Paths (configurable via env, with OpenClaw defaults)
  dist: path.join(PROJECT_ROOT, 'dist'),
  agentLogPath: path.join(PROJECT_ROOT, 'agent-log.json'),
  fileBrowserRoot: process.env.FILE_BROWSER_ROOT || '',
  memoryPath: process.env.MEMORY_PATH || path.join(HOME, '.openclaw', 'workspace', 'MEMORY.md'),
  memoryDir: process.env.MEMORY_DIR || path.join(HOME, '.openclaw', 'workspace', 'memory'),
  sessionsDir: process.env.SESSIONS_DIR || path.join(HOME, '.openclaw', 'agents', 'main', 'sessions'),
  usageFile: process.env.USAGE_FILE || path.join(HOME, '.openclaw', 'token-usage.json'),
  workspaceWatchRecursive: process.env.NERVE_WATCH_WORKSPACE_RECURSIVE === 'true',
  certPath: path.join(PROJECT_ROOT, 'certs', 'cert.pem'),
  keyPath: path.join(PROJECT_ROOT, 'certs', 'key.pem'),
  bunPath: path.join(HOME, '.bun', 'bin', 'bunx'),
  // Limits
  limits: {
    tts: 64 * 1024,                  // 64 KB
    agentLog: 64 * 1024,             // 64 KB
    transcribe: 12 * 1024 * 1024,    // 12 MB
    /** Global max request body size (transcribe + 1 MB overhead) */
    maxBodyBytes: 12 * 1024 * 1024 + 1024 * 1024,  // ~13 MB
  },

  // Agent log
  agentLogMax: 200,

  // TTS cache
  ttsCacheTtlMs: Number(process.env.TTS_CACHE_TTL_MS || 3_600_000), // 1 hour
  ttsCacheMax: Number(process.env.TTS_CACHE_MAX || 200),

  // Authentication
  auth: (process.env.NERVE_AUTH || 'false').toLowerCase() === 'true',
  passwordHash: process.env.NERVE_PASSWORD_HASH || '',
  sessionSecret: process.env.NERVE_SESSION_SECRET || '',
  sessionTtlMs: Number(process.env.NERVE_SESSION_TTL || 30 * 24 * 60 * 60 * 1000), // 30 days
} as const;

// ─── Typed config mutation ──────────────────────────────────────────────────

/** Keys that may be mutated at runtime and their accepted types. */
type MutableConfigMap = {
  sttProvider: 'local' | 'openai';
  language: string;
  edgeVoiceGender: 'female' | 'male';
  sessionSecret: string;
};

/**
 * Centralized, type-safe config mutation.
 *
 * Only the four known mutable keys are accepted; values are validated at
 * runtime before the write so callers can never silently corrupt config.
 * The single `Record<string, unknown>` cast is confined to this function.
 */
export function updateConfig<K extends keyof MutableConfigMap>(
  key: K,
  value: MutableConfigMap[K],
): void {
  switch (key) {
    case 'sttProvider':
      if (value !== 'local' && value !== 'openai') {
        throw new Error(`Invalid sttProvider: ${value}. Must be 'local' or 'openai'`);
      }
      break;
    case 'language':
      if (typeof value !== 'string' || !SUPPORTED_LANGUAGE_CODES.has(value)) {
        throw new Error(`Invalid language: ${value}. Must be a supported ISO 639-1 code`);
      }
      break;
    case 'edgeVoiceGender':
      if (value !== 'female' && value !== 'male') {
        throw new Error(`Invalid edgeVoiceGender: ${value}. Must be 'female' or 'male'`);
      }
      break;
    case 'sessionSecret':
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error('sessionSecret must be a non-empty string');
      }
      break;
    default: {
      // Exhaustiveness check — if we ever add a key to MutableConfigMap
      // without handling it, TypeScript will flag this line.
      const _exhaustive: never = key;
      throw new Error(`Cannot mutate config key: ${_exhaustive}`);
    }
  }
  (config as Record<string, unknown>)[key] = value;
}

/** Session cookie name — suffixed with port to avoid collisions when running multiple instances. */
export const SESSION_COOKIE_NAME = `nerve_session_${config.port}`;

/** WebSocket proxy allowed hostnames (extend via WS_ALLOWED_HOSTS env var, comma-separated) */
export const WS_ALLOWED_HOSTS = new Set([
  'localhost', '127.0.0.1', '::1',
  ...(process.env.WS_ALLOWED_HOSTS?.split(',').map(h => h.trim()).filter(Boolean) ?? []),
]);

/** Resolve the TTS provider label for the startup banner. */
function ttsProviderLabel(): string {
  if (config.openaiApiKey && config.replicateApiToken) return 'OpenAI + Replicate + Edge';
  if (config.openaiApiKey) return 'OpenAI + Edge';
  if (config.replicateApiToken) return 'Replicate + Edge';
  return 'Edge (free)';
}

/** Resolve the STT provider label for the startup banner. */
function sttProviderLabel(): string {
  if (config.sttProvider === 'openai') return config.openaiApiKey ? 'OpenAI Whisper' : 'OpenAI (no key!)';
  return `Local (${config.whisperModel})`;
}

/** Print startup banner with version and config summary. */
export function printStartupBanner(version: string): void {
  console.log(`\n  \x1b[33m⚡ Nerve v${version}\x1b[0m`);
  console.log(`  Agent: ${config.agentName} | TTS: ${ttsProviderLabel()} | STT: ${sttProviderLabel()}`);
  console.log(`  Gateway: ${config.gatewayUrl}`);
  if (config.auth) {
    console.log('  \x1b[32m🔒 Authentication enabled\x1b[0m');
  }
}

/** Non-blocking gateway health check at startup. */
export async function probeGateway(): Promise<void> {
  try {
    const resp = await fetch(`${config.gatewayUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (resp.ok) {
      console.log('  \x1b[32m✓\x1b[0m Gateway reachable');
    } else {
      console.warn(`  \x1b[33m⚠\x1b[0m Gateway returned HTTP ${resp.status}`);
    }
  } catch {
    console.warn('  \x1b[33m⚠\x1b[0m Gateway unreachable — is it running?');
  }
}

/** Log startup warnings and validate critical configuration. */
export function validateConfig(): void {
  // Critical: gateway token is the only required config
  if (!config.gatewayToken) {
    console.warn(
      '\n  \x1b[33m⚠ GATEWAY_TOKEN is not set\x1b[0m\n' +
      '  Gateway API calls (memories, models, session info) will fail.\n' +
      '  Run \x1b[36mnpm run setup\x1b[0m to configure, or set GATEWAY_TOKEN in .env\n',
    );
  }

  // ── Auth validation ──────────────────────────────────────────────
  if (config.auth && !config.passwordHash && !config.gatewayToken) {
    console.error(
      '\n  \x1b[31m✗ NERVE_AUTH is enabled but no password or gateway token is configured.\x1b[0m\n' +
      '  Run \x1b[36mnpm run setup\x1b[0m to set a password, or set GATEWAY_TOKEN as a fallback.\n',
    );
  }

  if (config.auth && !config.sessionSecret) {
    // Auto-generate session secret if missing
    const secret = crypto.randomBytes(32).toString('hex');
    console.warn('[config] ⚠ NERVE_SESSION_SECRET not set — generated ephemeral secret (sessions won\'t survive restarts)');
    updateConfig('sessionSecret', secret);
  }

  if (config.host === '0.0.0.0' && !config.auth) {
    if (process.env.NERVE_ALLOW_INSECURE === 'true') {
      console.warn(
        '\n  \x1b[33m⚠ INSECURE MODE: Server binds to 0.0.0.0 with authentication DISABLED.\x1b[0m\n' +
        '  All API endpoints are accessible from the network without a password.\n' +
        '  This is dangerous. Run \x1b[36mnpm run setup\x1b[0m to enable authentication.\n',
      );
    } else {
      console.error(
        '\n  \x1b[31m✗ Refusing to start: HOST=0.0.0.0 with authentication disabled.\x1b[0m\n' +
        '  This would expose all API endpoints (files, memory, API keys) to the network.\n\n' +
        '  To fix, either:\n' +
        '    1. Enable auth:  \x1b[36mnpm run setup\x1b[0m\n' +
        '    2. Bind locally: \x1b[36mHOST=127.0.0.1\x1b[0m in .env\n' +
        '    3. Override:     \x1b[36mNERVE_ALLOW_INSECURE=true\x1b[0m in .env (NOT recommended)\n',
      );
      process.exit(1);
    }
  }

  // Informational warnings
  if (!config.openaiApiKey) {
    console.warn('[config] ⚠ OPENAI_API_KEY not set — OpenAI TTS/Whisper unavailable (Edge TTS still works)');
  }
  if (!config.replicateApiToken) {
    console.warn('[config] ⚠ REPLICATE_API_TOKEN not set — Qwen TTS unavailable');
  }
  if (!process.env.NERVE_LANGUAGE && process.env.LANGUAGE) {
    console.warn('[config] ⚠ LANGUAGE is deprecated — use NERVE_LANGUAGE instead');
  }
  if (config.host === '0.0.0.0' && config.auth) {
    console.warn('[config] ⚠ Server binds to 0.0.0.0 — API is accessible from the network (auth enabled).');
  } else if (config.host !== '0.0.0.0' && config.host !== '127.0.0.1' && config.host !== 'localhost' && config.host !== '::1') {
    console.warn(
      '[config] ⚠ Server binds to ' + config.host + ' — API may be accessible from the network.\n' +
      '         Set HOST=127.0.0.1 for local-only access.',
    );
  }

  // STT validation
  if (config.sttProvider === 'local') {
    const modelFile = WHISPER_MODEL_FILES[config.whisperModel];
    if (modelFile) {
      const modelPath = path.join(config.whisperModelDir, modelFile);
      try {
        fs.accessSync(modelPath);
      } catch {
        console.warn(
          `[config] ⚠ Whisper model not found at ${modelPath}\n` +
          `         Local STT unavailable. Re-run installer or set STT_PROVIDER=openai`,
        );
      }
    } else {
      console.warn(`[config] ⚠ Unknown Whisper model: ${config.whisperModel}`);
    }
  }

  // ── FILE_BROWSER_ROOT validation ───────────────────────────────────────
  if (config.fileBrowserRoot) {
    try {
      const stat = fs.statSync(config.fileBrowserRoot);
      if (!stat.isDirectory()) {
        throw new Error('FILE_BROWSER_ROOT is not a directory');
      }
    } catch {
      console.warn('[config] ⚠ FILE_BROWSER_ROOT is not a directory or is inaccessible, falling back to default');
      (config as typeof config & { fileBrowserRoot: string }).fileBrowserRoot = '';
    }
  }
}
