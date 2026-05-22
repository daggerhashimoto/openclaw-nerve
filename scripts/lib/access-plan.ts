import type { EnvConfig } from './env-writer.js';
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
  remoteHost?: string | null;
  tailscale?: TailscaleState;
}

function dedupe(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function isLoopback(host: string | null | undefined): boolean {
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
      const origin = httpOrigin(host, port);
      plan.browserOrigins = [origin];
      plan.gatewayAllowedOrigins = [origin];
      plan.cspConnectExtra = [origin, websocketOrigin(origin)];
      plan.wsAllowedHosts = isLoopback(host) ? [] : [host];
      return plan;
    }

    case 'custom': {
      const host = input.remoteHost?.trim() || '127.0.0.1';
      const plan = emptyPlan('custom', host);
      if (!isLoopback(host)) {
        const origin = httpOrigin(host, port);
        plan.browserOrigins = [origin];
        plan.gatewayAllowedOrigins = [origin];
        plan.cspConnectExtra = [origin, websocketOrigin(origin)];
        plan.wsAllowedHosts = [host];
        if (input.sslPort) {
          const secureOrigin = httpsOrigin(host, input.sslPort);
          plan.browserOrigins = dedupe([...plan.browserOrigins, secureOrigin]);
          plan.gatewayAllowedOrigins = dedupe([...plan.gatewayAllowedOrigins, secureOrigin]);
          plan.cspConnectExtra = dedupe([...plan.cspConnectExtra, secureOrigin, websocketOrigin(secureOrigin)]);
        }
      }
      return plan;
    }

    case 'tailscale-ip': {
      const plan = emptyPlan('tailscale-ip', '0.0.0.0');
      const ip = tailscale?.ipv4;
      if (!ip) {
        plan.followUpSteps.push('Connect Tailscale and obtain a tailnet IPv4 address, then re-run setup.');
        return plan;
      }
      const origin = httpOrigin(ip, port);
      plan.browserOrigins = [origin];
      plan.gatewayAllowedOrigins = [origin];
      plan.cspConnectExtra = [origin, websocketOrigin(origin)];
      plan.wsAllowedHosts = [ip];
      return plan;
    }

    case 'tailscale-serve': {
      const plan = emptyPlan('tailscale-serve', '127.0.0.1');
      const origin = tailscale?.serveOrigins?.[0] || null;
      if (!origin) {
        plan.followUpSteps = dedupe([
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
