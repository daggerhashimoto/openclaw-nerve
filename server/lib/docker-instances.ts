import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DOCKER_TIMEOUT_MS = 4_000;
const DOCKER_MAX_BUFFER = 8 * 1024 * 1024;
const OPENCLAW_HINT_RE = /openclaw|multiclaw|multi-claw/i;
const TOKEN_ENV_KEYS = ['OPENCLAW_GATEWAY_TOKEN', 'GATEWAY_TOKEN'] as const;
const DEFAULT_MULTICLAW_IMAGE = 'multiclaw:latest';

const ENV_CONFIG_KEY_PREFIX = 'ENV:';
const OPENCLAW_JSON_CONFIG_KEY_PREFIX = 'OPENCLAW_JSON:';
const OPENCLAW_JSON_ENTRY_KEY_PREFIX = 'OPENCLAW_JSON_ENTRY:';
const AUTH_PROFILE_KEY_PREFIX = 'AUTH_PROFILE:';

const LEGACY_COPYABLE_ENV_KEYS = [
  'OPENAI_API_KEY',
  'REPLICATE_API_TOKEN',
] as const;
const NON_COPYABLE_ENV_KEYS = new Set(['GATEWAY_TOKEN', 'OPENCLAW_GATEWAY_TOKEN']);
const ENV_TEMPLATE_RE = /\$\{([A-Z][A-Z0-9_]{0,127})\}/g;
const MODEL_CREDENTIAL_ENV_KEYS = new Set([
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_OAUTH_TOKEN',
  'OPENROUTER_API_KEY',
  'GEMINI_API_KEY',
  'ZAI_API_KEY',
  'MINIMAX_API_KEY',
  'SYNTHETIC_API_KEY',
  'KILOCODE_API_KEY',
]);

export const COPYABLE_MASTER_CREDENTIAL_KEYS = LEGACY_COPYABLE_ENV_KEYS.map((key) => `${ENV_CONFIG_KEY_PREFIX}${key}`) as readonly string[];

function resolveOpenclawStateDir(): string {
  return process.env.OPENCLAW_STATE_DIR?.trim() || path.join(os.homedir(), '.openclaw');
}

function resolveOpenclawGlobalEnvPath(): string {
  return path.join(resolveOpenclawStateDir(), '.env');
}

function resolveOpenclawConfigPath(): string {
  return path.join(resolveOpenclawStateDir(), 'openclaw.json');
}

function resolveOpenclawAuthProfilesPath(): string {
  const agentDir = process.env.OPENCLAW_AGENT_DIR?.trim() || path.join(resolveOpenclawStateDir(), 'agents', 'main', 'agent');
  return path.join(agentDir, 'auth-profiles.json');
}

function resolveMulticlawInstanceRoot(): string {
  return process.env.MULTICLAW_INSTANCE_ROOT?.trim() || path.join(resolveOpenclawStateDir(), 'multiclaw-instances');
}

export interface InstancePort {
  containerPort: number;
  protocol: string;
  hostIp: string | null;
  hostPort: number | null;
}

export interface LocalInstanceSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  createdAt: string | null;
  labels: Record<string, string>;
  ports: InstancePort[];
  hasGatewayToken: boolean;
  availability: 'ready' | 'initializing' | 'unreachable';
  gateway: 'ok' | 'unreachable';
}

const DEFAULT_GATEWAY_CONTAINER_PORTS = [3181, 18789] as const;
const DEFAULT_NERVE_CONTAINER_PORT = 3080;

export interface InstanceTokenResult {
  instanceId: string;
  found: boolean;
  token: string | null;
  tokenKey: string | null;
}

export interface CopyableMasterCredential {
  key: string;
  isSet: boolean;
}

interface AuthProfileStoreLike {
  version?: number;
  profiles?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CreateDockerInstanceInput {
  name: string;
  credentialKeys: string[];
}

export interface CreateDockerInstanceResult {
  type: 'docker';
  image: string;
  instance: LocalInstanceSummary;
  copiedCredentialKeys: string[];
}

export class DockerCommandError extends Error {
  code: 'docker_unavailable' | 'docker_permission_denied' | 'docker_command_failed';
  constructor(code: DockerCommandError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

interface DockerInspect {
  Id?: string;
  Name?: string;
  Created?: string;
  Config?: {
    Image?: string;
    Env?: string[];
    Labels?: Record<string, string>;
  };
  State?: {
    Status?: string;
  };
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
  };
  Mounts?: Array<{
    Source?: string;
    Destination?: string;
  }>;
}

type DockerPortBindings = Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;

function runDocker(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'docker',
      args,
      { timeout: DOCKER_TIMEOUT_MS, maxBuffer: DOCKER_MAX_BUFFER },
      (err, stdout, stderr) => {
        if (!err) {
          resolve(stdout);
          return;
        }

        const message = `${(err as Error).message} ${stderr || ''}`.trim();
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          reject(new DockerCommandError('docker_unavailable', 'Docker CLI not found on PATH.'));
          return;
        }
        if (/permission denied|got permission denied/i.test(message)) {
          reject(new DockerCommandError('docker_permission_denied', 'Permission denied while accessing Docker daemon.'));
          return;
        }
        if (/Cannot connect to the Docker daemon/i.test(message)) {
          reject(new DockerCommandError('docker_unavailable', 'Docker daemon is not reachable.'));
          return;
        }
        reject(new DockerCommandError('docker_command_failed', message || 'Docker command failed.'));
      },
    );
  });
}

