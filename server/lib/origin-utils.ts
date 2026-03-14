/**
 * Shared origin allowlist for browser-facing HTTP and WebSocket entrypoints.
 */

import { config } from './config.js';

function normalizeHost(host: string): string {
  return host.replace(/^\[/, '').replace(/\]$/, '');
}

function isLocalHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

const ALLOWED_ORIGINS = new Set([
  `http://localhost:${config.port}`,
  `https://localhost:${config.sslPort}`,
  `http://127.0.0.1:${config.port}`,
  `https://127.0.0.1:${config.sslPort}`,
]);

const extraOrigins = process.env.ALLOWED_ORIGINS;
if (extraOrigins) {
  for (const raw of extraOrigins.split(',')) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === 'null') continue;
    try {
      ALLOWED_ORIGINS.add(new URL(trimmed).origin);
    } catch {
      // Ignore malformed origins from env.
    }
  }
}

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return isLocalHost(config.host);

  try {
    const parsed = new URL(origin);
    if (isLocalHost(parsed.hostname)) return true;
    return ALLOWED_ORIGINS.has(parsed.origin);
  } catch {
    return false;
  }
}

export function resolveCorsOrigin(origin: string | undefined): string | null | undefined {
  return isAllowedOrigin(origin) ? origin : null;
}
