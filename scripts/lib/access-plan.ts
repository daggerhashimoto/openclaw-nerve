import { DEFAULTS, type EnvConfig } from './env-writer.js';
import type { TailscaleState } from './tailscale.js';

export type InstallerAccessProfile =
  | 'local'
  | 'network'
  | 'custom'
  | 'tailscale-ip'
  | 'tailscale-serve';

export interface AccessPlan {
  profile: InstallerAccessProfile;
  bindHost: string;
  browserOrigins: string[];
  gatewayAllowedOrigins: string[];
  cspConnectExtra: string[];
  wsAllowedHosts: string[];
  followUpSteps: string[];
}

export interface BuildAccessPlanInput {
  profile: InstallerAccessProfile;
  port: string;
  sslPort?: string;
  /** Whether the HTTPS listener will start (certificates exist). Defaults to true. */
  httpsEnabled?: boolean;
  remoteHost?: string | null;
  tailscale?: TailscaleState;
}

// Serve mode binds Nerve to 127.0.0.1 only, so an endpoint proxying to ::1 would not reach it.
const NERVE_SERVE_HOSTS = new Set(['127.0.0.1', 'localhost']);

/**
 * A Serve proxy target as a URL. Tailscale also accepts shorthand targets:
 * a bare port means http://127.0.0.1:<port>, and host:port means http://host:port.
 */
function expandProxyTarget(target: string): string {
  const value = target.trim();
  if (/^\d+$/.test(value)) return `http://127.0.0.1:${value}`;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
}

interface ProxyTarget {
  host: string;
  port: string;
}

function parseProxyTarget(target: string | null): ProxyTarget | null {
  if (!target) return null;
  try {
    const url = new URL(expandProxyTarget(target));
    return {
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port || (url.protocol.startsWith('https') ? '443' : '80'),
    };
  } catch {
    return null;
  }
}

/** Whether a Serve proxy target is Nerve on this machine: 127.0.0.1 or localhost on Nerve's HTTP or HTTPS port. */
function proxiesToNerve(target: string | null, ports: string[]): boolean {
  const parsed = parseProxyTarget(target);
  return Boolean(parsed && NERVE_SERVE_HOSTS.has(parsed.host) && ports.includes(parsed.port));
}

/** The Serve endpoint whose root handler proxies to Nerve, if there is one. */
function matchingServeEndpoint(
  tailscale: TailscaleState | undefined,
  ports: string[],
): NonNullable<TailscaleState['serveEndpoints']>[number] | null {
  return tailscale?.serveEndpoints?.find((endpoint) => proxiesToNerve(endpoint.rootProxy, ports)) ?? null;
}

/**
 * The Serve origin that reaches Nerve: the endpoint whose root handler
 * proxies to Nerve's port. When no endpoint has a proxy target we can read,
 * the first one is used, as before; when they all proxy elsewhere, none is.
 */
function nerveServeOrigin(tailscale: TailscaleState | undefined, ports: string[]): string | null {
  const endpoints = tailscale?.serveEndpoints;
  if (!endpoints || endpoints.length === 0) return tailscale?.serveOrigins?.[0] || null;
  const match = matchingServeEndpoint(tailscale, ports);
  if (match) return match.origin;
  return endpoints.every((endpoint) => endpoint.rootProxy === null) ? endpoints[0].origin : null;
}

/**
 * The port the accepted Serve endpoint proxies to, when its root handler
 * targets Nerve on this machine. Null when no endpoint matches or the target
 * is unreadable, so callers can distinguish an HTTP proxy from an HTTPS one.
 */
export function serveTargetPort(tailscale: TailscaleState | undefined, ports: string[]): string | null {
  const match = matchingServeEndpoint(tailscale, ports);
  return match ? parseProxyTarget(match.rootProxy)?.port ?? null : null;
}

function dedupe(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value)))];
}

export function isLoopback(host: string | null | undefined): boolean {
  if (!host) return true;
  // Node's URL.hostname returns bracketed IPv6 literals (e.g. "[::1]"); strip
  // the brackets before comparing. Also accept any 127.0.0.0/8 IPv4 loopback
  // and the expanded IPv6 form.
  let normalized = host.trim().toLowerCase();
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }
  return normalized === 'localhost'
    || normalized === '::1'
    || normalized === '0:0:0:0:0:0:0:1'
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

