import { describe, it, expect } from 'vitest';
import { buildAccessPlan, applyAccessPlanToConfig, requiresAuthentication, serveTargetPort } from './access-plan.js';

const EXAMPLE_TS_DNS = 'example-node.tail0000.ts.net';
const EXAMPLE_TS_IPV4 = '100.64.0.42';

const connectedTailscale = {
  installed: true,
  authenticated: true,
  ipv4: EXAMPLE_TS_IPV4,
  dnsName: EXAMPLE_TS_DNS,
  serveOrigins: [`https://${EXAMPLE_TS_DNS}`],
};

describe('buildAccessPlan', () => {
  it('builds a tailscale-ip plan with network bind and IP origin', () => {
    expect(buildAccessPlan({
      profile: 'tailscale-ip',
      port: '3080',
      tailscale: connectedTailscale,
    })).toMatchObject({
      bindHost: '0.0.0.0',
      browserOrigins: [`http://${EXAMPLE_TS_IPV4}:3080`],
      gatewayAllowedOrigins: [`http://${EXAMPLE_TS_IPV4}:3080`],
      wsAllowedHosts: [EXAMPLE_TS_IPV4],
    });
  });

  it('builds a tailscale-serve plan with loopback bind and ts.net origin', () => {
    expect(buildAccessPlan({
      profile: 'tailscale-serve',
      port: '3080',
      tailscale: connectedTailscale,
    })).toMatchObject({
      bindHost: '127.0.0.1',
      browserOrigins: [`https://${EXAMPLE_TS_DNS}`],
      gatewayAllowedOrigins: [`https://${EXAMPLE_TS_DNS}`],
      wsAllowedHosts: [],
    });
  });

  it('builds a network plan with only the http origin when HTTPS is off', () => {
    expect(buildAccessPlan({
      profile: 'network',
      port: '3080',
      remoteHost: '192.168.1.20',
    })).toMatchObject({
      bindHost: '0.0.0.0',
      browserOrigins: ['http://192.168.1.20:3080'],
      gatewayAllowedOrigins: ['http://192.168.1.20:3080'],
      cspConnectExtra: ['http://192.168.1.20:3080', 'ws://192.168.1.20:3080'],
      wsAllowedHosts: ['192.168.1.20'],
    });
  });

  it('adds the https origin to a network plan when HTTPS is on', () => {
    expect(buildAccessPlan({
      profile: 'network',
      port: '3080',
      sslPort: '3443',
      remoteHost: '192.168.1.20',
    })).toMatchObject({
      bindHost: '0.0.0.0',
      browserOrigins: ['http://192.168.1.20:3080', 'https://192.168.1.20:3443'],
      gatewayAllowedOrigins: ['http://192.168.1.20:3080', 'https://192.168.1.20:3443'],
      cspConnectExtra: [
        'http://192.168.1.20:3080',
        'ws://192.168.1.20:3080',
        'https://192.168.1.20:3443',
        'wss://192.168.1.20:3443',
      ],
      wsAllowedHosts: ['192.168.1.20'],
    });
  });

  it('adds the https origin to a custom plan when HTTPS is on', () => {
    expect(buildAccessPlan({
      profile: 'custom',
      port: '3080',
      sslPort: '4443',
      remoteHost: '10.0.0.5',
    })).toMatchObject({
      browserOrigins: ['http://10.0.0.5:3080', 'https://10.0.0.5:4443'],
      gatewayAllowedOrigins: ['http://10.0.0.5:3080', 'https://10.0.0.5:4443'],
      cspConnectExtra: [
        'http://10.0.0.5:3080',
        'ws://10.0.0.5:3080',
        'https://10.0.0.5:4443',
        'wss://10.0.0.5:4443',
      ],
    });
  });

  it('adds the https origin to a tailscale-ip plan when HTTPS is on', () => {
    expect(buildAccessPlan({
      profile: 'tailscale-ip',
      port: '3080',
      sslPort: '3443',
      tailscale: connectedTailscale,
    })).toMatchObject({
      browserOrigins: [`http://${EXAMPLE_TS_IPV4}:3080`, `https://${EXAMPLE_TS_IPV4}:3443`],
      gatewayAllowedOrigins: [`http://${EXAMPLE_TS_IPV4}:3080`, `https://${EXAMPLE_TS_IPV4}:3443`],
      cspConnectExtra: [
        `http://${EXAMPLE_TS_IPV4}:3080`,
        `ws://${EXAMPLE_TS_IPV4}:3080`,
        `https://${EXAMPLE_TS_IPV4}:3443`,
        `wss://${EXAMPLE_TS_IPV4}:3443`,
      ],
      wsAllowedHosts: [EXAMPLE_TS_IPV4],
    });
  });

  it('keeps a tailscale-serve plan on the ts.net origin even when an SSL port is configured', () => {
    // Tailscale Serve terminates TLS itself and Nerve stays on loopback, so the
    // Nerve HTTPS port is never reachable from a browser.
    const plan = buildAccessPlan({
      profile: 'tailscale-serve',
      port: '3080',
      sslPort: '3443',
      tailscale: connectedTailscale,
    });
    expect(plan.browserOrigins).toEqual([`https://${EXAMPLE_TS_DNS}`]);
    expect(plan.gatewayAllowedOrigins).toEqual([`https://${EXAMPLE_TS_DNS}`]);
  });

  it('adds no origins to a local plan even when an SSL port is configured', () => {
    const plan = buildAccessPlan({ profile: 'local', port: '3080', sslPort: '3443' });
    expect(plan.browserOrigins).toEqual([]);
    expect(plan.gatewayAllowedOrigins).toEqual([]);
  });

  it('adds follow-up steps when tailscale-serve is selected without a confirmed ts.net origin', () => {
    const plan = buildAccessPlan({
      profile: 'tailscale-serve',
      port: '3080',
      tailscale: {
        installed: true,
        authenticated: true,
        ipv4: EXAMPLE_TS_IPV4,
        dnsName: null,
        serveOrigins: [],
      },
    });
    expect(plan.followUpSteps.length).toBeGreaterThan(0);
    expect(plan.followUpSteps[0]).toContain('tailscale serve --bg http://127.0.0.1:3080');
    expect(plan.followUpSteps[0]).not.toContain('--bg 443');
  });
});

