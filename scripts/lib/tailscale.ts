import { execSync } from 'node:child_process';

/** One Tailscale Serve web endpoint: the browser origin and what its root handler proxies to. */
export interface ServeEndpoint {
  origin: string;
  /** The `Proxy` target of the endpoint's root (`/`) handler, or null when it has none. */
  rootProxy: string | null;
}

export interface TailscaleState {
  installed: boolean;
  authenticated: boolean;
  ipv4: string | null;
  dnsName: string | null;
  serveOrigins: string[];
  /** The same endpoints as serveOrigins, with their proxy targets. */
  serveEndpoints?: ServeEndpoint[];
  /** Targets of raw TCP forwarders (`TCP` entries that carry a `TCPForward`). */
  tcpForwards?: string[];
}

type ExecLike = (command: string, options?: Record<string, unknown>) => string | Buffer;

function toText(value: string | Buffer): string {
  return typeof value === 'string' ? value : value.toString('utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function findFirstIpv4(values: unknown): string | null {
  if (!Array.isArray(values)) return null;
  for (const value of values) {
    if (typeof value === 'string' && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value.trim())) {
      return value.trim();
    }
  }
  return null;
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

export function normalizeDnsName(value: string | null | undefined): string | null {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  return trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
}

/** The browser origin for a Serve `Web` key such as `node.tailnet.ts.net:443`. */
function serveKeyToOrigin(rawKey: string): string | null {
  const key = rawKey.trim();
  if (!key) return null;

  const portMatch = key.match(/:(\d+)$/);
  const port = portMatch?.[1] || null;
  const hostPart = portMatch ? key.slice(0, -portMatch[0].length) : key;
  const host = normalizeDnsName(hostPart);
  if (!host) return null;

  if (port === '80') return `http://${host}`;
  if (!port || port === '443') return `https://${host}`;
  return `https://${host}:${port}`;
}

function rootProxyTarget(entry: unknown): string | null {
  if (!isRecord(entry) || !isRecord(entry.Handlers)) return null;
  const root = entry.Handlers['/'];
  if (!isRecord(root) || typeof root.Proxy !== 'string') return null;
  return root.Proxy.trim() || null;
}

/** Each Serve web endpoint once, in listing order, with its root proxy target. */
export function extractServeEndpoints(json: unknown): ServeEndpoint[] {
  if (!isRecord(json) || !isRecord(json.Web)) return [];

  const byOrigin = new Map<string, ServeEndpoint>();
  for (const [rawKey, entry] of Object.entries(json.Web)) {
    const origin = serveKeyToOrigin(rawKey);
    if (!origin) continue;
    const rootProxy = rootProxyTarget(entry);
    const existing = byOrigin.get(origin);
    if (!existing) byOrigin.set(origin, { origin, rootProxy });
    else if (!existing.rootProxy && rootProxy) existing.rootProxy = rootProxy;
  }

  return [...byOrigin.values()];
}

export function extractServeOrigins(json: unknown): string[] {
  return extractServeEndpoints(json).map((endpoint) => endpoint.origin);
}

/** The target of each raw TCP forwarder in `tailscale serve status --json`. */
export function extractTcpForwards(json: unknown): string[] {
  if (!isRecord(json) || !isRecord(json.TCP)) return [];

  const forwards: string[] = [];
  for (const entry of Object.values(json.TCP)) {
    if (isRecord(entry) && typeof entry.TCPForward === 'string' && entry.TCPForward.trim()) {
      forwards.push(entry.TCPForward.trim());
    }
  }
  return forwards;
}

export function parseTailscaleStatus(json: unknown): Pick<TailscaleState, 'authenticated' | 'ipv4' | 'dnsName'> {
  if (!isRecord(json) || !isRecord(json.Self)) {
    return {
      authenticated: false,
      ipv4: null,
      dnsName: null,
    };
  }

  const self = json.Self;
  const dnsName = normalizeDnsName(typeof self.DNSName === 'string' ? self.DNSName : null);
  const ipv4 = findFirstIpv4(self.TailscaleIPs);

  return {
    authenticated: Boolean(ipv4 || dnsName),
    ipv4,
    dnsName,
  };
}

export function getTailscaleState(exec: ExecLike = execSync): TailscaleState {
  try {
    exec('command -v tailscale', { stdio: 'pipe', timeout: 3000 });
  } catch {
    return {
      installed: false,
      authenticated: false,
      ipv4: null,
      dnsName: null,
      serveOrigins: [],
      serveEndpoints: [],
      tcpForwards: [],
    };
  }

  let status: Pick<TailscaleState, 'authenticated' | 'ipv4' | 'dnsName'> = {
    authenticated: false,
    ipv4: null,
    dnsName: null,
  };
  let serveEndpoints: ServeEndpoint[] = [];
  let tcpForwards: string[] = [];

  try {
    const statusJson = parseJson(toText(exec('tailscale status --json 2>/dev/null', { stdio: 'pipe', timeout: 3000 })));
    status = parseTailscaleStatus(statusJson);
  } catch {
    // leave default unauthenticated state
  }

  try {
    const serveJson = parseJson(toText(exec('tailscale serve status --json 2>/dev/null', { stdio: 'pipe', timeout: 3000 })));
    serveEndpoints = extractServeEndpoints(serveJson);
    tcpForwards = extractTcpForwards(serveJson);
  } catch {
    // serve may be inactive or unsupported
  }

  return {
    installed: true,
    authenticated: status.authenticated,
    ipv4: status.ipv4,
    dnsName: status.dnsName,
    serveOrigins: serveEndpoints.map((endpoint) => endpoint.origin),
    serveEndpoints,
    tcpForwards,
  };
}
