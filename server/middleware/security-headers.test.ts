/** Tests for the security headers middleware. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

describe('securityHeaders middleware', () => {
  let origEnv: string | undefined;

  beforeEach(() => {
    origEnv = process.env.NODE_ENV;
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = origEnv;
    vi.restoreAllMocks();
  });

  async function buildApp() {
    const { securityHeaders } = await import('./security-headers.js');
    const app = new Hono();
    app.use('*', securityHeaders);
    app.get('/test', (c) => c.text('ok'));
    return app;
  }

  it('sets Content-Security-Policy header', async () => {
    const app = await buildApp();
    const res = await app.request('/test');
    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toMatch(/frame-src [^;]*https:\/\/www\.google\.com/);
  });

  it('sets X-Frame-Options to SAMEORIGIN', async () => {
    const app = await buildApp();
    const res = await app.request('/test');
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
  });

  it('sets X-Content-Type-Options to nosniff', async () => {
    const app = await buildApp();
    const res = await app.request('/test');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('sets X-XSS-Protection', async () => {
    const app = await buildApp();
    const res = await app.request('/test');
    expect(res.headers.get('X-XSS-Protection')).toBe('1; mode=block');
  });

  it('sets Referrer-Policy', async () => {
    const app = await buildApp();
    const res = await app.request('/test');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('sets Cache-Control to no-store when not already set', async () => {
    const app = await buildApp();
    const res = await app.request('/test');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('preserves existing Cache-Control if set by route', async () => {
    const { securityHeaders } = await import('./security-headers.js');
    const app = new Hono();
    app.use('*', securityHeaders);
    app.get('/cached', (c) => {
      c.header('Cache-Control', 'public, max-age=3600');
      return c.text('ok');
    });
    const res = await app.request('/cached');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
  });

  it('CSP includes connect-src with websocket origins', async () => {
    const app = await buildApp();
    const res = await app.request('/test');
    const csp = res.headers.get('Content-Security-Policy')!;
    expect(csp).toContain('ws://localhost:*');
    expect(csp).toContain('wss://localhost:*');
  });
});
