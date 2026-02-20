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
import { DEFAULT_GATEWAY_URL, DEFAULT_PORT, DEFAULT_SSL_PORT, DEFAULT_HOST, WHISPER_MODEL_FILES } from './constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const HOME = process.env.HOME || os.homedir();

export const config = {
  port: Number(process.env.PORT || DEFAULT_PORT),
  sslPort: Number(process.env.SSL_PORT || DEFAULT_SSL_PORT),

  // Bind address — defaults to localhost for safety; set HOST=0.0.0.0 for remote access
  host: process.env.HOST || DEFAULT_HOST,

  openaiApiKey: process.env.OPENAI_API_KEY || '',
  replicateApiToken: process.env.REPLICATE_API_TOKEN || '',

  // Speech-to-text
  sttProvider: (process.env.STT_PROVIDER || 'local') as 'local' | 'openai',
  whisperModel: process.env.WHISPER_MODEL || 'tiny.en',
  whisperModelDir: process.env.WHISPER_MODEL_DIR || path.join(HOME, '.nerve', 'models'),

  // Gateway connection
  gatewayUrl: process.env.GATEWAY_URL || DEFAULT_GATEWAY_URL,
  gatewayToken: process.env.GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN || '',

  // Agent identity (used in UI)
  agentName: process.env.AGENT_NAME || 'Agent',

  home: HOME,

  // Paths (configurable via env, with OpenClaw defaults)
  dist: path.join(PROJECT_ROOT, 'dist'),
  agentLogPath: path.join(PROJECT_ROOT, 'agent-log.json'),
  memoryPath: process.env.MEMORY_PATH || path.join(HOME, '.openclaw', 'workspace', 'MEMORY.md'),
  memoryDir: process.env.MEMORY_DIR || path.join(HOME, '.openclaw', 'workspace', 'memory'),
  sessionsDir: process.env.SESSIONS_DIR || path.join(HOME, '.openclaw', 'agents', 'main', 'sessions'),
  usageFile: process.env.USAGE_FILE || path.join(HOME, '.openclaw', 'token-usage.json'),
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
    (config as Record<string, unknown>).sessionSecret = secret;
  }

  if (config.host === '0.0.0.0' && !config.auth) {
    console.warn(
      '\n  \x1b[33m⚠ Server binds to 0.0.0.0 with authentication DISABLED.\x1b[0m\n' +
      '  All API endpoints are accessible from the network without a password.\n' +
      '  Run \x1b[36mnpm run setup\x1b[0m to enable authentication.\n',
    );
  }

  // Informational warnings
  if (!config.openaiApiKey) {
    console.warn('[config] ⚠ OPENAI_API_KEY not set — OpenAI TTS/Whisper unavailable (Edge TTS still works)');
  }
  if (!config.replicateApiToken) {
    console.warn('[config] ⚠ REPLICATE_API_TOKEN not set — Qwen TTS unavailable');
  }
  if (config.host === '0.0.0.0' && config.auth) {
    // Only warn about network binding when auth IS enabled (the loud warning above covers the no-auth case)
    console.warn('[config] ⚠ Server binds to 0.0.0.0 — API is accessible from the network (auth enabled).');
  } else if (config.host === '0.0.0.0' && !config.auth) {
    // Already warned above with the loud message — skip the generic one
  } else if (config.host !== '127.0.0.1' && config.host !== 'localhost' && config.host !== '::1') {
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
}
