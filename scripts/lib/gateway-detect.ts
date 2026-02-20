/**
 * Auto-detect gateway token from the local OpenClaw configuration.
 *
 * Reads ~/.openclaw/openclaw.json and extracts the gateway auth token.
 * This avoids requiring users to manually copy-paste the token during setup.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import os from 'node:os';

const HOME = process.env.HOME || os.homedir();
const OPENCLAW_CONFIG = join(HOME, '.openclaw', 'openclaw.json');

interface OpenClawConfig {
  gateway?: {
    port?: number;
    bind?: string;
    auth?: {
      mode?: string;
      token?: string;
    };
    controlUi?: {
      allowedOrigins?: string[];
    };
  };
  [key: string]: unknown;
}

export interface DetectedGateway {
  token: string | null;
  url: string | null;
}

/**
 * Attempt to auto-detect gateway configuration from the local OpenClaw install.
 * Returns null values for anything that can't be detected.
 */
export function detectGatewayConfig(): DetectedGateway {
  const result: DetectedGateway = { token: null, url: null };

  if (!existsSync(OPENCLAW_CONFIG)) {
    return result;
  }

  try {
    const raw = readFileSync(OPENCLAW_CONFIG, 'utf-8');
    const config = JSON.parse(raw) as OpenClawConfig;

    // Extract token
    if (config.gateway?.auth?.token) {
      result.token = config.gateway.auth.token;
    }

    // Derive URL from port — always use 127.0.0.1 since Nerve connects locally
    const port = config.gateway?.port || 18789;
    result.url = `http://127.0.0.1:${port}`;
  } catch {
    // Config exists but can't be parsed — return nulls
  }

  return result;
}

/**
 * Check if the OPENCLAW_GATEWAY_TOKEN environment variable is already set.
 * This is the standard env var that OpenClaw itself uses.
 */
export function getEnvGatewayToken(): string | null {
  return process.env.OPENCLAW_GATEWAY_TOKEN || null;
}

/**
 * Patch gateway.bind to the given value (e.g. 'lan' for 0.0.0.0).
 */
export function patchGatewayBind(bind: string): GatewayPatchResult {
  const result: GatewayPatchResult = { ok: false, message: '', configPath: OPENCLAW_CONFIG };

  if (!existsSync(OPENCLAW_CONFIG)) {
    result.message = `Config not found: ${OPENCLAW_CONFIG}`;
    return result;
  }

  try {
    const raw = readFileSync(OPENCLAW_CONFIG, 'utf-8');
    const config = JSON.parse(raw) as OpenClawConfig;

    config.gateway = config.gateway || {};
    config.gateway.bind = bind;

    writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2) + '\n');
    result.ok = true;
    result.message = `Set gateway.bind to "${bind}"`;
    return result;
  } catch (err) {
    result.message = `Failed to patch config: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }
}

export interface GatewayPatchResult {
  ok: boolean;
  message: string;
  configPath: string;
}

/**
 * Patch the OpenClaw gateway config to allow external origins.
 * Adds the given origin to gateway.controlUi.allowedOrigins (deduped).
 * Returns a result indicating success/failure.
 */
export function patchGatewayAllowedOrigins(origin: string): GatewayPatchResult {
  const result: GatewayPatchResult = { ok: false, message: '', configPath: OPENCLAW_CONFIG };

  if (!existsSync(OPENCLAW_CONFIG)) {
    result.message = `Config not found: ${OPENCLAW_CONFIG}`;
    return result;
  }

  try {
    const raw = readFileSync(OPENCLAW_CONFIG, 'utf-8');
    const config = JSON.parse(raw) as OpenClawConfig;

    config.gateway = config.gateway || {};
    config.gateway.controlUi = config.gateway.controlUi || {};
    const origins = config.gateway.controlUi.allowedOrigins || [];

    if (origins.includes(origin)) {
      result.ok = true;
      result.message = `Origin already allowed: ${origin}`;
      return result;
    }

    origins.push(origin);
    config.gateway.controlUi.allowedOrigins = origins;

    writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2) + '\n');
    result.ok = true;
    result.message = `Added ${origin} to gateway.controlUi.allowedOrigins`;
    return result;
  } catch (err) {
    result.message = `Failed to patch config: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }
}

