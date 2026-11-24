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

export type TrustedProxyHeader = 'x-forwarded-for' | 'x-real-ip';

function headerText(value: HeaderValue): string {
  return Array.isArray(value) ? value.join(',') : (value ?? '');
}

/**
 * Normalize `TRUSTED_PROXY_HEADER` from the environment.
 * Accepts `'x-forwarded-for'` (default) or `'x-real-ip'` (case-insensitive).
 */
export function getTrustedProxyHeader(
  raw: string | undefined = process.env.TRUSTED_PROXY_HEADER,
): TrustedProxyHeader {
  return raw?.trim().toLowerCase() === 'x-real-ip' ? 'x-real-ip' : 'x-forwarded-for';
}

/**
 * Pick the client address out of `X-Forwarded-For` and `X-Real-IP`.
 *
 * By default (`TRUSTED_PROXY_HEADER=x-forwarded-for`), `X-Forwarded-For` is
 * walked from the right and the first address that is not a trusted proxy
 * wins. A proxy that appends to the header (nginx with
 * `$proxy_add_x_forwarded_for`, for example) keeps whatever the client sent
 * on the left, so only the right-hand entries were written by trusted hops.
 * When every entry is a trusted proxy, or the header is absent, `X-Real-IP`
 * is used, then the left-most `X-Forwarded-For` entry.
 *
 * When `TRUSTED_PROXY_HEADER=x-real-ip` is configured for a reverse proxy
 * that sets only `X-Real-IP` and passes a client-supplied `X-Forwarded-For`
 * through unchanged, only `X-Real-IP` is read and `X-Forwarded-For` is
 * ignored.
 *
 * Returns undefined when the configured header(s) name no address.
 */
export function resolveForwardedClientIp(
  forwardedFor: HeaderValue,
  realIp: HeaderValue,
  isTrustedProxy: (ip: string) => boolean,
  header: TrustedProxyHeader = getTrustedProxyHeader(),
): string | undefined {
  const realIpText = headerText(realIp).trim();
  if (header === 'x-real-ip') {
    return realIpText || undefined;
  }

  const hops = headerText(forwardedFor)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (let i = hops.length - 1; i >= 0; i--) {
    if (!isTrustedProxy(hops[i])) return hops[i];
  }

  if (realIpText) return realIpText;

  return hops[0];
}
