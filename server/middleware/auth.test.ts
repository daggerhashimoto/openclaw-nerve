/** Tests for the auth middleware. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// We need to mock config and verifySession before importing the middleware
vi.mock('../lib/config.js', () => {
  return {
    config: {
      auth: false,
      sessionSecret: 'test-secret-123',
      serviceToken: '',
    },
    SESSION_COOKIE_NAME: 'nerve_session_3080',
  };
});

vi.mock('../lib/session.js', () => {
  return {
    verifySession: vi.fn(),
  };
});

import { authMiddleware } from './auth.js';
import { config } from '../lib/config.js';
import { verifySession } from '../lib/session.js';

const mockedConfig = config as { auth: boolean; sessionSecret: string; serviceToken: string };
const mockedVerifySession = verifySession as ReturnType<typeof vi.fn>;

function createTestApp(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.get('/api/test', (c) => c.json({ ok: true }));
  app.post('/api/tts', (c) => c.json({ ok: true }));
  app.get('/api/auth/login', (c) => c.json({ login: true }));
  app.get('/api/auth/logout', (c) => c.json({ logout: true }));
  app.get('/api/auth/status', (c) => c.json({ status: true }));
  app.get('/api/health', (c) => c.json({ health: true }));
  app.get('/health', (c) => c.json({ health: true }));
  app.get('/api/version', (c) => c.json({ version: '1.0' }));
  app.get('/some/page', (c) => c.html('<h1>Page</h1>'));
  app.get('/assets/style.css', (c) => c.text('body{}'));
  return app;
}

describe('authMiddleware', () => {
  beforeEach(() => {
    mockedConfig.auth = false;
    mockedConfig.serviceToken = '';
    mockedVerifySession.mockReset();
  });

  describe('when auth is disabled', () => {
    it('passes through all API routes without checking cookies', async () => {
      const app = createTestApp();
      const res = await app.request('/api/test');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(mockedVerifySession).not.toHaveBeenCalled();
    });

    it('passes through non-API routes', async () => {
      const app = createTestApp();
      const res = await app.request('/some/page');
      expect(res.status).toBe(200);
    });
  });

  describe('when auth is enabled', () => {
    beforeEach(() => {
      mockedConfig.auth = true;
    });

    it('returns 401 for API routes without a session cookie', async () => {
      const app = createTestApp();
      const res = await app.request('/api/test');
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Authentication required');
    });

    it('returns 401 for an invalid session cookie', async () => {
      mockedVerifySession.mockReturnValue(null);
      const app = createTestApp();
      const res = await app.request('/api/test', {
        headers: { Cookie: 'nerve_session_3080=invalid-token' },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Invalid or expired session');
    });

    it('passes through with a valid session cookie', async () => {
      mockedVerifySession.mockReturnValue({ exp: Date.now() + 60000, iat: Date.now() });
      const app = createTestApp();
      const res = await app.request('/api/test', {
        headers: { Cookie: 'nerve_session_3080=valid-token' },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it('authenticates service-token TTS without a browser session', async () => {
      mockedConfig.serviceToken = 'tok-123';
      const app = createTestApp();
      const res = await app.request('/api/tts', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok-123' },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(mockedVerifySession).not.toHaveBeenCalled();
    });

    it('rejects a wrong service token', async () => {
      mockedConfig.serviceToken = 'tok-123';
      const app = createTestApp();
      const res = await app.request('/api/tts', {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong' },
      });
      expect(res.status).toBe(401);
    });

    it('does not grant the TTS token access to other API routes', async () => {
      mockedConfig.serviceToken = 'tok-123';
      const app = createTestApp();
      const res = await app.request('/api/test', {
        headers: { Authorization: 'Bearer tok-123' },
      });
      expect(res.status).toBe(401);
    });

    it('does not enable bearer auth when the service token is empty', async () => {
      const app = createTestApp();
      const res = await app.request('/api/tts', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok-123' },
      });
      expect(res.status).toBe(401);
    });

    describe('public routes bypass auth', () => {
      const publicRoutes = [
        '/api/auth/login',
        '/api/auth/logout',
        '/api/auth/status',
        '/api/health',
        '/health',
      ];

      for (const route of publicRoutes) {
        it(`${route} is accessible without auth`, async () => {
          const app = createTestApp();
          const res = await app.request(route);
          expect(res.status).toBe(200);
          expect(mockedVerifySession).not.toHaveBeenCalled();
        });
      }

      it('keeps /api/auth/login public while protected API routes still require a session', async () => {
        const app = createTestApp();

        const loginRes = await app.request('/api/auth/login');
        expect(loginRes.status).toBe(200);
        expect(mockedVerifySession).not.toHaveBeenCalled();

        const protectedRes = await app.request('/api/test');
        expect(protectedRes.status).toBe(401);
        const body = (await protectedRes.json()) as { error: string };
        expect(body.error).toBe('Authentication required');
        expect(mockedVerifySession).not.toHaveBeenCalled();
      });
    });

    describe('non-API routes pass through (SPA/static)', () => {
      it('/some/page passes through without auth check', async () => {
        const app = createTestApp();
        const res = await app.request('/some/page');
        expect(res.status).toBe(200);
        expect(mockedVerifySession).not.toHaveBeenCalled();
      });

      it('/assets/style.css passes through without auth check', async () => {
        const app = createTestApp();
        const res = await app.request('/assets/style.css');
        expect(res.status).toBe(200);
        expect(mockedVerifySession).not.toHaveBeenCalled();
      });
    });

    it('calls verifySession with token and secret', async () => {
      mockedVerifySession.mockReturnValue({ exp: Date.now() + 60000, iat: Date.now() });
      const app = createTestApp();
      await app.request('/api/test', {
        headers: { Cookie: 'nerve_session_3080=my-session-token' },
      });
      expect(mockedVerifySession).toHaveBeenCalledWith('my-session-token', 'test-secret-123');
    });
  });
});
