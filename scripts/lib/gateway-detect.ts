/**
 * Auto-detect gateway token from the local OpenClaw configuration.
 *
 * Reads ~/.openclaw/openclaw.json and extracts the gateway auth token.
 * This avoids requiring users to manually copy-paste the token during setup.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import crypto from 'node:crypto';
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
    tools?: {
      allow?: string[];
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

    // Extract token — systemd env var takes priority over config file because
    // the gateway process uses the env var when both exist (known 2026.2.19 bug:
    // onboard writes different tokens to the service file and openclaw.json).
    const systemdToken = readSystemdGatewayToken();
    if (systemdToken) {
      result.token = systemdToken;
    } else if (config.gateway?.auth?.token) {
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
 * Read the gateway token from the systemd service file.
 * The gateway process uses this env var over the config file value.
 */
function readSystemdGatewayToken(): string | null {
  const servicePaths = [
    join(HOME, '.config', 'systemd', 'user', 'openclaw-gateway.service'),
    '/etc/systemd/system/openclaw-gateway.service',
  ];
  for (const p of servicePaths) {
    if (!existsSync(p)) continue;
    try {
      const content = readFileSync(p, 'utf-8');
      const match = content.match(/OPENCLAW_GATEWAY_TOKEN=(\S+)/);
      if (match?.[1]) return match[1];
    } catch { /* skip */ }
  }
  return null;
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

const REQUIRED_HTTP_TOOLS = ['cron', 'gateway'] as const;

// Must match the connect metadata sent by Nerve's browser WS client
// (src/hooks/useWebSocket.ts) to avoid OpenClaw 2026.2.26+ metadata-repair prompts.
const NERVE_PAIRED_PLATFORM = 'web';
const NERVE_PAIRED_CLIENT_ID = 'webchat-ui';
const NERVE_PAIRED_CLIENT_MODE = 'webchat';
const NERVE_PAIRED_DISPLAY_NAME = 'Nerve UI';

/**
 * Patch the OpenClaw gateway config to allow required HTTP tools.
 * Adds missing entries in `gateway.tools.allow` (deduped).
 * Returns a result indicating success/failure.
 */
export function patchGatewayToolsAllow(): GatewayPatchResult {
  const result: GatewayPatchResult = { ok: false, message: '', configPath: OPENCLAW_CONFIG };

  if (!existsSync(OPENCLAW_CONFIG)) {
    result.message = `Config not found: ${OPENCLAW_CONFIG}`;
    return result;
  }

  try {
    const raw = readFileSync(OPENCLAW_CONFIG, 'utf-8');
    const config = JSON.parse(raw) as OpenClawConfig;

    config.gateway = config.gateway || {};
    config.gateway.tools = config.gateway.tools || {};
    const allow = Array.isArray(config.gateway.tools.allow) ? config.gateway.tools.allow : [];
    const missing = REQUIRED_HTTP_TOOLS.filter(tool => !allow.includes(tool));

    if (missing.length === 0) {
      result.ok = true;
      result.message = `${REQUIRED_HTTP_TOOLS.join(', ')} already in gateway.tools.allow`;
      return result;
    }

    config.gateway.tools.allow = [...allow, ...missing];

    writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2) + '\n');
    result.ok = true;
    result.message = `Added ${missing.join(', ')} to gateway.tools.allow`;
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
 * Bootstrap paired.json from scratch on a fresh install.
 * Reads the gateway's own device identity and creates the paired file
 * with full operator scopes + a device-auth.json for the CLI.
 */
function bootstrapPairedJson(): { ok: boolean; message: string; needsRestart: boolean } {
  const deviceJsonPath = join(HOME, '.openclaw', 'identity', 'device.json');
  const pairedPath = join(HOME, '.openclaw', 'devices', 'paired.json');
  const deviceAuthPath = join(HOME, '.openclaw', 'identity', 'device-auth.json');

  if (!existsSync(deviceJsonPath)) {
    return { ok: false, message: 'No gateway device identity found', needsRestart: false };
  }

  try {
    const device = JSON.parse(readFileSync(deviceJsonPath, 'utf-8'));
    const deviceId = device.deviceId;
    // Extract raw public key from PEM
    const pubPem = device.publicKeyPem as string;
    const pubDer = crypto.createPublicKey(pubPem).export({ type: 'spki', format: 'der' });
    const rawPub = pubDer.slice(-32);
    const publicKeyB64url = rawPub.toString('base64url');

    const now = Date.now();
    // Use the gateway auth token — the CLI sends this token in connect requests,
    // so the device's stored token must match it.
    const detected = detectGatewayConfig();
    const token = detected.token || crypto.randomBytes(32).toString('base64url');

    // Create paired.json
    const paired: Record<string, unknown> = {
      [deviceId]: {
        deviceId,
        publicKey: publicKeyB64url,
        platform: process.platform,
        clientId: 'gateway-client',
        clientMode: 'backend',
        role: 'operator',
        roles: ['operator'],
        scopes: FULL_OPERATOR_SCOPES,
        tokens: {
          operator: {
            token,
            role: 'operator',
            scopes: FULL_OPERATOR_SCOPES,
            createdAtMs: now,
          },
        },
        createdAtMs: now,
        approvedAtMs: now,
      },
    };

    const devicesDir = join(HOME, '.openclaw', 'devices');
    if (!existsSync(devicesDir)) {
      mkdirSync(devicesDir, { recursive: true, mode: 0o700 });
    }
    writeFileSync(pairedPath, JSON.stringify(paired, null, 2) + '\n', { mode: 0o600 });

    // Create matching device-auth.json so the CLI can connect
    const deviceAuth = {
      version: 1,
      deviceId,
      tokens: {
        operator: {
          token,
          role: 'operator',
          scopes: FULL_OPERATOR_SCOPES,
          updatedAtMs: now,
        },
      },
    };
    writeFileSync(deviceAuthPath, JSON.stringify(deviceAuth, null, 2) + '\n', { mode: 0o600 });

    return { ok: true, message: 'Bootstrapped gateway device with full scopes', needsRestart: true };
  } catch (err) {
    return {
      ok: false,
      message: `Bootstrap failed: ${err instanceof Error ? err.message : String(err)}`,
      needsRestart: false,
    };
  }
}

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
    // Fresh install — no paired.json yet. Bootstrap by creating it with the
    // gateway's own device identity (from identity/device.json) fully scoped.
    return bootstrapPairedJson();
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

    // Parse pending requests — try JSON first, fall back to box-drawing table regex
    const pendingIds: string[] = [];
    try {
      const parsed = JSON.parse(listOutput);
      const items = Array.isArray(parsed?.pending) ? parsed.pending : [];
      for (const item of items) {
        if (item.requestId && typeof item.requestId === 'string') {
          pendingIds.push(item.requestId);
        }
      }
    } catch {
      // Not valid JSON — fall back to table regex
      const requestPattern = /│\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s+│/g;
      let match;
      while ((match = requestPattern.exec(listOutput)) !== null) {
        pendingIds.push(match[1]);
      }
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
 * Pre-pair Nerve's device identity in the gateway's paired.json.
 *
 * Generates the Nerve device identity (Ed25519 keypair) if it doesn't exist,
 * then registers it directly in paired.json with full operator scopes.
 * This means Nerve can connect to the gateway immediately on first start
 * without any manual `openclaw devices approve` step.
 */
export function prePairNerveDevice(gatewayToken?: string): { ok: boolean; message: string; needsRestart: boolean } {
  const nerveDir = process.env.NERVE_DATA_DIR
    || join(process.env.HOME || HOME, '.nerve');
  const identityPath = join(nerveDir, 'device-identity.json');
  const pairedPath = join(HOME, '.openclaw', 'devices', 'paired.json');

  if (!existsSync(pairedPath)) {
    // fixGatewayDeviceScopes should have created this — but handle gracefully
    return { ok: false, message: 'No paired devices file — run fixGatewayDeviceScopes first', needsRestart: false };
  }

  try {
    // Load or generate Nerve device identity
    let deviceId: string;
    let publicKeyB64url: string;

    if (existsSync(identityPath)) {
      const stored = JSON.parse(readFileSync(identityPath, 'utf-8'));
      deviceId = stored.deviceId;
      publicKeyB64url = stored.publicKeyB64url;
    } else {
      // Generate new Ed25519 keypair (same logic as server/lib/device-identity.ts)
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const pubDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
      const rawPub = pubDer.slice(-32);
      publicKeyB64url = rawPub.toString('base64url');
      deviceId = crypto.createHash('sha256').update(rawPub).digest('hex');
      const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

      // Persist identity
      if (!existsSync(nerveDir)) {
        mkdirSync(nerveDir, { recursive: true, mode: 0o700 });
      }
      writeFileSync(identityPath, JSON.stringify({
        deviceId,
        publicKeyB64url,
        privateKeyPem,
        createdAt: new Date().toISOString(),
      }, null, 2) + '\n', { mode: 0o600 });
    }

    // Register in paired.json
    const paired = JSON.parse(readFileSync(pairedPath, 'utf-8')) as Record<string, unknown>;

    // Use the gateway auth token — Nerve's WS proxy forwards the browser's
    // connect request which includes this token. The gateway validates that
    // the token in the connect request matches the device's stored token.
    const now = Date.now();
    const token = gatewayToken || detectGatewayConfig().token || crypto.randomBytes(32).toString('base64url');

    // Update metadata/token if device already exists
    if (paired[deviceId]) {
      const existing = paired[deviceId] as {
        displayName?: string;
        platform?: string;
        clientId?: string;
        clientMode?: string;
        tokens?: Record<string, {
          token?: string;
          role?: string;
          scopes?: string[];
          createdAtMs?: number;
        }>;
      };

      let changed = false;
      const changedFields: string[] = [];

      // Keep token aligned with gateway auth token used by Nerve
      if (!existing.tokens) {
        existing.tokens = {};
        changed = true;
      }
      if (!existing.tokens.operator) {
        existing.tokens.operator = {
          token,
          role: 'operator',
          scopes: FULL_OPERATOR_SCOPES,
          createdAtMs: now,
        };
        changed = true;
        changedFields.push('token');
      } else if (existing.tokens.operator.token !== token) {
        existing.tokens.operator.token = token;
        changed = true;
        changedFields.push('token');
      }

      // OpenClaw 2026.2.26+ pins platform/device metadata on paired devices.
      // These must match the browser connect metadata Nerve sends.
      if (existing.platform !== NERVE_PAIRED_PLATFORM) {
        existing.platform = NERVE_PAIRED_PLATFORM;
        changed = true;
        changedFields.push('platform');
      }
      if (existing.clientId !== NERVE_PAIRED_CLIENT_ID) {
        existing.clientId = NERVE_PAIRED_CLIENT_ID;
        changed = true;
        changedFields.push('clientId');
      }
      if (existing.clientMode !== NERVE_PAIRED_CLIENT_MODE) {
        existing.clientMode = NERVE_PAIRED_CLIENT_MODE;
        changed = true;
        changedFields.push('clientMode');
      }
      if (existing.displayName !== NERVE_PAIRED_DISPLAY_NAME) {
        existing.displayName = NERVE_PAIRED_DISPLAY_NAME;
        changed = true;
        changedFields.push('displayName');
      }

      if (!changed) {
        return { ok: true, message: 'Nerve device already paired', needsRestart: false };
      }

      writeFileSync(pairedPath, JSON.stringify(paired, null, 2) + '\n');
      const fieldsLabel = changedFields.length > 0 ? ` (${changedFields.join(', ')})` : '';
      return {
        ok: true,
        message: `Updated Nerve paired device ${deviceId.substring(0, 12)}…${fieldsLabel}`,
        needsRestart: true,
      };
    }

    paired[deviceId] = {
      deviceId,
      publicKey: publicKeyB64url,
      displayName: NERVE_PAIRED_DISPLAY_NAME,
      platform: NERVE_PAIRED_PLATFORM,
      clientId: NERVE_PAIRED_CLIENT_ID,
      clientMode: NERVE_PAIRED_CLIENT_MODE,
      role: 'operator',
      roles: ['operator'],
      scopes: FULL_OPERATOR_SCOPES,
      tokens: {
        operator: {
          token,
          role: 'operator',
          scopes: FULL_OPERATOR_SCOPES,
          createdAtMs: now,
        },
      },
      createdAtMs: now,
      approvedAtMs: now,
    };

    writeFileSync(pairedPath, JSON.stringify(paired, null, 2) + '\n');
    return { ok: true, message: `Pre-paired Nerve device ${deviceId.substring(0, 12)}…`, needsRestart: true };
  } catch (err) {
    return {
      ok: false,
      message: `Failed to pre-pair: ${err instanceof Error ? err.message : String(err)}`,
      needsRestart: false,
    };
  }
}

// ── Detection layer ──────────────────────────────────────────────────

export interface ConfigChange {
  id: string;
  description: string;
  apply: () => { ok: boolean; message: string; needsRestart: boolean };
}

/**
 * Detect whether gateway-side operator scopes need repair/bootstrap.
 */
function needsDeviceScopeFix(): boolean {
  const pairedPath = join(HOME, '.openclaw', 'devices', 'paired.json');

  if (!existsSync(pairedPath)) {
    // Fresh install — needs bootstrap if the gateway identity exists
    const deviceJsonPath = join(HOME, '.openclaw', 'identity', 'device.json');
    return existsSync(deviceJsonPath);
  }

  try {
    const raw = readFileSync(pairedPath, 'utf-8');
    const paired = JSON.parse(raw) as Record<string, { scopes?: string[] }>;

    for (const [, device] of Object.entries(paired)) {
      const currentScopes = device.scopes || [];
      const missing = FULL_OPERATOR_SCOPES.filter(s => !currentScopes.includes(s));
      if (missing.length > 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Detect whether Nerve device pre-pairing is needed.
 * Returns false when paired.json is absent; device-scope bootstrap will create it first.
 */
function needsPrePair(gatewayToken?: string): boolean {
  const nerveDir = process.env.NERVE_DATA_DIR || join(process.env.HOME || HOME, '.nerve');
  const identityPath = join(nerveDir, 'device-identity.json');
  const pairedPath = join(HOME, '.openclaw', 'devices', 'paired.json');

  if (!existsSync(pairedPath)) return false;

  try {
    const paired = JSON.parse(readFileSync(pairedPath, 'utf-8')) as Record<string, unknown>;

    if (!existsSync(identityPath)) return true; // No Nerve identity yet

    const stored = JSON.parse(readFileSync(identityPath, 'utf-8'));
    const deviceId = stored.deviceId;

    if (!paired[deviceId]) return true; // Nerve not registered

    const existing = paired[deviceId] as {
      displayName?: string;
      platform?: string;
      clientId?: string;
      clientMode?: string;
      tokens?: Record<string, { token?: string }>;
    };

    // Check token match — if no token is available, assume mismatch (apply will generate one)
    const token = gatewayToken || detectGatewayConfig().token;
    if (!token) return true;
    if (existing.tokens?.operator?.token !== token) return true;

    // OpenClaw 2026.2.26+ metadata pinning requires these to match runtime connect metadata.
    if (existing.platform !== NERVE_PAIRED_PLATFORM) return true;
    if (existing.clientId !== NERVE_PAIRED_CLIENT_ID) return true;
    if (existing.clientMode !== NERVE_PAIRED_CLIENT_MODE) return true;
    if (existing.displayName !== NERVE_PAIRED_DISPLAY_NAME) return true;

    return false;
  } catch {
    return false;
  }
}

/**
 * Detect whether gateway.tools.allow is missing required HTTP tools.
 */
function needsToolsAllow(): boolean {
  if (!existsSync(OPENCLAW_CONFIG)) return false;

  try {
    const raw = readFileSync(OPENCLAW_CONFIG, 'utf-8');
    const config = JSON.parse(raw) as OpenClawConfig;
    const allow = Array.isArray(config.gateway?.tools?.allow) ? config.gateway.tools.allow : [];
    return REQUIRED_HTTP_TOOLS.some(tool => !allow.includes(tool));
  } catch {
    return false;
  }
}

/**
 * Detect whether a specific origin is missing from gateway.controlUi.allowedOrigins.
 */
function needsOriginPatch(origin: string): boolean {
  if (!existsSync(OPENCLAW_CONFIG)) return false;

  try {
    const raw = readFileSync(OPENCLAW_CONFIG, 'utf-8');
    const config = JSON.parse(raw) as OpenClawConfig;
    const origins = config.gateway?.controlUi?.allowedOrigins || [];
    return !origins.includes(origin);
  } catch {
    return false;
  }
}

/**
 * Detect which gateway config changes are needed without applying them.
 * Returns an array of pending changes with descriptions and apply functions.
 */
export function detectNeededConfigChanges(opts: {
  nerveOrigin?: string;
  nerveHttpsOrigin?: string;
  allowedOrigins?: string[];
  gatewayToken?: string;
}): ConfigChange[] {
  const changes: ConfigChange[] = [];

  const deviceScopeFixNeeded = needsDeviceScopeFix();

  if (deviceScopeFixNeeded) {
    changes.push({
      id: 'device-scopes',
      description: 'Fix gateway device scopes (required for Nerve to connect)',
      apply: () => fixGatewayDeviceScopes(),
    });
  }

  // If device-scopes will bootstrap paired.json, always include pre-pair
  // (paired.json won't exist yet for detection, but will after device-scopes runs)
  if (deviceScopeFixNeeded || needsPrePair(opts.gatewayToken)) {
    changes.push({
      id: 'pre-pair',
      description: 'Pre-pair Nerve device identity (skip manual approval step)',
      apply: () => prePairNerveDevice(opts.gatewayToken),
    });
  }

  if (needsToolsAllow()) {
    changes.push({
      id: 'tools-allow',
      description: 'Allow cron + gateway tools on /tools/invoke (needed for cron and gateway management)',
      apply: () => {
        const r = patchGatewayToolsAllow();
        return { ok: r.ok, message: r.message, needsRestart: r.ok };
      },
    });
  }

  const trimmedNerveOrigin = opts.nerveOrigin?.trim() || undefined;
  const trimmedNerveHttpsOrigin = opts.nerveHttpsOrigin?.trim() || undefined;

  const origins = [...new Set([
    ...(opts.allowedOrigins || []),
    trimmedNerveOrigin,
    trimmedNerveHttpsOrigin,
  ].map(origin => origin?.trim()).filter((origin): origin is string => Boolean(origin)))];

  for (const origin of origins) {
    if (!needsOriginPatch(origin)) continue;

    let id = `allowed-origins:${origin}`;
    if (origin === trimmedNerveOrigin) id = 'allowed-origins';
    else if (origin === trimmedNerveHttpsOrigin) id = 'allowed-origins-https';

    changes.push({
      id,
      description: `Add ${origin} to allowed origins (needed for WebSocket)`,
      apply: () => {
        const r = patchGatewayAllowedOrigins(origin);
        return { ok: r.ok, message: r.message, needsRestart: r.ok };
      },
    });
  }

  return changes;
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
