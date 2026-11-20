/**
 * Resolve the client address from the forwarding headers a trusted proxy sent.
 *
 * Shared by the loopback trust check (trust-utils.ts) and the rate limiter
 * (rate-limit.ts) so both read the headers the same way. Callers decide which
 * addresses count as trusted proxies and only call this when the socket
 * address itself is one.
 * @module
 */

type HeaderValue = string | string[] | undefined;

function headerText(value: HeaderValue): string {
  return Array.isArray(value) ? value.join(',') : (value ?? '');
}

/**
 * Pick the client address out of `X-Forwarded-For` and `X-Real-IP`.
 *
 * `X-Forwarded-For` is walked from the right and the first address that is
 * not a trusted proxy wins. A proxy that appends to the header (nginx with
 * `$proxy_add_x_forwarded_for`, for example) keeps whatever the client sent
 * on the left, so only the right-hand entries were written by trusted hops.
 *
 * When every entry is a trusted proxy, or the header is absent, `X-Real-IP`
 * is used: a proxy that sets only `X-Real-IP` passes the client's own
 * `X-Forwarded-For` through untouched. After that comes the left-most
 * `X-Forwarded-For` entry. Returns undefined when neither header names an
 * address.
 */
export function resolveForwardedClientIp(
  forwardedFor: HeaderValue,
  realIp: HeaderValue,
  isTrustedProxy: (ip: string) => boolean,
): string | undefined {
  const hops = headerText(forwardedFor)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (let i = hops.length - 1; i >= 0; i--) {
    if (!isTrustedProxy(hops[i])) return hops[i];
  }

  const realIpText = headerText(realIp).trim();
  if (realIpText) return realIpText;

  return hops[0];
}
