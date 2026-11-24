/**
 * Global error handler middleware.
 *
 * Catches unhandled errors thrown by route handlers and returns a consistent
 * response: JSON `{ error }` for `/api/*` routes, plain text otherwise.
 * In development mode, stack traces are logged to stderr.
 * @module
 */

import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

const isDev = process.env.NODE_ENV !== 'production';

/** `/api` and `/api/*`, but not lookalikes such as `/api-docs`. */
function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException && err.status < 500) {
    // A response attached to the exception (with its own headers, such as
    // WWW-Authenticate or Retry-After) is returned as is.
    if (err.res || !isApiPath(c.req.path)) {
      return err.getResponse();
    }
    return c.json({ ok: false, error: err.message }, err.status);
  }
  console.error('[server] unhandled error:', err.message || err);
  if (isDev && err.stack) {
    console.error('[server] stack:', err.stack);
  }
  if (isApiPath(c.req.path)) {
    return c.json({ error: 'Internal server error' }, 500);
  }
  return c.text('Internal server error', 500);
};
