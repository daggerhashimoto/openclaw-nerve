# Configuration

Nerve is configured via a `.env` file in the project root. All variables have sensible defaults — only `GATEWAY_TOKEN` is strictly required.

---

## Setup Wizard

The interactive setup wizard is the recommended way to configure Nerve:

```bash
npm run setup               # Interactive setup (5 steps)
npm run setup -- --check    # Validate existing config & test gateway
npm run setup -- --defaults # Non-interactive with auto-detected values
npm run setup -- --help     # Show help
```

### Wizard Steps

The wizard walks through **5 sections**:

#### 1. Gateway Connection

Connects Nerve to your OpenClaw gateway. The wizard auto-detects the gateway token from:
1. Existing `.env` (`GATEWAY_TOKEN`)
2. Environment variable `OPENCLAW_GATEWAY_TOKEN`
3. `~/.openclaw/openclaw.json` (auto-detected)

Tests the connection before proceeding. If the gateway is unreachable, you can continue anyway. On OpenClaw 2026.2.19+, the wizard also:
- Reads the real gateway token from the systemd service file (works around a known bug where `openclaw onboard` writes different tokens to systemd and `openclaw.json`)
- Bootstraps `paired.json` and `device-auth.json` with full operator scopes if they don't exist yet
- Pre-registers Nerve's device identity so it can connect without manual `openclaw devices approve`
- Restarts the gateway to apply changes

#### 2. Agent Identity

Sets the `AGENT_NAME` displayed in the UI.

#### 3. Access Mode

Determines how you'll access Nerve. The wizard auto-configures `HOST`, `ALLOWED_ORIGINS`, `WS_ALLOWED_HOSTS`, and `CSP_CONNECT_EXTRA` based on your choice:

| Mode | Bind | Description |
|------|------|-------------|
| **Localhost** | `127.0.0.1` | Only accessible from this machine. Safest option. |
| **Tailscale** | `0.0.0.0` | Accessible from your Tailscale network. Auto-detected if Tailscale is running. Sets CORS + CSP for your Tailscale IP. |
| **Network (LAN)** | `0.0.0.0` | Accessible from your local network. Prompts for your LAN IP. Sets CORS + CSP for that IP. |
| **Custom** | Manual | Full manual control: custom port, bind address, HTTPS certificate generation, CORS. |

**HTTPS (Custom mode only):** The wizard can generate self-signed certificates via `openssl` and configure `SSL_PORT`.

#### 4. TTS Configuration (Optional)

Prompts for optional API keys:
- `OPENAI_API_KEY` — enables OpenAI TTS + Whisper transcription
- `REPLICATE_API_TOKEN` — enables Qwen TTS via Replicate (warns if `ffmpeg` is missing)

Edge TTS always works without any keys.

#### 5. Advanced Settings (Optional)

Custom file paths for `MEMORY_PATH`, `MEMORY_DIR`, `SESSIONS_DIR`. Most users skip this.

### Modes Summary

| Flag | Behavior |
|------|----------|
| *(none)* | Full interactive wizard. If `.env` exists, asks whether to update or start fresh. |
| `--check` | Validates all config values, tests gateway connectivity, and exits. Non-destructive. |
| `--defaults` | Auto-detects gateway token, applies defaults for everything else, writes `.env`. No prompts. |

The wizard backs up existing `.env` files (e.g. `.env.bak.1708100000000`) before overwriting and applies `chmod 600` to both `.env` and backup files.

---

## Environment Variables

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3080` | HTTP server port |
| `SSL_PORT` | `3443` | HTTPS server port (requires certificates at `certs/cert.pem` and `certs/key.pem`) |
| `HOST` | `127.0.0.1` | Bind address. Set to `0.0.0.0` for network access — see warning below |

> **⚠️ Network exposure:** Setting `HOST=0.0.0.0` exposes all endpoints to the network. Enable authentication (`NERVE_AUTH=true`) and set a password via the setup wizard before binding to a non-loopback address. Without auth, anyone with network access can read/write agent memory, modify config files, and control sessions. See [Security](SECURITY.md) for the full threat model.

```bash
PORT=3080
SSL_PORT=3443
HOST=127.0.0.1
```

### Gateway (Required)

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `GATEWAY_TOKEN` | — | **Yes** | Authentication token for the OpenClaw gateway. The setup wizard auto-detects this. See note below |
| `GATEWAY_URL` | `http://127.0.0.1:18789` | No | Gateway HTTP endpoint URL |

```bash
GATEWAY_TOKEN=your-token-here
GATEWAY_URL=http://127.0.0.1:18789
```

### Token Injection

Nerve performs **server-side token injection**. When a connection is established through the WebSocket proxy, Nerve automatically injects the configured `GATEWAY_TOKEN` into the connection request if the client is considered **trusted**.