/**
 * Pair Nerve's device identity with the OpenClaw gateway.
 *
 * Reads the device identity from ~/.nerve/device-identity.json (generating
 * one if it doesn't exist) and writes an entry to ~/.openclaw/devices/paired.json.
 * This grants Nerve full operator scopes on the gateway WebSocket connection.
 */
export function pairNerveDevice(gatewayToken: string): GatewayPatchResult {
  const result: GatewayPatchResult = { ok: false, message: '', configPath: '' };

  const devicesDir = join(HOME, '.openclaw', 'devices');
  const pairedPath = join(devicesDir, 'paired.json');
  const nerveDir = join(HOME, '.nerve');
  const identityPath = join(nerveDir, 'device-identity.json');
  result.configPath = pairedPath;

  try {
    // Ensure Nerve device identity exists (generate if needed)
    let nerveIdentity: { deviceId: string; publicKeyB64url: string; privateKeyPem: string };

    if (existsSync(identityPath)) {
      nerveIdentity = JSON.parse(readFileSync(identityPath, 'utf-8'));
    } else {
      // Generate new Ed25519 keypair
      const crypto = require('node:crypto');
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const pubDer = publicKey.export({ type: 'spki', format: 'der' });
      const rawPub = pubDer.slice(-32);
      const pubB64url = rawPub.toString('base64url');
      const deviceId = crypto.createHash('sha256').update(rawPub).digest('hex');
      const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

      nerveIdentity = { deviceId, publicKeyB64url: pubB64url, privateKeyPem };

      // Write identity file
      const { mkdirSync } = require('node:fs');
      mkdirSync(nerveDir, { recursive: true, mode: 0o700 });
      writeFileSync(identityPath, JSON.stringify({
        ...nerveIdentity,
        createdAt: new Date().toISOString(),
      }, null, 2) + '\n', { mode: 0o600 });
    }

    // Load existing paired.json or start fresh
    let paired: Record<string, unknown> = {};
    if (existsSync(pairedPath)) {
      try {
        paired = JSON.parse(readFileSync(pairedPath, 'utf-8'));
      } catch { /* start fresh */ }
    }

    // Check if already paired
    if (paired[nerveIdentity.deviceId]) {
      result.ok = true;
      result.message = 'Nerve device already paired with gateway';
      return result;
    }

    const nowMs = Date.now();

    // Add Nerve device entry
    paired[nerveIdentity.deviceId] = {
      id: nerveIdentity.deviceId,
      publicKey: nerveIdentity.publicKeyB64url,
      displayName: 'nerve-ui',
      roles: ['operator'],
      pairedAtMs: nowMs,
      tokens: {
        operator: {
          token: gatewayToken,
          role: 'operator',
          scopes: ['operator.admin', 'operator.read', 'operator.write'],
          createdAtMs: nowMs,
          rotatedAtMs: nowMs,
        },
      },
    };

    // Write paired.json
    const { mkdirSync } = require('node:fs');
    mkdirSync(devicesDir, { recursive: true });
    writeFileSync(pairedPath, JSON.stringify(paired, null, 2) + '\n');

    result.ok = true;
    result.message = 'Paired Nerve device with gateway';
    return result;
  } catch (err) {
    result.message = `Failed to pair device: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }
}

/**
 * Attempt to restart the OpenClaw gateway so config changes take effect.
 * Tries `openclaw gateway restart` first, falls back to kill + start.
 */
export function restartGateway(): { ok: boolean; message: string } {
  try {
    execSync('openclaw gateway restart', { timeout: 15000, stdio: 'pipe' });
    return { ok: true, message: 'Gateway restarted' };
  } catch {
    try {
      execSync('pkill -f "openclaw gateway" || true', { timeout: 5000, stdio: 'pipe' });
      return { ok: true, message: 'Gateway process killed (should auto-restart if supervised)' };
    } catch {
      return { ok: false, message: 'Could not restart gateway — restart it manually' };
    }
  }
}
