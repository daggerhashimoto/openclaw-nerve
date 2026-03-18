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
  return !host || host === '127.0.0.1' || host === 'localhost' || host === '::1';
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
          `Run: tailscale serve --bg 443 http://127.0.0.1:${port}`,
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

  if (plan.wsAllowedHosts.length > 0) next.WS_ALLOWED_HOSTS = dedupe(plan.wsAllowedHosts).join(',');
  else delete next.WS_ALLOWED_HOSTS;

  return next;
}
