/**
 * Authentication middleware for Hono.
 *
 * When `NERVE_AUTH` is enabled, requires a valid signed session cookie on all
 * `/api/*` routes except public ones (auth endpoints, health check). Static
 * files and SPA routes pass through — the frontend login gate handles those.
 * @module
 */

import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { config, SESSION_COOKIE_NAME } from '../lib/config.js';
import { verifySession } from '../lib/session.js';

/** Routes that don't require authentication */
const PUBLIC_ROUTES = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/status',
  '/api/health',
  '/health',
];

/**
 * Authentication middleware.
 * When NERVE_AUTH is enabled, requires a valid signed session cookie
 * on all /api/* routes except public ones. Static files pass through.
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  // Auth disabled — pass through everything
  if (!config.auth) return next();

  // Non-API routes (static files, SPA) — pass through
  // The frontend login gate handles rendering the login page
  if (!c.req.path.startsWith('/api/') && c.req.path !== '/health') return next();

  // Public API routes — always accessible
  if (PUBLIC_ROUTES.some(route => c.req.path === route)) return next();

  // Check session cookie
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const session = verifySession(token, config.sessionSecret);
  if (!session) {
    return c.json({ error: 'Invalid or expired session' }, 401);
  }

  return next();
});
