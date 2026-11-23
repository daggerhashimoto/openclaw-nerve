# Configuration

Nerve reads its configuration from a `.env` file in the project root when the server starts. Variables already set in the process environment take precedence over `.env`. Restart the server after editing `.env`.

Only `GATEWAY_TOKEN` is required. Everything else has a default.

---

## Setup wizard

The setup wizard is the recommended way to write `.env`:

```bash
npm run setup                                            # Interactive setup (6 steps)
npm run setup -- --check                                 # Validate the existing .env and test the gateway
npm run setup -- --defaults                              # Non-interactive, auto-detected values
npm run setup -- --defaults --access-mode tailscale-serve
npm run setup -- --help                                  # Show help
```

### Wizard steps

#### 1. Gateway connection

Setup asks for the gateway URL (default: the existing `.env` value, then the port in the local OpenClaw config, then `http://127.0.0.1:18789`) and the gateway token. It uses the first token it finds in this order:

1. `GATEWAY_TOKEN` in the existing `.env`
2. The local gateway config: `OPENCLAW_GATEWAY_TOKEN` in the systemd unit (`~/.config/systemd/user/openclaw-gateway.service` or `/etc/systemd/system/openclaw-gateway.service`), then `gateway.auth.token` in `~/.openclaw/openclaw.json`
3. The `OPENCLAW_GATEWAY_TOKEN` environment variable

The systemd unit wins over `openclaw.json` because the gateway process uses the unit's value when the two differ. A `gateway.auth.token` stored as a secret reference is resolved when possible; otherwise setup asks for the token.

Setup then tests the connection. If the test fails, setup exits so you can fix the gateway or token first.

#### 2. Agent identity

Sets `AGENT_NAME`, the name shown in the UI.

#### 3. Access mode

Decides how browsers reach Nerve and writes `HOST`, `ALLOWED_ORIGINS`, `CSP_CONNECT_EXTRA` and `WS_ALLOWED_HOSTS` to match. Existing `WS_ALLOWED_HOSTS` entries are kept, and the host of a non-loopback `GATEWAY_URL` is added.

| Mode | `HOST` | Description |
|------|--------|-------------|
| **Localhost** | `127.0.0.1` | Only this machine can connect. Safest option. |
| **Tailscale IP** | `0.0.0.0` | Reachable from your tailnet at this machine's Tailscale IPv4 address. Requires Tailscale to be installed and connected. |
| **Tailscale Serve** | `127.0.0.1` | Nerve stays on loopback and is published through a Tailscale Serve HTTPS hostname. Setup offers to run `tailscale serve --bg http://127.0.0.1:<port>`; if no Serve hostname can be confirmed, it offers to fall back to Tailscale IP mode. |
| **Network (LAN)** | `0.0.0.0` | Reachable from your local network. Prompts for your LAN IPv4 address. |
| **Custom** | as entered | Manual port and bind address. |

For Network mode, and for Custom mode with a non-loopback bind address, setup offers to generate a self-signed certificate with `openssl` and asks for `SSL_PORT`. When HTTPS is on, setup also adds the `https://<host>:<SSL_PORT>` origin after the HTTP origin in `ALLOWED_ORIGINS`, `CSP_CONNECT_EXTRA` (with its `wss://` form) and the gateway's allowed origins. Browsers need HTTPS for microphone access away from localhost.

#### Gateway config changes

After the access mode, setup brings the gateway's config in line with Nerve. What it does depends on where `GATEWAY_URL` points.

**Gateway on this machine.** Setup lists the changes it needs and asks "Apply these changes?" (with `--defaults` it applies them without asking). Possible changes:

- Fix the gateway device's scopes, bootstrapping `devices/paired.json` and `identity/device-auth.json` with full operator scopes on a fresh install
- Pre-pair Nerve's device identity, so it connects without a manual `openclaw devices approve`
- Add `cron`, `gateway` and `sessions_spawn` to `gateway.tools.allow`
- Add the access mode's browser origins to `gateway.controlUi.allowedOrigins`

When a change needs it, setup restarts the gateway (`openclaw gateway restart`) and approves Nerve's pending device request. If you decline, setup prints how to make each change by hand.

