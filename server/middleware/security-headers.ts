/**
 * Security headers middleware.
 *
 * Adds essential security headers to all responses:
 * - Content-Security-Policy (CSP)
 * - X-Frame-Options
 * - X-Content-Type-Options
 * - Strict-Transport-Security (HSTS)
 * - Referrer-Policy
 * - X-XSS-Protection
 */

import type { MiddlewareHandler } from 'hono';

/**
 * Content Security Policy
 * 
 * - default-src 'self': Only allow resources from same origin by default
 * - script-src 'self': Only allow scripts from same origin
 * - style-src: Allow self, inline styles (needed for some UI libraries), and Google Fonts
 * - font-src: Allow self and Google Fonts CDN
 * - connect-src: Allow self and WebSocket connections to localhost
 * - img-src: Allow self, data URIs, and blob URLs (for generated images)
 * - frame-ancestors 'none': Prevent framing (like X-Frame-Options: DENY)
 */
// Build connect-src dynamically: always include localhost, plus any extra CSP sources
const baseConnectSrc = "'self' ws://localhost:* wss://localhost:* http://localhost:* https://localhost:* ws://127.0.0.1:* wss://127.0.0.1:* http://127.0.0.1:* https://127.0.0.1:*";

/**
 * Build CSP directives string lazily — env vars may not be loaded at import time
 * (dotenv/config runs in config.ts which may be imported after this module).
 */
let _cspDirectives: string | null = null;

function getCspDirectives(): string {
  if (_cspDirectives) return _cspDirectives;

  // CSP_CONNECT_EXTRA env var: space-separated additional connect-src entries
  // e.g. "wss://your-server.example.com:3443 https://your-server.example.com:3443"
  // Sanitize: strip semicolons and CR/LF to prevent directive injection
  const extraConnectSrc = process.env.CSP_CONNECT_EXTRA
    ?.replace(/[;\r\n]/g, '')
    .trim()
    .split(/\s+/)
    .filter(token => /^(https?|wss?):\/\//.test(token))
    .join(' ');
  const connectSrc = extraConnectSrc
    ? `${baseConnectSrc} ${extraConnectSrc}`
    : baseConnectSrc;

  _cspDirectives = [
    "default-src 'self'",
    "script-src 'self' https://s3.tradingview.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    `connect-src ${connectSrc}`,
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",  // Allow blob: URLs for TTS audio playback
    "frame-src https://s3.tradingview.com https://www.tradingview.com https://www.tradingview-widget.com https://s.tradingview.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  return _cspDirectives;
}

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();

  // Content Security Policy - defense in depth against XSS
  c.header('Content-Security-Policy', getCspDirectives());

  // Prevent clickjacking
  c.header('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  c.header('X-Content-Type-Options', 'nosniff');

  // Enable legacy XSS filter (mostly for older browsers)
  c.header('X-XSS-Protection', '1; mode=block');

  // Enforce HTTPS (1 year, include subdomains) — production only
  if (process.env.NODE_ENV === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Control referrer information
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Prevent browsers from caching sensitive responses
  // (can be overridden by cache-headers middleware for specific routes)
  if (!c.res.headers.get('Cache-Control')) {
    c.header('Cache-Control', 'no-store');
  }
};
