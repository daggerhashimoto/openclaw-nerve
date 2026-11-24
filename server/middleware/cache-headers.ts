/**
 * Cache-Control middleware for static assets.
 *
 * - API routes and `/health`: `no-cache`
 * - Vite-hashed assets (e.g. `index-Pbmes8jg.js`): immutable, 1-year max-age
 * - Other static files: `must-revalidate`
 * @module
 */

import type { MiddlewareHandler } from 'hono';

/**
 * Pattern matching hashed filenames from Vite builds.
 * e.g. index-Pbmes8jg.js, style-CsmNuK-P.css
 * Vite uses base64url-ish hashes (mixed case, digits, hyphens, underscores).
 */
const HASHED_ASSET_RE = /-[a-zA-Z0-9_-]{6,}\.\w+$/;

export const cacheHeaders: MiddlewareHandler = async (c, next) => {
  await next();

  const path = c.req.path;
  const routeCacheControl = c.res.headers.get('Cache-Control');
  const isApiRoute = path.startsWith('/api/') || path === '/api';
  const isNoCacheRoute = isApiRoute || path === '/health';

  // Keep a route's own Cache-Control header when it set one explicitly. API
  // responses may be auth-protected, so never let a route mark them public:
  // a shared cache could then serve the response without the session check.
  if (routeCacheControl && !(isApiRoute && /\bpublic\b/i.test(routeCacheControl))) {
    return;
  }

  // API routes and /health — no caching
  if (isNoCacheRoute) {
    c.header('Cache-Control', 'no-cache');
    return;
  }

  // Missing/static error responses must not be cached as immutable assets.
  if (c.res.status >= 400) {
    c.header('Cache-Control', 'no-store');
    return;
  }

  // Hashed static assets — cache forever
  if (HASHED_ASSET_RE.test(path)) {
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    return;
  }

  // Non-hashed static files (index.html etc) — revalidate
  if (path !== '/' && path.includes('.')) {
    c.header('Cache-Control', 'public, max-age=0, must-revalidate');
  }
};