**Gateway on another machine.** Setup changes no OpenClaw config. It prints the steps to run on the gateway host instead: the origins to add to `gateway.controlUi.allowedOrigins` (the access mode's origins plus `http://localhost:<port>` and `http://127.0.0.1:<port>`), the tools to add to `gateway.tools.allow`, `openclaw gateway restart`, and approving Nerve's device with `openclaw devices list` and `openclaw devices approve <requestId>`.

How setup decides:

- The gateway is local when the URL host is loopback, `0.0.0.0` or `::`, a `*.localhost` name, one of this machine's interface addresses, or this machine's hostname, short name, `.local` name or Tailscale MagicDNS name. Any other host is remote.
- A local-looking URL still counts as remote when this machine runs no OpenClaw (no `openclaw.json`, `identity/device.json` or `devices/paired.json` in the OpenClaw home). This covers an SSH tunnel or a container port.
- `NERVE_GATEWAY_LOCATION=remote` or `NERVE_GATEWAY_LOCATION=local` overrides the decision. Use `remote` for a tunnel on a machine that also runs OpenClaw, and `local` for a DNS alias of this machine:

  ```bash
  NERVE_GATEWAY_LOCATION=remote npm run setup
  ```

The OpenClaw home is `~/.openclaw`, or the directory of `OPENCLAW_CONFIG_PATH` when that is set.

#### 4. Authentication

Runs only when the chosen mode binds `HOST=0.0.0.0` (Tailscale IP, Network, or Custom with `0.0.0.0`). Setup offers to set a password (at least 4 characters), stored as a scrypt hash in `NERVE_PASSWORD_HASH`. If you skip the password and a gateway token is set, setup still enables auth and the gateway token works as the password.

Other modes skip this step and keep any existing auth settings. Setup always generates `NERVE_SESSION_SECRET` if it is missing.

#### 5. Text-to-speech (optional)

Prompts for optional API keys:

- `OPENAI_API_KEY`: OpenAI TTS and Whisper transcription
- `REPLICATE_API_TOKEN`: Qwen TTS via Replicate (warns if `ffmpeg` is missing)

Edge TTS works without a key. Xiaomi MiMo is enabled by saving `MIMO_API_KEY` in Settings, Audio, or in `.env`.

#### 6. Advanced settings (optional)

Custom `MEMORY_PATH`, `MEMORY_DIR` and `SESSIONS_DIR`. Most users skip this.

Setup also copies the bundled agent skills to `~/.openclaw/workspace/skills`.

### Modes summary

| Flag | Behaviour |
|------|-----------|
| *(none)* | Full interactive wizard. If `.env` has a gateway token, asks whether to update it, start fresh or cancel. |
| `--check` | Validates the config, tests the gateway connection, and exits. Changes nothing. |
| `--defaults` | No prompts. Auto-detects the gateway token (or fails if none is found), keeps existing values, fills in defaults, and writes `.env` only after the gateway check passes. Enables auth when `HOST=0.0.0.0` and a gateway token is set. |
| `--access-mode <mode>` | Access mode for `--defaults`: `local`, `network`, `custom`, `tailscale-ip` (alias `tailscale`), or `tailscale-serve`. A Tailscale mode that is not ready falls back (Serve to tailnet IP, then to localhost) and prints follow-up steps. |

### What setup writes

- Before overwriting, setup copies the existing `.env` to `.env.backup`, or to `.env.backup.YYYY-MM-DD` when `.env.backup` already exists.
- `.env` is written through `.env.tmp` and a rename, then set to mode `600`, as are the backups. An interrupted run removes `.env.tmp`.
- Setup manages these keys: `GATEWAY_URL`, `GATEWAY_TOKEN`, `AGENT_NAME`, `PORT`, `HOST`, `SSL_PORT`, `OPENAI_API_KEY`, `REPLICATE_API_TOKEN`, the `NERVE_AUTH`, `NERVE_PASSWORD_HASH`, `NERVE_SESSION_SECRET` and `NERVE_SESSION_TTL` auth keys, `ALLOWED_ORIGINS`, `CSP_CONNECT_EXTRA`, `WS_ALLOWED_HOSTS`, `MEMORY_PATH`, `MEMORY_DIR`, `SESSIONS_DIR`, `USAGE_FILE` and `FILE_BROWSER_ROOT`. Every run rewrites these. Any other variable is kept as written, for example `MIMO_API_KEY`, `NERVE_PUBLIC_ORIGIN`, `TRUSTED_PROXIES`, `NERVE_WORKSPACE_REMOTE`, `NERVE_LANGUAGE` or the `NERVE_UPLOAD_*` flags. Setup appends them after its own block under `# Preserved from your previous .env (not managed by setup)`, with the comment lines directly above each. A repeated variable keeps its last value, and other comments and blank lines are not carried over. Choose **Start fresh** in the wizard to drop them; they stay in the backup.

---

## Environment variables

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3080` | HTTP port. Also names the session cookie (`nerve_session_<PORT>`). |
| `SSL_PORT` | `3443` | HTTPS port. HTTPS starts only when `certs/cert.pem` and `certs/key.pem` exist. |
| `HOST` | `127.0.0.1` | Bind address. See the warning below. |

> **Network exposure:** with `HOST=0.0.0.0` every endpoint is reachable from the network. Enable authentication (`NERVE_AUTH=true`) and set a password with the setup wizard first. Without auth, anyone who can reach the port can read and write agent memory, edit workspace files, save API keys, and control sessions. The server refuses to start with `HOST=0.0.0.0` and auth off (see [`NERVE_ALLOW_INSECURE`](#nerve_allow_insecure)). Other non-loopback bind addresses only log a warning. See [Security](SECURITY.md).

```bash
PORT=3080
SSL_PORT=3443
HOST=127.0.0.1
```

### Gateway (required)

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `GATEWAY_TOKEN` | *(none)* | **Yes** | Token for the OpenClaw gateway. The setup wizard detects it. `OPENCLAW_GATEWAY_TOKEN` is read as a fallback. |
| `GATEWAY_URL` | `http://127.0.0.1:18789` | No | Gateway HTTP URL. Nerve derives the WebSocket URL from it. |
| `NERVE_PUBLIC_ORIGIN` | *(empty)* | No | The browser-facing Nerve origin. Nerve's server opens its own WebSocket to the gateway (for crons, Kanban runs, sub-agent spawns, and workspace files, memory and config when the workspace is remote) and sends this as its `Origin`. Without it, Nerve uses the first non-loopback `ALLOWED_ORIGINS` entry, then the first entry, then `http://127.0.0.1:<PORT>`. |

```bash
GATEWAY_TOKEN=your-token-here
GATEWAY_URL=http://127.0.0.1:18789

# Optional for reverse-proxy, cloud and split-host installs
NERVE_PUBLIC_ORIGIN=https://nerve.example.com
```

For a non-interactive install against a remote gateway, pass the URL and token to the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/install.sh \
  | bash -s -- --gateway-url https://gw.example.com --gateway-token <gateway-token> --skip-setup
```

If chat works but crons, Kanban runs or remote workspace panels fail with `origin not allowed`, set `NERVE_PUBLIC_ORIGIN` to the exact browser origin and add that origin to `gateway.controlUi.allowedOrigins` on the gateway.

### Token injection

Nerve injects `GATEWAY_TOKEN` on the server side, so the injection never sends it to the browser. The browser has it only if a user types it in, as the login password (when no password hash is set) or in the connect dialog. When the browser opens the WebSocket proxy (`/ws`) and its connect request carries no token, the proxy adds `GATEWAY_TOKEN` if the client is **trusted** and the target is the gateway in `GATEWAY_URL` (same host, port and TLS; `localhost`, `127.0.0.1` and `::1` count as one host). A client is trusted when:

1. Auth is on (`NERVE_AUTH=true`), so the upgrade already carried a valid session cookie, **or**
2. The client is on loopback (`127.0.0.1`, `::1` or `::ffff:127.x`). When the socket itself is loopback, Nerve reads `X-Forwarded-For` from the right and takes the first address that is not loopback. It falls back to `X-Real-IP` when the header is missing or lists only loopback addresses. A same-host reverse proxy must therefore send the real client address in one of those headers. `TRUSTED_PROXIES` does not affect this check.

`GET /api/connect-defaults` tells the browser whether this applies (`serverSideAuth`). If it does, the connect dialog hides the token field for the official gateway URL. Untrusted clients and custom gateway URLs need the token typed in the dialog, and a token entered that way is kept in the browser's `localStorage` (`oc-config`) until it is cleared.

### Agent identity

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_NAME` | `Agent` | Display name shown in the UI and server info |

```bash
AGENT_NAME=Friday
```

### API keys (optional)

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI TTS (several voices) and Whisper transcription |
| `REPLICATE_API_TOKEN` | Replicate-hosted TTS (Qwen TTS). Needs `ffmpeg` for WAV to MP3 conversion. |
| `MIMO_API_KEY` | Xiaomi MiMo TTS, used when Xiaomi is selected in Settings, Audio |

Keys saved in Settings are written to `.env` by the server.

```bash
OPENAI_API_KEY=sk-...
REPLICATE_API_TOKEN=r8_...
MIMO_API_KEY=sk-mimo-...
```

When a TTS request names no provider, the server picks:

1. **OpenAI**, if `OPENAI_API_KEY` is set
2. **Replicate**, if `REPLICATE_API_TOKEN` is set
3. **Edge TTS**, always available without a key

The browser sends its selected provider (Edge for new browsers), so this order applies to API callers that omit it. Xiaomi MiMo is used only when selected explicitly.

### Speech-to-text (STT)

| Variable | Default | Description |
|----------|---------|-------------|
| `STT_PROVIDER` | `local` | `local` (whisper.cpp, no API key) or `openai` (needs `OPENAI_API_KEY`) |
| `WHISPER_MODEL` | `base` | Local model: `tiny` (75 MB), `base` (142 MB) or `small` (466 MB), all multilingual, or the English-only `tiny.en`, `base.en`, `small.en` |
| `WHISPER_MODEL_DIR` | `~/.nerve/models` | Directory for downloaded model files |
| `NERVE_LANGUAGE` | `en` | Voice language (ISO 639-1). Unsupported values fall back to `en`. Legacy `LANGUAGE` is still read but deprecated. |
| `EDGE_VOICE_GENDER` | `female` | Edge TTS voice gender: `female` or `male` |

```bash
STT_PROVIDER=local
WHISPER_MODEL=base
NERVE_LANGUAGE=en
```

Language is always chosen explicitly; there is no auto-detect mode. Changing the language or Edge voice gender in Settings writes `NERVE_LANGUAGE` or `EDGE_VOICE_GENDER` to `.env`.

Local STT needs `ffmpeg` to convert recordings to 16 kHz mono WAV; the installer installs it. The installer also downloads the configured model from Hugging Face. Picking a model in Settings, Audio downloads it in the background if it is missing. If the model file is missing when you dictate, transcription fails with "Speech model not found at ...".

Voice phrase overrides (stop, cancel and wake phrases) are saved to `~/.nerve/voice-phrases.json` the first time you save them from the UI.

### Network and security

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOWED_ORIGINS` | *(none)* | Extra browser origins for CORS and the WebSocket proxy, comma-separated. Each is normalised with `new URL()`; malformed entries and `null` are ignored. Origins on `localhost`, `127.0.0.1` or `::1` (any port) are always allowed. |
| `CSP_CONNECT_EXTRA` | *(none)* | Extra CSP `connect-src` sources, space-separated. Only `http://`, `https://`, `ws://` and `wss://` entries are kept; semicolons and newlines are stripped. |
| `WS_ALLOWED_HOSTS` | `localhost,127.0.0.1,::1` | Extra hostnames the WebSocket proxy may connect to, comma-separated. Nerve injects `GATEWAY_TOKEN` only when the target is the gateway in `GATEWAY_URL` (same host, port and TLS; `localhost`, `127.0.0.1` and `::1` count as one host). For any other host in this list the browser's own token is used. List only gateways you trust. |
| `TRUSTED_PROXIES` | `127.0.0.1,::1,::ffff:127.0.0.1` | Extra proxy IPs whose `X-Forwarded-For` or `X-Real-IP` the rate limiter honours, comma-separated. The rate limiter reads `X-Forwarded-For` from the right and takes the first address not listed here, so list every proxy hop. Used only for rate limiting. |

```bash
# Tailscale IP example
ALLOWED_ORIGINS=http://100.64.0.5:3080
CSP_CONNECT_EXTRA=http://100.64.0.5:3080 ws://100.64.0.5:3080
WS_ALLOWED_HOSTS=100.64.0.5

# Behind a reverse proxy on another host
TRUSTED_PROXIES=10.0.0.1
```

To add Tailscale to an existing install, see [Add Tailscale to an existing Nerve install](TAILSCALE.md).

### Authentication

Nerve has an optional password login. When enabled, every `/api/*` route except the public ones needs a valid session cookie, and so do WebSocket upgrades. Setup offers it when the access mode binds `0.0.0.0`.

| Variable | Default | Description |
|----------|---------|-------------|
| `NERVE_AUTH` | `false` | Set to `true` to require a password |
| `NERVE_PASSWORD_HASH` | *(empty)* | scrypt hash of the password, written by the setup wizard |
| `NERVE_SESSION_SECRET` | *(empty)* | Secret for HMAC-SHA256 cookie signing (32 random bytes as hex from setup). If unset while auth is on, the server generates an ephemeral secret at startup and sessions do not survive a restart. |
| `NERVE_SESSION_TTL` | `2592000000` (30 days) | Session lifetime in milliseconds |

```bash
NERVE_AUTH=true
NERVE_PASSWORD_HASH=<generated-by-setup>
NERVE_SESSION_SECRET=<generated-by-setup>
```

#### `NERVE_ALLOW_INSECURE`

With `HOST=0.0.0.0` and `NERVE_AUTH` off, the server **refuses to start**. Set `NERVE_ALLOW_INSECURE=true` to start anyway with a warning. Not recommended.

```bash
NERVE_ALLOW_INSECURE=true
```

**Quick enable with the gateway token as password:**

```bash
NERVE_AUTH=true
NERVE_SESSION_SECRET=<output of: openssl rand -hex 32>
# No NERVE_PASSWORD_HASH: GATEWAY_TOKEN works as the password
```

`.env` values are not run through a shell, so paste the generated value rather than a `$(...)` command.

**Behaviour:**

- `NERVE_AUTH=false` (default): no login; every endpoint is open to anyone who can reach the port.
- `NERVE_AUTH=true`: every `/api/*` route needs a session cookie except `/api/auth/login`, `/api/auth/logout`, `/api/auth/status` and `/api/version`. `/health`, static files and the login page load without a cookie.
- The cookie is `nerve_session_<PORT>`, `HttpOnly`, `SameSite=Strict`, and `Secure` when the request reached Nerve over HTTPS.
- The gateway token is accepted as the password only while `NERVE_PASSWORD_HASH` is empty.
- `POST /api/auth/login` is limited to 5 requests per minute per client.

### API base URLs

Override these for proxies, self-hosted endpoints or compatible APIs.

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible API base URL. TTS, Whisper and the Realtime TTS socket (`wss://.../realtime`) are derived from it. |
| `REPLICATE_BASE_URL` | `https://api.replicate.com/v1` | Replicate API base URL |

```bash
OPENAI_BASE_URL=https://api.openai.com/v1
REPLICATE_BASE_URL=https://api.replicate.com/v1
```

### OpenClaw and tool paths

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_CONFIG_PATH` | `~/.openclaw/openclaw.json` | OpenClaw config file. Nerve reads it for the model list, agent workspaces and skills; setup also patches it and treats its directory as the OpenClaw home. |
| `OPENCLAW_BIN` | auto-detected | Path to the `openclaw` binary, used for gateway restart and skills. Without it, Nerve checks next to the running Node binary, Homebrew and system paths, then falls back to `openclaw` on `PATH`. |
| `CODEX_DIR` | `.codex` | Codex CLI directory, relative to your home directory. Nerve reads `auth.json` and `sessions/` from it for the Codex usage limits display. |
| `BD_BIN` | auto-detected | Path to the Beads `bd` binary used to show bead details. Without it, Nerve checks `~/.local/bin`, `~/.npm-global/bin`, `~/.volta/bin` and `~/.bun/bin`, then falls back to `bd` on `PATH`. |
| `NERVE_DATA_DIR` | `~/.nerve` | Where Nerve keeps its device identity (`device-identity.json`) and Kanban data (`kanban/`). Setup reads (or creates) the device identity here when pre-pairing. Model files, voice phrases and updater state stay under `~/.nerve` regardless. |
| `NERVE_WORKSPACE_REMOTE` | `false` | Set to `true` to treat agent workspaces as remote: the file and config panels go through gateway RPC instead of the local disk, the Memory panel shows a "Sandboxed workspace" notice instead of its list (manage memories on the gateway host), file watching is off, and binary previews and file mutations (rename, move, trash) are unavailable. Without it, Nerve treats a workspace as remote when its directory does not exist locally. |

### File paths

| Variable | Default | Description |
|---------|---------|-------------|
| `FILE_BROWSER_ROOT` | *(empty)* | When set, the file browser shows this directory for every agent. Per-agent workspace scoping and the default exclusions (`node_modules`, `.git`, `.env*` and so on) are off, and deletes are permanent (no `.trash`). |
| `FILE_BROWSER_MAX_TREE_ENTRIES` | `5000` | Most entries one file tree response returns across all expanded directories. Larger directories page. Invalid values fall back to the default. |
| `MEMORY_PATH` | `~/.openclaw/workspace/MEMORY.md` | Main agent's long-term memory file. Its directory is the main workspace root. |
| `MEMORY_DIR` | `~/.openclaw/workspace/memory` | Main agent's daily memory files (`YYYY-MM-DD.md`) |
| `SESSIONS_DIR` | `~/.openclaw/agents/main/sessions` | Main agent's session transcript directory, read for token usage and session lookups |
| `USAGE_FILE` | `~/.openclaw/token-usage.json` | Cumulative token usage data |
| `NERVE_VOICE_PHRASES_PATH` | `~/.nerve/voice-phrases.json` | Location of the per-language voice phrase overrides |
| `NERVE_WATCH_WORKSPACE_RECURSIVE` | `true` | Recursive `fs.watch` for workspace `file.changed` events outside `MEMORY.md` and `memory/`. Set to `false` if Linux runs out of inotify watchers (`ENOSPC`). Memory watchers stay on. |

```bash
FILE_BROWSER_ROOT=/home/user
MEMORY_PATH=/custom/path/MEMORY.md
MEMORY_DIR=/custom/path/memory/
SESSIONS_DIR=/custom/path/sessions/
NERVE_VOICE_PHRASES_PATH=/custom/path/voice-phrases.json
NERVE_WATCH_WORKSPACE_RECURSIVE=false
```

### Uploads

Files attached in the chat composer are uploaded to the server, saved in the main workspace, and sent to the agent as file references. The browser reads these flags from `GET /api/upload-config`. Boolean flags accept `true`, `false`, `1`, `0`, `yes`, `no`, `on` and `off`; invalid values fall back to the default.

| Variable | Default | Description |
|----------|---------|-------------|
| `NERVE_UPLOAD_INLINE_ENABLED` | `true` | Allow attaching files from the browser (paperclip, drag and drop, pasted images) |
| `NERVE_UPLOAD_FILE_REFERENCE_ENABLED` | `false` | Allow attaching existing workspace files by path, and the file browser's add-to-chat action. Also widens the picker to all file types. |
| `NERVE_UPLOAD_TWO_MODE_ENABLED` | `false` | Widens the file picker from images to all file types |
| `NERVE_UPLOAD_INLINE_ATTACHMENT_MAX_MB` | `4` | Size cap for non-image browser uploads, in MB. Images are not capped by this. |
| `NERVE_UPLOAD_STAGING_TEMP_DIR` | `<workspace>/.temp/nerve-uploads` | Where browser uploads are saved, in dated subfolders. Must be inside the main workspace root, or uploads fail. `~` is expanded. |

A message can carry up to 4 attachments. All files picked at once go to the server in one request, so they share the request body limit (about 13 MB).

`NERVE_UPLOAD_MODE_CHOOSER_ENABLED`, `NERVE_UPLOAD_INLINE_IMAGE_CONTEXT_MAX_BYTES` (32768), `NERVE_UPLOAD_INLINE_IMAGE_AUTO_DOWNGRADE_TO_FILE_REFERENCE` (true), `NERVE_UPLOAD_INLINE_IMAGE_SHRINK_MIN_DIMENSION` (512), `NERVE_UPLOAD_IMAGE_OPTIMIZATION_MAX_DIMENSION` (2048), `NERVE_UPLOAD_IMAGE_OPTIMIZATION_WEBP_QUALITY` (82) and `NERVE_UPLOAD_EXPOSE_INLINE_BASE64_TO_AGENT` (false) are still read and reported, but they govern inline image sending, which the current composer does not use.

### TTS cache

| Variable | Default | Description |
|----------|---------|-------------|
| `TTS_CACHE_TTL_MS` | `3600000` (1 hour) | Lifetime of cached TTS audio in milliseconds |
| `TTS_CACHE_MAX` | `200` | Maximum cached entries (in-memory LRU, also capped at 100 MB) |

```bash
TTS_CACHE_TTL_MS=7200000
TTS_CACHE_MAX=500
```

### Updates

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` or `GH_TOKEN` | Optional GitHub token sent when the updater and the in-app update check look up the latest release, to avoid anonymous API rate limits |

The updater keeps its state in `~/.nerve/updater/`. These paths are not configurable; `npm run update` manages them.

| Path | Purpose |
|------|---------|
| `~/.nerve/updater/last-good.json` | Snapshot taken before the last update (git ref, version, `.env` hash) |
| `~/.nerve/updater/last-run.json` | Result of the most recent update attempt |
| `~/.nerve/updater/snapshots/<timestamp>/.env` | `.env` backups (mode `600`) |
| `~/.nerve/updater/update.lock` | PID lock that prevents concurrent updates |

### Development

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | `production` (set by the installer's systemd unit and launchd wrapper) turns on the `Strict-Transport-Security` header and stops stack traces in error logs. `development` enables the `POST /api/events/test` debug endpoint. |
| `VITE_PORT` | Vite dev server port (default `3080`) |
| `VITE_HOST` | Vite dev server bind address (default `127.0.0.1`) |
| `VITE_DISABLE_HTTPS` | Set to `true` to keep the Vite dev server on HTTP when `certs/` exists |

`vite.config.ts` reads these from the shell environment, not from `.env`. In dev, Vite proxies `/api` and `/ws` to `http://localhost:${PORT}`, with `PORT` defaulting to `3081` there:

```bash
PORT=3081 npm run dev:server   # backend
PORT=3081 npm run dev          # frontend on :3080, proxies to :3081
```

---

## In-app settings

The Settings drawer has three sections: **Connection**, **Audio** and **Appearance**. Most settings live in the browser's `localStorage`, so they apply per browser.

| Setting | Where | Stored |
|---------|-------|--------|
| Gateway URL and auth token | Connection | Browser (`oc-config`) |
| Language | Audio | Server, `NERVE_LANGUAGE` in `.env` |
| Voice phrases | Audio | Server, voice phrases file |
| Sound effects (also turns spoken replies on or off) | Audio | Browser, off by default |
| UI sound volume (wake, send and cancel chimes and the completion ping; TTS is unaffected) | Audio | Browser, 100% by default |
| TTS provider and model | Audio | Browser |
| TTS voice settings | Audio | Server, `tts-config.json` in the project root |
| API keys (OpenAI, Replicate, Xiaomi) | Audio | Server, `.env` |
| Wake word, STT input mode, live transcription preview | Audio | Browser |
| STT provider and model | Audio | Browser, applied to the running server (not written to `.env`) |
| Performance mode (freezes cosmetic live visuals, slows shell timers) | Appearance | Browser |
| Theme: Night, Daylight, Workbench Night (default) or Workbench Paper | Appearance | Browser (`oc-theme`) |
| UI font: Nerve default (Atkinson Hyperlegible Next), Instrument Sans, Space Grotesk or JetBrains Mono | Appearance | Browser |
| Font size, editor font size | Appearance | Browser |
| Show events, activity log, hidden workspace entries, chatbox Commands button, workspace tasks | Appearance | Browser |

Pinned sessions are also stored per browser.

---

## Kanban

Kanban board configuration lives in the runtime data file `${NERVE_DATA_DIR:-~/.nerve}/kanban/tasks.json`, not in `.env`. Manage it with the REST API:

```bash
# Read the current config
curl http://localhost:3080/api/kanban/config

# Update part of it
curl -X PUT http://localhost:3080/api/kanban/config \
  -H 'Content-Type: application/json' \
  -d '{"proposalPolicy":"auto","defaultThinking":"medium"}'
```

With auth on, these calls need the session cookie.

### Board configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `columns` | `array` | *(see below)* | 1 to 10 column definitions. Each: `{ key, title, wipLimit?, visible }` |
| `defaults.status` | `string` | `"todo"` | Status for new tasks. Must be a configured column. |
| `defaults.priority` | `string` | `"normal"` | Priority for new tasks: `critical`, `high`, `normal` or `low` |
| `proposalPolicy` | `string` | `"confirm"` | Agent proposals: `"confirm"` waits for review, `"auto"` applies them immediately |
| `defaultModel` | `string` | *(none)* | Model for task runs when neither the run request nor the task sets one (max 100 chars). Unset means OpenClaw's default model. |
| `defaultThinking` | `string` | *(none)* | Thinking level for task runs when neither the run request nor the task sets one (max 20 chars). Unset, empty or `off` runs with `low`. |
| `reviewRequired` | `boolean` | `true` | Stored and validated, but nothing reads it yet |
| `allowDoneDragBypass` | `boolean` | `false` | Stored and validated, but nothing reads it yet |
| `quickViewLimit` | `number` | `5` | Stored and validated (1 to 50), but nothing reads it yet |

### Column schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | `string` | Yes | Status key in lowercase kebab case (for example `in-progress` or `blocked`), up to 64 chars |
| `title` | `string` | Yes | Display label, 1 to 100 chars |
| `wipLimit` | `integer` | No | Work-in-progress limit, 0 or more. Stored and validated, but not enforced yet |
| `visible` | `boolean` | Yes | Whether the column shows on the board |

A board must keep the `backlog`, `todo`, `in-progress`, `review` and `done` columns; `cancelled` is optional, and custom keys can be added. A column that tasks or proposals still use cannot be removed.

### Default columns

```json
[
  { "key": "backlog",     "title": "Backlog",     "visible": true },
  { "key": "todo",        "title": "To Do",       "visible": true },
  { "key": "in-progress", "title": "In Progress", "visible": true },
  { "key": "review",      "title": "Review",      "visible": true },
  { "key": "done",        "title": "Done",        "visible": true },
  { "key": "cancelled",   "title": "Cancelled",   "visible": false }
]
```

---

## HTTPS

Nerve also starts an HTTPS server on `SSL_PORT` when both files exist:

```
certs/cert.pem    # Certificate
certs/key.pem     # Private key
```

Generate a self-signed certificate:

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 \
  -keyout certs/key.pem -out certs/cert.pem \
  -days 365 -nodes -subj '/CN=localhost'
```

The setup wizard generates one for you in Network mode, or in Custom mode with a non-loopback bind address, when `openssl` is available.

> **Why HTTPS?** Browser microphone access (`getUserMedia`) needs a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts). `localhost` counts as secure over HTTP; any other address needs HTTPS.

---

## Minimal `.env` example

```bash
GATEWAY_TOKEN=<gateway-token>
```

Everything else uses defaults. This is enough for local-only use.

## Full `.env` example

```bash
# Gateway (required)
GATEWAY_TOKEN=<gateway-token>
GATEWAY_URL=http://127.0.0.1:18789

# Server
PORT=3080
SSL_PORT=3443
HOST=0.0.0.0
AGENT_NAME=Friday

# Authentication (required when HOST=0.0.0.0)
NERVE_AUTH=true
NERVE_PASSWORD_HASH=<generated-by-setup>
NERVE_SESSION_SECRET=<generated-by-setup>
NERVE_SESSION_TTL=2592000000

# API keys
OPENAI_API_KEY=sk-...
REPLICATE_API_TOKEN=r8_...
MIMO_API_KEY=sk-mimo-...

# Speech and language
STT_PROVIDER=local
WHISPER_MODEL=base
NERVE_LANGUAGE=en
EDGE_VOICE_GENDER=female

# Network (Tailscale IP example)
ALLOWED_ORIGINS=http://100.64.0.5:3080
CSP_CONNECT_EXTRA=http://100.64.0.5:3080 ws://100.64.0.5:3080
WS_ALLOWED_HOSTS=100.64.0.5

# TTS cache
TTS_CACHE_TTL_MS=3600000
TTS_CACHE_MAX=200

# Custom paths (optional)
MEMORY_PATH=/home/user/.openclaw/workspace/MEMORY.md
MEMORY_DIR=/home/user/.openclaw/workspace/memory
SESSIONS_DIR=/home/user/.openclaw/agents/main/sessions
```