**Trust is granted if:**
1. The connection is from a **local loopback address** (`127.0.0.1` or `::1`), accounting for `X-Forwarded-For` and `X-Real-IP` when behind a trusted proxy (see `TRUSTED_PROXIES`).
2. OR, the connection has a valid **authenticated session** (`NERVE_AUTH=true`).

This allows the browser UI to connect without having to manually enter or store the gateway token in the browser's persistent storage. If a connection is not trusted (e.g., remote access without authentication), the token field in the UI must be filled manually.

> **Note:** `OPENCLAW_GATEWAY_TOKEN` is also accepted as a fallback for `GATEWAY_TOKEN`.
>
> **Token detection order:** The setup wizard finds the gateway token from: (1) systemd service file (`OPENCLAW_GATEWAY_TOKEN` env var in the unit), (2) `~/.openclaw/openclaw.json`, (3) `OPENCLAW_GATEWAY_TOKEN` shell env var. The systemd source takes priority because the gateway process reads the env var over the config file — a known issue where `openclaw onboard` writes different tokens to each location.

### Agent Identity

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_NAME` | `Agent` | Display name shown in the UI header and server info |

```bash
AGENT_NAME=Friday
```

### API Keys (Optional)

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Enables OpenAI TTS (multiple voices) and Whisper audio transcription |
| `REPLICATE_API_TOKEN` | Enables Replicate-hosted TTS models (e.g. Qwen TTS). Requires `ffmpeg` for WAV→MP3 |

```bash
OPENAI_API_KEY=sk-...
REPLICATE_API_TOKEN=r8_...
```

TTS provider fallback chain (when no explicit provider is requested):
1. **OpenAI** — if `OPENAI_API_KEY` is set
2. **Replicate** — if `REPLICATE_API_TOKEN` is set
3. **Edge TTS** — always available, no API key needed (default for new installs)

### Speech-to-Text (STT)

| Variable | Default | Description |
|----------|---------|-------------|
| `STT_PROVIDER` | `local` | STT provider: `local` (whisper.cpp, no API key needed) or `openai` (requires `OPENAI_API_KEY`) |
| `WHISPER_MODEL` | `tiny` | Local whisper model: `tiny` (75 MB), `base` (142 MB), or `small` (466 MB) — multilingual variants. English-only variants (`tiny.en`, `base.en`, `small.en`) are also available. |
| `WHISPER_MODEL_DIR` | `~/.nerve/models` | Directory for downloaded whisper model files |
| `NERVE_LANGUAGE` | `en` | Preferred voice language (ISO 639-1). Legacy `LANGUAGE` is still accepted but deprecated |
| `EDGE_VOICE_GENDER` | `female` | Edge TTS voice gender: `female` or `male` |

```bash
# Use local speech-to-text (no API key needed)
STT_PROVIDER=local
WHISPER_MODEL=tiny
NERVE_LANGUAGE=en
```

Nerve uses explicit language selection (`NERVE_LANGUAGE`) for voice flows; there is no user-facing auto-detect language mode.

Local STT requires `ffmpeg` for audio format conversion (webm/ogg → 16kHz mono WAV). The installer handles this automatically. Models are downloaded from HuggingFace on first use.

> **Migration note:** `LANGUAGE` is still read for backwards compatibility, but new writes use `NERVE_LANGUAGE`.

Voice phrase overrides (stop/cancel/wake words) are stored at `~/.nerve/voice-phrases.json` and generated on first save from the UI.

### Network & Security

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOWED_ORIGINS` | *(localhost only)* | Additional CORS origins, comma-separated. Normalised via `URL` constructor; `"null"` origins are rejected |
| `CSP_CONNECT_EXTRA` | *(none)* | Additional CSP `connect-src` entries, space-separated. Only `http://`, `https://`, `ws://`, `wss://` schemes accepted. Semicolons and newlines are stripped to prevent directive injection |
| `WS_ALLOWED_HOSTS` | `localhost,127.0.0.1,::1` | Additional WebSocket proxy allowed hostnames, comma-separated |
| `TRUSTED_PROXIES` | `127.0.0.1,::1,::ffff:127.0.0.1` | IP addresses trusted to set `X-Forwarded-For` / `X-Real-IP` headers, comma-separated |

```bash
# Tailscale example
ALLOWED_ORIGINS=http://100.64.0.5:3080
CSP_CONNECT_EXTRA=http://100.64.0.5:3080 ws://100.64.0.5:3080
WS_ALLOWED_HOSTS=100.64.0.5

# Behind nginx reverse proxy
TRUSTED_PROXIES=127.0.0.1,::1,10.0.0.1
```

### Authentication

