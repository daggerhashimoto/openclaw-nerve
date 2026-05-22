import { describe, it, expect } from 'vitest';
import { buildAccessPlan, applyAccessPlanToConfig } from './access-plan.js';

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
