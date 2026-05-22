import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type TelemetryMode = 'off' | 'minimal' | 'detailed';
export type InstallMethod = 'release' | 'source' | 'unknown';
export type MetadataSource = 'install.sh' | 'setup' | 'runtime';
export type BootstrapKind = 'fresh_install' | 'upgrade_legacy';

export interface IdentityRecord {
  instanceId: string;
  createdAt: string;
}

export interface InstallMethodStamp {
  installMethod: InstallMethod;
  stampedAt: string;
  source: MetadataSource;
}

export interface BootstrapMarker {
  kind: BootstrapKind;
  stampedAt: string;
  source: MetadataSource;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.NERVE_PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');
const IDENTITY_FILE = 'identity.json';
const INSTALL_METHOD_FILE = 'install-method.json';
const BOOTSTRAP_FILE = 'bootstrap.json';
let cachedInstanceId: string | undefined;

function telemetryDir(): string {
  return process.env.NERVE_TELEMETRY_DIR || path.join(PROJECT_ROOT, '.nerve', 'telemetry');
}

function telemetryPath(fileName: string): string {
  return path.join(telemetryDir(), fileName);
}

function ensureTelemetryDir(): string {
  const dir = telemetryDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function telemetryWriteErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Returns the parsed JSON as unknown so callers must validate the shape before
// trusting any field. A previous `as T` cast made every caller's downstream
// property access type-checked against a lie.
function readJsonFile(fileName: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(telemetryPath(fileName), 'utf8'));
  } catch {
    return undefined;
  }
}

// Atomic write: serialize to a temp file then rename into place so a crash or
// disk-full mid-write leaves the original file untouched. Without this, a
// half-written identity.json would parse as invalid JSON on next start,
// triggering a fresh instanceId generation and silently rotating the anonymous
// install identity.
function writeJsonFile(fileName: string, value: unknown): void {
  try {
    ensureTelemetryDir();
    const target = telemetryPath(fileName);
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(tmp, target);
  } catch (error) {
    console.warn(`[telemetry] Failed to write ${fileName}:`, telemetryWriteErrorMessage(error));
  }
}

function isInstallMethod(value: unknown): value is InstallMethod {
  return value === 'release' || value === 'source' || value === 'unknown';
}

function isMetadataSource(value: unknown): value is MetadataSource {
  return value === 'install.sh' || value === 'setup' || value === 'runtime';
}

function isBootstrapKind(value: unknown): value is BootstrapKind {
  return value === 'fresh_install' || value === 'upgrade_legacy';
}

function normalizeTelemetryMode(value: string | null | undefined): TelemetryMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;

  if (normalized === 'off' || normalized === 'minimal' || normalized === 'detailed') {
    return normalized;
  }

  return undefined;
}

function hasExplicitTelemetryModeInput(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.length > 0;
}

function asRecord(value: unknown): Partial<Record<string, unknown>> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<Record<string, unknown>>)
    : undefined;
}

export function readIdentity(): IdentityRecord | undefined {
  const identity = asRecord(readJsonFile(IDENTITY_FILE));
  if (!identity || typeof identity.instanceId !== 'string' || !identity.instanceId) {
    return undefined;
  }

  return {
    instanceId: identity.instanceId,
    createdAt: typeof identity.createdAt === 'string' && identity.createdAt
      ? identity.createdAt
      : new Date(0).toISOString(),
  };
}

export function writeIdentity(instanceId: string, createdAt = new Date().toISOString()): IdentityRecord {
  const record: IdentityRecord = { instanceId, createdAt };
  writeJsonFile(IDENTITY_FILE, record);
  return record;
}

export function ensureInstanceId(createdAt = new Date().toISOString()): string {
  if (cachedInstanceId) {
    return cachedInstanceId;
  }

  const current = readIdentity();
  if (current?.instanceId) {
    cachedInstanceId = current.instanceId;
    return current.instanceId;
  }

  const instanceId = crypto.randomUUID();
  // Keep a process-lifetime fallback when the filesystem is read-only or broken,
  // so one bad write does not rotate the anonymous id on every call.
  cachedInstanceId = instanceId;
  writeIdentity(instanceId, createdAt);
  return instanceId;
}

export function readInstallMethod(): InstallMethodStamp | undefined {
  const stamp = asRecord(readJsonFile(INSTALL_METHOD_FILE));
  if (!stamp || !isInstallMethod(stamp.installMethod) || !isMetadataSource(stamp.source) || typeof stamp.stampedAt !== 'string' || !stamp.stampedAt) {
    return undefined;
  }

  return {
    installMethod: stamp.installMethod,
    stampedAt: stamp.stampedAt,
    source: stamp.source,
  };
}

export function writeInstallMethod(
  installMethod: InstallMethod,
  source: MetadataSource,
  stampedAt = new Date().toISOString(),
): InstallMethodStamp {
  const stamp: InstallMethodStamp = { installMethod, stampedAt, source };
  writeJsonFile(INSTALL_METHOD_FILE, stamp);
  return stamp;
}

export function readInstallMethodOrUnknown(stamp = readInstallMethod()): InstallMethod {
  return stamp?.installMethod || 'unknown';
}

export function readBootstrapMarker(): BootstrapMarker | undefined {
  const marker = asRecord(readJsonFile(BOOTSTRAP_FILE));
  if (!marker || !isBootstrapKind(marker.kind) || !isMetadataSource(marker.source) || typeof marker.stampedAt !== 'string' || !marker.stampedAt) {
    return undefined;
  }

  return {
    kind: marker.kind,
    stampedAt: marker.stampedAt,
    source: marker.source,
  };
}

export function writeBootstrapMarker(
  kind: BootstrapKind,
  source: MetadataSource,
  stampedAt = new Date().toISOString(),
): BootstrapMarker {
  const marker: BootstrapMarker = { kind, stampedAt, source };
  writeJsonFile(BOOTSTRAP_FILE, marker);
  return marker;
}

export function isTrustedFreshInstallBootstrap(bootstrap: BootstrapMarker | undefined): boolean {
  return !!bootstrap
    && bootstrap.kind === 'fresh_install'
    && (bootstrap.source === 'install.sh' || bootstrap.source === 'setup');
}

export function resolveTelemetryMode(params: {
  envMode?: string | null;
  bootstrap?: BootstrapMarker;
}): TelemetryMode {
  const explicitMode = normalizeTelemetryMode(params.envMode);
  if (explicitMode) return explicitMode;

  if (hasExplicitTelemetryModeInput(params.envMode)) {
    return 'off';
  }

  return isTrustedFreshInstallBootstrap(params.bootstrap) ? 'minimal' : 'off';
}

export function ensureLegacyUpgradeMarker(params: {
  envMode?: string | null;
  stampedAt?: string;
} = {}): BootstrapMarker | undefined {
  const current = readBootstrapMarker();
  if (isTrustedFreshInstallBootstrap(current) || current?.kind === 'upgrade_legacy') {
    return current;
  }

  if (hasExplicitTelemetryModeInput(params.envMode)) {
    return current;
  }

  return writeBootstrapMarker('upgrade_legacy', 'runtime', params.stampedAt);
}
