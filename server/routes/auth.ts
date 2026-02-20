/**
 * Authentication routes — login, logout, and status.
 *
 * POST /api/auth/login  — Authenticate with password, receive session cookie.
 * POST /api/auth/logout — Clear session cookie.
 * GET  /api/auth/status — Check auth configuration and current session state.
 * @module
 */

import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { config, SESSION_COOKIE_NAME } from '../lib/config.js';
import { createSession, verifySession, verifyPassword } from '../lib/session.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';

const app = new Hono();

/**
 * POST /api/auth/login
 * Accepts { password: string }
 * Sets HttpOnly session cookie on success.
 */
app.post('/api/auth/login', rateLimitGeneral, async (c) => {
  // If auth is disabled, always succeed
  if (!config.auth) {
    return c.json({ ok: true, message: 'Auth disabled' });
  }

  try {
    const body = await c.req.json() as { password?: string };
    const password = body.password?.trim();

    if (!password) {
      return c.json({ error: 'Password required' }, 400);
    }

    let valid = false;

    // Check against stored password hash
    if (config.passwordHash) {
      valid = await verifyPassword(password, config.passwordHash);
    }

    // Fallback: accept gateway token as password
    if (!valid && config.gatewayToken && password === config.gatewayToken) {
      valid = true;
    }

    if (!valid) {
      return c.json({ error: 'Invalid password' }, 401);
    }

    // Create signed session token
    const token = createSession(config.sessionSecret, config.sessionTtlMs);

    // Set HttpOnly, SameSite=Strict cookie
    setCookie(c, SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'Strict',
      secure: c.req.url.startsWith('https'),
      path: '/',
      maxAge: Math.floor(config.sessionTtlMs / 1000),
    });

    return c.json({ ok: true });
  } catch {
    return c.json({ error: 'Invalid request' }, 400);
  }
});

/**
 * POST /api/auth/logout
 * Clears the session cookie.
 */
app.post('/api/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
  return c.json({ ok: true });
});

/**
 * GET /api/auth/status
 * Returns whether auth is enabled and whether the current request is authenticated.
 */
app.get('/api/auth/status', (c) => {
  if (!config.auth) {
    return c.json({ authEnabled: false, authenticated: true });
  }

  const token = getCookie(c, SESSION_COOKIE_NAME);
  const session = token ? verifySession(token, config.sessionSecret) : null;

  return c.json({
    authEnabled: true,
    authenticated: !!session,
  });
});

export default app;
