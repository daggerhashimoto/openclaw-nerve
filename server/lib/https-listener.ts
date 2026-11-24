/**
 * Whether Nerve starts its own HTTPS listener.
 *
 * HTTPS starts whenever the certificate pair exists, unless SSL_PORT is set to
 * an empty value. A missing SSL_PORT keeps the certificate-only behavior on any
 * bind address: older .env files have no SSL_PORT line because setup used to
 * omit the default 3443, and a Tailscale Serve endpoint may proxy to
 * https+insecure://localhost:3443. Setup writes `SSL_PORT=` to turn the
 * listener off while leaving certs/ in place.
 *
 * `scripts/setup.ts` applies the same rule in `--check` and `--defaults`.
 * @module
 */

export function httpsListenerEnabled(sslPortEnv: string | undefined, certsPresent: boolean): boolean {
  return certsPresent && sslPortEnv !== '';
}