function parseEnvPairs(env: string[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(env)) return out;
  for (const entry of env) {
    const splitAt = entry.indexOf('=');
    if (splitAt <= 0) continue;
    const key = entry.slice(0, splitAt);
    const value = entry.slice(splitAt + 1);
    out.set(key, value);
  }
  return out;
}

function isCopyableMasterCredentialKey(key: string): boolean {
  return listAllowedMasterCredentialKeys().has(key);
}

type JsonPrimitive = string | number | boolean;

function readOpenclawConfigObject(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(resolveOpenclawConfigPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getJsonPathValue(root: Record<string, unknown>, pathSegments: string[]): unknown {
  let cursor: unknown = root;
  for (const segment of pathSegments) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function setJsonPathValue(root: Record<string, unknown>, pathSegments: string[], value: unknown): void {
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < pathSegments.length - 1; i++) {
    const segment = pathSegments[i];
    const next = cursor[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[pathSegments[pathSegments.length - 1]] = value;
}

function listOpenclawJsonConfigurationKeys(): string[] {
  const cfg = readOpenclawConfigObject();
  const found = new Set<string>();

  const skillsEntries = getJsonPathValue(cfg, ['skills', 'entries']);
  if (skillsEntries && typeof skillsEntries === 'object' && !Array.isArray(skillsEntries)) {
    for (const key of Object.keys(skillsEntries as Record<string, unknown>)) {
      found.add(`${OPENCLAW_JSON_ENTRY_KEY_PREFIX}skills.entries.${key}`);
    }
  }

  const channels = getJsonPathValue(cfg, ['channels']);
  if (channels && typeof channels === 'object' && !Array.isArray(channels)) {
    for (const key of Object.keys(channels as Record<string, unknown>)) {
      found.add(`${OPENCLAW_JSON_ENTRY_KEY_PREFIX}channels.${key}`);
    }
  }

  return [...found].sort((a, b) => a.localeCompare(b));
}

function listEnvConfigurationKeys(): string[] {
  const envFileEntries = parseDotEnvShallow(resolveOpenclawGlobalEnvPath());
  const discovered = [...envFileEntries.keys()]
    .filter((key) => /(?:^|_)(?:API_KEY|API_TOKEN|ACCESS_TOKEN|AUTH_TOKEN|SECRET|TOKEN)$/.test(key))
    .filter((key) => !NON_COPYABLE_ENV_KEYS.has(key))
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${ENV_CONFIG_KEY_PREFIX}${key}`);

  return [...new Set([...COPYABLE_MASTER_CREDENTIAL_KEYS, ...discovered])].sort((a, b) => a.localeCompare(b));
}

function listAllowedMasterCredentialKeys(): Set<string> {
  return new Set<string>([
    ...listEnvConfigurationKeys(),
    ...listOpenclawJsonConfigurationKeys(),
  ]);
}

function parseDotEnvShallow(filePath: string): Map<string, string> {
  const out = new Map<string, string>();
  let raw = '';
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return out;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!key) continue;
    let value = withoutExport.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }

  return out;
}

function resolveMasterCredentialValue(key: string): string | null {
  if (key.startsWith(ENV_CONFIG_KEY_PREFIX)) {
    const envKey = key.slice(ENV_CONFIG_KEY_PREFIX.length).trim();
    if (!envKey) return null;
    const fromOpenClawEnv = parseDotEnvShallow(resolveOpenclawGlobalEnvPath()).get(envKey)?.trim();
    return fromOpenClawEnv || null;
  }

  if (key.startsWith(OPENCLAW_JSON_CONFIG_KEY_PREFIX) || key.startsWith(OPENCLAW_JSON_ENTRY_KEY_PREFIX)) {
    const prefix = key.startsWith(OPENCLAW_JSON_ENTRY_KEY_PREFIX) ? OPENCLAW_JSON_ENTRY_KEY_PREFIX : OPENCLAW_JSON_CONFIG_KEY_PREFIX;
    const jsonPath = key.slice(prefix.length).trim();
    if (!jsonPath) return null;
    const value = getJsonPathValue(readOpenclawConfigObject(), jsonPath.split('.').filter(Boolean));
    if (typeof value === 'string') return value.trim() || null;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value && typeof value === 'object') return JSON.stringify(value);
  }

  return null;
}

function readAuthProfileStore(): AuthProfileStoreLike | null {
  try {
    const raw = fs.readFileSync(resolveOpenclawAuthProfilesPath(), 'utf8');
    const parsed = JSON.parse(raw) as AuthProfileStoreLike;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function listAvailableAuthProfileCredentialKeys(): string[] {
  const store = readAuthProfileStore();
  const profiles = store?.profiles;
  if (!profiles || typeof profiles !== 'object') return [];
  return Object.keys(profiles)
    .filter((profileId) => profileId.trim().length > 0)
    .sort((a, b) => a.localeCompare(b))
    .map((profileId) => `${AUTH_PROFILE_KEY_PREFIX}${profileId}`);
}

function selectedAuthProfileIds(credentialKeys: string[]): string[] {
  return credentialKeys
    .filter((key) => key.startsWith(AUTH_PROFILE_KEY_PREFIX))
    .map((key) => key.slice(AUTH_PROFILE_KEY_PREFIX.length).trim())
    .filter(Boolean);
}

function hasSelectedModelCredentialEnvKey(credentialKeys: string[]): boolean {
  return credentialKeys.some((key) => {
    if (!key.startsWith(ENV_CONFIG_KEY_PREFIX)) return false;
    const envKey = key.slice(ENV_CONFIG_KEY_PREFIX.length).trim();
    return MODEL_CREDENTIAL_ENV_KEYS.has(envKey);
  });
}

function resolveAutoAuthProfileKey(): string | null {
  const available = listAvailableAuthProfileCredentialKeys();
  if (available.length === 0) return null;

  const store = readAuthProfileStore();
  const lastGood = (store?.lastGood && typeof store.lastGood === 'object' && !Array.isArray(store.lastGood))
    ? (store.lastGood as Record<string, unknown>)
    : null;

  const preferredProviders = ['openai-codex', 'anthropic', 'openai'];
  for (const provider of preferredProviders) {
    const profileId = typeof lastGood?.[provider] === 'string' ? String(lastGood?.[provider]).trim() : '';
    if (!profileId) continue;
    const key = `${AUTH_PROFILE_KEY_PREFIX}${profileId}`;
    if (available.includes(key)) return key;
  }

  const preferredPrefix = `${AUTH_PROFILE_KEY_PREFIX}openai-codex:`;
  const openaiCodex = available.find((key) => key.startsWith(preferredPrefix));
  if (openaiCodex) return openaiCodex;

  return available[0] || null;
}

function normalizeCredentialKeysWithDefaultAuthProfile(credentialKeys: string[]): string[] {
  const deduped = [...new Set(credentialKeys.map((key) => key.trim()).filter(Boolean))];
  if (selectedAuthProfileIds(deduped).length > 0) return deduped;
  if (hasSelectedModelCredentialEnvKey(deduped)) return deduped;

  const autoProfileKey = resolveAutoAuthProfileKey();
  if (!autoProfileKey) return deduped;

  return [...deduped, autoProfileKey];
}

function buildFilteredAuthStore(selectedProfileIds: string[]): AuthProfileStoreLike | null {
  if (selectedProfileIds.length === 0) return null;

  const source = readAuthProfileStore();
  if (!source?.profiles || typeof source.profiles !== 'object') return null;

  const selectedSet = new Set(selectedProfileIds);
  const filteredProfiles = Object.fromEntries(
    Object.entries(source.profiles).filter(([profileId]) => selectedSet.has(profileId)),
  );

  const nextStore: AuthProfileStoreLike = {
    ...source,
    profiles: filteredProfiles,
  };

  if (Array.isArray(nextStore.authOrder)) {
    nextStore.authOrder = nextStore.authOrder.filter(
      (id) => typeof id === 'string' && selectedSet.has(id),
    );
  }

  return nextStore;
}

function resolveSelectedCredentialValues(credentialKeys: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const key of credentialKeys) {
    if (!isCopyableMasterCredentialKey(key)) continue;
    const value = resolveMasterCredentialValue(key);
    if (!value) continue;
    out.set(key, value);
  }
  return out;
}

function normalizeEnvEntries(selected: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of selected.entries()) {
    if (!key.startsWith(ENV_CONFIG_KEY_PREFIX)) continue;
    const envKey = key.slice(ENV_CONFIG_KEY_PREFIX.length).trim();
    if (!envKey) continue;
    out.set(envKey, value);
  }
  return out;
}

function applySelectedJsonConfigEntries(selected: Map<string, string>, target: Record<string, unknown>): void {
  for (const [key, value] of selected.entries()) {
    const isLegacyPath = key.startsWith(OPENCLAW_JSON_CONFIG_KEY_PREFIX);
    const isEntryPath = key.startsWith(OPENCLAW_JSON_ENTRY_KEY_PREFIX);
    if (!isLegacyPath && !isEntryPath) continue;

    const prefix = isEntryPath ? OPENCLAW_JSON_ENTRY_KEY_PREFIX : OPENCLAW_JSON_CONFIG_KEY_PREFIX;
    const jsonPath = key.slice(prefix.length).trim();
    if (!jsonPath) continue;

    if (isEntryPath) {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (parsed && typeof parsed === 'object') {
          setJsonPathValue(target, jsonPath.split('.').filter(Boolean), parsed);
          continue;
        }
      } catch {
        // fall back to string assignment
      }
    }

    setJsonPathValue(target, jsonPath.split('.').filter(Boolean), value);
  }
}

function collectEnvTemplateNames(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    ENV_TEMPLATE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ENV_TEMPLATE_RE.exec(value)) !== null) {
      out.add(match[1]);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectEnvTemplateNames(item, out);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    collectEnvTemplateNames(item, out);
  }
}

function isSecretRefObject(value: unknown): value is { source: string; provider: string; id: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    (record.source === 'env' || record.source === 'file' || record.source === 'exec')
    && typeof record.provider === 'string'
    && record.provider.trim().length > 0
    && typeof record.id === 'string'
    && record.id.trim().length > 0
  );
}

function containsSecretRefObject(value: unknown): boolean {
  if (isSecretRefObject(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsSecretRefObject(item));
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  return Object.values(value as Record<string, unknown>).some((item) => containsSecretRefObject(item));
}

function parseSelectedJsonValue(key: string, value: string): unknown {
  const isLegacyPath = key.startsWith(OPENCLAW_JSON_CONFIG_KEY_PREFIX);
  const isEntryPath = key.startsWith(OPENCLAW_JSON_ENTRY_KEY_PREFIX);
  if (!isLegacyPath && !isEntryPath) return undefined;
  if (!isEntryPath) return value;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function collectSelectedJsonDependencies(selected: Map<string, string>): {
  referencedEnvKeys: Set<string>;
  hasSecretRefs: boolean;
} {
  const referencedEnvKeys = new Set<string>();
  let hasSecretRefs = false;

  for (const [key, value] of selected.entries()) {
    const parsed = parseSelectedJsonValue(key, value);
    if (parsed === undefined) continue;

    collectEnvTemplateNames(parsed, referencedEnvKeys);
    if (!hasSecretRefs && containsSecretRefObject(parsed)) {
      hasSecretRefs = true;
    }
  }

  return { referencedEnvKeys, hasSecretRefs };
}

async function resolveFirstLocalMulticlawImage(): Promise<string | null> {
  try {
    const stdout = await runDocker(['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}']);
    const images = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.includes('<none>'));

    const exactDefault = images.find((image) => image === DEFAULT_MULTICLAW_IMAGE);
    if (exactDefault) return exactDefault;

    const firstMulticlaw = images.find((image) => /(^|[\/\-_.])multiclaw([:\/\-_.]|$)/i.test(image));
    if (firstMulticlaw) return firstMulticlaw;

    return null;
  } catch {
    return null;
  }
}

async function resolvePreferredMulticlawImage(): Promise<string> {
  const configured = process.env.MULTICLAW_DEFAULT_IMAGE?.trim();
  if (configured) return configured;

  const localMulticlawImage = await resolveFirstLocalMulticlawImage();
  if (localMulticlawImage) return localMulticlawImage;

  const containerId = process.env.HOSTNAME?.trim() || '';
  if (/^[a-f0-9]{12,64}$/i.test(containerId)) {
    try {
      const inspected = await inspectContainers([containerId]);
      const image = inspected[0]?.Config?.Image?.trim();
      if (image) return image;
    } catch {
      // fall through to instance-derived/fallback image selection
    }
  }

  try {
    const discovered = await listLocalOpenClawInstances();
    const firstImage = discovered.find((instance) => instance.image?.trim())?.image?.trim();
    if (firstImage) return firstImage;
  } catch {
    // keep fallback
  }

  return DEFAULT_MULTICLAW_IMAGE;
}

function parsePorts(ports: DockerPortBindings | undefined): InstancePort[] {
  const out: InstancePort[] = [];
  if (!ports) return out;

  for (const [containerKey, bindings] of Object.entries(ports)) {
    const slashIdx = containerKey.lastIndexOf('/');
    if (slashIdx <= 0) continue;
    const containerPort = Number.parseInt(containerKey.slice(0, slashIdx), 10);
    const protocol = containerKey.slice(slashIdx + 1) || 'tcp';
    if (!Number.isFinite(containerPort)) continue;

    if (!bindings || bindings.length === 0) {
      out.push({ containerPort, protocol, hostIp: null, hostPort: null });
      continue;
    }

    for (const binding of bindings) {
      const hostPort = Number.parseInt(binding.HostPort || '', 10);
      out.push({
        containerPort,
        protocol,
        hostIp: binding.HostIp || null,
        hostPort: Number.isFinite(hostPort) ? hostPort : null,
      });
    }
  }

  return out.sort((a, b) => a.containerPort - b.containerPort);
}

function extractTokenFromEnv(inspect: DockerInspect): { token: string | null; tokenKey: string | null } {
  const envMap = parseEnvPairs(inspect.Config?.Env);
  for (const key of TOKEN_ENV_KEYS) {
    const value = envMap.get(key);
    if (value && value.trim()) {
      return { token: value.trim(), tokenKey: key };
    }
  }
  return { token: null, tokenKey: null };
}

function resolveMountedStateDir(inspect: DockerInspect): string | null {
  const stateMount = (inspect.Mounts || []).find(
    (mount) => (mount.Destination || '').trim() === '/home/node/.openclaw' && (mount.Source || '').trim().length > 0,
  );
  const sourcePath = stateMount?.Source?.trim();
  if (!sourcePath) return null;
  return sourcePath;
}

function resolveManagedMountedStateDir(inspect: DockerInspect): string | null {
  const mounted = resolveMountedStateDir(inspect);
  if (!mounted) return null;

  const managedRoot = path.resolve(resolveMulticlawInstanceRoot());
  const candidate = path.resolve(mounted);
  if (candidate === managedRoot) return null;
  if (!candidate.startsWith(`${managedRoot}${path.sep}`)) return null;
  return candidate;
}

function extractTokenFromMountedOpenclawConfig(inspect: DockerInspect): { token: string | null; tokenKey: string | null } {
  const sourcePath = resolveMountedStateDir(inspect);
  if (!sourcePath) return { token: null, tokenKey: null };

  const configPath = path.join(sourcePath, 'openclaw.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      gateway?: {
        auth?: {
          token?: unknown;
        };
      };
    };
    const token = parsed?.gateway?.auth?.token;
    if (typeof token === 'string' && token.trim()) {
      return { token: token.trim(), tokenKey: 'OPENCLAW_JSON:gateway.auth.token' };
    }
  } catch {
    // ignore parse/read errors and fall through
  }

  return { token: null, tokenKey: null };
}

function extractToken(inspect: DockerInspect): { token: string | null; tokenKey: string | null } {
  const envToken = extractTokenFromEnv(inspect);
  if (envToken.token) return envToken;
  return extractTokenFromMountedOpenclawConfig(inspect);
}

async function resolveRuntimeGatewayTokenViaExec(containerId: string): Promise<string | null> {
  try {
    const script = "fetch('http://127.0.0.1:3080/api/connect-defaults').then(r=>r.json()).then(j=>process.stdout.write((j&&typeof j.token==='string')?j.token:''))";
    const stdout = await runDocker(['exec', containerId, 'node', '-e', script]);
    const token = stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}

async function resolveInstanceToken(inspect: DockerInspect): Promise<{ token: string | null; tokenKey: string | null }> {
  const envToken = extractTokenFromEnv(inspect);
  if (envToken.token) return envToken;

  const containerId = inspect.Id?.trim();
  const status = (inspect.State?.Status || '').trim().toLowerCase();
  if (containerId && status === 'running') {
    const runtimeToken = await resolveRuntimeGatewayTokenViaExec(containerId);
    if (runtimeToken) return { token: runtimeToken, tokenKey: 'RUNTIME:connect-defaults' };
  }

  return extractTokenFromMountedOpenclawConfig(inspect);
}

function exposesNervePort(inspect: DockerInspect): boolean {
  const portKeys = Object.keys(inspect.NetworkSettings?.Ports || {});
  return portKeys.some((key) => key.startsWith(`${DEFAULT_NERVE_CONTAINER_PORT}/`));
}

function looksLikeOpenClawInstanceByHints(inspect: DockerInspect): boolean {
  const name = (inspect.Name || '').replace(/^\//, '');
  const image = inspect.Config?.Image || '';
  const labels = inspect.Config?.Labels || {};
  const env = inspect.Config?.Env || [];
  const portKeys = Object.keys(inspect.NetworkSettings?.Ports || {});

  if (OPENCLAW_HINT_RE.test(name) || OPENCLAW_HINT_RE.test(image)) return true;
  if (Object.entries(labels).some(([k, v]) => OPENCLAW_HINT_RE.test(k) || OPENCLAW_HINT_RE.test(v))) return true;
  if (env.some((entry) => entry.startsWith('OPENCLAW_'))) return true;
  if (TOKEN_ENV_KEYS.some((key) => env.some((entry) => entry.startsWith(`${key}=`)))) return true;
  if (resolveManagedMountedStateDir(inspect)) return true;
  return DEFAULT_GATEWAY_CONTAINER_PORTS.some((port) => portKeys.some((key) => key.startsWith(`${port}/`)));
}

export function looksLikeOpenClawInstance(inspect: DockerInspect): boolean {
  // MultiClaw instance list should only include containers that expose Nerve.
  if (!exposesNervePort(inspect)) return false;
  return looksLikeOpenClawInstanceByHints(inspect);
}

async function probeInstanceHealth(ports: InstancePort[]): Promise<{ availability: 'ready' | 'initializing' | 'unreachable'; gateway: 'ok' | 'unreachable' }> {
  const nervePort = resolvePublishedNervePort(ports);
  if (!nervePort) {
    return { availability: 'initializing', gateway: 'unreachable' };
  }

  try {
    const res = await fetch(`http://127.0.0.1:${nervePort}/healthcheck`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { availability: 'initializing', gateway: 'unreachable' };
    const body = await res.json() as { ready?: boolean; gateway?: 'ok' | 'unreachable' };
    const gateway = body.gateway === 'ok' ? 'ok' : 'unreachable';
    const availability = body.ready ? 'ready' : 'initializing';
    return { availability, gateway };
  } catch {
    return { availability: 'unreachable', gateway: 'unreachable' };
  }
}

async function toSummary(inspect: DockerInspect, opts?: { includeHealth?: boolean }): Promise<LocalInstanceSummary> {
  const token = extractToken(inspect);
  const ports = parsePorts(inspect.NetworkSettings?.Ports);
  const includeHealth = opts?.includeHealth !== false;
  const health = includeHealth
    ? await probeInstanceHealth(ports)
    : { availability: 'initializing' as const, gateway: 'unreachable' as const };
  return {
    id: inspect.Id || '',
    name: (inspect.Name || '').replace(/^\//, ''),
    image: inspect.Config?.Image || '',
    state: inspect.State?.Status || 'unknown',
    status: inspect.State?.Status || 'unknown',
    createdAt: inspect.Created || null,
    labels: inspect.Config?.Labels || {},
    ports,
    hasGatewayToken: !!token.token,
    availability: health.availability,
    gateway: health.gateway,
  };
}

async function inspectContainers(ids: string[]): Promise<DockerInspect[]> {
  if (ids.length === 0) return [];
  const stdout = await runDocker(['inspect', ...ids]);
  try {
    const parsed = JSON.parse(stdout) as DockerInspect[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new DockerCommandError('docker_command_failed', 'Failed to parse docker inspect output.');
  }
}

export async function listLocalOpenClawInstances(): Promise<LocalInstanceSummary[]> {
  const idsRaw = await runDocker(['ps', '-a', '--no-trunc', '-q']);
  const ids = idsRaw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (ids.length === 0) return [];

  const inspected = await inspectContainers(ids);
  const summaries = await Promise.all(
    inspected
      .filter(looksLikeOpenClawInstance)
      .map((item) => toSummary(item)),
  );

  return summaries
    .filter((item) => item.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function inspectLocalOpenClawInstance(
  instanceId: string,
  opts?: { allowHintOnly?: boolean },
): Promise<DockerInspect | null> {
  let inspected: DockerInspect[];
  try {
    inspected = await inspectContainers([instanceId]);
  } catch (err) {
    if (err instanceof DockerCommandError && /No such (?:container|object)/i.test(err.message)) {
      return null;
    }
    throw err;
  }

  const target = inspected[0];
  if (!target) return null;
  const recognized = opts?.allowHintOnly
    ? looksLikeOpenClawInstanceByHints(target)
    : looksLikeOpenClawInstance(target);
  if (!recognized) return null;
  return target;
}

export async function getInstanceToken(instanceId: string): Promise<InstanceTokenResult | null> {
  const target = await inspectLocalOpenClawInstance(instanceId, { allowHintOnly: true });
  if (!target) return null;

  const token = await resolveInstanceToken(target);
  return {
    instanceId: target.Id || instanceId,
    found: !!token.token,
    token: token.token,
    tokenKey: token.tokenKey,
  };
}

export async function getLocalOpenClawInstance(instanceId: string): Promise<LocalInstanceSummary | null> {
  const target = await inspectLocalOpenClawInstance(instanceId, { allowHintOnly: true });
  if (!target) return null;
  return await toSummary(target, { includeHealth: false });
}

export async function stopLocalOpenClawInstance(instanceId: string): Promise<LocalInstanceSummary | null> {
  const target = await inspectLocalOpenClawInstance(instanceId, { allowHintOnly: true });
  if (!target) return null;

  const status = (target.State?.Status || '').trim().toLowerCase();
  if (status === 'running' || status === 'restarting') {
    const dockerId = target.Id || instanceId;
    try {
      await runDocker(['stop', '-t', '2', dockerId]);
    } catch (err) {
      if (err instanceof DockerCommandError && /is not running|No such (?:container|object)/i.test(err.message)) {
        // already stopped/removed; continue to re-inspect below
      } else {
        try {
          await runDocker(['kill', dockerId]);
        } catch (killErr) {
          if (!(killErr instanceof DockerCommandError) || !/is not running|No such (?:container|object)/i.test(killErr.message)) {
            throw err;
          }
        }
      }
    }
  }

  const refreshed = await inspectLocalOpenClawInstance(instanceId, { allowHintOnly: true });
  if (!refreshed) return null;
  return await toSummary(refreshed, { includeHealth: false });
}

export interface RemoveLocalInstanceResult {
  instanceId: string;
  removed: boolean;
  stateDirPath: string | null;
  stateDirRemoved: boolean;
}

export async function removeLocalOpenClawInstance(instanceId: string): Promise<RemoveLocalInstanceResult | null> {
  const target = await inspectLocalOpenClawInstance(instanceId, { allowHintOnly: true });
  if (!target) return null;

  const stateDirPath = resolveManagedMountedStateDir(target);
  await runDocker(['rm', '-f', target.Id || instanceId]);

  let stateDirRemoved = false;
  if (stateDirPath) {
    try {
      fs.rmSync(stateDirPath, { recursive: true, force: true });
      stateDirRemoved = true;
    } catch {
      stateDirRemoved = false;
    }
  }

  return {
    instanceId: target.Id || instanceId,
    removed: true,
    stateDirPath,
    stateDirRemoved,
  };
}

export function listCopyableMasterCredentials(): CopyableMasterCredential[] {
  const allCredentialKeys = [...listAllowedMasterCredentialKeys()].sort((a, b) => a.localeCompare(b));
  const envBacked = allCredentialKeys.map((key) => ({
    key,
    isSet: !!resolveMasterCredentialValue(key),
  }));

  const authProfiles = listAvailableAuthProfileCredentialKeys().map((key) => ({
    key,
    isSet: true,
  }));

  return [...envBacked, ...authProfiles];
}

export function listAllowedMasterCredentialSelectionKeys(): string[] {
  return [...listAllowedMasterCredentialKeys()].sort((a, b) => a.localeCompare(b));
}

function resolveDefaultModelForWorkspace(credentialKeys: string[]): string | null {
  const selectedProfileIds = selectedAuthProfileIds(credentialKeys);
  if (selectedProfileIds.some((id) => id.startsWith('openai-codex:'))) return 'openai-codex/gpt-5.3-codex';
  if (selectedProfileIds.some((id) => id.startsWith('anthropic:'))) return 'anthropic/claude-opus-4-6';
  if (credentialKeys.includes('ENV:OPENAI_API_KEY') || !!resolveMasterCredentialValue('ENV:OPENAI_API_KEY')) {
    return 'openai/gpt-5.1-codex';
  }
  return null;
}

function generateInstanceGatewayToken(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(32);
  let token = '';
  for (let i = 0; i < bytes.length; i += 1) {
    token += alphabet[bytes[i] % alphabet.length];
  }
  return token;
}

function prepareInstanceWorkspace(instanceName: string, credentialKeys: string[]): string {
  const instanceRoot = path.join(resolveMulticlawInstanceRoot(), instanceName);
  const stateDir = path.join(instanceRoot, '.openclaw');
  const agentDir = path.join(stateDir, 'agents', 'main', 'agent');
  const workspaceDir = path.join(stateDir, 'workspace');

  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });

  const selectedConfigurations = resolveSelectedCredentialValues(credentialKeys);
  const selectedEnvEntries = normalizeEnvEntries(selectedConfigurations);
  const selectedJsonDependencies = collectSelectedJsonDependencies(selectedConfigurations);

  const selectedProfiles = selectedAuthProfileIds(credentialKeys);
  const filteredStore = buildFilteredAuthStore(selectedProfiles);
  if (filteredStore) {
    fs.writeFileSync(
      path.join(agentDir, 'auth-profiles.json'),
      `${JSON.stringify(filteredStore, null, 2)}\n`,
      'utf8',
    );
  }

  const defaultModel = resolveDefaultModelForWorkspace(credentialKeys);
  const openclawConfigPath = path.join(stateDir, 'openclaw.json');
  let cfg: Record<string, unknown> = {};
  try {
    cfg = JSON.parse(fs.readFileSync(openclawConfigPath, 'utf8')) as Record<string, unknown>;
  } catch {
    cfg = {};
  }

  applySelectedJsonConfigEntries(selectedConfigurations, cfg);

  if (selectedJsonDependencies.hasSecretRefs) {
    const masterSecrets = getJsonPathValue(readOpenclawConfigObject(), ['secrets']);
    if (masterSecrets && typeof masterSecrets === 'object' && !Array.isArray(masterSecrets)) {
      cfg.secrets = structuredClone(masterSecrets);
    }
  }

  const gateway = (cfg.gateway && typeof cfg.gateway === 'object') ? (cfg.gateway as Record<string, unknown>) : {};
  const gatewayAuth = (gateway.auth && typeof gateway.auth === 'object') ? (gateway.auth as Record<string, unknown>) : {};
  gatewayAuth.mode = 'token';
  gatewayAuth.token = generateInstanceGatewayToken();
  gateway.auth = gatewayAuth;
  cfg.gateway = gateway;

  if (defaultModel) {
    const agents = (cfg.agents && typeof cfg.agents === 'object') ? (cfg.agents as Record<string, unknown>) : {};
    const defaults = (agents.defaults && typeof agents.defaults === 'object') ? (agents.defaults as Record<string, unknown>) : {};
    const model = (defaults.model && typeof defaults.model === 'object') ? (defaults.model as Record<string, unknown>) : {};
    model.primary = defaultModel;
    defaults.model = model;
    agents.defaults = defaults;
    cfg.agents = agents;
  }

  const finalEnvEntries = new Map<string, string>(selectedEnvEntries);
  const sourceEnvFileEntries = parseDotEnvShallow(resolveOpenclawGlobalEnvPath());
  for (const envKey of selectedJsonDependencies.referencedEnvKeys) {
    if (finalEnvEntries.has(envKey)) continue;

    const fromEnvFile = sourceEnvFileEntries.get(envKey)?.trim();
    if (fromEnvFile) {
      finalEnvEntries.set(envKey, fromEnvFile);
      continue;
    }

    const fromProcess = process.env[envKey]?.trim();
    if (fromProcess) {
      finalEnvEntries.set(envKey, fromProcess);
    }
  }

  if (finalEnvEntries.size > 0) {
    const envContent = [...finalEnvEntries.entries()]
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    fs.writeFileSync(path.join(stateDir, '.env'), `${envContent}\n`, 'utf8');
  }

  fs.writeFileSync(openclawConfigPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');

  return stateDir;
}

export async function createDockerInstance(input: CreateDockerInstanceInput): Promise<CreateDockerInstanceResult> {
  const image = await resolvePreferredMulticlawImage();
  const effectiveCredentialKeys = normalizeCredentialKeysWithDefaultAuthProfile(input.credentialKeys);
  const selectedConfigurations = resolveSelectedCredentialValues(effectiveCredentialKeys);
  const selectedEnvEntries = normalizeEnvEntries(selectedConfigurations);
  const selectedProfileKeys = effectiveCredentialKeys.filter((key) => key.startsWith(AUTH_PROFILE_KEY_PREFIX));
  const copiedCredentialKeys = [...selectedConfigurations.keys(), ...selectedProfileKeys];
  const preparedStateDir = prepareInstanceWorkspace(input.name, effectiveCredentialKeys);

  const args = ['run', '-d', '--name', input.name, '-p', '0:3080', '-p', '0:3181', '-v', `${preparedStateDir}:/home/node/.openclaw`, '-e', 'NERVE_ALLOW_INSECURE=true'];
  for (const [key, value] of selectedEnvEntries.entries()) {
    args.push('-e', `${key}=${value}`);
  }
  args.push(image);

  const createStdout = await runDocker(args);
  const createdId = createStdout
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0];

  if (!createdId) {
    throw new DockerCommandError('docker_command_failed', 'Docker run did not return a created container id.');
  }

  const inspected = await inspectContainers([createdId]);
  const created = inspected[0];
  if (!created || !looksLikeOpenClawInstance(created)) {
    throw new DockerCommandError(
      'docker_command_failed',
      'Created container is not recognized as an OpenClaw/Nerve instance (missing 3080/tcp exposure or expected hints).',
    );
  }

  return {
    type: 'docker',
    image,
    instance: await toSummary(created),
    copiedCredentialKeys,
  };
}

function resolvePublishedPortByContainerPort(ports: InstancePort[], containerPort: number): number | null {
  const match = ports.find(
    (port) =>
      port.protocol === 'tcp' &&
      port.containerPort === containerPort &&
      typeof port.hostPort === 'number' &&
      Number.isFinite(port.hostPort) &&
      port.hostPort > 0,
  );
  return match?.hostPort ?? null;
}

export function resolvePublishedNervePort(ports: InstancePort[]): number | null {
  return resolvePublishedPortByContainerPort(ports, DEFAULT_NERVE_CONTAINER_PORT);
}

export function resolvePublishedGatewayPort(ports: InstancePort[]): number | null {
  for (const gatewayPort of DEFAULT_GATEWAY_CONTAINER_PORTS) {
    const resolved = resolvePublishedPortByContainerPort(ports, gatewayPort);
    if (resolved) return resolved;
  }
  return null;
}
