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

const FULL_OPERATOR_SCOPES = [
  'operator.admin',
  'operator.read',
  'operator.write',
  'operator.approvals',
  'operator.pairing',
];

/**
 * Workaround for OpenClaw 2026.2.19 bootstrap bug.
 *
 * On fresh install, the gateway creates its own device identity with only
 * `operator.read` scope. But the CLI needs `operator.admin` + `operator.approvals`
 * + `operator.pairing` for commands like `devices list`. This creates a deadlock:
 * can't approve devices because the CLI can't connect with sufficient scopes.
 *
 * This function upgrades the gateway's own device scopes in paired.json and
 * restarts the gateway, breaking the deadlock.
 */
export function fixGatewayDeviceScopes(): { ok: boolean; message: string; needsRestart: boolean } {
  const pairedPath = join(HOME, '.openclaw', 'devices', 'paired.json');

  if (!existsSync(pairedPath)) {
    return { ok: false, message: 'No paired devices file found', needsRestart: false };
  }

  try {
    const raw = readFileSync(pairedPath, 'utf-8');
    const paired = JSON.parse(raw) as Record<string, {
      scopes?: string[];
      tokens?: Record<string, { scopes?: string[] }>;
      clientId?: string;
    }>;

    let fixed = false;
    for (const [, device] of Object.entries(paired)) {
      const currentScopes = device.scopes || [];
      const missing = FULL_OPERATOR_SCOPES.filter(s => !currentScopes.includes(s));

      if (missing.length > 0) {
        device.scopes = FULL_OPERATOR_SCOPES;
        if (device.tokens?.operator) {
          device.tokens.operator.scopes = FULL_OPERATOR_SCOPES;
        }
        fixed = true;
      }
    }

    if (!fixed) {
      return { ok: true, message: 'Device scopes already correct', needsRestart: false };
    }

    writeFileSync(pairedPath, JSON.stringify(paired, null, 2) + '\n');

    // Also fix the CLI's own identity file — without this the gateway sees a
    // scope mismatch (token claims operator.read, paired.json says full set)
    // and triggers a scope-upgrade request that requires approval scopes to
    // approve, creating another deadlock.
    const identityPath = join(HOME, '.openclaw', 'identity', 'device-auth.json');
    if (existsSync(identityPath)) {
      try {
        const idRaw = readFileSync(identityPath, 'utf-8');
        const identity = JSON.parse(idRaw) as {
          tokens?: Record<string, { scopes?: string[] }>;
        };
        let idFixed = false;
        for (const [, tok] of Object.entries(identity.tokens || {})) {
          const missing = FULL_OPERATOR_SCOPES.filter(s => !(tok.scopes || []).includes(s));
          if (missing.length > 0) {
            tok.scopes = FULL_OPERATOR_SCOPES;
            idFixed = true;
          }
        }
        if (idFixed) {
          writeFileSync(identityPath, JSON.stringify(identity, null, 2) + '\n');
        }
      } catch {
        // Non-fatal — paired.json fix is the critical one
      }
    }

    return { ok: true, message: 'Upgraded gateway device scopes', needsRestart: true };
  } catch (err) {
    return {
      ok: false,
      message: `Failed to fix device scopes: ${err instanceof Error ? err.message : String(err)}`,
      needsRestart: false,
    };
  }
}

/**
 * Approve all pending device pairing requests via the CLI.
 * Call after fixing scopes + restarting the gateway.
 */
export function approveAllPendingDevices(): { ok: boolean; approved: number; message: string } {
  try {
    const listOutput = execSync('openclaw devices list --json 2>/dev/null || echo "[]"', {
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();

    // Parse pending requests — the CLI may not have --json, fall back to regex
    const pendingIds: string[] = [];
    const requestPattern = /│\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s+│/g;
    let match;
    while ((match = requestPattern.exec(listOutput)) !== null) {
      pendingIds.push(match[1]);
    }

    if (pendingIds.length === 0) {
      return { ok: true, approved: 0, message: 'No pending requests' };
    }

    let approved = 0;
    for (const id of pendingIds) {
      try {
        execSync(`openclaw devices approve ${id}`, { timeout: 10000, stdio: 'pipe' });
        approved++;
      } catch { /* skip individual failures */ }
    }

    return {
      ok: approved > 0,
      approved,
      message: approved > 0 ? `Approved ${approved} pending device(s)` : 'Failed to approve pending devices',
    };
  } catch {
    return { ok: false, approved: 0, message: 'Could not list pending devices' };
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
