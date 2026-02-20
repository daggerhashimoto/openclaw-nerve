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
