/**
 * Session management — cookie creation, signing, verification, and password hashing.
 *
 * Uses HMAC-SHA256 for stateless signed session tokens and scrypt for password
 * hashing. Zero external dependencies — only `node:crypto`.
 * @module
 */

import crypto from 'node:crypto';

interface SessionPayload {
  /** Expiry timestamp (ms since epoch) */
  exp: number;
  /** Issued-at timestamp (ms since epoch) */
  iat: number;
}

/**
 * Create a signed session token.
 * Format: base64url(JSON payload).base64url(HMAC-SHA256 signature)
 */
export function createSession(secret: string, ttlMs: number): string {
  const payload: SessionPayload = {
    exp: Date.now() + ttlMs,
    iat: Date.now(),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a signed session token.
 * Returns the payload if valid and not expired, null otherwise.
 */
export function verifySession(token: string, secret: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');

  // Timing-safe comparison to prevent timing attacks
  if (sig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as SessionPayload;
    if (payload.exp < Date.now()) return null; // Expired
    return payload;
  } catch {
    return null;
  }
}

/**
 * Verify a password against a stored scrypt hash.
 * Hash format: salt:derivedKey (both hex-encoded)
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [saltHex, keyHex] = hash.split(':');
  if (!saltHex || !keyHex) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const storedKey = Buffer.from(keyHex, 'hex');

  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(crypto.timingSafeEqual(derivedKey, storedKey));
    });
  });
}

/**
 * Hash a password using scrypt.
 * Returns: salt:derivedKey (both hex-encoded)
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(32);
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt.toString('hex')}:${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * Parse the nerve_session cookie from a raw Cookie header string.
 * Used for WebSocket upgrade requests (outside Hono's middleware).
 */
export function parseSessionCookie(cookieHeader: string | undefined, cookieName: string): string | null {
  if (!cookieHeader) return null;
  const regex = new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`);
  const match = cookieHeader.match(regex);
  return match ? decodeURIComponent(match[1]) : null;
}
