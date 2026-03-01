/**
 * Simple in-memory rate limiter middleware for Hono.
 *
 * Uses a sliding-window approach keyed by `clientIP:path`. Includes automatic
 * periodic cleanup, a hard cap on store size to prevent memory amplification
 * from spoofed IPs, and configurable trusted-proxy support for `X-Forwarded-For`.
 *
 * Presets exported: {@link rateLimitTTS}, {@link rateLimitTranscribe}, {@link rateLimitGeneral}.
 * @module
 */

import type { Context, Next } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

interface RateLimitEntry {
  timestamps: number[];
}

interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
}

const store = new Map<string, RateLimitEntry>();

/** Hard cap on store size to prevent memory amplification from spoofed IPs */
const MAX_STORE_SIZE = 10_000;

// Cleanup old entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
const MAX_WINDOW_MS = 60 * 1000; // largest window used by any preset

function cleanup(): void {
  const now = Date.now();
  const cutoff = now - MAX_WINDOW_MS;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
  }
}

// Interval-based cleanup so entries don't pile up during idle periods
const cleanupInterval = setInterval(cleanup, CLEANUP_INTERVAL);
cleanupInterval.unref(); // don't keep process alive just for cleanup

/**
 * Trusted proxy IPs that are allowed to set X-Forwarded-For / X-Real-IP.
 * Default: loopback only. Extend via TRUSTED_PROXIES env (comma-separated).
 */
const TRUSTED_PROXIES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// Allow additional trusted proxies via env
const extraProxies = process.env.TRUSTED_PROXIES;
if (extraProxies) {
  for (const ip of extraProxies.split(',')) {
    const trimmed = ip.trim();
    if (trimmed) TRUSTED_PROXIES.add(trimmed);
  }
}

/**
 * Get client identifier from request.
 *
 * Uses the real TCP socket address from Node.js (via getConnInfo) — not
 * spoofable request headers. Only trusts X-Forwarded-For / X-Real-IP when
 * the socket address belongs to a trusted proxy.
 */
export function getClientId(c: Context): string {
  // Allow middleware-injected override (for testing / custom client identification)
  const override = c.get('rateLimitClientId' as never) as string | undefined;
  if (override) return override;

  // Get the real TCP socket remote address (not spoofable)
  let directIp = 'unknown';
  try {
    const info = getConnInfo(c);
    directIp = info.remote.address || 'unknown';
  } catch {
    // getConnInfo may fail in test environments — fall back to 'unknown'
  }

  // Only trust forwarded headers from known proxy IPs
  if (TRUSTED_PROXIES.has(directIp)) {
    // Prefer X-Forwarded-For (standard), fall back to X-Real-IP (nginx convention)
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    const realIp = c.req.header('x-real-ip');
    if (realIp) {
      return realIp;
    }
  }

  return directIp;
}

/**
 * Create a rate limiting middleware
 */
export function rateLimit(config: RateLimitConfig) {
  const { maxRequests, windowMs } = config;

  return async (c: Context, next: Next) => {

    const clientId = getClientId(c);
    const path = c.req.path;
    const key = `${clientId}:${path}`;
    const now = Date.now();
    const cutoff = now - windowMs;

    let entry = store.get(key);
    if (!entry) {
      // Enforce store size cap — evict oldest entry if full
      if (store.size >= MAX_STORE_SIZE) {
        const oldestKey = store.keys().next().value;
        if (oldestKey !== undefined) store.delete(oldestKey);
      }
      entry = { timestamps: [] };
      store.set(key, entry);
    }

    // Remove old timestamps outside the window
    entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);

    if (entry.timestamps.length >= maxRequests) {
      const oldestTs = entry.timestamps[0];
      const retryAfter = Math.ceil((oldestTs + windowMs - now) / 1000);

      c.header('Retry-After', String(retryAfter));
      c.header('X-RateLimit-Limit', String(maxRequests));
      c.header('X-RateLimit-Remaining', '0');
      c.header('X-RateLimit-Reset', String(Math.ceil((oldestTs + windowMs) / 1000)));

      return c.text('Too many requests. Please try again later.', 429);
    }

    // Add current timestamp
    entry.timestamps.push(now);

    // Set rate limit headers
    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(maxRequests - entry.timestamps.length));

    await next();
  };
}

/** Preset: 10 requests per minute (for expensive operations like TTS) */
export const rateLimitTTS = rateLimit({ maxRequests: 10, windowMs: 60 * 1000 });

/** Preset: 30 requests per minute (for transcription) */
export const rateLimitTranscribe = rateLimit({ maxRequests: 30, windowMs: 60 * 1000 });

/** Preset: 60 requests per minute (for general API calls like memories) */
export const rateLimitGeneral = rateLimit({ maxRequests: 60, windowMs: 60 * 1000 });

/** Preset: 5 requests per minute (for authentication — brute-force protection) */
export const rateLimitAuth = rateLimit({ maxRequests: 5, windowMs: 60 * 1000 });

/** Preset: 3 requests per minute (for service restart — prevent restart storms) */
export const rateLimitRestart = rateLimit({ maxRequests: 3, windowMs: 60 * 1000 });
