import { afterEach, describe, expect, it, vi } from 'vitest';

const EXAMPLE_TS_DNS = 'example-node.tail0000.ts.net';
const EXAMPLE_TS_IPV4 = '100.64.0.42';

describe('checkPrerequisites', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('includes Tailscale authentication, dns name, and serve origins when available', async () => {
    vi.doMock('./tailscale.js', () => ({
      getTailscaleState: () => ({
        installed: true,
        authenticated: true,
        ipv4: EXAMPLE_TS_IPV4,
        dnsName: EXAMPLE_TS_DNS,
        serveOrigins: [`https://${EXAMPLE_TS_DNS}`],
      }),
    }));

    const { checkPrerequisites } = await import('./prereq-check.js');
    const result = checkPrerequisites({ quiet: true });

    expect(result.tailscale).toEqual({
      installed: true,
      authenticated: true,
      ipv4: EXAMPLE_TS_IPV4,
      dnsName: EXAMPLE_TS_DNS,
      serveOrigins: [`https://${EXAMPLE_TS_DNS}`],
    });
  });
});
