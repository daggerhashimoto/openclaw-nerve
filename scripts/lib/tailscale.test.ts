import { describe, it, expect } from 'vitest';
import {
  normalizeDnsName,
  extractServeEndpoints,
  extractServeOrigins,
  parseTailscaleStatus,
  getTailscaleState,
} from './tailscale.js';

const EXAMPLE_TS_DNS = 'example-node.tail0000.ts.net';
const EXAMPLE_TS_IPV4 = '100.64.0.42';
const EXAMPLE_TS_IPV6 = 'fd7a:115c:a1e0::42';

describe('normalizeDnsName', () => {
  it('strips the trailing dot from Self.DNSName', () => {
    expect(normalizeDnsName(`${EXAMPLE_TS_DNS}.`)).toBe(EXAMPLE_TS_DNS);
  });

  it('returns null for blank input', () => {
    expect(normalizeDnsName('')).toBeNull();
    expect(normalizeDnsName('   ')).toBeNull();
    expect(normalizeDnsName(undefined)).toBeNull();
  });
});

describe('extractServeOrigins', () => {
  it('returns https origins for default HTTPS listeners', () => {
    expect(extractServeOrigins({
      Web: {
        [`${EXAMPLE_TS_DNS}:443`]: {
          Handlers: {
            '/': { Proxy: 'http://127.0.0.1:3080' },
          },
        },
      },
    })).toEqual([`https://${EXAMPLE_TS_DNS}`]);
  });

  it('maps port 80 listeners to http origins', () => {
    expect(extractServeOrigins({
      Web: {
        [`${EXAMPLE_TS_DNS}:80`]: { Handlers: {} },
      },
    })).toEqual([`http://${EXAMPLE_TS_DNS}`]);
  });

  it('preserves non-standard HTTPS ports in the origin', () => {
    expect(extractServeOrigins({
      Web: {
        [`${EXAMPLE_TS_DNS}:8443`]: { Handlers: {} },
      },
    })).toEqual([`https://${EXAMPLE_TS_DNS}:8443`]);
  });

  it('dedupes duplicate hosts and ignores invalid entries', () => {
    expect(extractServeOrigins({
      Web: {
        [`${EXAMPLE_TS_DNS}:443`]: { Handlers: {} },
        [EXAMPLE_TS_DNS]: { Handlers: {} },
        ':443': { Handlers: {} },
      },
    })).toEqual([`https://${EXAMPLE_TS_DNS}`]);
  });
});

describe('parseTailscaleStatus', () => {
  it('marks authenticated false when tailscale is installed but Self is missing a usable address', () => {
    expect(parseTailscaleStatus({})).toMatchObject({
      authenticated: false,
      ipv4: null,
      dnsName: null,
    });
  });

  it('extracts the first IPv4 and normalized dns name from status json', () => {
    expect(parseTailscaleStatus({
      Self: {
        DNSName: `${EXAMPLE_TS_DNS}.`,
        TailscaleIPs: [EXAMPLE_TS_IPV6, EXAMPLE_TS_IPV4],
      },
    })).toEqual({
      authenticated: true,
      ipv4: EXAMPLE_TS_IPV4,
      dnsName: EXAMPLE_TS_DNS,
    });
  });
});

describe('getTailscaleState', () => {
  it('returns installed false when tailscale is unavailable', () => {
    const exec = () => {
      throw new Error('not found');
    };

    expect(getTailscaleState(exec as never)).toEqual({
      installed: false,
      authenticated: false,
      ipv4: null,
      dnsName: null,
      serveOrigins: [],
      serveEndpoints: [],
    });
  });

  it('keeps each Serve endpoint with the target its root handler proxies to', () => {
    const exec = (command: string) => {
      if (command.startsWith('command -v')) return '/usr/bin/tailscale';
      if (command.startsWith('tailscale status')) return JSON.stringify({ Self: { DNSName: `${EXAMPLE_TS_DNS}.`, TailscaleIPs: ['100.64.0.42'] } });
      if (command.startsWith('tailscale serve status')) {
        return JSON.stringify({
          Web: {
            [`${EXAMPLE_TS_DNS}:8443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:9000' } } },
            [`${EXAMPLE_TS_DNS}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3080' } } },
          },
        });
      }
      throw new Error(`unexpected command: ${command}`);
    };

    const state = getTailscaleState(exec as never);

    expect(state.serveOrigins).toEqual([`https://${EXAMPLE_TS_DNS}:8443`, `https://${EXAMPLE_TS_DNS}`]);
    expect(state.serveEndpoints).toEqual([
      { origin: `https://${EXAMPLE_TS_DNS}:8443`, rootProxy: 'http://127.0.0.1:9000' },
      { origin: `https://${EXAMPLE_TS_DNS}`, rootProxy: 'http://127.0.0.1:3080' },
    ]);
  });
});

describe('extractServeEndpoints', () => {
  it('records the root handler proxy target for each origin', () => {
    expect(extractServeEndpoints({
      Web: {
        [`${EXAMPLE_TS_DNS}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3080' } } },
      },
    })).toEqual([{ origin: `https://${EXAMPLE_TS_DNS}`, rootProxy: 'http://127.0.0.1:3080' }]);
  });

  it('records no target when only a sub-path proxies somewhere or there is no root handler', () => {
    expect(extractServeEndpoints({
      Web: {
        [`${EXAMPLE_TS_DNS}:443`]: { Handlers: { '/old': { Proxy: 'http://127.0.0.1:3080' } } },
        [`${EXAMPLE_TS_DNS}:8443`]: { Handlers: { '/': { Path: '/srv/www' } } },
      },
    })).toEqual([
      { origin: `https://${EXAMPLE_TS_DNS}`, rootProxy: null },
      { origin: `https://${EXAMPLE_TS_DNS}:8443`, rootProxy: null },
    ]);
  });

  it('keeps the proxy target of a duplicate origin that has one', () => {
    expect(extractServeEndpoints({
      Web: {
        [EXAMPLE_TS_DNS]: { Handlers: {} },
        [`${EXAMPLE_TS_DNS}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3080' } } },
      },
    })).toEqual([{ origin: `https://${EXAMPLE_TS_DNS}`, rootProxy: 'http://127.0.0.1:3080' }]);
  });
});