Nerve includes a built-in authentication layer that protects all API endpoints, WebSocket connections, and SSE streams with a session cookie. Auth is opt-in for localhost users and auto-prompted during setup when binding to a network interface.

| Variable | Default | Description |
|----------|---------|-------------|
| `NERVE_AUTH` | `false` | Enable authentication. Set to `true` to require a password for access |
| `NERVE_PASSWORD_HASH` | *(empty)* | scrypt hash of the password. Generated by the setup wizard |
| `NERVE_SESSION_SECRET` | *(auto-generated)* | 32-byte hex string for HMAC-SHA256 cookie signing. Auto-generated during setup. If not set, an ephemeral secret is generated at startup (sessions won't survive restarts) |
| `NERVE_SESSION_TTL` | `2592000000` (30 days) | Session lifetime in milliseconds |

```bash
NERVE_AUTH=true
NERVE_PASSWORD_HASH=<generated-by-setup>
NERVE_SESSION_SECRET=<generated-by-setup>
```

#### `NERVE_ALLOW_INSECURE`

When `HOST=0.0.0.0` and `NERVE_AUTH=false`, the server **refuses to start** to prevent accidentally exposing all endpoints without authentication. Set `NERVE_ALLOW_INSECURE=true` to override this safety check. **Not recommended for production.**

```bash
NERVE_ALLOW_INSECURE=true
```

**Quick enable (with gateway token as password):**

```bash
NERVE_AUTH=true
NERVE_SESSION_SECRET=$(openssl rand -hex 32)
# No NERVE_PASSWORD_HASH needed — your GATEWAY_TOKEN works as the password
```

**Behavior:**
- When `NERVE_AUTH=false` (default): No authentication, all endpoints are open
- When `NERVE_AUTH=true`: All `/api/*` routes (except auth and health) require a valid session cookie
- The session cookie is `HttpOnly`, `SameSite=Strict`, and port-suffixed (`nerve_session_3080`)
- WebSocket upgrade requests are also authenticated
- If no password hash is set, the gateway token is accepted as a fallback password

**Setup wizard:** When the access mode is set to a non-localhost option, the wizard prompts to set a password and auto-generates the session secret.

### API Base URLs

Override these for proxies, self-hosted endpoints, or API-compatible alternatives.

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible API base URL |
| `REPLICATE_BASE_URL` | `https://api.replicate.com/v1` | Replicate API base URL |

```bash
OPENAI_BASE_URL=https://api.openai.com/v1
REPLICATE_BASE_URL=https://api.replicate.com/v1
```

### Codex Integration

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEX_DIR` | `.codex` | Directory for Codex integration files |

### File Paths

| Variable | Default | Description |
|---------|---------|-------------|
| `FILE_BROWSER_ROOT` | `""` (disabled) | If set, overrides OpenClaw workspace as the root directory for the workspace directory tree. In this mode, default exclusion rules are disabled and delete operations are permanent (no `.trash` recovery). |
| `MEMORY_PATH` | `~/.openclaw/workspace/MEMORY.md` | Path to the agent's long-term memory file |
| `MEMORY_DIR` | `~/.openclaw/workspace/memory/` | Directory for daily memory files (`YYYY-MM-DD.md`) |
| `SESSIONS_DIR` | `~/.openclaw/agents/main/sessions/` | Session transcript directory (scanned for token usage) |
| `USAGE_FILE` | `~/.openclaw/token-usage.json` | Persistent cumulative token usage data |
| `NERVE_VOICE_PHRASES_PATH` | `~/.nerve/voice-phrases.json` | Override location for per-language voice phrase overrides |
| `NERVE_WATCH_WORKSPACE_RECURSIVE` | `false` | Enables recursive `fs.watch` for the entire workspace (legacy behavior). Disabled by default to prevent Linux inotify `ENOSPC` watcher exhaustion. |
| `WORKSPACE_ROOT` | *(auto-detected)* | Allowed base directory for git workdir registration. Auto-derived from `git worktree list` or parent of `process.cwd()` |

```bash
FILE_BROWSER_ROOT=/home/user
MEMORY_PATH=/custom/path/MEMORY.md
MEMORY_DIR=/custom/path/memory/
SESSIONS_DIR=/custom/path/sessions/
NERVE_VOICE_PHRASES_PATH=/custom/path/voice-phrases.json
NERVE_WATCH_WORKSPACE_RECURSIVE=false
```

### TTS Cache

| Variable | Default | Description |
|----------|---------|-------------|
| `TTS_CACHE_TTL_MS` | `3600000` (1 hour) | Time-to-live for cached TTS audio in milliseconds |
| `TTS_CACHE_MAX` | `200` | Maximum number of cached TTS entries (in-memory LRU) |

```bash
TTS_CACHE_TTL_MS=7200000
TTS_CACHE_MAX=500
```

### Updater State

The updater stores state in `~/.nerve/updater/`. These are not configurable via env vars — they're managed automatically by `npm run update`.

| Path | Purpose |
|------|---------|
| `~/.nerve/updater/last-good.json` | Snapshot of the last successful state (git ref, version, env hash) |
| `~/.nerve/updater/last-run.json` | Result metadata from the most recent update attempt |
| `~/.nerve/updater/snapshots/<ts>/.env` | Timestamped `.env` backups (mode 0600) |
| `~/.nerve/updater/nerve-update.lock` | PID lock file (prevents concurrent updates) |

### Development

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | Set to `development` to enable the `POST /api/events/test` debug endpoint and verbose error logging |

---

## Kanban

Kanban board configuration is stored in the data file (`server/data/kanban/tasks.json`), not in `.env`. Manage it via the REST API:

```bash
# Read current config
curl http://localhost:3080/api/kanban/config

# Update config
curl -X PUT http://localhost:3080/api/kanban/config \
  -H 'Content-Type: application/json' \
  -d '{"proposalPolicy":"auto","quickViewLimit":10}'
```

### Board Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `columns` | `array` | *(see below)* | Column definitions (1--10). Each: `{ key, title, wipLimit?, visible }` |
| `defaults.status` | `string` | `"todo"` | Default status for new tasks |
| `defaults.priority` | `string` | `"normal"` | Default priority for new tasks |
| `reviewRequired` | `boolean` | `true` | Whether completed tasks must go through review before done |
| `allowDoneDragBypass` | `boolean` | `false` | Allow dragging tasks directly to done (skipping review) |
| `quickViewLimit` | `number` | `5` | Max tasks shown in workspace quick view (1--50) |
| `proposalPolicy` | `string` | `"confirm"` | How agent proposals are handled: `"confirm"` (manual review) or `"auto"` (apply immediately) |
| `defaultModel` | `string` | *(none)* | Default model for agent execution (max 100 chars). Falls back to `anthropic/claude-sonnet-4-5` |

### Column Schema

Each column in the `columns` array:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | `string` | Yes | Status key: `backlog`, `todo`, `in-progress`, `review`, `done`, `cancelled` |
| `title` | `string` | Yes | Display label (1--100 chars) |
| `wipLimit` | `number` | No | Work-in-progress limit (≥0). `0` or omitted means unlimited |
| `visible` | `boolean` | Yes | Whether the column is shown on the board |

### Default Columns

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

Nerve automatically starts an HTTPS server on `SSL_PORT` when certificates exist at:

```
certs/cert.pem    # Certificate
certs/key.pem     # Private key
```

Generate self-signed certificates:

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 \
  -keyout certs/key.pem -out certs/cert.pem \
  -days 365 -nodes -subj '/CN=localhost'
```

Or use the setup wizard's Custom access mode, which generates them automatically if `openssl` is available.

> **Why HTTPS?** Browser microphone access (`getUserMedia`) requires a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts). On `localhost` this works over HTTP, but network access requires HTTPS.