/**
 * Extract the gateway host from a configured GATEWAY_URL when it points at a
 * non-loopback target. Returned host should be added to WS_ALLOWED_HOSTS so the
 * WS proxy will forward to remote gateways (the default allowlist is just
 * localhost / 127.0.0.1 / ::1).
 */
function extractRemoteGatewayHost(gatewayUrl: string | null | undefined): string | null {
  if (!gatewayUrl) return null;
  try {
    const host = new URL(gatewayUrl).hostname;
    return isLoopback(host) ? null : host;
  } catch {
    return null;
  }
}

/** Parse a comma-separated env value, trimming and dropping empties. */
function splitCsv(value: string | null | undefined): string[] {
  return value?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
}

function httpOrigin(host: string, port: string): string {
  return `http://${host}:${port}`;
}

function httpsOrigin(host: string, port: string): string {
  return `https://${host}:${port}`;
}

function websocketOrigin(origin: string): string {
  if (origin.startsWith('https://')) return origin.replace(/^https:\/\//, 'wss://');
  if (origin.startsWith('http://')) return origin.replace(/^http:\/\//, 'ws://');
  return origin;
}

function emptyPlan(profile: InstallerAccessProfile, bindHost: string): AccessPlan {
  return {
    profile,
    bindHost,
    browserOrigins: [],
    gatewayAllowedOrigins: [],
    cspConnectExtra: [],
    wsAllowedHosts: [],
    followUpSteps: [],
  };
}

/**
 * Build the plan for a mode that serves Nerve on a non-loopback host: the http
 * origin, plus the https origin when an SSL port is set. The server only allows
 * loopback origins on its own, so every origin a browser will load Nerve from
 * has to be listed here (ALLOWED_ORIGINS gates the /ws upgrade and CORS) and in
 * the CSP connect-src extras. The http origin stays first because the server
 * uses the first non-loopback entry as its own Origin toward the gateway.
 */
function hostedPlan(
  profile: InstallerAccessProfile,
  bindHost: string,
  host: string,
  port: string,
  sslPort: string | undefined,
): AccessPlan {
  const plan = emptyPlan(profile, bindHost);
  const origin = httpOrigin(host, port);
  plan.browserOrigins = [origin];
  plan.gatewayAllowedOrigins = [origin];
  plan.cspConnectExtra = [origin, websocketOrigin(origin)];
  plan.wsAllowedHosts = isLoopback(host) ? [] : [host];
  if (sslPort) {
    const secureOrigin = httpsOrigin(host, sslPort);
    plan.browserOrigins = dedupe([...plan.browserOrigins, secureOrigin]);
    plan.gatewayAllowedOrigins = dedupe([...plan.gatewayAllowedOrigins, secureOrigin]);
    plan.cspConnectExtra = dedupe([...plan.cspConnectExtra, secureOrigin, websocketOrigin(secureOrigin)]);
  }
  return plan;
}

export function buildAccessPlan(input: BuildAccessPlanInput): AccessPlan {
  const port = input.port;
  const tailscale = input.tailscale;

  switch (input.profile) {
    case 'local':
      return emptyPlan('local', '127.0.0.1');

    case 'network': {
      const host = input.remoteHost?.trim() || '';
      const plan = emptyPlan('network', '0.0.0.0');
      if (!host) {
        plan.followUpSteps.push('Provide a reachable LAN IP address for network mode.');
        return plan;
      }
      return hostedPlan('network', '0.0.0.0', host, port, input.sslPort);
    }

    case 'custom': {
      const host = input.remoteHost?.trim() || '127.0.0.1';
      if (isLoopback(host)) return emptyPlan('custom', host);
      return hostedPlan('custom', host, host, port, input.sslPort);
    }

    case 'tailscale-ip': {
      const plan = emptyPlan('tailscale-ip', '0.0.0.0');
      const ip = tailscale?.ipv4;
      if (!ip) {
        plan.followUpSteps.push('Connect Tailscale and obtain a tailnet IPv4 address, then re-run setup.');
        return plan;
      }
      return hostedPlan('tailscale-ip', '0.0.0.0', ip, port, input.sslPort);
    }

    case 'tailscale-serve': {
      const plan = emptyPlan('tailscale-serve', '127.0.0.1');
      // .env omits SSL_PORT when it is the default. The server still starts
      // HTTPS on 3443 when certificates exist, so keep the default in the
      // match only when the HTTPS listener will actually start.
      const httpsPort = input.httpsEnabled === false ? undefined : input.sslPort || DEFAULTS.SSL_PORT;
      const origin = nerveServeOrigin(tailscale, httpsPort ? [port, httpsPort] : [port]);
      if (!origin) {
        const servingElsewhere = (tailscale?.serveEndpoints?.length ?? 0) > 0;
        plan.followUpSteps = dedupe([
          servingElsewhere ? `Tailscale Serve is running, but no endpoint forwards to http://127.0.0.1:${port}.` : null,
          `Run: tailscale serve --bg http://127.0.0.1:${port}`,
          'Confirm Tailscale Serve exposes a usable https://<node>.tail<id>.ts.net origin, then re-run setup.',
        ]);
        return plan;
      }
      plan.browserOrigins = [origin];
      plan.gatewayAllowedOrigins = [origin];
      plan.cspConnectExtra = [origin, websocketOrigin(origin)];
      return plan;
    }
  }
}

export function applyAccessPlanToConfig(config: EnvConfig, plan: AccessPlan): EnvConfig {
  const next: EnvConfig = {
    ...config,
    HOST: plan.bindHost,
  };

  if (plan.browserOrigins.length > 0) next.ALLOWED_ORIGINS = dedupe(plan.browserOrigins).join(',');
  else delete next.ALLOWED_ORIGINS;

  if (plan.cspConnectExtra.length > 0) next.CSP_CONNECT_EXTRA = dedupe(plan.cspConnectExtra).join(' ');
  else delete next.CSP_CONNECT_EXTRA;

  // WS_ALLOWED_HOSTS = plan hosts ∪ user's existing entries ∪ remote-gateway host (if any).
  // The plan only knows about Nerve UI accessibility; the gateway host has to be
  // grafted in here so split-host deployments (remote GATEWAY_URL) don't get rejected
  // by the WS proxy with "Target not allowed".
  const wsHosts = dedupe([
    ...plan.wsAllowedHosts,
    ...splitCsv(config.WS_ALLOWED_HOSTS),
    extractRemoteGatewayHost(config.GATEWAY_URL),
  ]);
  if (wsHosts.length > 0) next.WS_ALLOWED_HOSTS = wsHosts.join(',');
  else delete next.WS_ALLOWED_HOSTS;

  return next;
}

function hasNonLoopbackOrigin(allowedOrigins: string | null | undefined): boolean {
  for (const entry of splitCsv(allowedOrigins)) {
    try {
      const host = new URL(entry).hostname;
      if (!isLoopback(host)) return true;
    } catch {
      // Ignore malformed origin entries
    }
  }
  return false;
}

/**
 * The listener ports Nerve can answer on. The HTTPS port is omitted from .env
 * when it is the default and only starts when certificates exist, so the
 * default has to stay in the match for those cases.
 */
function listenerPorts(config: EnvConfig, httpsEnabled: boolean): string[] {
  const ports = [config.PORT || DEFAULTS.PORT];
  if (httpsEnabled) ports.push(config.SSL_PORT || DEFAULTS.SSL_PORT);
  return ports;
}

/**
 * Whether the chosen access mode or configuration exposes Nerve beyond
 * localhost and therefore requires authentication setup.
 *
 * Tailscale Serve keeps HOST=127.0.0.1 while publishing Nerve to the tailnet
 * over *.ts.net (and forwarding requests from loopback), so it needs
 * authentication just like a non-loopback bind. Browser endpoints and raw TCP
 * forwarders are checked separately because only the former provides a
 * browser origin.
 *
 * `httpsEnabled` reports whether the HTTPS listener will start (certificates
 * exist); without it a Serve target on the default HTTPS port is not Nerve.
 */
export function requiresAuthentication(
  config: EnvConfig,
  plan?: Pick<AccessPlan, 'profile'>,
  tailscale?: TailscaleState,
  httpsEnabled = true,
): boolean {
  if (plan?.profile === 'tailscale-serve') return true;
  if (!isLoopback(config.HOST)) return true;
  if (hasNonLoopbackOrigin(config.ALLOWED_ORIGINS)) return true;
  const ports = listenerPorts(config, httpsEnabled);
  if (tailscale?.tcpForwards?.some((target) => proxiesToNerve(target, ports))) return true;
  return Boolean(nerveServeOrigin(tailscale, ports));
}
