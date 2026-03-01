import { execFile } from 'node:child_process';

const DOCKER_TIMEOUT_MS = 4_000;
const DOCKER_MAX_BUFFER = 8 * 1024 * 1024;
const OPENCLAW_HINT_RE = /openclaw|multiclaw|multi-claw/i;
const TOKEN_ENV_KEYS = ['OPENCLAW_GATEWAY_TOKEN', 'GATEWAY_TOKEN'] as const;

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
}

const DEFAULT_GATEWAY_CONTAINER_PORT = 18789;
const DEFAULT_NERVE_CONTAINER_PORT = 3080;

export interface InstanceTokenResult {
  instanceId: string;
  found: boolean;
  token: string | null;
  tokenKey: string | null;
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

function extractToken(inspect: DockerInspect): { token: string | null; tokenKey: string | null } {
  const envMap = parseEnvPairs(inspect.Config?.Env);
  for (const key of TOKEN_ENV_KEYS) {
    const value = envMap.get(key);
    if (value && value.trim()) {
      return { token: value.trim(), tokenKey: key };
    }
  }
  return { token: null, tokenKey: null };
}

function exposesNervePort(inspect: DockerInspect): boolean {
  const portKeys = Object.keys(inspect.NetworkSettings?.Ports || {});
  return portKeys.some((key) => key.startsWith(`${DEFAULT_NERVE_CONTAINER_PORT}/`));
}

export function looksLikeOpenClawInstance(inspect: DockerInspect): boolean {
  // MultiClaw instance list should only include containers that expose Nerve.
  if (!exposesNervePort(inspect)) return false;

  const name = (inspect.Name || '').replace(/^\//, '');
  const image = inspect.Config?.Image || '';
  const labels = inspect.Config?.Labels || {};
  const env = inspect.Config?.Env || [];
  const portKeys = Object.keys(inspect.NetworkSettings?.Ports || {});

  if (OPENCLAW_HINT_RE.test(name) || OPENCLAW_HINT_RE.test(image)) return true;
  if (Object.entries(labels).some(([k, v]) => OPENCLAW_HINT_RE.test(k) || OPENCLAW_HINT_RE.test(v))) return true;
  if (env.some((entry) => entry.startsWith('OPENCLAW_'))) return true;
  if (TOKEN_ENV_KEYS.some((key) => env.some((entry) => entry.startsWith(`${key}=`)))) return true;
  return portKeys.some((key) => key.startsWith(`${DEFAULT_GATEWAY_CONTAINER_PORT}/`));
}

function toSummary(inspect: DockerInspect): LocalInstanceSummary {
  const token = extractToken(inspect);
  return {
    id: inspect.Id || '',
    name: (inspect.Name || '').replace(/^\//, ''),
    image: inspect.Config?.Image || '',
    state: inspect.State?.Status || 'unknown',
    status: inspect.State?.Status || 'unknown',
    createdAt: inspect.Created || null,
    labels: inspect.Config?.Labels || {},
    ports: parsePorts(inspect.NetworkSettings?.Ports),
    hasGatewayToken: !!token.token,
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
  return inspected
    .filter(looksLikeOpenClawInstance)
    .map(toSummary)
    .filter((item) => item.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getInstanceToken(instanceId: string): Promise<InstanceTokenResult | null> {
  const inspected = await inspectContainers([instanceId]);
  const target = inspected[0];
  if (!target) return null;
  if (!looksLikeOpenClawInstance(target)) return null;

  const token = extractToken(target);
  return {
    instanceId: target.Id || instanceId,
    found: !!token.token,
    token: token.token,
    tokenKey: token.tokenKey,
  };
}

export async function getLocalOpenClawInstance(instanceId: string): Promise<LocalInstanceSummary | null> {
  const inspected = await inspectContainers([instanceId]);
  const target = inspected[0];
  if (!target) return null;
  if (!looksLikeOpenClawInstance(target)) return null;
  return toSummary(target);
}

export function resolvePublishedGatewayPort(
  ports: InstancePort[],
  preferredContainerPort = DEFAULT_GATEWAY_CONTAINER_PORT,
): number | null {
  const preferred = ports.find(
    (port) =>
      port.protocol === 'tcp' &&
      port.containerPort === preferredContainerPort &&
      typeof port.hostPort === 'number' &&
      Number.isFinite(port.hostPort) &&
      port.hostPort > 0,
  );
  if (preferred?.hostPort) return preferred.hostPort;

  const fallback = ports.find(
    (port) =>
      port.protocol === 'tcp' &&
      typeof port.hostPort === 'number' &&
      Number.isFinite(port.hostPort) &&
      port.hostPort > 0,
  );
  return fallback?.hostPort ?? null;
}
