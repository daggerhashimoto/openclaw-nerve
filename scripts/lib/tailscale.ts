import { execSync } from 'node:child_process';

export interface TailscaleState {
  installed: boolean;
  authenticated: boolean;
  ipv4: string | null;
  dnsName: string | null;
  serveOrigins: string[];
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

export function extractServeOrigins(json: unknown): string[] {
  if (!isRecord(json) || !isRecord(json.Web)) return [];

  const origins = new Set<string>();
  for (const rawKey of Object.keys(json.Web)) {
    const key = rawKey.trim();
    if (!key) continue;

    const portMatch = key.match(/:(\d+)$/);
    const port = portMatch?.[1] || null;
    const hostPart = portMatch ? key.slice(0, -portMatch[0].length) : key;
    const host = normalizeDnsName(hostPart);
    if (!host) continue;

    if (port === '80') {
      origins.add(`http://${host}`);
    } else if (!port || port === '443') {
      origins.add(`https://${host}`);
    } else {
      origins.add(`https://${host}:${port}`);
    }
  }

  return [...origins];
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
    };
  }

  let status: Pick<TailscaleState, 'authenticated' | 'ipv4' | 'dnsName'> = {
    authenticated: false,
    ipv4: null,
    dnsName: null,
  };
  let serveOrigins: string[] = [];

  try {
    const statusJson = parseJson(toText(exec('tailscale status --json 2>/dev/null', { stdio: 'pipe', timeout: 3000 })));
    status = parseTailscaleStatus(statusJson);
  } catch {
    // leave default unauthenticated state
  }

  try {
    const serveJson = parseJson(toText(exec('tailscale serve status --json 2>/dev/null', { stdio: 'pipe', timeout: 3000 })));
    serveOrigins = extractServeOrigins(serveJson);
  } catch {
    // serve may be inactive or unsupported
  }

  return {
    installed: true,
    authenticated: status.authenticated,
    ipv4: status.ipv4,
    dnsName: status.dnsName,
    serveOrigins,
  };
}
