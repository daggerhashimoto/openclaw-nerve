/**
 * Decide whether a configured GATEWAY_URL points at this machine.
 *
 * Setup patches and restarts the OpenClaw gateway through this machine's
 * OpenClaw home, which is only correct when the gateway runs here. A gateway
 * on another host has to be configured on that host instead.
 */

import os from 'node:os';
import { isLoopback } from './access-plan.js';

/**
 * `local`: the URL host is loopback or one of this machine's own addresses or names.
 * `remote`: the URL host is something else.
 * `unknown`: the URL is missing, unparseable, or not an http(s)/ws(s) URL.
 */
export type GatewayLocality = 'local' | 'remote' | 'unknown';

export interface GatewayLocation {
  locality: GatewayLocality;
  /** The URL host, lowercased and without IPv6 brackets. Null when the URL could not be used. */
  host: string | null;
}

export interface LocalMachine {
  hostname: string;
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>;
  /** Other names that reach this machine, such as its Tailscale MagicDNS name. */
  extraHostnames?: Array<string | null | undefined>;
}

const GATEWAY_URL_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);
/** Connecting to the unspecified address reaches this machine. */
const UNSPECIFIED_ADDRESSES = new Set(['0.0.0.0', '::']);

/** Read this machine's hostname and interface addresses from `os`. */
export function readLocalMachine(extraHostnames: Array<string | null | undefined> = []): LocalMachine {
  let hostname = '';
  let interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {};
  try {
    hostname = os.hostname();
  } catch {
    // Leave the hostname empty; addresses can still match.
  }
  try {
    interfaces = os.networkInterfaces();
  } catch {
    // Some sandboxes refuse interface enumeration; fall back to names only.
  }
  return { hostname, interfaces, extraHostnames };
}

function normalizeHost(value: string): string {
  let host = value.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

/** Canonicalize an IPv6 literal the way URL parsing does, so both sides compare equal. */
function canonicalIpv6(address: string): string {
  const withoutZone = address.split('%')[0];
  try {
    return normalizeHost(new URL(`http://[${withoutZone}]`).hostname);
  } catch {
    return normalizeHost(withoutZone);
  }
}

/** `::ffff:7f00:1` (how URL writes `::ffff:127.0.0.1`) back to dotted IPv4. */
function ipv4FromMappedIpv6(host: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!hex) return null;
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

function ownAddresses(interfaces: LocalMachine['interfaces']): Set<string> {
  const addresses = new Set<string>();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (!entry?.address) continue;
      const isIpv6 = entry.family === 'IPv6' || (entry.family as unknown) === 6;
      addresses.add(isIpv6 ? canonicalIpv6(entry.address) : normalizeHost(entry.address));
    }
  }
  return addresses;
}

function ownHostnames(machine: LocalMachine): Set<string> {
  const names = new Set<string>();
  for (const raw of [machine.hostname, ...(machine.extraHostnames ?? [])]) {
    if (!raw) continue;
    const name = normalizeHost(raw);
    if (!name) continue;
    names.add(name);
    // The machine's own short name and its mDNS name reach it too. The URL's
    // first label is never matched on its own: gw.example.com is not "gw".
    const shortName = name.split('.')[0];
    if (shortName) {
      names.add(shortName);
      names.add(`${shortName}.local`);
    }
  }
  return names;
}

function isThisMachine(host: string, machine: LocalMachine): boolean {
  const candidates = [host];
  const mapped = ipv4FromMappedIpv6(host);
  if (mapped) candidates.push(mapped);

  if (candidates.some(candidate => isLoopback(candidate) || UNSPECIFIED_ADDRESSES.has(candidate))) return true;
  if (host.endsWith('.localhost')) return true;

  const addresses = ownAddresses(machine.interfaces);
  if (candidates.some(candidate => addresses.has(candidate))) return true;

  return ownHostnames(machine).has(host);
}

/**
 * Classify a gateway URL as on this machine, on another machine, or unknown.
 * Callers should keep their existing local behaviour for `unknown`.
 */
export function classifyGatewayUrl(
  url: string | null | undefined,
  machine: LocalMachine = readLocalMachine(),
): GatewayLocation {
  const unknown: GatewayLocation = { locality: 'unknown', host: null };
  if (!url?.trim()) return unknown;

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return unknown;
  }
  if (!GATEWAY_URL_PROTOCOLS.has(parsed.protocol)) return unknown;

  const host = normalizeHost(parsed.hostname);
  if (!host) return unknown;

  return { locality: isThisMachine(host, machine) ? 'local' : 'remote', host };
}
