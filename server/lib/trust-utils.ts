/**
 * Utility for determining if a request is "trusted" for sensitive operations
 * like token injection or bypassing security gates.
 */

import { config } from './config.js';

/** Regular expression to match IPv4 and IPv6 loopback addresses */
export const LOOPBACK_RE = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;

/**
 * Resolve the real client IP, accounting for local reverse proxies (X-Forwarded-For).
 * Only trusts forwarded headers if the direct connection is from a loopback address.
 */
export function getRealClientIp(req: { 
  socket: { remoteAddress?: string }; 
  headers: Record<string, string | string[] | undefined>;
}): string {
  const directIp = req.socket.remoteAddress || '';
  const isDirectLoopback = LOOPBACK_RE.test(directIp);
  
  if (isDirectLoopback) {
    const forwarded = req.headers['x-forwarded-for'];
    const realIp = req.headers['x-real-ip'];
    const headersIp = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim()
      || (typeof realIp === 'string' ? realIp : undefined);
    if (headersIp) return headersIp;
  }
  
  return directIp;
}

/**
 * Determine if a request is trusted for server-side token injection.
 * 
 * NOTE: When config.auth is enabled, this function assumes the caller has
 * independently verified the session (as the WebSocket upgrade handler does).
 * In unauthenticated contexts like connect-defaults, it reflects the server's
 * CAPABILITY to inject tokens once trust is established.
 * 
 * A request is trusted if:
 * 1. Global auth is enabled (requires independent session verification for injection).
 * 2. OR the resolved client IP is a local loopback (local development).
 */
export function isRequestTrusted(req: { 
  socket: { remoteAddress?: string }; 
  headers: Record<string, string | string[] | undefined>;
}): boolean {
  const clientIp = getRealClientIp(req);
  return config.auth || LOOPBACK_RE.test(clientIp);
}

/**
 * Determine if the server is capable and willing to inject a gateway token for this request.
 */
export function canInjectGatewayToken(req: { 
  socket: { remoteAddress?: string }; 
  headers: Record<string, string | string[] | undefined>;
}): boolean {
  return !!config.gatewayToken && isRequestTrusted(req);
}
