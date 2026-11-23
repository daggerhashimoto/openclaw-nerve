# Security

Nerve is a **local-first** web cockpit for an AI agent. Its security model assumes the server runs on a trusted machine and is used by its owner. It is **not** built for multi-tenant use or for direct exposure to the public internet. Anyone who can use Nerve acts as the operator: they can read and write workspace files and memory, change agent config, save API keys, and run agents.

---

## Contents

- [Threat model](#threat-model)
- [Authentication and access control](#authentication-and-access-control)
- [CORS policy](#cors-policy)
- [Security headers](#security-headers)
- [Rate limiting](#rate-limiting)
- [Input validation](#input-validation)
- [File serving](#file-serving)
- [Gateway media](#gateway-media)
- [Embedded content](#embedded-content)
- [WebSocket proxy security](#websocket-proxy-security)
- [Body size limits](#body-size-limits)
- [Path traversal prevention](#path-traversal-prevention)
- [TLS and HTTPS](#tls-and-https)
- [Token and secret handling](#token-and-secret-handling)
- [Client-side security](#client-side-security)
- [Configuration file security](#configuration-file-security)
- [Reporting vulnerabilities](#reporting-vulnerabilities)

---

## Threat model

### In scope

| Threat | Mitigation |
|--------|------------|
| **Cross-site requests (CSRF)** | Cross-origin requests that need a CORS preflight (JSON bodies, `PUT`, `PATCH`, `DELETE`) are allowed only from listed origins. With auth on, the session cookie is `SameSite=Strict`, so browsers do not send it on cross-site requests. |
| **Cross-site scripting (XSS)** | CSP `script-src 'self' https://s3.tradingview.com` with no inline scripts. Markdown renders without raw HTML, and every place that injects HTML runs it through DOMPurify. KaTeX runs with `trust: false`. |
| **Clickjacking** | `X-Frame-Options: SAMEORIGIN` and CSP `frame-ancestors 'self'`: only Nerve itself can frame its pages (the PDF viewer does). |
| **Network sniffing** | Optional HTTPS. `Strict-Transport-Security` when `NODE_ENV=production`. |
| **Abuse and resource exhaustion** | Per-client rate limits on most API routes, a global request body limit, and a 10,000-entry cap on the rate limit store. |
| **Directory traversal** | Paths are resolved and checked against a prefix allowlist or the workspace root. |
| **Symlink escape** | `/api/files`, the file browser and upload references resolve the real path and check it again. |
| **Gateway token exfiltration** | Server-side injection never sends the token to the browser (a user can still type it in as the login password or in the connect dialog). The server injects it only for trusted clients and only toward the gateway named in `GATEWAY_URL`, and fetches gateway media for trusted clients only. |
| **Spoofed client IPs** | The rate limiter uses the TCP socket address and honours `X-Forwarded-For` only from `TRUSTED_PROXIES`. |
| **MIME sniffing** | `X-Content-Type-Options: nosniff` on every response. |
| **Active content in served files** | `/api/files` forces SVG downloads; `/api/files/raw` sends SVG under a sandboxing Content-Security-Policy; `/api/chat-media` and `/api/sessions/media` pass only raster images. |
| **CSP directive injection** | `CSP_CONNECT_EXTRA` is sanitised: semicolons and newlines are stripped, and only `http(s)://` and `ws(s)://` sources are kept. |
| **Malformed CORS origins** | `ALLOWED_ORIGINS` entries are normalised with `new URL()`. Malformed entries and `null` are ignored. |

### Out of scope

- **Multiple users.** Auth is one shared password (or the gateway token). There are no accounts or roles.
- **Encryption at rest.** TLS covers transport only. Memory files, transcripts and `.env` are stored as plain files.
- **DDoS protection.** The in-memory rate limiter handles casual abuse, not sustained attacks. Put a reverse proxy in front for anything exposed.

---

## Authentication and access control

Nerve has an optional session-cookie login, enabled with `NERVE_AUTH=true`.

### When auth is disabled (default)

Every endpoint is open to anyone who can reach the port. Protection comes from the network:

1. **Loopback binding.** The server binds to `127.0.0.1` by default, so only local processes can connect. On a shared machine, other local users count as local too.
2. **Refusal to start.** With `HOST=0.0.0.0` and auth off, the server exits unless `NERVE_ALLOW_INSECURE=true`. Other non-loopback bind addresses only log a warning.
3. **CORS and Origin checks.** Browsers enforce CORS, and WebSocket upgrades from unlisted origins are refused.
4. **Gateway token isolation.** `GATEWAY_TOKEN` is never sent to the browser. The WebSocket proxy injects it for trusted clients (see [Token injection](#token-injection)).
5. **Client config.** The browser keeps the gateway URL and any manually entered token in `localStorage` as `oc-config`. With server-side injection the token stays empty.

### When auth is enabled

Every `/api/*` route needs a valid session cookie except `/api/auth/login`, `/api/auth/logout`, `/api/auth/status` and `/api/version`. `/health`, static files and the login page load without one. WebSocket upgrades to `/ws` need the cookie too and are refused with `401` without it.

**How it works:**

1. The user submits a password to `POST /api/auth/login` (5 requests per minute per client).
2. The server checks it against the scrypt hash in `NERVE_PASSWORD_HASH`. Only when no hash is set does it accept `GATEWAY_TOKEN` instead, compared in constant time.
3. On success it sets a signed session cookie.
4. The session token is a stateless payload holding the issue and expiry times, signed with HMAC-SHA256.

**Session cookie:**

| Property | Value | Purpose |
|----------|-------|---------|
| `HttpOnly` | `true` | Not readable from JavaScript |
| `SameSite` | `Strict` | Not sent on cross-site requests |
| `Secure` | when the request arrived over HTTPS | Not sent over plain HTTP once set over HTTPS. Behind a TLS-terminating proxy that talks HTTP to Nerve, the flag is not set. |
| Signature | HMAC-SHA256 with `NERVE_SESSION_SECRET` | Tamper-proof. Without a configured secret, a random one is generated at each start and old cookies stop working. |
| Name | `nerve_session_<PORT>` | Port suffix avoids collisions between instances |
| Lifetime | `NERVE_SESSION_TTL` (30 days) | Expired tokens are rejected |

**Password storage:** scrypt with a 32-byte random salt and a 64-byte derived key, stored as `salt:key` in hex. Verification uses a constant-time comparison. Passwords are not stored in plain text or logged.

### Recommendations for network access

When Nerve is reachable from other machines:

- **Enable authentication.** The setup wizard prompts for it when the access mode binds `0.0.0.0`. Tailscale Serve and Custom binds to a specific address skip that prompt, so set it up yourself if other people can reach the tailnet or network.
- A VPN (Tailscale, WireGuard) adds a layer in front of the password.
- Put a reverse proxy with HTTPS in front for anything wider.
- A reverse proxy on the same host must pass the real client address in `X-Forwarded-For`, either by setting it or by appending to the client's value (nginx `$proxy_add_x_forwarded_for`). Nerve reads the header from the right and takes the first address that is not loopback, so entries a client writes on the left do not count. For a proxy that sets only `X-Real-IP` and passes a client-sent `X-Forwarded-For` through unchanged, set `TRUSTED_PROXY_HEADER=x-real-ip` so Nerve reads only `X-Real-IP` and ignores `X-Forwarded-For` (otherwise a client could pick its own rate-limit bucket with a non-loopback `X-Forwarded-For` entry). With neither header, every proxied client looks local and, with auth off, gets the gateway token injected.

---

## CORS policy

CORS applies to every request through Hono's CORS middleware.

**Allowed origins:**

- Any origin whose host is `localhost`, `127.0.0.1` or `::1`, on any port and scheme
- Each origin in `ALLOWED_ORIGINS` (comma-separated, normalised with `new URL()`):

```bash
ALLOWED_ORIGINS=http://100.64.0.5:3080,https://your-host.tailnet-name.ts.net
```

**Allowed methods:** `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`
**Allowed headers:** `Content-Type`, `Authorization`
**Credentials:** allowed

Requests without an `Origin` header (same-origin navigations and non-browser clients) get no CORS headers and are processed normally. The same origin list guards WebSocket upgrades, where a missing `Origin` is accepted only when `HOST` is a loopback address.

---

## Security headers

The `securityHeaders` middleware sets these on every response, except that a route that sets its own `Content-Security-Policy` keeps it (`GET /api/files/raw` does this for SVG files):

| Header | Value | Purpose |
|--------|-------|---------|
| `Content-Security-Policy` | See below | Defence in depth against XSS |
| `X-Frame-Options` | `SAMEORIGIN` | Only Nerve can frame its pages |
| `X-Content-Type-Options` | `nosniff` | No MIME sniffing |
| `X-XSS-Protection` | `1; mode=block` | Legacy XSS filter for old browsers |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Only when `NODE_ENV=production` (the installer's services set it) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer leakage |
| `Cache-Control` | varies | `no-cache` for `/api/*` and `/health`; `public, max-age=31536000, immutable` for hashed build assets; `public, max-age=0, must-revalidate` for other static files; `no-store` for static error responses and anything else without a value |

### Content Security Policy

The directives are built on the first request, after `.env` has loaded, and cached for the life of the process.

```
default-src 'self';
script-src 'self' https://s3.tradingview.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com data:;
connect-src 'self' ws://localhost:* wss://localhost:* http://localhost:* https://localhost:*
            ws://127.0.0.1:* wss://127.0.0.1:* http://127.0.0.1:* https://127.0.0.1:*
            [CSP_CONNECT_EXTRA];
img-src 'self' data: blob:;
media-src 'self' blob:;
frame-src 'self' https://s3.tradingview.com https://www.tradingview.com
          https://www.tradingview-widget.com https://s.tradingview.com https://www.google.com;
frame-ancestors 'self';
base-uri 'self';
form-action 'self'
```

What the external sources are for:

- **TradingView** (`script-src`, `frame-src`): the inline `tv` chart type loads TradingView's widget script, which injects frames from several TradingView hosts.
- **Google Fonts** (`style-src`, `font-src`): the UI fonts load from Google Fonts.
- **`https://www.google.com`** (`frame-src`): inline Google Maps embeds (see [Embedded content](#embedded-content)).
- **`'self'` in `frame-src`**: the file browser's PDF viewer frames `/api/files/raw`.

`img-src` allows no remote hosts, so remote images do not load directly; gateway-hosted chat images go through `/api/chat-media`.

`connect-src` can be extended with `CSP_CONNECT_EXTRA` (space-separated). Semicolons, `\r` and `\n` are stripped, and only entries starting with `http://`, `https://`, `ws://` or `wss://` are kept.

---

## Rate limiting

An in-memory sliding-window limiter, attached per route.

### Presets

| Preset | Limit | Window | Applied to |
|--------|-------|--------|------------|
| Auth | 5 requests | 60 seconds | `POST /api/auth/login` |
| Restart | 3 requests | 60 seconds | `POST /api/gateway/restart` |
| TTS | 10 requests | 60 seconds | `POST /api/tts` |
| Transcribe | 30 requests | 60 seconds | `POST /api/transcribe` |
| General | 60 requests | 60 seconds | Most other API routes |

Routes without a limiter: `/health`, `GET /api/files`, the file browser routes (`/api/files/tree`, `read`, `write`, `rename`, `move`, `trash`, `restore`, `raw`, `resolve`), the `/api/events` stream, `GET /api/agentlog`, `/api/auth/logout`, `/api/auth/status`, `/api/transcribe/config`, `/api/voice-phrases/*`, `/api/codex-limits` and `/api/claude-code-limits`.

### Implementation details

- **Per client and path.** Each `clientIP:path` pair has its own window.
- **Client identification.** The TCP socket address from `getConnInfo()`, not request headers.
- **Trusted proxies.** `X-Forwarded-For` and `X-Real-IP` are used only when the socket address is in `TRUSTED_PROXIES` (default: loopback addresses). By default (`TRUSTED_PROXY_HEADER=x-forwarded-for`), `X-Forwarded-For` is read from the right, the first address not in `TRUSTED_PROXIES` is the client, and `X-Real-IP` is used when the header is missing or lists only trusted proxies. With `TRUSTED_PROXY_HEADER=x-real-ip`, only `X-Real-IP` is read and `X-Forwarded-For` is ignored.
- **Store cap.** At most 10,000 entries; when full, the oldest is evicted. This bounds memory when a trusted proxy forwards many distinct addresses.
- **Cleanup.** Expired timestamps are purged every 5 minutes.

### Response headers

Rate-limited routes return:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 57
```

When the limit is hit (HTTP 429, body `Too many requests. Please try again later.`):

```
Retry-After: 42
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1708100060
```

---

## Input validation

Most mutating endpoints validate bodies with [Zod](https://zod.dev/) schemas; a few use hand-written checks.

| Endpoint | Checks |
|----------|--------|
| `POST /api/tts` | `text` 1 to 5000 chars and not blank, `provider` one of `openai`, `replicate`, `qwen`, `edge`, `xiaomi`, optional `voice` and `model` (Zod) |
| `PUT /api/tts/config` | Known sections and keys only, string values, each at most 2000 chars (hand-written) |
| `POST /api/transcribe` | File present, at most 12 MB, MIME type on the audio allowlist when the browser sends one |
| `POST /api/agentlog` | Optional typed fields `ts`, `type`, `message`, `level`, `icon`, `text`, `data` (Zod) |
| `POST /api/memories` | `text` 1 to 10000 chars, `section` at most 200, `category` enum, `importance` 0 to 1 (Zod) |
| `PUT /api/memories/section` | `title` 1 to 200, `content` at most 50000, `date` at most 100 (Zod) |
| `DELETE /api/memories` | `query` 1 to 1000, `type` one of `section`, `item`, `daily`, `date` at most 100 (Zod) |
| Memory `date` values | Must match `^[a-zA-Z0-9._-]+$` and contain no `..`, since they become file names |
| `PUT /api/workspace/:key` | `key` on a fixed allowlist, `content` a string of at most 100,000 chars (hand-written) |
| `POST /api/crons`, `PATCH /api/crons/:id` | Zod schemas; the old flat fields (`prompt`, `model`, `thinkingLevel`, `channel`, `notify`) are rejected |
| `/api/kanban/*` | Zod schemas; status keys must be lowercase kebab case |

Validation errors return **HTTP 400**, as plain text or JSON depending on the route.

---

## File serving

### `GET /api/files` (local images)

Serves local image files referenced in chat, with several checks.

**1. MIME type allowlist.** Only images:

| Extension | MIME type |
|-----------|-----------|
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.webp` | `image/webp` |
| `.svg` | `image/svg+xml` (sent with `Content-Disposition: attachment`, so it downloads instead of rendering) |
| `.avif` | `image/avif` |

Other types return **403 Not an allowed file type**.

**2. Directory prefix allowlist.** Files are served only from:

| Prefix | Source |
|--------|--------|
| `/tmp` | Hardcoded |
| `~/.openclaw` | From `os.homedir()` |
| `MEMORY_DIR` | From configuration |

The real paths of these prefixes are allowed too (for example `/private/tmp` on macOS). A leading `~` in the request is expanded to the home directory, then the path is resolved with `path.resolve()`, which removes `..`. The result must lie inside a prefix, checked with `path.relative()` so `/tmp-evil` does not match `/tmp`. Otherwise: **403 Access denied**.

**3. Symlink check.** The file's real path (`fs.promises.realpath()`) is checked against the same prefixes, so a symlink inside `/tmp` or `~/.openclaw` cannot point elsewhere. A failure returns **403 Access denied**.

### File browser (`/api/files/tree`, `read`, `write`, `rename`, `move`, `trash`, `restore`, `raw`, `resolve`)

- Paths are relative to the agent's workspace root, or to `FILE_BROWSER_ROOT` for every agent when that is set.
- Paths that start with `..` or are absolute are rejected. `/api/files/resolve` also accepts `/workspace/...` and absolute paths under the workspace root, and converts them to relative paths first.
- Every path segment is checked against the exclusions: `node_modules`, `.git`, `dist`, `build`, `server-dist`, `certs`, `.env` and `.env.*`, `agent-log.json`, and `*.log`. **With `FILE_BROWSER_ROOT` set, there are no exclusions**, so `.env` files and other secrets under that root can be read and edited.
- The resolved path must stay inside the root, and its real path must stay inside the root's real path. For new files, the nearest existing parent is checked.
- Text reads and writes are capped at 1 MB. `raw` serves images up to 10 MB and PDFs up to 50 MB. SVG responses carry a sandboxing `Content-Security-Policy` (`sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:`).
- When the workspace is remote, `resolve` returns 501, `raw` returns 404, and the mutation routes return 501.

### Upload references (`POST /api/upload-reference/resolve`)

- **Workspace paths (JSON body):** each path goes through the same workspace checks as the file browser. The real path must be a file inside the workspace root.
- **Browser uploads (multipart):** each file is written to the staging directory (`<workspace>/.temp/nerve-uploads/YYYY/MM/DD/`, or `NERVE_UPLOAD_STAGING_TEMP_DIR`) under a sanitised name with a random suffix. The staging path must be inside the main workspace root. The request is bound by the global body limit.

The response includes absolute server paths, which the client sends to the agent as file references.

---

## Gateway media

### `GET /api/chat-media`

Proxies images the gateway hosts for chat replies. Those URLs need the gateway token, which the browser never holds.

- Only paths of the form `/api/chat/media/outgoing/<session>/<id>/<variant>` are accepted, and the path is rejected if URL parsing changes it (encoded dot segments, query, fragment).
- The server needs `GATEWAY_TOKEN` (otherwise 503) and uses it only for trusted clients, by the same rule as [token injection](#token-injection). Other clients get 403.
- Redirects are not followed, and the fetch times out after 30 seconds.
- Only `image/png`, `image/jpeg`, `image/gif`, `image/webp` and `image/avif` pass through, with `nosniff`. Anything else returns 502.

### `GET /api/sessions/media`

Serves an image that `chat.history` left out of a message. The client sends a session key, a message timestamp and an image index, plus the `artifactId` when current OpenClaw supplied one. With an `artifactId` (form `artifact_transcript_image_<base64url>`, at most 8192 characters), the server downloads the image from the gateway with `artifacts.download`, so no file is read. Without it (older OpenClaw), the server maps the key to a transcript through `SESSIONS_DIR/sessions.json`, so no client path reaches the file system, and a missing `sessions.json` gives 404. Only `image/png`, `image/jpeg`, `image/gif`, `image/webp` and `image/avif` are served, inline and with `nosniff`. Any other recorded type returns 415, and an unreachable gateway returns 502.

---

## Embedded content

- **Google Maps.** A chat message paragraph that consists only of a link to `https://www.google.com/maps/embed?pb=...` renders as a lazy-loaded iframe with `referrerpolicy="strict-origin-when-cross-origin"`. No other URL shape is framed. Rendering such a message contacts Google.
- **TradingView.** The `tv` chart type loads TradingView's widget script and frames.
- **KaTeX.** Math renders in the browser with `trust: false` (no `\href` or other commands that create links or HTML), `maxSize: 100` and `maxExpand: 1000` to bound output and macro expansion. It loads nothing remote.
- **Fonts.** UI fonts load from Google Fonts.

---

## WebSocket proxy security

The browser reaches the gateway through Nerve's WebSocket proxy at `/ws?target=<gateway URL>`.

**On upgrade:**

- The `Origin` must be allowed (see [CORS policy](#cors-policy)); otherwise **403 Origin not allowed**.
- With auth on, the session cookie must be valid; otherwise **401 Authentication required**.

**Target check.** The target must use `ws:` or `wss:` and its hostname must be in the allowlist; otherwise the socket closes with code `1008` and reason `Target not allowed`.

**Default allowed hosts:** `localhost`, `127.0.0.1`, `::1`. Extend with `WS_ALLOWED_HOSTS` (comma-separated):

```bash
WS_ALLOWED_HOSTS=your-host.tailnet-name.ts.net,100.64.0.5
```

This stops the proxy from being used to reach arbitrary hosts.

**Buffering.** Until the gateway connection is open, the proxy buffers at most 100 messages or 1 MB; beyond that it closes with `1008 Too many pending messages`. Backlogs on an open connection close it with `1013`.

### Token injection

Nerve injects `GATEWAY_TOKEN` on the server so the browser never stores it.

1. `GET /api/connect-defaults` returns the gateway WebSocket URL derived from `GATEWAY_URL`, `token: null`, and `serverSideAuth`, which says whether this client is trusted.
2. The proxy adds `GATEWAY_TOKEN` to the connect request when all of these hold:
   - a gateway token is configured
   - the browser's connect request carries no token of its own
   - the client is trusted: auth is on (so the upgrade carried a valid cookie), or the client address is loopback
   - the target is the gateway in `GATEWAY_URL`: same host, port and TLS, with `localhost`, `127.0.0.1` and `::1` counting as one host
   - the upgrade passed the Origin and target checks
3. For the official gateway URL with `serverSideAuth=true`, the browser connects with an empty token.
4. Custom gateway URLs and untrusted clients need the token entered in the connect dialog.

**Client address.** When the socket is loopback, the proxy takes the client address from `X-Forwarded-For`, read from the right past loopback hops, or from `X-Real-IP` when that header is missing or lists only loopback addresses. Your reverse proxy must set one of them. `TRUSTED_PROXIES` does not apply here. See the reverse proxy note under [Recommendations for network access](#recommendations-for-network-access).

**Allowed hosts.** List only gateways you trust in `WS_ALLOWED_HOSTS`. The server's gateway token goes only to the host in `GATEWAY_URL`. Other listed hosts receive only the token the browser supplies.

### Device identity and gateway scopes

OpenClaw grants `operator.read` and `operator.write` scopes only to connections that present a signed device identity (Ed25519). Token authentication alone gets no scopes.

Nerve creates a persistent identity on first start in `${NERVE_DATA_DIR:-~/.nerve}/device-identity.json` (file mode `600`, directory `700`) and signs each connect handshake with it, both for proxied browser connections and for the server's own gateway RPC connection.

**Normal setup:** for a gateway on the same machine, the setup wizard pre-pairs this identity, so a fresh install needs no manual approval. For a remote gateway, setup prints the approval steps instead.

**Manual approval (fallback and recovery):**

1. Start Nerve and open it in a browser.
2. On the gateway host, list requests: `openclaw devices list`
3. Approve Nerve's request: `openclaw devices approve <requestId>`

If the gateway rejects the device (`device token mismatch`, `device signature invalid`, `unknown device` or `pairing required`), the proxy retries once without the device identity. That connection succeeds with reduced scopes, and chat or tool calls can fail with missing-scope errors until the device is approved again.

**Layout:** `Browser -> Nerve (WS proxy) -> Gateway`. When the gateway runs on the same machine, it can stay bound to loopback; browsers never connect to it directly.

---

## Body size limits

| Scope | Limit | Enforced by |
|-------|-------|-------------|
| Every `/api/*` request | About 13 MB (12 MB + 1 MB) | Hono `bodyLimit`; the HTTPS server applies the same cap to every request |
| Transcription upload | 12 MB | Route check (413) |
| TTS text | 5,000 characters | Zod |
| TTS config value | 2,000 characters | Route check |
| Memory text | 10,000 characters | Zod |
| Memory section content | 50,000 characters | Zod |
| Workspace file (`PUT /api/workspace/:key`) | 100,000 characters | Route check |
| File browser read and write | 1 MB | Route check |
| File browser `raw` | 10 MB (images), 50 MB (PDF) | Route check |

Exceeding the global limit returns **413 Request body too large**.

---

## Path traversal prevention

| Route | Mechanism |
|-------|-----------|
| `/api/files` | `path.resolve()`, prefix allowlist, real path re-check |
| `/api/files/*` (file browser), `/api/upload-reference/resolve` | Relative paths only, exclusion check per segment, must stay inside the workspace root, real path re-check |
| `/api/memories` (`date`) | `^[a-zA-Z0-9._-]+$` and no `..` |
| `/api/workspace/:key` | Fixed key to file map (`soul` to `SOUL.md`, `tools`, `identity`, `user`, `agents`, `heartbeat`, `chatPathLinks` to `CHAT_PATH_LINKS.json`); no user-supplied paths |
| `/api/chat-media` | One accepted gateway path shape, re-checked after URL parsing |
| `/api/sessions/media` | No client path; artifact id checked against the gateway's id shape, or session key to transcript through `sessions.json` |

---

## TLS and HTTPS

Nerve starts an HTTPS server on `SSL_PORT` next to HTTP when both files exist:

```
certs/cert.pem    # X.509 certificate
certs/key.pem     # Private key
```

`Strict-Transport-Security` (`max-age=31536000; includeSubDomains`) is sent only when `NODE_ENV=production`, which the installer's systemd unit and launchd wrapper set. It is then sent on HTTP responses too, but browsers act on it only when it arrives over HTTPS. After that, a browser upgrades every request to that hostname, on any port, to HTTPS for a year.

> **Microphone access** needs a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts). `localhost` works over HTTP; other addresses need HTTPS.

---

## Token and secret handling

| Secret | Storage | Exposure |
|--------|---------|----------|
| `GATEWAY_TOKEN` | `.env` | Server side only: proxy injection for trusted clients, the server's own gateway RPC and HTTP tool calls, and `/api/chat-media` fetches. `/api/connect-defaults` returns `token: null`. The setup wizard shows it in its prompts so you can check it. |
| `OPENAI_API_KEY`, `REPLICATE_API_TOKEN`, `MIMO_API_KEY` | `.env` | Server side only. `GET /api/keys` reports only whether each is set. `PUT /api/keys` (Settings, Audio) writes them to `.env`. |
| `NERVE_PASSWORD_HASH`, `NERVE_SESSION_SECRET` | `.env` | Server side only |
| Device identity private key | `${NERVE_DATA_DIR:-~/.nerve}/device-identity.json` (mode `600`) | Server side only |
| Gateway URL and optional manual token | Browser `localStorage` (`oc-config`) | Used for reconnects. With server-side injection the token is empty; a manually entered token stays until cleared. |

The setup wizard sets `.env` and its backups to mode `600`. Keys saved from Settings update `.env` in place without changing its mode.

---

## Client-side security

| Measure | Details |
|---------|---------|
| **Markdown** | Rendered with `react-markdown` without raw HTML |
| **DOMPurify** | Every HTML injection (code highlighting, diffs, file previews, tool call output, streaming text) goes through `sanitizeHtml()`: a tag and attribute allowlist, with `script`, `style`, `iframe`, `object`, `embed`, `form`, `input`, `svg` and `math` forbidden |
| **CSP** | `script-src 'self' https://s3.tradingview.com` blocks inline scripts and limits external scripts to the TradingView widget |
| **No eval** | No `eval()`, `new Function()` or direct `innerHTML` assignment |
| **Local storage** | Connection preferences in `oc-config`; with server-side injection the token stays empty |

---

## Configuration file security

The setup wizard:

1. Writes `.env` through `.env.tmp` and a rename
2. Sets `.env` and backups to mode `600`
3. Removes a leftover `.env.tmp` on start and on Ctrl+C
4. Backs up an existing `.env` to `.env.backup` (or `.env.backup.YYYY-MM-DD`) before overwriting

---

## Reporting vulnerabilities

If you find a security issue, do not open a public GitHub issue. Contact the maintainers privately, for example by direct message on the [Nerve Discord](https://discord.gg/Sh9ZGtctva), and give them time to ship a fix before you disclose it.
