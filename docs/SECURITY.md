# Security

Nerve is designed as a **local-first** web UI for an AI agent. Its security model assumes the server runs on a trusted machine and is accessed by its owner. It is **not** designed for multi-tenant or public-internet deployment without an additional reverse proxy and authentication layer.

---

## Table of Contents

- [Threat Model](#threat-model)
- [Authentication & Access Control](#authentication--access-control)
- [CORS Policy](#cors-policy)
- [Security Headers](#security-headers)
- [Rate Limiting](#rate-limiting)
- [Input Validation](#input-validation)
- [File Serving Security](#file-serving-security)
- [WebSocket Proxy Security](#websocket-proxy-security)
- [Body Size Limits](#body-size-limits)
- [Path Traversal Prevention](#path-traversal-prevention)
- [TLS / HTTPS](#tls--https)
- [Token & Secret Handling](#token--secret-handling)
- [Client-Side Security](#client-side-security)
- [Configuration File Security](#configuration-file-security)
- [Reporting Vulnerabilities](#reporting-vulnerabilities)

---

## Threat Model

### In Scope

| Threat | Mitigation |
|--------|------------|
| **Cross-site request forgery (CSRF)** | CORS allowlist restricts cross-origin requests. Only explicitly configured origins are allowed. |
| **Cross-site scripting (XSS)** | CSP `script-src 'self'` blocks inline/injected scripts (exception: `s3.tradingview.com` for chart widgets). HTML content is sanitised with DOMPurify on the client. |
| **Clickjacking** | `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'` prevent embedding in iframes. |
| **Network sniffing** | Optional HTTPS with HSTS (`max-age=31536000; includeSubDomains`). |
| **Abuse / resource exhaustion** | Per-IP rate limiting on all API endpoints. Global body size limits. Rate limit store capped at 10,000 entries. |
| **Directory traversal** | Resolved absolute paths checked against strict prefix allowlists. Symlinks resolved and re-checked. |
| **Symlink escape** | `/api/files` resolves symlinks via `fs.realpathSync()` and re-validates the real path against allowed prefixes. |
| **Gateway token exfiltration** | Token is never sent to the client; it is injected server-side specifically for trusted (local/authenticated) connections. |
| **Spoofed client IPs** | Rate limiter uses the real TCP socket address. `X-Forwarded-For` only trusted from configured `TRUSTED_PROXIES`. |
| **MIME sniffing** | `X-Content-Type-Options: nosniff` on all responses. |
| **CSP directive injection** | `CSP_CONNECT_EXTRA` is sanitised: semicolons and newlines stripped, only `http(s)://` and `ws(s)://` schemes accepted. |
| **Malformed CORS origins** | `ALLOWED_ORIGINS` entries are normalised via `new URL()`. Malformed entries and `"null"` origins are silently rejected. |

### Out of Scope

- **Multi-user authentication** — Nerve supports single-user password authentication. Multi-user accounts with roles are not yet implemented.
- **End-to-end encryption** — TLS covers transport; at-rest encryption of memory files or session data is not provided.
- **DDoS protection** — The in-memory rate limiter handles casual abuse but is not designed for sustained attacks. Use a reverse proxy (nginx, Cloudflare) for production exposure.

---

## Authentication & Access Control

Nerve includes a built-in session-cookie-based authentication layer that can be enabled via the `NERVE_AUTH` environment variable.

### When Auth is Disabled (default for localhost)

Security is enforced through network-level controls:

1. **Localhost binding** — The server binds to `127.0.0.1` by default. Only local processes can connect.
2. **CORS allowlist** — Browsers enforce the Origin check. Only configured origins receive CORS headers.
3. **Gateway token isolation** — The sensitive `GATEWAY_TOKEN` is never sent to the browser. Instead, Nerve injects it server-side into the WebSocket connection upgrade for trusted clients.
4. **Client config persistence** — The frontend stores the gateway URL and optional manual token in `localStorage` as `oc-config`. Trusted official-gateway flows usually keep the token empty because server-side injection handles auth.

### When Auth is Enabled

All API endpoints (except `/api/auth/*` and `/health`) require a valid session cookie. WebSocket upgrade requests are also checked.

**How it works:**

1. User submits a password via `POST /api/auth/login`
2. The server verifies the password against a stored scrypt hash (or accepts the gateway token as a fallback)
3. On success, a signed `HttpOnly` session cookie is set
4. All subsequent requests include the cookie automatically
5. The session token is a stateless HMAC-SHA256 signed payload containing only an expiry timestamp

**Session cookie security:**

| Property | Value | Purpose |
|----------|-------|---------|
| `HttpOnly` | `true` | Not accessible via JavaScript (XSS-proof) |
| `SameSite` | `Strict` | Not sent on cross-origin requests (CSRF-proof) |
| `Secure` | auto | Only sent over HTTPS when HTTPS is active |
| Signed | HMAC-SHA256 | Tamper-proof — requires `NERVE_SESSION_SECRET` |
| Cookie name | `nerve_session_{PORT}` | Port-suffixed to avoid collisions across instances |

**Password storage:**

- Passwords are hashed with scrypt (32-byte random salt, 64-byte derived key)
- Timing-safe comparison prevents timing attacks
- Passwords are never stored in plaintext or logged

**Gateway token fallback:**

Users who haven't set a dedicated password can authenticate using their existing `GATEWAY_TOKEN`. This provides zero-config authentication when upgrading to network access.

### Recommendations for Network Access

When exposing Nerve to a network (`HOST=0.0.0.0`):
- **Enable authentication** — the setup wizard prompts for this automatically
- Using a VPN (Tailscale, WireGuard) adds an additional layer of security
- Placing Nerve behind a reverse proxy with HTTPS is recommended for production
- The gateway token can serve as an immediate fallback password

---

## CORS Policy

CORS is enforced on all requests via Hono's CORS middleware.

**Default allowed origins** (auto-configured):
- `http://localhost:{PORT}`
- `https://localhost:{SSL_PORT}`
- `http://127.0.0.1:{PORT}`
- `https://127.0.0.1:{SSL_PORT}`

**Additional origins** via `ALLOWED_ORIGINS` env var (comma-separated). Each entry is normalised through the `URL` constructor:

```bash
ALLOWED_ORIGINS=http://100.64.0.5:3080,https://my-server.tailnet.ts.net:3443
```

**Allowed methods:** `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`  
**Allowed headers:** `Content-Type`, `Authorization`  
**Credentials:** Enabled (`credentials: true`)

Requests with no `Origin` header (same-origin, non-browser) are allowed through.

---

## Security Headers

Applied to **every response** via the `securityHeaders` middleware:

| Header | Value | Purpose |
|--------|-------|---------|
| `Content-Security-Policy` | See below | Defense-in-depth against XSS |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME type sniffing |
| `X-XSS-Protection` | `1; mode=block` | Legacy XSS filter for older browsers |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Enforce HTTPS for 1 year |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Control referrer leakage |
| `Cache-Control` | `no-store` | Default for all responses (overridden by cache middleware for assets) |

### Content Security Policy

> **Implementation note:** CSP directives are built lazily on first request (not at module import time) to avoid race conditions with `dotenv/config` load order. The computed directives are then cached for the lifetime of the process.

```
default-src 'self';
script-src 'self' https://s3.tradingview.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
connect-src 'self' ws://localhost:* wss://localhost:* http://localhost:* https://localhost:*
            ws://127.0.0.1:* wss://127.0.0.1:* http://127.0.0.1:* https://127.0.0.1:*
            [CSP_CONNECT_EXTRA];
img-src 'self' data: blob:;
media-src 'self' blob:;
frame-src https://s3.tradingview.com https://www.tradingview.com
          https://www.tradingview-widget.com https://s.tradingview.com;
frame-ancestors 'none';
base-uri 'self';
form-action 'self'
```

**TradingView domains:** The `script-src` and `frame-src` entries for TradingView are required for the inline `tv` chart type, which uses TradingView's official widget embed script. The script injects iframes from multiple TradingView subdomains.

The `connect-src` directive can be extended via `CSP_CONNECT_EXTRA` (space-separated). Input is sanitised:
- Semicolons (`;`) and newlines (`\r`, `\n`) are stripped to prevent directive injection
- Only entries matching `http://`, `https://`, `ws://`, or `wss://` schemes are accepted

---

## Rate Limiting

In-memory sliding window rate limiter applied to all `/api/*` routes.

### Presets

| Preset | Limit | Window | Applied To |
|--------|-------|--------|------------|
| TTS | 10 requests | 60 seconds | `POST /api/tts` |
| Transcribe | 30 requests | 60 seconds | `POST /api/transcribe` |
| General | 60 requests | 60 seconds | All other `/api/*` routes |

### Implementation Details

- **Per-client, per-path** — Each unique `clientIP:path` combination gets its own sliding window.
- **Client identification** — Uses the real TCP socket address from `getConnInfo()`. **Not** spoofable via request headers.
- **Trusted proxies** — `X-Forwarded-For` and `X-Real-IP` are only honoured when the direct connection comes from an IP in `TRUSTED_PROXIES` (default: loopback addresses only). Extend via `TRUSTED_PROXIES` env var.
- **Store cap** — The rate limit store is capped at **10,000 entries** to prevent memory amplification from spoofed IPs (when behind a trusted proxy). When full, the oldest entry is evicted.
- **Cleanup** — Expired timestamps are purged every 5 minutes.

### Response Headers

Every response includes:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 57
```

When rate-limited (HTTP 429):

```
Retry-After: 42
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1708100060
```

---

## Input Validation

All POST/PUT endpoints validate request bodies with [Zod](https://zod.dev/) schemas:

| Endpoint | Validated Fields |
|----------|-----------------|
| `POST /api/tts` | `text` (1–5000 chars, non-empty), `provider` (enum), `voice`, `model` |
| `PUT /api/tts/config` | Strict key allowlist per section, string values only, max 2000 chars |
| `POST /api/transcribe` | File presence, size (≤12 MB), MIME type allowlist |
| `POST /api/agentlog` | Optional typed fields (`ts`, `type`, `message`, `level`, `data`) |
| `POST /api/memories` | `text` (1–10000 chars), `section` (≤200), `category` (enum), `importance` (0–1) |
| `PUT /api/memories/section` | `title` (1–200), `content` (≤50000), `date` (YYYY-MM-DD regex) |
| `DELETE /api/memories` | `query` (1–1000), `type` (enum), `date` (YYYY-MM-DD regex) |
| `PUT /api/workspace/:key` | `content` (string, ≤100 KB), `key` checked against strict allowlist |
| `POST /api/git-info/workdir` | `sessionKey` (non-empty), `workdir` (non-empty, validated against allowed base) |

Validation errors return **HTTP 400** with the first Zod issue message as plain text or JSON.

---

## File Serving Security

The `GET /api/files` endpoint serves local image files with multiple layers of protection:

### 1. MIME Type Allowlist

Only image files are served:

| Extension | MIME Type |
|-----------|-----------|
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.webp` | `image/webp` |
| `.svg` | `image/svg+xml` |
| `.avif` | `image/avif` |

Non-image file types return **403 Not an allowed file type**.

### 2. Directory Prefix Allowlist

Files are only served from these directories:

| Prefix | Source |
|--------|--------|
| `/tmp` | Hardcoded |
| `~/.openclaw` | Derived from `os.homedir()` |
| `MEMORY_DIR` | From configuration |

The request path is resolved to an absolute path via `path.resolve()`, blocking `..` traversal. The resolved path must start with one of the allowed prefixes (with a path separator check to prevent `/tmp-evil` matching `/tmp`).

### 3. Symlink Traversal Protection

After the prefix check passes, the file's **real path** is resolved via `fs.realpathSync()`. The real path is then re-checked against the same prefix allowlist. This prevents:

- Symlinks inside `/tmp` pointing to `/etc/passwd`
- Symlinks inside `~/.openclaw` pointing outside the allowed tree

If the real path falls outside allowed prefixes → **403 Access denied**.

### 4. Path Canonicalisation

The `~` prefix in input paths is expanded to `os.homedir()` before resolution, preventing home directory confusion.

---

## WebSocket Proxy Security

The WebSocket proxy (connecting the frontend to the OpenClaw gateway) restricts target hostnames:

**Default allowed hosts:** `localhost`, `127.0.0.1`, `::1`

**Extend via** `WS_ALLOWED_HOSTS` env var (comma-separated):

```bash
WS_ALLOWED_HOSTS=my-server.tailnet.ts.net,100.64.0.5
```

This prevents the proxy from being used to connect to arbitrary external hosts.

### Token Injection

Nerve performs **server-side token injection** to provide a zero-config connection experience for local and authenticated users without exposing the `GATEWAY_TOKEN` to the browser storage.

**Injection Logic:**
1. `GET /api/connect-defaults` returns the official gateway WebSocket URL, `token: null`, and a `serverSideAuth` flag.
2. The WebSocket proxy only injects `GATEWAY_TOKEN` when all of these are true:
   - a gateway token is configured on the server
   - the request is trusted (`loopback` access or an authenticated session)
   - the WebSocket upgrade `Origin` is allowed
3. For the official gateway URL, the browser connects with an empty token when `serverSideAuth=true`.
4. Custom gateway URLs or untrusted contexts still require manual token entry in the connect dialog.

This keeps the managed gateway token on the server while still allowing explicit manual credentials for unsupported or custom connection paths.

### Device Identity & Gateway Scopes

OpenClaw 2026.2.19+ requires a signed device identity (Ed25519 keypair) for WebSocket connections to receive `operator.read` / `operator.write` scopes. Plain token authentication alone grants zero scopes.

Nerve generates a persistent device identity on first start (stored at `~/.nerve/device-identity.json`) and injects it into the connect handshake. The gateway always stays on loopback (`127.0.0.1`) — Nerve proxies all external connections through its WS proxy.

**First-time pairing (required once):**

1. Start Nerve and open the UI in a browser
2. The first connection creates a pending pairing request on the gateway
3. Approve it: `openclaw devices list` → `openclaw devices approve <requestId>`
4. All subsequent connections are automatically authenticated

If the device is rejected (e.g. after a gateway reset), the proxy falls back to token-only auth. The connection succeeds but with reduced scopes — chat and tool calls may fail with "missing scope" errors. Re-approve the device to restore full functionality.

**Architecture:** `Browser (remote) → Nerve (0.0.0.0:3080) → WS proxy → Gateway (127.0.0.1:18789)`. The gateway never needs to bind to LAN or be directly network-accessible.

---

## Body Size Limits

| Scope | Limit | Enforced By |
|-------|-------|-------------|
| Global (`/api/*`) | ~13 MB (12 MB + 1 MB overhead) | Hono `bodyLimit` middleware |
| TTS text | 5,000 characters | Zod schema |
| Transcription file | 12 MB | Application check |
| Agent log entry | 64 KB | Config constant |
| Workspace file write | 100 KB | Application check |
| Memory text | 10,000 characters | Zod schema |
| Memory section content | 50,000 characters | Zod schema |
| TTS config field | 2,000 characters | Application check |

Exceeding the global body limit returns **413 Request body too large**.

---

## Path Traversal Prevention

Multiple layers prevent directory traversal attacks:

| Route | Mechanism |
|-------|-----------|
| `/api/files` | `path.resolve()` + prefix allowlist + symlink resolution + re-check |
| `/api/memories` (date params) | Regex validation: `/^\d{4}-\d{2}-\d{2}$/` — prevents injection in file paths |
| `/api/workspace/:key` | Strict key→filename allowlist (`soul`→`SOUL.md`, etc.) — no user-controlled paths |
| `/api/git-info/workdir` | Resolved path checked against allowed base directory (derived from git worktrees or `WORKSPACE_ROOT`). Exact match or child-path check with separator guard |

---

## TLS / HTTPS

Nerve automatically starts an HTTPS server alongside HTTP when certificates are present:

```
certs/cert.pem    # X.509 certificate
certs/key.pem     # RSA/EC private key
```

HSTS is always sent (`max-age=31536000; includeSubDomains`), even over HTTP. Browsers that have previously visited over HTTPS will refuse HTTP connections for 1 year.

> **Microphone access** requires a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts). On `localhost` HTTP works, but network access requires HTTPS.

---

## Token & Secret Handling

| Secret | Storage | Exposure |
|--------|---------|----------|
| `GATEWAY_TOKEN` | `.env` file (chmod 600) | Used server-side for trusted official-gateway connections. `/api/connect-defaults` returns `token: null`. Never logged. |
| `OPENAI_API_KEY` | `.env` file | Used server-side only. Never sent to clients. |
| `REPLICATE_API_TOKEN` | `.env` file | Used server-side only. Never sent to clients. |
| Gateway URL + optional manual token | `localStorage` (`oc-config`) | Used for reconnects. Trusted official-gateway flows usually keep the token empty; manually entered custom-gateway tokens persist until cleared. |

The setup wizard applies `chmod 600` to `.env` and backup files, restricting read access to the file owner.

---

## Client-Side Security

| Measure | Details |
|---------|---------|
| **DOMPurify** | All rendered HTML (agent messages, markdown) passes through DOMPurify with a strict tag/attribute allowlist |
| **Local storage** | Connection preferences are stored in `localStorage` as `oc-config`. The official managed gateway path can keep the token empty; manually entered custom tokens may persist until cleared |
| **CSP enforcement** | `script-src 'self' https://s3.tradingview.com` blocks inline scripts and limits external scripts to TradingView chart widgets only |
| **No eval** | No use of `eval()`, `Function()`, or `innerHTML` with unsanitised content |

---

## Configuration File Security

The setup wizard:

1. Writes `.env` atomically (via temp file + rename)
2. Applies `chmod 600` to `.env` and backup files
3. Cleans up `.env.tmp` on interruption (Ctrl+C handler)
4. Backs up existing `.env` before overwriting (timestamped `.env.bak.*`)

---

## Reporting Vulnerabilities

If you find a security issue, please open a GitHub issue or contact the maintainers directly. Do not disclose vulnerabilities publicly before they are addressed.