describe('buildAccessPlan with several Tailscale Serve endpoints', () => {
  const serveState = (endpoints: Array<{ origin: string; rootProxy: string | null }>) => ({
    ...connectedTailscale,
    serveOrigins: endpoints.map((e) => e.origin),
    serveEndpoints: endpoints,
  });
  const OTHER = `https://${EXAMPLE_TS_DNS}:8443`;
  const NERVE = `https://${EXAMPLE_TS_DNS}`;

  it('uses the endpoint that proxies to Nerve even when another one is listed first', () => {
    const plan = buildAccessPlan({
      profile: 'tailscale-serve',
      port: '3080',
      tailscale: serveState([
        { origin: OTHER, rootProxy: 'http://127.0.0.1:9000' },
        { origin: NERVE, rootProxy: 'http://127.0.0.1:3080' },
      ]),
    });
    expect(plan.browserOrigins).toEqual([NERVE]);
    expect(plan.gatewayAllowedOrigins).toEqual([NERVE]);
    expect(plan.cspConnectExtra).toEqual([NERVE, `wss://${EXAMPLE_TS_DNS}`]);
  });

  it('keeps working with a single endpoint that proxies to Nerve', () => {
    const plan = buildAccessPlan({
      profile: 'tailscale-serve',
      port: '3080',
      tailscale: serveState([{ origin: NERVE, rootProxy: 'http://127.0.0.1:3080' }]),
    });
    expect(plan.browserOrigins).toEqual([NERVE]);
    expect(plan.followUpSteps).toEqual([]);
  });

  it('matches localhost targets and the Nerve HTTPS port', () => {
    for (const rootProxy of ['http://localhost:3080', 'http://127.0.0.1:3080/', 'https+insecure://localhost:3443']) {
      const plan = buildAccessPlan({
        profile: 'tailscale-serve',
        port: '3080',
        sslPort: '3443',
        tailscale: serveState([
          { origin: OTHER, rootProxy: 'http://127.0.0.1:9000' },
          { origin: NERVE, rootProxy },
        ]),
      });
      expect(plan.browserOrigins, rootProxy).toEqual([NERVE]);
    }
  });

  it('matches the Nerve HTTPS port when SSL_PORT is absent', () => {
    const plan = buildAccessPlan({
      profile: 'tailscale-serve',
      port: '3080',
      tailscale: serveState([
        { origin: OTHER, rootProxy: 'http://127.0.0.1:9000' },
        { origin: NERVE, rootProxy: 'https+insecure://localhost:3443' },
      ]),
    });
    expect(plan.browserOrigins).toEqual([NERVE]);
  });

  it('does not match the default HTTPS port when certificates are unavailable', () => {
    const plan = buildAccessPlan({
      profile: 'tailscale-serve',
      port: '3080',
      httpsEnabled: false,
      tailscale: serveState([
        { origin: OTHER, rootProxy: 'http://127.0.0.1:9000' },
        { origin: NERVE, rootProxy: 'https+insecure://localhost:3443' },
      ]),
    });
    expect(plan.browserOrigins).toEqual([]);
    expect(plan.followUpSteps.length).toBeGreaterThan(0);
  });

  it('matches the shorthand targets Tailscale accepts: a bare port and host:port', () => {
    for (const rootProxy of ['3080', 'localhost:3080', '127.0.0.1:3080']) {
      const plan = buildAccessPlan({
        profile: 'tailscale-serve',
        port: '3080',
        tailscale: serveState([
          { origin: OTHER, rootProxy: '9000' },
          { origin: NERVE, rootProxy },
        ]),
      });
      expect(plan.browserOrigins, rootProxy).toEqual([NERVE]);
    }
  });

  it('does not take an endpoint that proxies to ::1, since Serve mode binds Nerve to 127.0.0.1', () => {
    const plan = buildAccessPlan({
      profile: 'tailscale-serve',
      port: '3080',
      tailscale: serveState([
        { origin: OTHER, rootProxy: 'http://[::1]:3080' },
        { origin: NERVE, rootProxy: 'http://127.0.0.1:3080' },
      ]),
    });
    expect(plan.browserOrigins).toEqual([NERVE]);
  });

  it('does not take a port that only starts with Nerve\'s port', () => {
    const plan = buildAccessPlan({
      profile: 'tailscale-serve',
      port: '3080',
      tailscale: serveState([{ origin: OTHER, rootProxy: 'http://127.0.0.1:30800' }]),
    });
    expect(plan.browserOrigins).toEqual([]);
  });

  it('writes no origin and says why when every endpoint proxies somewhere else', () => {
    const plan = buildAccessPlan({
      profile: 'tailscale-serve',
      port: '3080',
      tailscale: serveState([
        { origin: OTHER, rootProxy: 'http://127.0.0.1:9000' },
        { origin: NERVE, rootProxy: 'http://192.168.1.20:3080' },
      ]),
    });
    expect(plan.browserOrigins).toEqual([]);
    expect(plan.gatewayAllowedOrigins).toEqual([]);
    expect(plan.followUpSteps.join(' ')).toContain('no endpoint forwards to http://127.0.0.1:3080');
    expect(plan.followUpSteps.join(' ')).toContain('tailscale serve --bg http://127.0.0.1:3080');
  });

  it('falls back to the first endpoint when no endpoint has a readable proxy target', () => {
    const plan = buildAccessPlan({
      profile: 'tailscale-serve',
      port: '3080',
      tailscale: serveState([
        { origin: NERVE, rootProxy: null },
        { origin: OTHER, rootProxy: null },
      ]),
    });
    expect(plan.browserOrigins).toEqual([NERVE]);
  });

  it('reports the port the accepted Serve endpoint proxies to', () => {
    const http = serveState([
      { origin: OTHER, rootProxy: 'http://127.0.0.1:9000' },
      { origin: NERVE, rootProxy: 'http://localhost:3080' },
    ]);
    expect(serveTargetPort(http, ['3080', '3443'])).toBe('3080');

    const https = serveState([
      { origin: OTHER, rootProxy: 'http://127.0.0.1:9000' },
      { origin: NERVE, rootProxy: 'https+insecure://localhost:3443' },
    ]);
    expect(serveTargetPort(https, ['3080', '3443'])).toBe('3443');
    expect(serveTargetPort(https, ['3080'])).toBeNull();

    const shorthand = serveState([{ origin: NERVE, rootProxy: '3443' }]);
    expect(serveTargetPort(shorthand, ['3080', '3443'])).toBe('3443');

    expect(serveTargetPort(undefined, ['3080'])).toBeNull();
  });
});

