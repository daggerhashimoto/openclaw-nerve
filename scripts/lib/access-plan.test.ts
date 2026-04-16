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
});