---

## Minimal `.env` Example

```bash
GATEWAY_TOKEN=abc123def456
```

Everything else uses defaults. This is sufficient for local-only usage.

## Full `.env` Example

```bash
# Gateway (required)
GATEWAY_TOKEN=abc123def456
GATEWAY_URL=http://127.0.0.1:18789

# Server
PORT=3080
SSL_PORT=3443
HOST=0.0.0.0
AGENT_NAME=Friday

# Authentication (recommended when HOST=0.0.0.0)
NERVE_AUTH=true
NERVE_PASSWORD_HASH=<generated-by-setup>
NERVE_SESSION_SECRET=<generated-by-setup>
NERVE_SESSION_TTL=2592000000

# API Keys
OPENAI_API_KEY=sk-...
REPLICATE_API_TOKEN=r8_...

# Speech / Language
STT_PROVIDER=local
WHISPER_MODEL=tiny
NERVE_LANGUAGE=en
EDGE_VOICE_GENDER=female

# Network (Tailscale example)
ALLOWED_ORIGINS=http://100.64.0.5:3080
CSP_CONNECT_EXTRA=http://100.64.0.5:3080 ws://100.64.0.5:3080
WS_ALLOWED_HOSTS=100.64.0.5

# TTS Cache
TTS_CACHE_TTL_MS=3600000
TTS_CACHE_MAX=200

# Custom Paths (optional)
MEMORY_PATH=/home/user/.openclaw/workspace/MEMORY.md
MEMORY_DIR=/home/user/.openclaw/workspace/memory
SESSIONS_DIR=/home/user/.openclaw/agents/main/sessions
```