describe('applyAccessPlanToConfig', () => {
  it('maps the access plan back onto env config fields', () => {
    expect(applyAccessPlanToConfig({ PORT: '3080' }, buildAccessPlan({
      profile: 'tailscale-ip',
      port: '3080',
      tailscale: connectedTailscale,
    }))).toMatchObject({
      HOST: '0.0.0.0',
      ALLOWED_ORIGINS: `http://${EXAMPLE_TS_IPV4}:3080`,
      CSP_CONNECT_EXTRA: `http://${EXAMPLE_TS_IPV4}:3080 ws://${EXAMPLE_TS_IPV4}:3080`,
      WS_ALLOWED_HOSTS: EXAMPLE_TS_IPV4,
    });
  });

  it('writes both the http and https origins of a network plan to ALLOWED_ORIGINS', () => {
    const next = applyAccessPlanToConfig({ PORT: '3080', SSL_PORT: '3443' }, buildAccessPlan({
      profile: 'network',
      port: '3080',
      sslPort: '3443',
      remoteHost: '192.168.1.20',
    }));
    expect(next.ALLOWED_ORIGINS).toBe('http://192.168.1.20:3080,https://192.168.1.20:3443');
    expect(next.CSP_CONNECT_EXTRA).toBe(
      'http://192.168.1.20:3080 ws://192.168.1.20:3080 https://192.168.1.20:3443 wss://192.168.1.20:3443',
    );
  });

  it('adds the remote GATEWAY_URL host to WS_ALLOWED_HOSTS for split-host deployments', () => {
    const localPlan = buildAccessPlan({ profile: 'local', port: '3080' });
    expect(applyAccessPlanToConfig({
      PORT: '3080',
      GATEWAY_URL: 'http://10.0.0.5:18789',
    }, localPlan)).toMatchObject({ WS_ALLOWED_HOSTS: '10.0.0.5' });
  });

  it('does not add a loopback GATEWAY_URL host to WS_ALLOWED_HOSTS', () => {
    const localPlan = buildAccessPlan({ profile: 'local', port: '3080' });
    const next = applyAccessPlanToConfig({
      PORT: '3080',
      GATEWAY_URL: 'http://127.0.0.1:18789',
    }, localPlan);
    expect(next.WS_ALLOWED_HOSTS).toBeUndefined();
  });

  it.each([
    ['http://127.0.1.1:18789', '127/8 alternative loopback'],
    ['http://127.255.255.254:18789', '127/8 high end'],
    ['http://localhost:18789', 'hostname literal'],
    ['http://[::1]:18789', 'bracketed IPv6 loopback from URL.hostname'],
    ['http://[0:0:0:0:0:0:0:1]:18789', 'expanded IPv6 loopback'],
  ])('treats %s as loopback (%s)', gatewayUrl => {
    const localPlan = buildAccessPlan({ profile: 'local', port: '3080' });
    const next = applyAccessPlanToConfig({
      PORT: '3080',
      GATEWAY_URL: gatewayUrl,
    }, localPlan);
    expect(next.WS_ALLOWED_HOSTS).toBeUndefined();
  });

  it('preserves user-added WS_ALLOWED_HOSTS entries when merging plan + gateway host', () => {
    const tsPlan = buildAccessPlan({
      profile: 'tailscale-ip',
      port: '3080',
      tailscale: connectedTailscale,
    });
    const next = applyAccessPlanToConfig({
      PORT: '3080',
      GATEWAY_URL: 'http://10.0.0.5:18789',
      WS_ALLOWED_HOSTS: 'manual-host.example, 192.168.1.42',
    }, tsPlan);
    const hosts = next.WS_ALLOWED_HOSTS!.split(',');
    expect(hosts).toEqual(expect.arrayContaining([
      EXAMPLE_TS_IPV4,
      'manual-host.example',
      '192.168.1.42',
      '10.0.0.5',
    ]));
    expect(hosts).toHaveLength(4); // no duplicates
  });

  it('dedupes when GATEWAY_URL host already appears in the plan or existing config', () => {
    const customPlan = buildAccessPlan({
      profile: 'custom',
      port: '3080',
      remoteHost: '10.0.0.5',
    });
    const next = applyAccessPlanToConfig({
      PORT: '3080',
      GATEWAY_URL: 'http://10.0.0.5:18789',
      WS_ALLOWED_HOSTS: '10.0.0.5',
    }, customPlan);
    expect(next.WS_ALLOWED_HOSTS).toBe('10.0.0.5');
  });

  it('ignores a malformed GATEWAY_URL instead of throwing', () => {
    const localPlan = buildAccessPlan({ profile: 'local', port: '3080' });
    const next = applyAccessPlanToConfig({
      PORT: '3080',
      GATEWAY_URL: 'not-a-url',
    }, localPlan);
    expect(next.WS_ALLOWED_HOSTS).toBeUndefined();
  });
});

