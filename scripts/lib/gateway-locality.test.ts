import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyGatewayUrl, readLocalMachine, type LocalMachine } from './gateway-locality.js';

const EXAMPLE_TS_DNS = 'example-node.tail0000.ts.net';
const EXAMPLE_TS_IPV6 = 'fd7a:115c:a1e0::42';

function iface(address: string, family: 'IPv4' | 'IPv6', internal = false): os.NetworkInterfaceInfo {
  const base = { address, netmask: '', mac: '00:00:00:00:00:00', internal, cidr: null };
  return family === 'IPv4' ? { ...base, family } : { ...base, family, scopeid: 0 };
}

const machine: LocalMachine = {
  hostname: 'Nerve-Box.local',
  interfaces: {
    lo0: [iface('127.0.0.1', 'IPv4', true), iface('::1', 'IPv6', true)],
    en0: [iface('192.168.1.20', 'IPv4'), iface('fe80::1c2b:3a4d:5e6f:7081', 'IPv6')],
    tailscale0: [iface('100.64.0.42', 'IPv4'), iface(EXAMPLE_TS_IPV6, 'IPv6')],
  },
};

describe('classifyGatewayUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    'http://127.0.0.1:18789',
    'http://localhost:18789',
    'ws://127.0.0.5:18789',
    'http://LOCALHOST.:18789',
    'http://gateway.localhost:18789',
    'http://[::1]:18789',
    'wss://[::ffff:127.0.0.1]:18789',
    'http://0.0.0.0:18789',
  ])('treats %s as local without looking at the machine', (url) => {
    expect(classifyGatewayUrl(url, { hostname: '', interfaces: {} }).locality).toBe('local');
  });

  it.each([
    ['an own IPv4 address over http', 'http://192.168.1.20:18789', '192.168.1.20'],
    ['an own IPv4 address over ws', 'ws://100.64.0.42:18789', '100.64.0.42'],
    ['an own bracketed IPv6 address', `wss://[${EXAMPLE_TS_IPV6}]:18789`, EXAMPLE_TS_IPV6],
    ['an own IPv6 address written uncompressed', 'http://[FE80:0:0:0:1C2B:3A4D:5E6F:7081]:18789', 'fe80::1c2b:3a4d:5e6f:7081'],
  ])('treats %s as local', (_label, url, host) => {
    expect(classifyGatewayUrl(url, machine)).toEqual({ locality: 'local', host });
  });

  it.each([
    ['the full hostname, any case', 'https://NERVE-BOX.local:18789'],
    ['the full hostname with a trailing dot', 'http://nerve-box.local.:18789'],
    ['the short hostname', 'http://nerve-box:18789'],
  ])('treats %s as local', (_label, url) => {
    expect(classifyGatewayUrl(url, machine).locality).toBe('local');
  });

  it('treats the Tailscale MagicDNS name as local only when it is passed in as an own name', () => {
    const url = `https://${EXAMPLE_TS_DNS}`;
    expect(classifyGatewayUrl(url, machine).locality).toBe('remote');
    expect(classifyGatewayUrl(url, { ...machine, extraHostnames: [null, EXAMPLE_TS_DNS] })).toEqual({
      locality: 'local',
      host: EXAMPLE_TS_DNS,
    });
  });

  it.each([
    ['a remote hostname', 'https://gw.example.com', 'gw.example.com'],
    ['a remote hostname over wss', 'wss://GW.example.com:18789/ws', 'gw.example.com'],
    ['a remote IPv4 address', 'ws://10.0.0.9:18789', '10.0.0.9'],
    ['a remote bracketed IPv6 address', 'http://[2001:db8::1]:18789', '2001:db8::1'],
    ['another tailnet node', 'http://100.64.0.43:18789', '100.64.0.43'],
  ])('treats %s as remote', (_label, url, host) => {
    expect(classifyGatewayUrl(url, machine)).toEqual({ locality: 'remote', host });
  });

  it('does not match a remote host on its first label alone', () => {
    expect(classifyGatewayUrl('https://gw.example.com', { hostname: 'gw', interfaces: {} }).locality).toBe('remote');
  });

  it.each([
    ['an empty string', ''],
    ['whitespace', '   '],
    ['undefined', undefined],
    ['null', null],
    ['text that is not a URL', 'not a url'],
    ['a host and port without a scheme', 'localhost:18789'],
    ['an unsupported scheme', 'ftp://127.0.0.1:18789'],
  ])('returns unknown for %s', (_label, url) => {
    expect(classifyGatewayUrl(url, machine)).toEqual({ locality: 'unknown', host: null });
  });

  it('reads the hostname and interfaces from os by default', () => {
    vi.spyOn(os, 'hostname').mockReturnValue('vps-host');
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({ eth0: [iface('203.0.113.7', 'IPv4')] });

    expect(classifyGatewayUrl('http://203.0.113.7:18789').locality).toBe('local');
    expect(classifyGatewayUrl('http://vps-host:18789').locality).toBe('local');
    expect(classifyGatewayUrl('http://203.0.113.8:18789').locality).toBe('remote');
  });

  it('still matches by name when os cannot list interfaces', () => {
    vi.spyOn(os, 'hostname').mockReturnValue('vps-host');
    vi.spyOn(os, 'networkInterfaces').mockImplementation(() => {
      throw new Error('uv_interface_addresses failed');
    });

    const local = readLocalMachine([EXAMPLE_TS_DNS]);
    expect(local.interfaces).toEqual({});
    expect(classifyGatewayUrl('http://vps-host:18789', local).locality).toBe('local');
    expect(classifyGatewayUrl(`https://${EXAMPLE_TS_DNS}`, local).locality).toBe('local');
    expect(classifyGatewayUrl('http://203.0.113.7:18789', local).locality).toBe('remote');
  });
});
