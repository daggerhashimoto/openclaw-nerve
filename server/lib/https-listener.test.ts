/** Tests for the HTTPS listener rule. */
import { describe, it, expect } from 'vitest';
import { httpsListenerEnabled } from './https-listener.js';

describe('httpsListenerEnabled', () => {
  it('stays off without the certificate pair', () => {
    expect(httpsListenerEnabled(undefined, false)).toBe(false);
    expect(httpsListenerEnabled('3443', false)).toBe(false);
  });

  it('starts with certificates and an explicit SSL_PORT', () => {
    expect(httpsListenerEnabled('3443', true)).toBe(true);
    expect(httpsListenerEnabled('4443', true)).toBe(true);
  });

  it('keeps an older .env with certificates and no SSL_PORT line on HTTPS', () => {
    // The rule does not depend on the bind address, so a loopback install whose
    // Tailscale Serve endpoint proxies to https+insecure://localhost:3443 keeps working.
    expect(httpsListenerEnabled(undefined, true)).toBe(true);
  });

  it('stays off when SSL_PORT is explicitly empty, even with certificates', () => {
    expect(httpsListenerEnabled('', true)).toBe(false);
  });
});