describe('requiresAuthentication', () => {
  it('returns false for localhost-only setup', () => {
    const plan = buildAccessPlan({ profile: 'local', port: '3080' });
    const config = applyAccessPlanToConfig({ PORT: '3080' }, plan);
    expect(requiresAuthentication(config, plan)).toBe(false);
  });

  it('returns false for a custom loopback bind with no external origins', () => {
    const plan = buildAccessPlan({ profile: 'custom', port: '3080', remoteHost: '127.0.0.1' });
    const config = applyAccessPlanToConfig({ PORT: '3080' }, plan);
    expect(requiresAuthentication(config, plan)).toBe(false);
  });

  it('returns true for tailscale-serve even though HOST stays 127.0.0.1', () => {
    const plan = buildAccessPlan({
      profile: 'tailscale-serve',
      port: '3080',
      tailscale: connectedTailscale,
    });
    const config = applyAccessPlanToConfig({ PORT: '3080' }, plan);
    expect(config.HOST).toBe('127.0.0.1');
    expect(requiresAuthentication(config, plan)).toBe(true);
  });

  it('returns true for tailscale-serve even before a Serve origin is confirmed', () => {
    const plan = buildAccessPlan({
      profile: 'tailscale-serve',
      port: '3080',
      tailscale: { ...connectedTailscale, serveOrigins: [] },
    });
    const config = applyAccessPlanToConfig({ PORT: '3080' }, plan);
    expect(config.HOST).toBe('127.0.0.1');
    expect(config.ALLOWED_ORIGINS).toBeUndefined();
    expect(requiresAuthentication(config, plan)).toBe(true);
  });

  it('returns true for network, tailscale-ip, and non-loopback custom binds', () => {
    const networkPlan = buildAccessPlan({ profile: 'network', port: '3080', remoteHost: '192.168.1.20' });
    expect(requiresAuthentication(applyAccessPlanToConfig({ PORT: '3080' }, networkPlan), networkPlan)).toBe(true);

    const tsIpPlan = buildAccessPlan({ profile: 'tailscale-ip', port: '3080', tailscale: connectedTailscale });
    expect(requiresAuthentication(applyAccessPlanToConfig({ PORT: '3080' }, tsIpPlan), tsIpPlan)).toBe(true);

    const customPlan = buildAccessPlan({ profile: 'custom', port: '3080', remoteHost: '10.0.0.5' });
    expect(requiresAuthentication(applyAccessPlanToConfig({ PORT: '3080' }, customPlan), customPlan)).toBe(true);
  });

  it('returns true without an access plan when ALLOWED_ORIGINS contains a non-loopback origin', () => {
    expect(requiresAuthentication({
      HOST: '127.0.0.1',
      ALLOWED_ORIGINS: `https://${EXAMPLE_TS_DNS}`,
    })).toBe(true);

    expect(requiresAuthentication({
      HOST: '127.0.0.1',
      ALLOWED_ORIGINS: 'http://localhost:3080,http://127.0.0.1:3080',
    })).toBe(false);
  });

  it('returns true without an access plan when Tailscale Serve actively proxies to Nerve', () => {
    expect(requiresAuthentication(
      { HOST: '127.0.0.1', PORT: '3080' },
      undefined,
      {
        ...connectedTailscale,
        serveEndpoints: [{ origin: `https://${EXAMPLE_TS_DNS}`, rootProxy: 'http://127.0.0.1:3080' }],
      },
    )).toBe(true);

    expect(requiresAuthentication(
      { HOST: '127.0.0.1', PORT: '3080' },
      undefined,
      {
        ...connectedTailscale,
        serveEndpoints: [{ origin: `https://${EXAMPLE_TS_DNS}`, rootProxy: 'http://127.0.0.1:9000' }],
      },
    )).toBe(false);
  });

  it('matches the default HTTPS port when SSL_PORT is absent', () => {
    expect(requiresAuthentication(
      { HOST: '127.0.0.1', PORT: '3080' },
      undefined,
      {
        ...connectedTailscale,
        serveOrigins: [],
        serveEndpoints: [{ origin: `https://${EXAMPLE_TS_DNS}`, rootProxy: 'https+insecure://localhost:3443' }],
      },
    )).toBe(true);
  });

  it('does not match the default HTTPS port when a different SSL_PORT is configured', () => {
    expect(requiresAuthentication(
      { HOST: '127.0.0.1', PORT: '3080', SSL_PORT: '4443' },
      undefined,
      {
        ...connectedTailscale,
        serveOrigins: [],
        serveEndpoints: [{ origin: `https://${EXAMPLE_TS_DNS}`, rootProxy: 'https+insecure://localhost:3443' }],
      },
    )).toBe(false);
  });

  it('does not match the default HTTPS port when certificates are unavailable', () => {
    expect(requiresAuthentication(
      { HOST: '127.0.0.1', PORT: '3080' },
      undefined,
      {
        ...connectedTailscale,
        serveOrigins: [],
        serveEndpoints: [{ origin: `https://${EXAMPLE_TS_DNS}`, rootProxy: 'https+insecure://localhost:3443' }],
      },
      false,
    )).toBe(false);
  });

  it('returns true without an access plan when a Serve TCP forward reaches Nerve', () => {
    const tcpOnly = {
      ...connectedTailscale,
      serveOrigins: [],
      serveEndpoints: [],
    };

    expect(requiresAuthentication(
      { HOST: '127.0.0.1', PORT: '3080' },
      undefined,
      { ...tcpOnly, tcpForwards: ['127.0.0.1:3080'] },
    )).toBe(true);

    expect(requiresAuthentication(
      { HOST: '127.0.0.1', PORT: '3080' },
      undefined,
      { ...tcpOnly, tcpForwards: ['127.0.0.1:9000'] },
    )).toBe(false);
  });
});
