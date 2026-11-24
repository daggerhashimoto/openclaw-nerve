# API reference

Nerve exposes a REST + SSE API served by [Hono](https://hono.dev/) on the configured `PORT` (default **3080**). All API routes are prefixed with `/api/` except the health endpoint. Responses are JSON unless otherwise noted. Browsers reach the OpenClaw gateway through a WebSocket proxy at `/ws` (see [WebSocket proxy](#websocket-proxy)).

> **Authentication:** When `NERVE_AUTH=true`, all API endpoints require a valid session cookie except `/api/auth/login`, `/api/auth/logout`, `/api/auth/status`, `/api/version` and `/health`. Obtain a cookie via `POST /api/auth/login`. When `NERVE_AUTH=false` (the default), no authentication is required. See [SECURITY.md](./SECURITY.md) for details.

---

## Table of contents

- [Authentication](#authentication)
- [Health](#health)
- [Server info](#server-info)
- [Version](#version)
- [Connect defaults](#connect-defaults)
- [Events (SSE)](#events-sse)
- [Text-to-speech](#text-to-speech)
- [Transcription](#transcription)
- [Language & voice phrases](#language--voice-phrases)
- [Token usage](#token-usage)
- [Memories](#memories)
- [Agent log](#agent-log)
- [Gateway](#gateway)
- [Sessions](#sessions)
- [Channels](#channels)
- [Workspace files](#workspace-files)
- [Cron jobs](#cron-jobs)
- [Skills](#skills)
- [Beads](#beads)
- [File browser](#file-browser)
- [File serving](#file-serving)
- [Chat media](#chat-media)
- [Uploads](#uploads)
- [Codex limits](#codex-limits)
- [Claude Code limits](#claude-code-limits)
- [Kanban](#kanban)
- [WebSocket proxy](#websocket-proxy)
- [Error handling](#error-handling)
- [Rate limiting](#rate-limiting)
- [Global middleware](#global-middleware)
- [Static files & SPA](#static-files--spa)

---

## Authentication

### `GET /api/auth/status`

Check whether authentication is enabled and whether the current request is authenticated.

**Rate limit:** None (public endpoint)

**Response:**

```json
{
  "authEnabled": true,
  "authenticated": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `authEnabled` | `boolean` | Whether `NERVE_AUTH` is enabled on the server |
| `authenticated` | `boolean` | Whether the current request has a valid session cookie. Always `true` when auth is disabled. |

### `POST /api/auth/login`

Authenticate with a password and receive a session cookie.

**Rate limit:** Auth (5/min)

**Request body:**

```json
{
  "password": "your-password"
}
```

**Response (200):**

```json
{ "ok": true }
```

On success the server sets an `HttpOnly`, `SameSite=Strict` session cookie named `nerve_session_{PORT}` (the port is part of the name so several Nerve instances on one host do not collide). The cookie is `Secure` when the request URL is `https`, has path `/`, and lasts `NERVE_SESSION_TTL` milliseconds (default 30 days).

**Errors:**

| Status | Body | Condition |
|--------|------|-------------|
| 400 | `{ "error": "Password required" }` | Empty or missing password (the value is trimmed) |
| 400 | `{ "error": "Invalid request" }` | Body is not valid JSON |
| 401 | `{ "error": "Invalid password" }` | Wrong password |
| 429 | plain text | Rate limit exceeded |

**Notes:**
- When auth is disabled, the endpoint skips the password check and returns `{ "ok": true, "message": "Auth disabled" }`.
- When no password hash is configured, the gateway token is accepted as the password.

### `POST /api/auth/logout`

Clear the session cookie.

**Rate limit:** None (public endpoint)

**Response:**

```json
{ "ok": true }
```

---

## Health

### `GET /health`

Health check with gateway connectivity probe. Public: it needs no session cookie even when `NERVE_AUTH=true`.

**Rate limit:** None

**Response:**

```json
{
  "status": "ok",
  "uptime": 3621.42,
  "gateway": "ok"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Always `"ok"` if the server is running |
| `uptime` | `number` | Server uptime in seconds |
| `gateway` | `"ok" \| "unreachable"` | Result of a 3-second probe of `GET {GATEWAY_URL}/health` |

---

## Server info

### `GET /api/server-info`

Returns server time, gateway process start time, timezone, agent name and the default agent workspace root.

**Rate limit:** General (60/min)

**Response:**

```json
{
  "serverTime": 1708100000000,
  "gatewayStartedAt": 1708090000000,
  "timezone": "Europe/Berlin",
  "agentName": "Agent",
  "defaultAgentWorkspaceRoot": "/home/user/.openclaw/workspace"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `serverTime` | `number` | Current epoch milliseconds |
| `gatewayStartedAt` | `number \| null` | Gateway process start time (epoch ms). Found by looking for an `openclaw-gateway` process on the Nerve host (Linux reads `/proc`, other platforms use `ps`), so it is `null` when the gateway runs elsewhere or is not running. Cached for 30 seconds. |
| `timezone` | `string` | IANA timezone of the server |
| `agentName` | `string` | Configured agent display name |
| `defaultAgentWorkspaceRoot` | `string \| null` | `agents.defaults.workspace` from the active OpenClaw config, resolved to an absolute path. `null` when it is not set. |

---

## Version

### `GET /api/version`

Returns the application name and version from `package.json`. Public: it needs no session cookie even when `NERVE_AUTH=true`.

**Rate limit:** General (60/min)

**Response:**

```json
{
  "version": "1.6.0",
  "name": "openclaw-nerve"
}
```

### `GET /api/version/check`

Compares the running version with the newest published one. The newest version comes from the latest GitHub release of the repository behind the install's `origin` remote, with the highest semver tag (`git ls-remote --tags origin`, then local tags) as a fallback. Successful lookups are cached for 1 hour.

**Rate limit:** General (60/min)

**Response:**

```json
{
  "current": "1.5.4",
  "latest": "1.6.0",
  "source": "release",
  "updateAvailable": true,
  "projectDir": "/path/to/nerve"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `current` | `string` | Version from `package.json` |
| `latest` | `string \| null` | Newest version found, or `null` if the lookup failed |
| `source` | `"release" \| "tag" \| null` | Where `latest` came from |
| `updateAvailable` | `boolean` | `true` when `latest` is a higher semver than `current` |
| `projectDir` | `string` | Absolute path of the Nerve install directory |
| `error` | `string` | Only present when the lookup failed: `"Could not fetch release or semver tags"` (status is still 200) |

---

## Connect defaults

### `GET /api/connect-defaults`

Provides the gateway WebSocket URL and trust metadata for the frontend's auto-connect flow. The `token` field is always `null`; when `serverSideAuth` is `true`, the browser connects with an empty token and the WebSocket proxy injects `GATEWAY_TOKEN` during the handshake.

**Rate limit:** General (60/min)

**Response (token injected server-side):**

```json
{
  "wsUrl": "ws://127.0.0.1:18789/ws",
  "token": null,
  "agentName": "Agent",
  "authEnabled": false,
  "serverSideAuth": true
}
```

**Response (token entered manually):**

```json
{
  "wsUrl": "ws://127.0.0.1:18789/ws",
  "token": null,
  "agentName": "Agent",
  "authEnabled": true,
  "serverSideAuth": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `wsUrl` | `string` | `GATEWAY_URL` with the scheme switched to `ws` or `wss` and the path set to `/ws` |
| `token` | `null` | Always `null`; the gateway token never leaves the server |
| `agentName` | `string` | Configured agent display name |
| `authEnabled` | `boolean` | Whether `NERVE_AUTH` is enabled |
| `serverSideAuth` | `boolean` | `true` when a gateway token is configured and the request is trusted for injection |

A request is trusted when `NERVE_AUTH` is enabled (the request already passed the session check) or when the client address is loopback. The client address is the socket address, except that when the direct connection is itself loopback (a local reverse proxy), Nerve reads the header selected by `TRUSTED_PROXY_HEADER`. With the default `x-forwarded-for`, it is the first non-loopback entry of `X-Forwarded-For`, read from the right, or `X-Real-IP` when that header is missing or lists only loopback addresses. With `x-real-ip`, only `X-Real-IP` is read and `X-Forwarded-For` is ignored. A remote client behind such a proxy is therefore judged by the forwarded address and is not trusted, while a loopback hop that adds no forwarded header, such as a local tunnel, counts as loopback access. If none of the headers the current mode reads carries a client address, the socket address is used and the proxied client looks local. If `serverSideAuth` is `false`, the connect dialog keeps the token field visible and the user must supply the token.

---

## Events (SSE)

### `GET /api/events`

Server-Sent Events stream for real-time push updates. Compression is **disabled** on this route to prevent chunk buffering. There is no rate limiter.

**Headers sent by server:**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

**Event format:**

Each SSE message has an `event` field and a JSON `data` payload that repeats the event name and adds a timestamp:

```
event: memory.changed
data: {"event":"memory.changed","data":{"source":"api","action":"create","section":"General","agentId":"main"},"ts":1708100000000}
```

`connected` and `ping` carry no `data` key: `{"event":"ping","ts":1708100000000}`.

Each client has a bounded send queue (64 messages or 256 KiB) and a 5-second write timeout. A client that falls behind is disconnected and should reconnect.

### Event types

| Event | Trigger | Payload `data` fields |
|-------|---------|-----------------------|
| `connected` | On initial connection | none (only `ts`) |
| `ping` | Every 30 seconds (keep-alive) | none (only `ts`) |
| `memory.changed` | Memory changed through the API or seen by the file watcher | `source` (`"api"` or `"file"`), `action?` (`"create"`, `"update"` or `"delete"`, API only), `section?`, `file?`, `agentId?` |
| `file.changed` | Workspace file changed (file watcher) | `path`, `agentId` |

The client also listens for `tokens.updated` and `status.changed`, but the server does not currently emit them.

### `POST /api/events/test`

**Development only.** Registered only when `NODE_ENV=development`; otherwise the route does not exist. Broadcasts a test event to all connected clients.

**Request body:**

```json
{
  "event": "test",
  "data": { "message": "Hello" }
}
```

Both fields are optional (defaults: `"test"` and `{ "message": "Test broadcast" }`).

**Response:**

```json
{ "ok": true, "event": "test", "data": { "message": "Hello" } }
```

---

## Text-to-speech

### `POST /api/tts`

Synthesizes speech from text. Returns the audio as a binary body.

**Rate limit:** TTS (10/min)

**Request body:**

```json
{
  "text": "Hello, world!",
  "provider": "openai",
  "voice": "marin",
  "model": "gpt-realtime-2.1-mini"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | `string` | Yes | Text to synthesize (1 to 5000 chars, non-empty after trim) |
| `provider` | `"openai" \| "replicate" \| "edge" \| "qwen" \| "xiaomi"` | No | TTS provider. `"qwen"` is a legacy alias for `"replicate"` with model `"qwen-tts"` |
| `voice` | `string` | No | Provider-specific voice name. When omitted, the voice from the TTS config is used |
| `model` | `string` | No | Provider-specific model ID. When omitted, the model from the TTS config is used |

**Provider selection (when `provider` is omitted):**

1. OpenAI, if `OPENAI_API_KEY` is set
2. Replicate, if `REPLICATE_API_TOKEN` is set
3. Edge TTS, always available (free, no API key)

Xiaomi MiMo is used only when `provider: "xiaomi"` is requested and `MIMO_API_KEY` is configured. It is not part of the automatic fallback chain. An explicit provider is always honoured, so requesting a provider whose key is missing returns an error instead of falling back.

**Providers:**

| Provider | Requires | Model | Voice | Response content type |
|----------|----------|-------|-------|-----------------------|
| `openai` | `OPENAI_API_KEY` | `model`, else `openai.model` from the TTS config (default `gpt-realtime-2.1-mini`) | `voice`, else `openai.realtimeVoice` (default `marin`) for the Realtime model, or `openai.voice` (default `nova`) for other models | `audio/wav` for `gpt-realtime-2.1-mini`, `audio/mpeg` for Speech API models |
| `replicate` | `REPLICATE_API_TOKEN` | Only `qwen-tts` (the default) | `voice` is ignored. Mode, speaker and style come from the `qwen` section of the TTS config | `audio/wav` |
| `edge` | None | Ignored | `voice`, else a voice chosen for the current language (see below) | `audio/mpeg` |
| `xiaomi` | `MIMO_API_KEY` | `model`, else `xiaomi.model` (default `mimo-v2-tts`) | `voice`, else `xiaomi.voice` (default `mimo_default`) | `audio/wav` |

Provider notes:

- **OpenAI Realtime** (`gpt-realtime-2.1-mini`) only accepts these voices: `alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`, `marin`, `cedar`. Any other voice, including a legacy voice such as `nova`, is rejected with a 400. Audio is returned as 24 kHz mono 16-bit PCM in a WAV container.
- **OpenAI Speech API models** (`tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`) return MP3. The `model` and `voice` values are forwarded to OpenAI without validation. The Settings UI offers these three plus the Realtime model.
- **`openai.instructions`** is sent as style guidance to the Realtime model and to `gpt-4o-mini-tts`. `tts-1` and `tts-1-hd` ignore it.
- **Edge** picks a voice from the server language (`NERVE_LANGUAGE`) and `EDGE_VOICE_GENDER`. A configured `edge.voice` takes priority when it is a non-default English voice, or when its locale matches one of the current language's Edge locales.
- **Replicate (Qwen3-TTS)** uses the server language, falling back to English when Qwen3 does not support it (Hindi, Arabic, Bengali and Turkish). `qwen.language` is stored in the TTS config but is not used for synthesis.
- **Xiaomi** prepends `xiaomi.style` to the text as a `<style>` tag when it is not empty.

**Response:** the audio binary (200). The `Content-Type` is `audio/mpeg` or `audio/wav` as listed above.

**Errors:** all bodies are plain text unless noted.

| Status | Body | Condition |
|--------|------|-------------|
| 400 | Message of the first validation issue, for example `Text cannot be empty or whitespace` or `Text too long (max 5000 chars)` | Invalid body (missing or non-string `text`, empty text, text over 5000 chars, unknown `provider`) |
| 400 | `Unsupported Realtime voice: <voice>` | Voice not supported by the Realtime model |
| 400 | `Unknown Replicate TTS model: <id>. Available: qwen-tts` | Unknown Replicate model (checked only after the Replicate token is confirmed) |
| 429 | `Too many requests. Please try again later.` | Rate limit exceeded |
| 500 | `OpenAI API key not configured`, `No TTS provider configured (need REPLICATE_API_TOKEN)` or `Xiaomi MiMo API key not configured` | Explicit provider without its key |
| 500 | `TTS failed` | Unexpected error |
| 500 | JSON `{ "error": "Internal server error" }` | Request body is not valid JSON |
| 502, 504 | Provider message, for example `OpenAI Realtime TTS timed out`, `Qwen TTS timed out` or `Edge TTS failed: ...` | Provider failure or timeout (Realtime 60 s, Replicate 120 s, Edge 30 s) |
| Upstream status | Upstream response body | OpenAI Speech API and Xiaomi errors are passed through with their own status and body |

Results are cached in memory (LRU). The cache key is an MD5 hash of `provider:model:voice:style:text`, where `style` is the configured OpenAI `instructions` or Xiaomi `style`, and model and voice are the resolved values for OpenAI. Entries expire after `TTS_CACHE_TTL_MS` (default 1 hour), the cache holds up to `TTS_CACHE_MAX` entries (default 200), and total cached audio is capped at 100 MB.

### `GET /api/tts/config`

Returns the current TTS voice configuration. It is stored in `tts-config.json` in the project root, which is created with these defaults on first read.

**Rate limit:** General (60/min)

**Response:**

```json
{
  "qwen": {
    "mode": "voice_design",
    "language": "English",
    "speaker": "Serena",
    "voiceDescription": "",
    "styleInstruction": ""
  },
  "openai": {
    "model": "gpt-realtime-2.1-mini",
    "voice": "nova",
    "realtimeVoice": "marin",
    "instructions": "Speak naturally and conversationally, like a real person. Warm, friendly tone with a slight British accent. Keep it casual and relaxed, not robotic or overly formal."
  },
  "edge": { "voice": "en-US-AriaNeural" },
  "xiaomi": { "model": "mimo-v2-tts", "voice": "mimo_default", "style": "" }
}
```

### `PUT /api/tts/config`

Partially updates the TTS voice configuration. Sections are deep-merged into the stored config and saved to `tts-config.json`. Only known keys are accepted.

**Rate limit:** General (60/min)

**Request body (partial update):**

```json
{
  "openai": { "voice": "nova", "instructions": "Speak cheerfully" },
  "edge": { "voice": "en-GB-SoniaNeural" },
  "xiaomi": { "voice": "default_en", "style": "Happy" }
}
```

**Allowed keys:**

| Section | Fields |
|---------|--------|
| `qwen` | `mode` (`voice_design` or `custom_voice`), `language`, `speaker`, `voiceDescription`, `styleInstruction` |
| `openai` | `model`, `voice`, `realtimeVoice`, `instructions` |
| `edge` | `voice` |
| `xiaomi` | `model`, `voice`, `style` |

All values must be strings, max 2000 characters each. Values are not checked against provider lists.

**Response:** the full updated configuration, in the same shape as `GET /api/tts/config` (200).

**Errors:** 400 with a plain text body.

| Body | Condition |
|------|-----------|
| `Body must be a JSON object` | Body is not an object |
| `Unknown section: "<name>"` | Section other than `qwen`, `openai`, `edge`, `xiaomi` |
| `"<section>" must be an object` | Section value is not an object |
| `Unknown key: "<section>.<key>"` | Field not in the allowed list |
| `"<section>.<key>" must be a string` | Non-string value |
| `"<section>.<key>" exceeds max length (2000)` | Value longer than 2000 characters |
| `Invalid config` | Body could not be parsed as JSON |

### `GET /api/keys`

Returns whether optional provider keys are configured. Key values are never returned.

**Rate limit:** General (60/min)

**Response:**

```json
{
  "openaiKeySet": true,
  "replicateKeySet": false,
  "xiaomiKeySet": true
}
```

### `PUT /api/keys`

Writes optional provider keys to the `.env` file in the server's working directory and hot-reloads the in-memory config.

**Rate limit:** General (60/min)

**Request body (partial update):**

```json
{
  "openaiKey": "sk-...",
  "replicateToken": "r8_...",
  "mimoApiKey": "sk-mimo-..."
}
```

| Field | Type | Env key written |
|-------|------|-----------------|
| `openaiKey` | `string` | `OPENAI_API_KEY` |
| `replicateToken` | `string` | `REPLICATE_API_TOKEN` |
| `mimoApiKey` | `string` | `MIMO_API_KEY` |

Any subset of fields may be provided. Values are trimmed. Sending an empty string clears that key. Fields are processed in the order above.

**Response:**

```json
{
  "ok": true,
  "message": "OPENAI_API_KEY saved, MIMO_API_KEY saved",
  "openaiKeySet": true,
  "replicateKeySet": false,
  "xiaomiKeySet": true
}
```

`message` lists one `<ENV_KEY> saved` or `<ENV_KEY> cleared` entry per field provided, or `No changes` when the body has none of the three fields.

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `Invalid request` (plain text) | Body is not valid JSON, a value is not a string, or a value contains a line break. Fields processed before the failing one stay saved |

---

## Transcription

### `POST /api/transcribe`

Transcribes audio using the configured STT provider.

**Rate limit:** Transcribe (30/min)

**Providers:**

| Provider | Config | Requirements |
|----------|--------|-------------|
| `openai` | `STT_PROVIDER=openai` | `OPENAI_API_KEY`. Uses the `whisper-1` model |
| `local` (default) | `STT_PROVIDER=local` | `ffmpeg` on the server's `PATH` and a downloaded Whisper model |

The installer installs `ffmpeg` on Debian-family and Fedora-family Linux and downloads the Whisper model (`base`, or the `WHISPER_MODEL` already set in `.env`). On macOS, install `ffmpeg` yourself (`brew install ffmpeg`). The request itself never downloads a model: if the model file is missing the request fails with a 500. A model is also downloaded by `PUT /api/transcribe/config` with a `model`.

**Local STT** uses `@fugood/whisper.node` (whisper.cpp bindings). Available models:

| Model | Size | Speed | Quality |
|-------|------|-------|---------|
| `tiny` | 75 MB | Fastest | Good baseline, multilingual |
| `base` (default) | 142 MB | Fast | Better conversational accuracy, multilingual |
| `small` | 466 MB | Moderate | Best accuracy (CPU-intensive), multilingual |
| `tiny.en` | 75 MB | Fastest | English-only variant |
| `base.en` | 142 MB | Fast | English-only variant |
| `small.en` | 466 MB | Moderate | English-only variant |

Configure the model with `WHISPER_MODEL`. Model files are stored in `WHISPER_MODEL_DIR` (default `~/.nerve/models/`). The language hint comes from `NERVE_LANGUAGE` (the deprecated `LANGUAGE` is still read as a fallback), or from `PUT /api/language` and `PUT /api/transcribe/config` at runtime. An English-only model always transcribes as English. Models are downloaded from HuggingFace.

**Request:** `multipart/form-data` with a `file` field containing audio data. The request body is limited to about 13 MB overall and the file itself to 12 MB.

**Accepted MIME types:** `audio/webm`, `audio/mp3`, `audio/mpeg`, `audio/mp4`, `audio/m4a`, `audio/wav`, `audio/x-wav`, `audio/ogg`, `audio/flac`, `audio/x-flac`. The type of the `file` part is matched exactly, so a value with parameters such as `audio/webm;codecs=opus` is rejected.

```bash
curl -X POST http://localhost:3080/api/transcribe \
  -F "file=@recording.webm"
```

**Response:**

```json
{
  "text": "The transcribed text goes here."
}
```

**Errors:** all bodies are plain text.

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `No file found in request` | No `file` field, or it is not a file |
| 413 | `File too large (max 12MB)` | File exceeds 12 MB |
| 413 | `Request body too large` | Whole request body exceeds about 13 MB (rejected before the handler runs) |
| 415 | `Unsupported audio format: <type>` | MIME type not in the accepted list |
| 429 | `Too many requests. Please try again later.` | Rate limit exceeded |
| 500 | `OpenAI API key not configured. Set OPENAI_API_KEY in .env or switch to STT_PROVIDER=local` | `openai` provider without a key |
| 500 | `Speech model not found at <path>. Re-run the installer or set STT_PROVIDER=openai with an OPENAI_API_KEY.` | Local model file missing |
| 500 | `ffmpeg not found. Install it: apt install ffmpeg (Linux) or brew install ffmpeg (macOS)` | `ffmpeg` missing for local STT |
| 500 | `Audio format conversion failed`, `Transcription returned empty result`, `Local transcription failed: ...` or `Transcription failed` | Other transcription failures |
| Upstream status | Upstream response body | OpenAI API errors are passed through with their own status and body |

### `GET /api/transcribe/config`

Returns the current STT runtime config plus local model readiness and download state.

**Rate limit:** None

**Response (example):**

```json
{
  "provider": "local",
  "model": "base",
  "language": "en",
  "modelReady": true,
  "openaiKeySet": false,
  "replicateKeySet": true,
  "hasGpu": false,
  "availableModels": {
    "tiny.en": { "size": "75MB", "ready": false, "multilingual": false },
    "base.en": { "size": "142MB", "ready": false, "multilingual": false },
    "small.en": { "size": "466MB", "ready": false, "multilingual": false },
    "tiny": { "size": "75MB", "ready": true, "multilingual": true },
    "base": { "size": "142MB", "ready": true, "multilingual": true },
    "small": { "size": "466MB", "ready": false, "multilingual": true }
  },
  "download": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `provider` | `"local" \| "openai"` | Active STT provider |
| `model` | `string` | Active local Whisper model |
| `language` | `string` | Current language code |
| `modelReady` | `boolean` | Whether the active model file exists. Always `true` when the provider is `openai` |
| `openaiKeySet`, `replicateKeySet` | `boolean` | Whether the keys are configured |
| `hasGpu` | `boolean` | Whether a GPU (CUDA, Vulkan or Apple Silicon Metal) was detected |
| `availableModels` | `object` | One entry per Whisper model with `size`, `ready` (file downloaded) and `multilingual` |
| `download` | `object \| null` | Current or just-finished model download: `{ model, downloading, percent, error? }`. `error` is present only when the download failed or was cancelled. It stays set for a few seconds after the download ends |

### `PUT /api/transcribe/config`

Hot-reloads STT config at runtime.

**Rate limit:** None

**Request body (partial):**

```json
{
  "provider": "local",
  "model": "base",
  "language": "tr"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `provider` | `"local" \| "openai"` | STT provider. Any other value is ignored without an error |
| `model` | `string` | Whisper model id: `tiny`, `base`, `small`, or the `.en` variants |
| `language` | `string` | Language code. One of `en`, `zh`, `hi`, `es`, `fr`, `ar`, `bn`, `pt`, `ru`, `ja`, `de`, `tr` |

Changes apply in the order provider, model, language. If a later change is rejected, the earlier ones stay applied.

Only `language` is persisted: it is written to `.env` as `NERVE_LANGUAGE`. `provider` and `model` apply to the running server only and revert to `STT_PROVIDER` and `WHISPER_MODEL` after a restart.

If the requested `model` is not downloaded yet, the server starts the download in the background and responds immediately with `Downloading <model>...`. The `model` in that response is still the previous one. Poll `GET /api/transcribe/config` and watch `download`; the server switches to the new model automatically when the download finishes. Starting a download for a different model cancels the one in progress.

**Response:**

```json
{
  "provider": "local",
  "model": "base",
  "language": "tr",
  "message": "Provider set to local, Switched to base, Language set to tr"
}
```

`message` lists what was changed, or is `No changes` when nothing was applied.

**Errors:** all bodies are plain text.

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `Unknown model: <id>. Available: tiny.en, base.en, small.en, tiny, base, small` | Unknown `model` |
| 400 | `Unsupported language: <code>. Available: en, zh, hi, es, fr, ar, bn, pt, ru, ja, de, tr` | Unknown `language` |
| 400 | `Invalid request` | Body is not valid JSON |
| 500 | `Failed to update transcription config` | Unexpected error |

---

## Language & voice phrases

The server language is one of 12 codes: `en`, `zh`, `hi`, `es`, `fr`, `ar`, `bn`, `pt`, `ru`, `ja`, `de`, `tr`. It sets the language hint for STT, the Edge TTS voice, and the Qwen3 TTS language, and it is stored as `NERVE_LANGUAGE`.

### `GET /api/language`

Returns current language settings and compatibility flags.

**Rate limit:** General (60/min)

**Response (example):**

```json
{
  "language": "en",
  "edgeVoiceGender": "female",
  "supported": [
    { "code": "en", "name": "English", "nativeName": "English" },
    { "code": "tr", "name": "Turkish", "nativeName": "Türkçe" }
  ],
  "providers": {
    "edge": true,
    "qwen3": true,
    "openai": true
  }
}
```

`supported` lists all 12 languages (two shown above). `providers` says whether the current language is supported by each TTS provider. `qwen3` is `false` when the current language is `hi`, `ar`, `bn` or `tr`.

### `PUT /api/language`

Hot-reloads language settings at runtime.

**Rate limit:** General (60/min)

**Request body (partial):**

```json
{
  "language": "tr",
  "edgeVoiceGender": "male"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `language` | `string` | One of the 12 supported language codes |
| `edgeVoiceGender` | `"female" \| "male"` | Preferred Edge TTS voice gender |

Persists to `.env` keys:
- `NERVE_LANGUAGE`
- `EDGE_VOICE_GENDER`

**Response:**

```json
{
  "language": "tr",
  "edgeVoiceGender": "male",
  "providers": {
    "edge": true,
    "qwen3": false,
    "openai": true
  }
}
```

**Errors:** all bodies are plain text. If `language` is valid and `edgeVoiceGender` is not, the language change stays applied.

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `Unsupported language: <code>. Available: en, zh, hi, es, fr, ar, bn, pt, ru, ja, de, tr` | Unknown `language` |
| 400 | `edgeVoiceGender must be "female" or "male"` | Invalid gender |
| 400 | `Invalid request` | Body is not valid JSON |
| 500 | `Failed to update language settings` | Unexpected error |

### `GET /api/language/support`

Returns the full provider by language support matrix and the current local model state.

**Rate limit:** General (60/min)

**Response (shape):**

```json
{
  "languages": [
    {
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "edgeTtsVoices": { "female": "en-US-AriaNeural", "male": "en-US-GuyNeural" },
      "stt": { "local": true, "openai": true },
      "tts": { "edge": true, "qwen3": true, "openai": true }
    }
  ],
  "currentModel": "base",
  "isMultilingual": true
}
```

`currentModel` is the active local Whisper model and `isMultilingual` is `false` when it is an English-only (`.en`) model. `stt.local` is `true` for English, and for other languages only when the active model is multilingual. `stt.openai`, `tts.edge` and `tts.openai` are always `true`. `tts.qwen3` is `false` for `hi`, `ar`, `bn` and `tr`.

### `GET /api/voice-phrases`

Returns the phrase set used for voice recognition matching (stop, cancel and optional wake phrases) for one language.

**Rate limit:** None

**Query parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `lang` | `string` | No | Language code (case-insensitive). Defaults to the current server language |

For the language, custom phrases saved with `PUT /api/voice-phrases/:lang` are used, otherwise the built-in defaults. Phrases are not merged with English. English phrases are returned only when the language has neither custom nor built-in phrases.

**Response:**

```json
{
  "stopPhrases": ["envoie", "terminé"],
  "cancelPhrases": ["annuler", "laisse tomber"],
  "wakePhrases": ["salut toi"]
}
```

`wakePhrases` is present only when a custom wake phrase has been saved. Built-in defaults have none.

### `GET /api/voice-phrases/status`

Returns whether each supported language has custom phrase overrides configured.

**Rate limit:** None

**Response (example):**

```json
{
  "en": { "configured": false, "hasDefaults": true },
  "tr": { "configured": true, "hasDefaults": true }
}
```

The response has one entry for each of the 12 supported languages (two shown above).

### `GET /api/voice-phrases/:lang`

Returns language-only phrase config (no English fallback).

**Rate limit:** None

**Response:**

```json
{
  "source": "custom",
  "stopPhrases": ["gönder"],
  "cancelPhrases": ["iptal"],
  "wakePhrases": ["selam kim"]
}
```

`source` is one of `custom`, `defaults`, or `none`. `wakePhrases` is present only for `custom` entries that have one. `none` (a language with no phrases at all) returns empty `stopPhrases` and `cancelPhrases` arrays. The language is matched case-insensitively and is not validated against the supported list.

### `PUT /api/voice-phrases/:lang`

Saves per-language custom phrase overrides.

**Rate limit:** None

**Request body (partial):**

```json
{
  "stopPhrases": ["gönder"],
  "cancelPhrases": ["iptal"],
  "wakePhrases": ["selam kim"]
}
```

At least one of `stopPhrases`, `cancelPhrases`, or `wakePhrases` is required. Fields you omit keep their current custom value, or the built-in default if none was saved. Blank strings are removed from `stopPhrases` and `cancelPhrases`. Only the first non-blank entry of `wakePhrases` is stored, and sending an empty array clears the saved wake phrase.

**Response:**

```json
{ "ok": true, "lang": "tr" }
```

**Errors:** all bodies are plain text.

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `Unsupported language: <lang>` | `:lang` is not one of the 12 supported codes |
| 400 | `At least one of stopPhrases, cancelPhrases, or wakePhrases required` | None of the three fields given |
| 400 | `Invalid JSON body` | Body is not valid JSON, or a phrase is not a string |

Custom phrase overrides are stored in `~/.nerve/voice-phrases.json` (created on first save). Set `NERVE_VOICE_PHRASES_PATH` to use another file. If that file does not exist, a `voice-phrases.json` in the project root is read as a legacy fallback, but saves always go to the primary path.

---

## Token usage

### `GET /api/tokens`

Returns token usage and cost, aggregated per provider from session transcript files, plus persistent cumulative totals.

**Rate limit:** General (60/min)

**Response:**

```json
{
  "totalCost": 1.2345,
  "totalInput": 500000,
  "totalOutput": 120000,
  "totalMessages": 85,
  "entries": [
    {
      "source": "anthropic",
      "cost": 0.9812,
      "messageCount": 60,
      "inputTokens": 400000,
      "outputTokens": 100000,
      "cacheReadTokens": 250000,
      "errorCount": 2
    }
  ],
  "persistent": {
    "totalInput": 1500000,
    "totalOutput": 400000,
    "totalCost": 5.6789,
    "lastUpdated": "2025-02-15T10:00:00.000Z"
  },
  "updatedAt": 1708100000000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `totalCost`, `totalInput`, `totalOutput`, `totalMessages` | `number` | Totals across all providers. `totalCost` is rounded to 4 decimals |
| `entries` | `object[]` | One entry per provider (`source`), sorted by cost, highest first. `cost` is rounded to 4 decimals. `errorCount` counts transcript error records for that provider |
| `persistent` | `object` | High-water mark of input tokens, output tokens and cost. Values only ever increase, so they survive session compaction. `lastUpdated` is an ISO timestamp |
| `updatedAt` | `number` | Time of the response, epoch ms |

How the numbers are built:

- Nerve reads every `*.jsonl` transcript in `SESSIONS_DIR` (default `~/.openclaw/agents/main/sessions`). When the path has the form `.../agents/<id>/sessions`, it also scans the `sessions` folder of every other agent under `.../agents/`.
- A line counts when it is a `message` record with `usage` data and a provider other than `openclaw`. `error` records only add to the provider's `errorCount`. Malformed lines and unreadable files are skipped.
- The persistent totals are stored in `USAGE_FILE` (default `~/.openclaw/token-usage.json`). The file is rewritten on every request, so `lastUpdated` always shows the time of the latest request.
- The transcript scan is cached for 60 seconds to avoid repeated filesystem scans.

**Errors:** an unexpected failure (for example, the usage file cannot be written) returns 500 with JSON `{ "error": "Internal server error" }`.

---

## Memories

All memory routes accept an optional `agentId` scope: a query parameter on every route, or a body field on `POST`, `PUT` and `DELETE`. If omitted, Nerve uses `main`. An id is 1 to 64 characters of lowercase letters, digits and hyphens, starting and ending with a letter or digit. Anything else returns 400 with `{ "ok": false, "error": "Invalid agentId" }`.

Files for `main` come from `MEMORY_PATH` and `MEMORY_DIR` (defaults `~/.openclaw/workspace/MEMORY.md` and `~/.openclaw/workspace/memory/`). Other agents use the workspace configured for them in the OpenClaw config. If that workspace is not on the local filesystem (or `NERVE_WORKSPACE_REMOTE=true`), `GET /api/memories`, `POST /api/memories`, `PUT /api/memories/section` and `DELETE /api/memories` read and write `MEMORY.md` through the gateway instead. `GET /api/memories/section` always reads the local file, so for a remote workspace it returns 404 `File not found`. Daily files are always local-only.

Error bodies on these routes are JSON `{ "ok": false, "error": "..." }`.

### `GET /api/memories`

Returns parsed memory data from `MEMORY.md` (sections + bullet and numbered items) and the 7 most recent daily files (section headers only) for the selected workspace agent.

**Rate limit:** General (60/min)

**Query parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | `string` | No | Workspace agent id. Defaults to `main` |

**Response:**

```json
[
  { "type": "section", "text": "Preferences" },
  { "type": "item", "text": "Prefers dark mode" },
  { "type": "daily", "date": "2025-02-15", "text": "Worked on API docs" }
]
```

`section` entries come from `## ` headings in `MEMORY.md`, and `item` entries from the bullet or numbered lines under them, with bold markers and backticks removed. `daily` entries are the `## ` headings of the 7 newest `*.md` files in the memory directory (newest first), with `date` taken from the file name. A missing file or directory just yields fewer entries.

### `GET /api/memories/section`

Returns the raw markdown content of a specific section.

**Rate limit:** General (60/min)

**Query parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `string` | Yes | Section title (exact match) |
| `date` | `string` | No | `YYYY-MM-DD` for daily files; omit for MEMORY.md. Only letters, digits, `.`, `_` and `-` are accepted |
| `agentId` | `string` | No | Workspace agent id. Defaults to `main` |

**Response:**

```json
{
  "ok": true,
  "content": "- Prefers dark mode\n- Likes TypeScript"
}
```

`content` is the section body without its heading, trimmed.

**Errors:**

| Status | Body `error` | Condition |
|--------|--------------|-----------|
| 400 | `Missing title parameter` | No `title` |
| 400 | `Invalid filename` | Invalid `date` |
| 400 | `Invalid agentId` | Invalid `agentId` |
| 404 | `File not found` | File missing or empty |
| 404 | `Section not found` | No `## <title>` heading in the file |
| 500 | `Failed to read memory section` | Unexpected error |

### `POST /api/memories`

Creates a new memory entry. Writes a bullet point to `MEMORY.md` under the specified section (creating it if needed), and also stores it in the gateway's vector database on a best-effort basis.

**Rate limit:** General (60/min)

**Request body:**

```json
{
  "text": "Prefers dark mode",
  "section": "Preferences",
  "category": "preference",
  "importance": 0.8
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | `string` | Yes | Memory text (1 to 10000 chars, non-blank). Stored trimmed |
| `section` | `string` | No | Section heading (max 200 chars). Line breaks become spaces. Defaults to "General" when omitted or blank. Matched case-insensitively against existing headings |
| `category` | `"preference" \| "fact" \| "decision" \| "entity" \| "other"` | No | Category for the vector store (default: `other`) |
| `importance` | `number` | No | 0 to 1 importance score for the vector store (default: 0.7) |
| `agentId` | `string` | No | Workspace agent id. Defaults to `main` |

**Response:**

```json
{ "ok": true, "result": { "written": true, "section": "Preferences" } }
```

The file write is what counts: if the gateway `memory_store` call fails, the error is only logged and the response is still a success. Broadcasts a `memory.changed` SSE event on success (`{ "source": "api", "action": "create", "section": "...", "agentId": "..." }`).

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "ok": false, "error": "<first validation message>" }`, for example `Text is required` or `Text too long (max 10000 chars)` | Invalid body |
| 400 | `{ "ok": false, "error": "Invalid agentId" }` | Invalid `agentId` |
| 500 | `{ "ok": false, "error": "Failed to store memory" }`, or with `Failed to store memory (remote workspace)` as the message | Write failed |
| 500 | `{ "error": "Internal server error" }` | Request body is not valid JSON |

### `PUT /api/memories/section`

Replaces the content of an existing section. The `## <title>` heading is kept and everything up to the next `## ` heading is replaced.

**Rate limit:** General (60/min)

**Request body:**

```json
{
  "title": "Preferences",
  "content": "- Prefers dark mode\n- Likes TypeScript",
  "date": "2025-02-15"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `string` | Yes | Section title (1 to 200 chars, exact match) |
| `content` | `string` | Yes | New markdown content (max 50000 chars) |
| `date` | `string` | No | `YYYY-MM-DD` for daily files; omit for MEMORY.md. Only letters, digits, `.`, `_` and `-` are accepted |
| `agentId` | `string` | No | Workspace agent id. Defaults to `main` |

**Response:**

```json
{ "ok": true, "result": { "updated": true, "file": "2025-02-15.md", "section": "Preferences" } }
```

`file` is `MEMORY.md` or the daily file name. Broadcasts a `memory.changed` SSE event (`action: "update"`).

**Errors:**

| Status | Body `error` | Condition |
|--------|--------------|-----------|
| 400 | First validation message, for example `Title is required` or `Content too long` | Invalid body |
| 400 | `Invalid filename` | Invalid `date` |
| 400 | `Invalid agentId` | Invalid `agentId` |
| 404 | `File not found` or `Section not found` | Missing file or section |
| 500 | `Failed to update memory section` | Write failed |

A request body that is not valid JSON returns 500 with `{ "error": "Internal server error" }`.

### `DELETE /api/memories`

Deletes a memory entry from the file.

**Rate limit:** General (60/min)

**Request body:**

```json
{
  "query": "Prefers dark mode",
  "type": "item"
}
```

```json
{
  "query": "Worked on API docs",
  "type": "daily",
  "date": "2025-02-15"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | `string` | Yes | Text to find (1 to 1000 chars). For items, matched exactly against the bullet text with bold markers and backticks removed. For sections, the section title |
| `type` | `"section" \| "item" \| "daily"` | No | What to delete. `section` and `daily` remove the heading and all its content. Default: `item` |
| `date` | `string` | No | `YYYY-MM-DD`. Selects the daily file for `type: "daily"` and is ignored for other types. Without it, a `daily` request searches `MEMORY.md` |
| `agentId` | `string` | No | Workspace agent id. Defaults to `main` |

An `item` delete removes every bullet or numbered line in `MEMORY.md` that matches `query`.

**Response:**

```json
{ "ok": true, "result": { "deleted": 1, "source": "file", "file": "MEMORY.md", "type": "item" } }
```

`deleted` is always `1`. `file` is `MEMORY.md`, or the daily file name for `type: "daily"`. Broadcasts a `memory.changed` SSE event (`action: "delete"`).

**Errors:**

| Status | Body `error` | Condition |
|--------|--------------|-----------|
| 400 | First validation message, for example `Query is required` or `Query too long` | Invalid body |
| 400 | `Invalid agentId` | Invalid `agentId` |
| 404 | `Memory not found in MEMORY.md` or `Memory not found in memory/<date>.md` | Nothing matched, the file is missing, or `date` is invalid |
| 500 | `Failed to delete memory` | Unexpected error |

A request body that is not valid JSON returns 500 with `{ "error": "Internal server error" }`.

---

## Agent log

### `GET /api/agentlog`

Returns the agent log: a JSON array of up to 200 entries, oldest first. It is stored in `agent-log.json` in the project root. Returns `[]` when the file is missing or unreadable.

**Rate limit:** None

**Response:**

```json
[
  { "ts": 1708100000000, "type": "action", "message": "Started task", "level": "info" }
]
```

### `POST /api/agentlog`

Appends an entry to the agent log.

**Rate limit:** General (60/min)

**Request body:**

```json
{
  "type": "action",
  "message": "Completed deployment",
  "level": "info",
  "data": { "duration": 45 }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ts` | `number` | Epoch ms timestamp. Defaults to the server time when omitted |
| `type`, `message`, `level`, `icon`, `text` | `string` | Free-form entry fields |
| `data` | `object` | Free-form payload |

All fields are optional. Unknown fields are dropped. The log is capped at 200 entries (oldest trimmed on write).

**Response:**

```json
{ "ok": true }
```

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "ok": false, "error": "<first validation message>" }` | A field has the wrong type |
| 500 | `{ "ok": false, "error": "Failed to write log" }` | Write failed |
| 500 | `{ "error": "Internal server error" }` | Request body is not valid JSON |

---

## Gateway

### `GET /api/gateway/models`

Returns the models defined in the active OpenClaw config. This endpoint is config-backed, not CLI-discovered or cache-backed. The config file is `OPENCLAW_CONFIG_PATH` if set, otherwise `~/.openclaw/openclaw.json`.

**Rate limit:** General (60/min)

**Response:**

```json
{
  "models": [
    {
      "id": "anthropic/claude-sonnet-4-20250514",
      "label": "claude-sonnet-4-20250514",
      "provider": "anthropic",
      "configured": true,
      "role": "primary"
    }
  ],
  "error": null,
  "source": "config"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `models` | `array` | Models from `agents.defaults.model` (primary and fallbacks) and the `agents.defaults.models` allowlist |
| `models[].id` | `string` | Full model id, `provider/model` |
| `models[].label` | `string` | The entry's `alias` if one is set, otherwise the model id without the provider prefix |
| `models[].provider` | `string` | Part of the id before the first `/` |
| `models[].alias` | `string` | Only present when the allowlist entry sets an `alias` |
| `models[].configured` | `true` | Always `true` |
| `models[].role` | `"primary" \| "fallback" \| "allowed"` | Order of the list is primary, fallbacks, then the remaining allowlist entries sorted by id |
| `error` | `string \| null` | `"Could not read OpenClaw config."` or `"No models configured in OpenClaw config."`, otherwise `null` |
| `source` | `"config"` | Identifies the backing source |

If the config cannot be read, or no models are configured, the endpoint still returns 200 with an empty `models` array and the matching `error` string.

### `GET /api/gateway/session-info`

Returns a session's model and thinking level.

**Rate limit:** General (60/min)

**Query parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `sessionKey` | preferred root session | Session identifier. When omitted, Nerve picks `agent:main:main` if the gateway lists it, otherwise the first top-level `agent:<id>:main` session, otherwise the first listed session |

**Response:**

```json
{
  "model": "anthropic/claude-opus-4-6",
  "thinking": "medium"
}
```

Both fields are optional and omitted when unknown, so the response can be `{}`. `thinking` is lower-cased. The status is always 200.

Resolution order: per-session data from the gateway's `sessions_list` tool, then the gateway's global `session_status` tool (defaults, not per-session values).

### `POST /api/gateway/session-patch`

HTTP fallback for **model changes** when the frontend cannot apply `sessions.patch` over WebSocket. Thinking-only changes are not supported here.

**Rate limit:** General (60/min)

**Request body:**

```json
{
  "sessionKey": "agent:main:main",
  "model": "anthropic/claude-sonnet-4-20250514",
  "thinkingLevel": "high"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionKey` | `string` | No | Target session (max 200 characters). If omitted, Nerve picks a preferred active root session, as in `session-info` |
| `model` | `string` | No | Model to apply via the gateway's `session_status` tool (max 200 characters) |
| `thinkingLevel` | `string \| null` | No | Accepted by the schema (max 50 characters), but not applied by this HTTP fallback |

**Response:**

```json
{ "ok": true, "model": "anthropic/claude-sonnet-4-20250514" }
```

**Behavior notes:**
- Thinking changes belong on WebSocket RPC `sessions.patch`, alongside other session metadata and settings updates.
- A request with `thinkingLevel` (even `null`) and no `model` returns **501**.
- If both `model` and `thinkingLevel` are sent, the model change is applied and the thinking change is ignored.
- If `sessionKey` is omitted and no active root session is found, the endpoint returns **409** before looking at the other fields.

**Errors:** every error body has the shape `{ "ok": false, "error": "..." }`.

| Status | Condition |
|--------|-----------|
| 400 | Invalid JSON (`Invalid JSON body`) or a schema violation (first issue message) |
| 409 | No active root session available (`No active root session available. Provide sessionKey explicitly.`) |
| 501 | Thinking-only change (`Thinking level changes are only supported via WebSocket RPC`) |
| 502 | The model change failed (`Model change failed: <reason>`) |

### `POST /api/gateway/restart`

Restarts the OpenClaw gateway service with `openclaw gateway restart` (15-second timeout), then waits 2 seconds and checks `openclaw gateway status` up to 8 times, 1 second apart, until it reports `Runtime: running` and the gateway port accepts a TCP connection.

**Rate limit:** Restart (3/min)

**Response:**

```json
{ "ok": true, "output": "Gateway restarted successfully" }
```

**Errors:** 500 with `{ "ok": false, "output": "..." }` when the restart command fails, or when the gateway is not running and listening after the retries (`output` then holds the last status text).

---

## Sessions

### `GET /api/sessions/hidden`

Returns hidden cron-like sessions (keys that match `agent:<id>:cron:<job>` or `agent:<id>:cron:<job>:run:<run>`) from the gateway's `sessions.json`, sorted by recent activity. Used to surface session metadata that is not part of the normal active session tree.

**Rate limit:** General (60/min)

**Query parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `activeMinutes` | `1440` | Include sessions updated within the last N minutes. Non-positive or non-numeric values fall back to the default |
| `limit` | `200` | Maximum results. Clamped to `2000` |

**Response:**

```json
{
  "ok": true,
  "sessions": [
    {
      "key": "agent:main:cron:daily:run:abc",
      "sessionKey": "agent:main:cron:daily:run:abc",
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "label": "daily summary",
      "displayName": "daily summary",
      "updatedAt": 1708100000000,
      "model": "openai/gpt-5",
      "thinking": "medium",
      "thinkingLevel": "medium",
      "totalTokens": 1234,
      "contextTokens": 456,
      "parentId": "agent:main:cron:daily"
    }
  ]
}
```

`parentId` is the cron job session for a run (`...:cron:<job>`) and `agent:<id>:main` for a job session.

This reads the main agent's `sessions.json`, for older gateways that leave cron sessions out of `sessions.list`. Current OpenClaw keeps sessions in a database, writes no such file and lists cron sessions itself. When the file does not exist (that case, or a remote gateway) the endpoint returns `{ "ok": true, "sessions": [], "storeMissing": true, "remoteWorkspace": true }` without logging, and the UI asks again only after five minutes. Any other read or parse failure returns `{ "ok": true, "sessions": [] }`.

### `GET /api/sessions/runtime`

Returns the model and thinking level a session actually runs with, recovered from the session store and the start of its transcript. The gateway's session listing can omit them, especially after a reload.

**Rate limit:** General (60/min)

**Query parameters:**

| Param | Required | Description |
|-------|----------|-------------|
| `sessionKey` | Yes | Session key. The agent is taken from the `agent:<id>:` prefix, and the matching agent's `sessions.json` is read |

**Response:**

```json
{ "ok": true, "model": "openai/gpt-5", "thinking": "medium", "missing": false }
```

| Field | Type | Description |
|-------|------|-------------|
| `model` | `string \| null` | The first `model_change` entry in the first 20 transcript lines, else the model stored for the session |
| `thinking` | `string \| null` | The first `thinking_level_change` entry in the first 20 transcript lines, else the stored level (lower-cased) |
| `missing` | `boolean` | `true` when the session is not in the store or its transcript file cannot be found. Stored values are still returned |

**Errors:** 400 `{ "ok": false, "error": "sessionKey is required" }`. An agent id in the key that is not a valid agent id (lowercase letters, digits and hyphens) is not caught and returns 500 `{ "error": "Internal server error" }`.

### `GET /api/sessions/:id/model`

Reads the model and thinking level used by a session from its transcript. This is mainly for cron-run sessions where gateway session listings may only expose the parent agent's default model. Deleted one-shot cron transcripts (`<id>.jsonl.deleted*`) are also found.

**Rate limit:** General (60/min)

**Path parameters:**

| Param | Description |
|-------|-------------|
| `id` | Session UUID |

**Query parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `agentId` | `main` | Agent whose sessions directory holds the transcript |

**Response:**

```json
{ "ok": true, "model": "openai/gpt-5", "thinking": "medium", "missing": false }
```

If the transcript cannot be found, the endpoint returns 200 with `{ "ok": true, "model": null, "thinking": null, "missing": true }`. Fields are read as for `/api/sessions/runtime`.

**Errors:** 400 `{ "ok": false, "error": "Invalid session ID" }` if `id` is not a valid UUID. An `agentId` that is not a valid agent id is not caught and returns 500 `{ "error": "Internal server error" }`.

### `GET /api/sessions/media`

Returns an image that chat history left out of a message. On current OpenClaw, `chat.history` puts an `artifactId` on each omitted image, and the server downloads the image from the gateway with `artifacts.download`. Without an `artifactId` (older OpenClaw), the server looks the session up in the main agent's `sessions.json`, opens its transcript, and returns the image block at the given index of the message with the given timestamp.

**Rate limit:** General (60/min)

**Query parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionKey` | `string` | Yes | Session key. Without `artifactId`, it must be present in `sessions.json` |
| `timestamp` | `number` | Yes | `timestamp` of the transcript message |
| `imageIndex` | `integer` | No | Zero-based index among the message's image blocks. Default `0` |
| `artifactId` | `string` | No | The gateway's id for an omitted image: `artifact_transcript_image_` followed by base64url characters, at most 8192 characters. When present, the image is downloaded from the gateway and `sessions.json` is not read |

**Response:** the raw image bytes, with `Content-Type` set to the recorded MIME type (lower-cased, parameters removed), `X-Content-Type-Options: nosniff`, `Content-Disposition: inline; filename="message-<timestamp>-image-<index>.<ext>"`. Only `image/png`, `image/jpeg`, `image/gif`, `image/webp` and `image/avif` are served. The handler asks for `Cache-Control: private, max-age=3600`, but the global API cache middleware replaces it, so clients receive `Cache-Control: no-cache`.

**Errors:** all bodies have the shape `{ "ok": false, "error": "..." }`.

| Status | `error` | Condition |
|--------|---------|-----------|
| 400 | `Invalid media lookup params` | Missing `sessionKey`, non-numeric `timestamp`, `imageIndex` that is not a non-negative integer, or an `artifactId` with the wrong form or more than 8192 characters |
| 404 | `Unknown session key` | Without `artifactId`: the key is not in `sessions.json`, or `sessions.json` does not exist |
| 404 | `Transcript not found` | No transcript file for the session |
| 404 | `Image not found` | No such message, image block, or image data, or the gateway has no such artifact |
| 415 | `Not a supported image type` | The recorded MIME type is not one of the five raster types |
| 500 | `Failed to load media` | Without `artifactId`: `sessions.json` exists but cannot be read or parsed |
| 502 | `Gateway unavailable` | With `artifactId`: the gateway could not be reached or failed the `artifacts.download` call |

### `POST /api/sessions/spawn-subagent`

Starts a subagent under a root session and monitors it. The server owns the lifecycle: the client only asks for the spawn and then switches focus to the returned session.

**Rate limit:** General (60/min)

**Request body:**

```json
{
  "parentSessionKey": "agent:main:main",
  "task": "Summarize the open pull requests",
  "label": "PR summary",
  "model": "anthropic/claude-sonnet-4-20250514",
  "thinking": "medium",
  "cleanup": "keep"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `parentSessionKey` | `string` | Yes | Top-level root session key, `agent:<id>:main` |
| `task` | `string` | Yes | Prompt for the subagent (1 to 50000 characters) |
| `label` | `string` | No | Display label (max 500 characters) |
| `model` | `string` | No | Model override (max 200 characters) |
| `thinking` | `string` | No | Thinking level (max 20 characters) |
| `cleanup` | `"keep" \| "delete"` | No | What to do with the child session after it reports back. Default `"keep"` |

**Response:**

```json
{
  "ok": true,
  "sessionKey": "agent:main:subagent:5b0e9c2e-0000-4000-8000-000000000000",
  "runId": "run-123",
  "mode": "direct"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `sessionKey` | `string` | Key of the new child session |
| `runId` | `string` | Run id of the first turn. Only present in `direct` mode |
| `mode` | `"direct" \| "marker"` | `direct`: Nerve created the child with the gateway's `sessions.create` and sent the task with `sessions.send`. `marker`: the gateway does not support those methods, so Nerve sent a `[spawn-subagent]` message to the parent session and waited (up to 60 seconds) for the new child to appear |

After the spawn the server polls the child session every 5 seconds (for about an hour). When the child finishes or fails, the server sends a completion report to the parent session. With `cleanup: "delete"` the child session and its transcript are deleted once that report was sent.

**Errors:** all bodies have the shape `{ "ok": false, "error": "..." }`.

| Status | Condition |
|--------|-----------|
| 400 | Invalid JSON (`Invalid JSON body`) or a schema violation (`<field>: <message>`, joined with `; `) |
| 500 | The spawn failed (gateway error, or `Timed out waiting for the new subagent session to appear` in `marker` mode) |

---

## Channels

### `GET /api/channels`

Lists the messaging channels configured in OpenClaw (for example `whatsapp` or `discord`); the cron dialog uses it to offer delivery channels. Reads the keys of `channels` in `~/.openclaw/openclaw.json` and leaves out `webchat`. The result is cached for 5 minutes.

**Rate limit:** General (60/min)

**Response:**

```json
{ "channels": ["whatsapp", "discord"] }
```

If the config file cannot be read or has no `channels` object, the response is `{ "channels": [] }`.

---

## Workspace files

Workspace file routes read and write a fixed set of top-level agent files. They accept an optional `agentId` scope. If omitted, Nerve uses the `main` workspace.

**Workspace selection.** `agentId` is trimmed. An empty value or `main` selects the main workspace, which is the directory that contains `MEMORY_PATH` (default `~/.openclaw/workspace`). Any other id must match `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$` (lowercase letters, digits and hyphens, 1 to 64 characters, no leading or trailing hyphen). It maps to the `workspace` configured for that agent in the OpenClaw config (`agents.list[]`), otherwise to `<agents.defaults.workspace>/<agentId>`, otherwise to `~/.openclaw/workspace-<agentId>`. An invalid id returns 400 with `{ "ok": false, "error": "Invalid agent id: <id>" }`. The File browser routes use the same rule.

**Remote workspaces.** A workspace counts as remote when `NERVE_WORKSPACE_REMOTE=true`, or when its directory does not exist on the machine running Nerve (the check is cached for 60 seconds per directory). Remote files are read and written through the gateway RPC methods `agents.files.list`, `agents.files.get` and `agents.files.set`, and responses carry `"remoteWorkspace": true`.

**Valid keys:**

| Key | File |
|-----|------|
| `soul` | `SOUL.md` |
| `tools` | `TOOLS.md` |
| `identity` | `IDENTITY.md` |
| `user` | `USER.md` |
| `agents` | `AGENTS.md` |
| `heartbeat` | `HEARTBEAT.md` |
| `chatPathLinks` | `CHAT_PATH_LINKS.json` |

### `GET /api/workspace`

Lists the workspace file keys and whether each file exists in the selected workspace.

**Rate limit:** General (60/min)

**Query parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | `string` | No | Workspace agent id. Defaults to `main` |

**Response:**

```json
{
  "ok": true,
  "files": [
    { "key": "soul", "filename": "SOUL.md", "exists": true },
    { "key": "tools", "filename": "TOOLS.md", "exists": true },
    { "key": "identity", "filename": "IDENTITY.md", "exists": false },
    { "key": "user", "filename": "USER.md", "exists": true },
    { "key": "agents", "filename": "AGENTS.md", "exists": true },
    { "key": "heartbeat", "filename": "HEARTBEAT.md", "exists": false },
    { "key": "chatPathLinks", "filename": "CHAT_PATH_LINKS.json", "exists": true }
  ]
}
```

For a remote workspace the response also contains `"remoteWorkspace": true`. If the gateway call fails, the response is still 200 with every file reported as `"exists": false`.

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "ok": false, "error": "Invalid agent id: <id>" }` | `agentId` fails the id rule |
| 500 | `{ "ok": false, "error": "<message>" }` | The workspace could not be resolved for another reason |

### `GET /api/workspace/:key`

Reads a workspace file by key. For a local workspace, Nerve reads the file from disk and, if that fails (for example the file does not exist), asks the gateway for it. A remote workspace goes straight to the gateway.

**Rate limit:** General (60/min)

**Path parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `key` | `string` | One of the valid keys above |

**Query parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | `string` | No | Workspace agent id. Defaults to `main` |

**Response:**

```json
{ "ok": true, "content": "# SOUL.md\n\nYou are..." }
```

When the content came from the gateway, the response also contains `"remoteWorkspace": true`.

A missing local `CHAT_PATH_LINKS.json` is recreated and returned instead of a 404. The file is written to the workspace and seeded with `prefixes` (`/workspace/`, the workspace root, and `<home>/.openclaw/workspace/` and `<home>/workspace/` when the home directory can be inferred) and empty `aliases`.

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "ok": false, "error": "Invalid agent id: <id>" }` | `agentId` fails the id rule (checked before the key) |
| 400 | `{ "ok": false, "error": "Unknown file key" }` | `key` is not one of the valid keys |
| 404 | `{ "ok": false, "error": "File not found" }` | The file is not on disk and the gateway did not return it |
| 500 | `{ "ok": false, "error": "<message>" }` | The workspace could not be resolved for another reason |

### `PUT /api/workspace/:key`

Writes content to a workspace file. The parent directory is created if needed. `CHAT_PATH_LINKS.json` is stored as sent; its content is not validated as JSON.

**Rate limit:** General (60/min)

**Path parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `key` | `string` | One of the valid keys above |

**Request body:**

```json
{ "content": "# Updated content\n\nNew text here.", "agentId": "research" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | `string` | Yes | New file contents. At most 100,000 characters |
| `agentId` | `string` | No | Workspace agent id. Falls back to the `agentId` query parameter, then `main` |

**Response:**

```json
{ "ok": true }
```

When the write went through the gateway, the response is `{ "ok": true, "remoteWorkspace": true }`.

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "ok": false, "error": "Invalid JSON body" }` | Body is not valid JSON |
| 400 | `{ "ok": false, "error": "Invalid agent id: <id>" }` | `agentId` fails the id rule |
| 400 | `{ "ok": false, "error": "Unknown file key" }` | `key` is not one of the valid keys |
| 400 | `{ "ok": false, "error": "Missing content field" }` | `content` is not a string |
| 400 | `{ "ok": false, "error": "Content too large (max 100KB)" }` | `content` is longer than 100,000 characters |
| 500 | `{ "ok": false, "error": "Failed to write file" }` | Local or gateway write failed |

---

## Cron jobs

Cron routes go through the gateway's `cron.*` RPC methods (`cron.list`, `cron.get`, `cron.add`, `cron.update`, `cron.remove`, `cron.run`, `cron.runs`) over Nerve's persistent gateway WebSocket. The only exception is a manual run of an isolated agent-turn job, which starts a session with the gateway's `sessions_spawn` tool over HTTP (see `POST /api/crons/:id/run`). Job objects and gateway results are passed through as the gateway returns them; Nerve validates only the request fields listed below.

**Rate limit:** General (60/min) on all endpoints.

**Errors:** a failure on the gateway side, and also a malformed JSON body, returns **502** with `{ "ok": false, "error": "<message>" }`. The one exception is `POST /api/crons/:id/toggle`, which treats a missing or malformed body as `{ "enabled": true }` and can return success. A request that fails validation returns **400** with the same body shape.

### `GET /api/crons`

Lists all cron jobs, including disabled ones. The gateway returns at most 200 jobs per page; Nerve follows the pages (up to 50) and returns them as one list. For jobs with a manual run newer than the gateway's `state.lastRunAtMs`, Nerve raises that timestamp.

**Response:**

```json
{ "ok": true, "result": { "jobs": [] } }
```

`result` is the gateway's `cron.list` result with the merged `jobs` array.

### `POST /api/crons`

Creates a cron job.

**Request body:**

```json
{
  "job": {
    "name": "Check email",
    "schedule": { "kind": "cron", "expr": "*/30 * * * *", "tz": "Europe/Berlin" },
    "payload": { "kind": "agentTurn", "message": "Check email" },
    "delivery": { "mode": "announce", "channel": "telegram" },
    "sessionTarget": "isolated",
    "enabled": true
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | 1 to 200 characters |
| `schedule` | `object` | One of `{ "kind": "at", "at": string }`, `{ "kind": "every", "everyMs": number, "anchorMs"?: number }` or `{ "kind": "cron", "expr": string, "tz"?: string }` |
| `payload` | `object` | `{ "kind": "systemEvent", "text": string }` or `{ "kind": "agentTurn", "message": string, "model"?: string, "thinking"?: string, "timeoutSeconds"?: number }` |
| `delivery` | `object` | `{ "mode"?: "none" \| "announce", "channel"?: string, "to"?: string, "bestEffort"?: boolean }` |
| `sessionTarget` | `"main" \| "isolated"` | Where the job runs |
| `sessionKey` | `string` | Max 200 characters. If it looks like `agent:<id>:...`, `agentId` is set from it |
| `agentId` | `string` | Max 200 characters |
| `enabled` | `boolean` | Whether the job is active |

All fields inside `job` are optional for Nerve; the gateway enforces which ones it requires. The flat fields of the old cron tool (`prompt`, `model`, `thinkingLevel`, `channel`, `notify`) are rejected with 400 `Unsupported field(s): ... Use payload (message, model, thinking) and delivery instead.`

**Response:**

```
{ "ok": true, "result": <gateway cron.add result> }
```

### `PATCH /api/crons/:id`

Updates a cron job.

**Request body:**

```json
{ "patch": { "schedule": { "kind": "cron", "expr": "0 9 * * *" } } }
```

`patch` accepts the same fields and validation as `job` above, including the rejection of the legacy flat fields.

**Response:**

```
{ "ok": true, "result": <gateway cron.update result> }
```

### `DELETE /api/crons/:id`

Deletes a cron job.

**Response:**

```
{ "ok": true, "result": <gateway cron.remove result> }
```

### `POST /api/crons/:id/toggle`

Sets a cron job's enabled state with `cron.update`.

**Request body:**

```json
{ "enabled": false }
```

If the body is missing or not valid JSON, `enabled` defaults to `true`. A broken body therefore enables the job and returns success instead of 502, so send valid JSON whenever you mean to disable a job.

**Response:**

```
{ "ok": true, "result": <gateway cron.update result> }
```

### `POST /api/crons/:id/run`

Triggers immediate execution of a cron job. Timeout: 60 seconds.

- For an isolated job (`sessionTarget: "isolated"`) with an `agentTurn` payload and a non-empty message, Nerve starts the run itself with `sessions_spawn` (`mode: "run"`, the job's model, thinking level and agent, label `Cron · <name> · HH:MM`). The run shows up as its own session, and Nerve records it in `~/.openclaw/cron/nerve-manual-runs/<jobId>.jsonl` so it appears in the run history. `result` is the `sessions_spawn` tool result. Writing the history entry is best effort: if the history file cannot be written, Nerve logs a warning and still returns success, so a run that is missing from the history may still have started.
- Any other job is run with `cron.run` in `force` mode.

**Response:**

```
{ "ok": true, "result": ... }
```

### `GET /api/crons/:id/runs`

Returns the last 10 run history entries, newest first, merged from the gateway's `cron.runs` and Nerve's own manual-run records. If the gateway cannot return runs, only the manual entries are shown.

**Response:**

```json
{
  "ok": true,
  "result": {
    "entries": [],
    "total": 0,
    "offset": 0,
    "limit": 10,
    "hasMore": false,
    "nextOffset": null
  }
}
```

Manual-run entries have the shape `{ "ts", "jobId", "action": "spawned", "status": "ok", "summary", "runAtMs", "nextRunAtMs"?, "childSessionKey"?, "runId"?, "manual": true }`. Other entries are the gateway's.

---

## Skills

### `GET /api/skills`

Lists all OpenClaw skills via `openclaw skills list --json` for the selected workspace agent (15-second timeout).

Nerve scopes this by creating a temporary OpenClaw config whose `agents.defaults.workspace` points at the selected agent workspace, then runs the CLI against that workspace.

**Rate limit:** General (60/min)

**Query parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | `string` | No | Workspace agent id. Defaults to `main` |

**Response:**

```json
{
  "ok": true,
  "skills": [
    {
      "name": "web-search",
      "description": "Search the web using Brave Search API",
      "emoji": "🔍",
      "eligible": true,
      "disabled": false,
      "blockedByAllowlist": false,
      "source": "/home/user/.openclaw/skills/web-search",
      "bundled": true,
      "homepage": "https://github.com/example/skill"
    }
  ]
}
```

Skill entries are passed through from the CLI. `homepage` is optional. A skill that cannot run on this host can carry a `missing` object that lists what is absent (`bins`, `anyBins`, `env`, `config`, `os`).

**Errors:** all bodies have the shape `{ "ok": false, "error": "..." }`.

| Status | Condition |
|--------|-----------|
| 400 | `agentId` is not a valid agent id (`Invalid agent id: <id>`) |
| 502 | The CLI is missing, timed out, failed, or printed output that is not a skills list (for example `openclaw CLI not found in PATH`) |

---

## Beads

### `GET /api/beads/:id`

Returns the details of one bead (an issue tracked by the `bd` CLI), read with `bd show <id> --json`. The bead viewer tab uses this. `bd` is looked up through `BD_BIN`, then in `~/.local/bin`, `~/.npm-global/bin`, `~/.volta/bin` and `~/.bun/bin`, then on `PATH`. The command has a 15-second timeout.

**Rate limit:** General (60/min)

**Path parameters:**

| Param | Description |
|-------|-------------|
| `id` | Bead id |

**Query parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `targetPath` | `string` | No | Beads repository to read. Absolute, or relative to the directory of `currentDocumentPath`. A trailing `.beads` segment is stripped. Must stay inside the workspace root |
| `currentDocumentPath` | `string` | No | Workspace file that contains the link. Required when `targetPath` is relative; when `targetPath` is omitted, the nearest parent directory of that file with a `.beads` folder is used (else the file's own directory) |
| `workspaceAgentId` | `string` | No | Agent whose workspace is the root for the path checks. Defaults to `main` |

Without either parameter, the lookup runs in the server's working directory (in the agent's workspace root when `workspaceAgentId` is set and the working directory is outside the default workspace).

**Response:**

```json
{
  "ok": true,
  "bead": {
    "id": "nerve-fms2",
    "title": "Implement read-only bead viewer tab foundation",
    "notes": "Open a bead viewer tab.",
    "status": "in_progress",
    "priority": 1,
    "issueType": "task",
    "owner": "someone",
    "createdAt": "2026-04-06T13:23:33Z",
    "updatedAt": "2026-04-06T13:26:10Z",
    "closedAt": null,
    "closeReason": null,
    "dependencies": [
      { "id": "nerve-qkdo", "title": "Create branch", "status": "closed", "dependencyType": "blocks" }
    ],
    "dependents": [],
    "linkedPlan": {
      "path": ".plans/2026-04-06-bead-viewer-tab-foundation-execution.md",
      "workspacePath": ".plans/2026-04-06-bead-viewer-tab-foundation-execution.md",
      "title": "Bead viewer tab foundation",
      "planId": "plan-bead-viewer-tab-foundation-execution",
      "archived": false,
      "status": "In Progress",
      "updatedAt": 1712409970000
    }
  }
}
```

Only `id` and `title` are always set. `notes`, `status`, `priority`, `issueType`, `owner`, the four timestamp and reason fields are `null` when `bd` does not return them. `linkedPlan` is `null` when no plan in the repository references the bead; its `workspacePath` is the plan path relative to the workspace root, or `null` when the plan lies outside it.

**Errors:** all bodies have the shape `{ "error": "<code>", "details": "<message>" }`.

| Status | `error` | Condition |
|--------|---------|-----------|
| 400 | `invalid_request` | Empty id, a path outside the workspace root, a relative `targetPath` without `currentDocumentPath`, or a repository root that is not a directory |
| 404 | `not_found` | `bd` does not know the bead |
| 502 | `beads_adapter_error` | `bd` is not installed, timed out, failed, or printed unparsable output |

---

## File browser

Browse, read and edit workspace files. Every path is relative to the selected workspace root and is validated before use.

**Rate limit:** None on any File browser route.

**Workspace scope.** All routes accept an optional `agentId` (query parameter, or JSON body field on `POST` and `PUT` routes where the body value wins). If omitted, Nerve uses `main`. The id rule and the 400 error are the same as in [Workspace files](#workspace-files). If `FILE_BROWSER_ROOT` is set to a directory, `agentId` is ignored and every request browses that one root. In that mode `workspaceInfo.isCustomWorkspace` is `true`, the default exclusions below are switched off, `.trash` is hidden, and deletes are permanent. If `FILE_BROWSER_ROOT` is not a directory at startup, Nerve logs a warning and ignores it.

**Path rules.**

- A path must stay inside the workspace root. Absolute paths and `..` traversal are rejected, and after symlinks are resolved the real location must still be inside the real workspace root.
- Every path segment is checked against the exclusion list. A path that does not exist is rejected like an excluded one. Only `GET /api/files/resolve` and `PUT /api/files/write` accept a path that does not exist yet, provided its nearest existing parent is inside the root.
- A rejected path returns 403 `Invalid or excluded path` (400 `Invalid path` for `GET /api/files/tree`).

**Default exclusions** (default workspace only; hidden from listings and rejected in paths, and rejected as new names):

| Rule | Matches |
|------|---------|
| Exact names | `node_modules`, `.git`, `dist`, `build`, `server-dist`, `certs`, `.env`, `agent-log.json` |
| Name pattern | `.env` and `.env.*` (for example `.env.local`) |
| Name suffix | Any name ending in `.log` |

**Binary files.** A file is treated as binary by extension (case-insensitive): `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `svg`, `ico`, `mp3`, `mp4`, `wav`, `ogg`, `flac`, `webm`, `zip`, `tar`, `gz`, `bz2`, `7z`, `rar`, `pdf`, `doc`, `docx`, `xls`, `xlsx`, `exe`, `dll`, `so`, `dylib`, `woff`, `woff2`, `ttf`, `eot`, `sqlite`, `db`. Binary files are listed with `binary: true` but cannot be read or written as text (415).

**Size limit.** The limit is 1,048,576 for both text reads and writes, but it is counted differently. A local read is rejected (413) when the file is larger than 1,048,576 bytes. A write is rejected (413) when `content` is longer than 1,048,576 characters (JavaScript string length, not bytes). Multibyte text can therefore be accepted by a write and still be too large to read back: 600,000 `é` characters write successfully, but the resulting 1,200,000-byte file returns 413 on read.

**Errors.** File browser errors are JSON: `{ "ok": false, "error": "<message>" }`. Failures from rename, move, trash and restore also include `"code"` (a machine-readable string, listed per route). Routes that do not support remote workspaces answer 501 with `"code": "REMOTE_WORKSPACE"`.

**Remote workspaces.** Remote workspaces (see [Workspace files](#workspace-files)) only expose top-level files through the gateway. `tree`, `read` and `write` work on the gateway's top-level files only (the per-route notes below give the details), `raw` returns 404, and `resolve`, `rename`, `move`, `trash` and `restore` return 501. Responses that came from the gateway carry `"remoteWorkspace": true`.

**Change notifications.** File changes on disk are announced on the SSE stream as `file.changed` events with `{ path, agentId }` (see [Events (SSE)](#events-sse)). The watcher covers each agent workspace (not `FILE_BROWSER_ROOT`), ignores binary files, excluded names and any path with a segment that starts with `.`, debounces per path (500 ms), and is off when the main workspace is remote. `NERVE_WATCH_WORKSPACE_RECURSIVE=false` turns off the recursive workspace watch; `MEMORY.md` and `memory/*.md` still notify.

### `GET /api/files/tree`

Lists the entries of one workspace directory, optionally expanding nested directories. Listings are bounded and paged.

**Rate limit:** None

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|------------------|-------------|
| `path` | `string` | Workspace root | Relative directory path to list |
| `depth` | `number` | `1` | Levels to expand, clamped to 1 to 5. At `1`, directories have `children: null` |
| `limit` | `number` | `1000` | Entries per directory page. Positive integer, capped at `5000`. Missing, invalid or non-positive values use the default |
| `cursor` | `string` | `0` | Zero-based offset into the directory's sorted listing. Pass the `nextCursor` of the previous page. Invalid or non-positive values mean `0` |
| `showHidden` | `string` | `false` | `true` includes entries whose name starts with `.` |
| `agentId` | `string` | `main` | Workspace agent id |

**Response:**

```json
{
  "ok": true,
  "root": ".",
  "entries": [
    {
      "name": "memory",
      "path": "memory",
      "type": "directory",
      "children": null
    },
    {
      "name": "logo.png",
      "path": "logo.png",
      "type": "file",
      "size": 2048,
      "mtime": 1771355007542,
      "binary": true
    },
    {
      "name": "MEMORY.md",
      "path": "MEMORY.md",
      "type": "file",
      "size": 128,
      "mtime": 1771355007542
    }
  ],
  "totalEntries": 3,
  "returnedEntries": 3,
  "limit": 1000,
  "cursor": 0,
  "truncated": false,
  "workspaceInfo": {
    "isCustomWorkspace": false,
    "rootPath": "/home/user/.openclaw/workspace"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `root` | `string` | The requested `path`, or `.` for the workspace root |
| `entries` | `array` | Entries of this page (see entry fields below) |
| `totalEntries` | `number` | Number of visible entries in the requested directory (after exclusions and hidden filtering), not only this page |
| `returnedEntries` | `number` | Number of top-level entries in `entries` |
| `limit` | `number` | Effective page size |
| `cursor` | `number` | Effective start offset (clamped to `totalEntries`) |
| `truncated` | `boolean` | `true` when `nextCursor` is present or the response-wide entry budget ran out anywhere in the response |
| `nextCursor` | `string` | Offset of the first entry not returned. Omitted when there is nothing more |
| `workspaceInfo` | `object` | `{ isCustomWorkspace: boolean, rootPath: string }`. `rootPath` is the absolute workspace root |
| `remoteWorkspace` | `boolean` | Present and `true` only for remote workspaces |

**Entry fields:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | File or directory name |
| `path` | `string` | Path relative to the workspace root |
| `type` | `string` | `file` or `directory` |
| `size` | `number` | Files only. Size in bytes |
| `mtime` | `number` | Files only. Modification time in epoch milliseconds |
| `binary` | `boolean` | Files only. Present (as `true`) only for binary files |
| `children` | `array` or `null` | Directories only. `null` when not expanded, `[]` for an empty directory, otherwise the nested entries |
| `childrenTruncated` | `boolean` | Directories only. `true` when the nested listing, or something below it, was cut short by `limit` or the response budget |
| `childrenNextCursor` | `string` | Directories only. Present when the directory's own listing has more entries; offset to resume from |

**What is listed.**

- Only regular files and directories. Symlinks, sockets, FIFOs and devices are omitted.
- Order: directories first, then files, each sorted by name case-insensitively.
- Names starting with `.` are omitted unless `showHidden=true`. `.nerveignore` and `.trash` are always listed, except that `.trash` is never listed when `FILE_BROWSER_ROOT` is set.
- Inside `.trash`, every entry is listed except the index file `.index.json`.
- The default exclusions listed above are omitted (none are applied when `FILE_BROWSER_ROOT` is set).

**Paging.** `cursor` is an offset into the sorted listing of the single directory named by `path`. To get the next page, repeat the request with `cursor` set to the previous `nextCursor`. With `depth` above 1, nested directories are listed from offset 0 using the same `limit`. A nested directory that did not fit gets `childrenTruncated: true` and, if its own listing has more entries, `childrenNextCursor`. Fetch the rest with `?path=<that directory's path>&cursor=<childrenNextCursor>`.

**Caps.** Two limits apply. `limit` bounds each directory page (default 1000, maximum 5000). A response-wide budget bounds the total number of entries returned across all levels: `FILE_BROWSER_MAX_TREE_ENTRIES`, default 5000 (an invalid or non-positive value falls back to 5000). Each directory and each file spends one unit. When the budget runs out the listing stops and `truncated` is `true`. If entries of the requested directory itself were dropped, `nextCursor` points at the first one that was not returned, so paging does not skip entries. If the budget runs out only inside a nested directory, the root has `truncated: true` but no `nextCursor`, and the missing entries are reached through that directory's `childrenNextCursor`. A client that needs the complete listing must follow the root `nextCursor` and also page every nested directory that carries `childrenNextCursor` (see Paging above). A directory with `childrenTruncated: true` and no `childrenNextCursor` has a directory further down that carries one.

**Remote workspaces.** Entries are the gateway's top-level files (all `type: "file"`; hidden names follow `showHidden`), paged with `limit` and `cursor`. A non-empty `path`, or a gateway failure, returns 200 with an empty `entries` list.

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "ok": false, "error": "Invalid path" }` | `path` is outside the workspace, excluded, a broken symlink, or does not exist |
| 400 | `{ "ok": false, "error": "Not a directory" }` | `path` is a file |
| 400 | `{ "ok": false, "error": "Invalid agent id: <id>" }` | `agentId` fails the id rule |
| 404 | `{ "ok": false, "error": "Directory not found" }` | The directory disappeared between validation and listing |
| 500 | `{ "ok": false, "error": "<message>" }` | The workspace could not be resolved for another reason |

### `GET /api/files/resolve`

Maps a path found in text (a markdown link, a path printed by an agent) to a workspace-relative path and reports whether it is a file or a directory. The client uses it to open a file or reveal a folder. It does not read file contents.

**Rate limit:** None

**Query parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | Yes | The path to resolve |
| `relativeTo` | `string` | No | Workspace path of the document the link came from. Relative `path` values are resolved against this document's directory |
| `agentId` | `string` | No | Workspace agent id. Defaults to `main` |

**Resolution rules**, applied in order:

1. Backslashes in `path` become `/`.
2. `/workspace` and `/workspace/<rest>` are treated as relative to the workspace root, whatever `relativeTo` says.
3. An absolute path that starts with the workspace root (or its symlink-resolved real path) is made relative to it. The root itself becomes `.`.
4. Otherwise, with `relativeTo`: a path with a leading `/` is relative to the workspace root (leading slashes are removed), and any other path is joined to the directory of `relativeTo` (which is normalised the same way).
5. Otherwise the path is used as given, relative to the workspace root.

The result goes through the standard path rules, except that the target may be missing, so a missing file yields 404 rather than 403. Hidden files resolve.

**Response:**

```json
{ "ok": true, "path": "docs/guide/advanced.md", "type": "file", "binary": false }
```

| Field | Type | Description |
|-------|------|-------------|
| `path` | `string` | Workspace-relative path using `/` separators |
| `type` | `string` | `file` or `directory` |
| `binary` | `boolean` | `true` for a file with a binary extension; always `false` for directories |

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "ok": false, "error": "Missing path parameter" }` | `path` is missing or empty |
| 400 | `{ "ok": false, "error": "Invalid agent id: <id>" }` | `agentId` fails the id rule |
| 403 | `{ "ok": false, "error": "Invalid or excluded path" }` | Traversal, excluded name, or a symlink that leaves the workspace |
| 404 | `{ "ok": false, "error": "Path not found" }` | The target does not exist, or resolves to the workspace root itself |
| 501 | `{ "ok": false, "error": "Not supported for remote workspaces", "code": "REMOTE_WORKSPACE" }` | Remote workspace |

### `GET /api/files/read`

Reads a text file with its modification time, for conflict detection on save.

**Rate limit:** None

**Query parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | Yes | Relative path within the selected workspace |
| `agentId` | `string` | No | Workspace agent id. Defaults to `main` |

**Response:**

```json
{
  "ok": true,
  "content": "# MEMORY.md\n...",
  "size": 128,
  "mtime": 1771355007542
}
```

`size` is in bytes and `mtime` in epoch milliseconds. For a remote workspace the response also contains `"remoteWorkspace": true`.

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "ok": false, "error": "Missing path parameter" }` | `path` is missing or empty |
| 400 | `{ "ok": false, "error": "Invalid agent id: <id>" }` | `agentId` fails the id rule |
| 400 | `{ "ok": false, "error": "Not a file" }` | `path` is a directory whose name has no binary extension (the binary check runs first, so a directory named like `dir.png` gets 415) |
| 403 | `{ "ok": false, "error": "Invalid or excluded path" }` | Traversal, excluded name, symlink leaving the workspace, or the path does not exist |
| 404 | `{ "ok": false, "error": "File not found" }` | The file disappeared after validation. For remote workspaces: not found, or `path` is not a top-level file name (response also has `"remoteWorkspace": true`) |
| 413 | `{ "ok": false, "error": "File too large (<n>KB, max 1MB)" }` | File is larger than 1 MB |
| 415 | `{ "ok": false, "error": "Binary file", "binary": true }` | Extension is in the binary list |
| 500 | `{ "ok": false, "error": "Failed to read file" }` | Read failed |

### `PUT /api/files/write`

Writes a text file with optimistic concurrency. If `expectedMtime` is sent and the file's current modification time differs, the write is refused with 409. Missing parent directories are created. A file that does not exist yet cannot conflict.

Unlike `read`, this route does not check that the workspace directory exists (only `NERVE_WORKSPACE_REMOTE=true` forces remote mode), so the first write can bootstrap a fresh agent workspace.

**Rate limit:** None

**Request body:**

```json
{
  "path": "MEMORY.md",
  "content": "# Updated content\n...",
  "expectedMtime": 1771355007542,
  "agentId": "research"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | Yes | Relative file path within the selected workspace |
| `content` | `string` | Yes | UTF-8 file contents. At most 1,048,576 characters |
| `expectedMtime` | `number` | No | Modification time from the last read. Ignored unless it is a number |
| `agentId` | `string` | No | Workspace agent id. Falls back to the `agentId` query parameter, then `main` |

**Response:**

```json
{
  "ok": true,
  "mtime": 1771355107000
}
```

For a remote workspace the response is `{ "ok": true, "remoteWorkspace": true, "mtime": <now> }`, where `mtime` is the time of the write and no conflict check is made.

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "ok": false, "error": "Invalid JSON body" }` | Body is not valid JSON |
| 400 | `{ "ok": false, "error": "Missing path" }` | `path` is missing or not a string |
| 400 | `{ "ok": false, "error": "Missing or invalid content" }` | `content` is not a string |
| 400 | `{ "ok": false, "error": "Invalid agent id: <id>" }` | `agentId` fails the id rule |
| 403 | `{ "ok": false, "error": "Invalid or excluded path" }` | Traversal, excluded name, or a symlink leaving the workspace |
| 409 | `{ "ok": false, "error": "File was modified since you loaded it", "currentMtime": <number> }` | `expectedMtime` differs from the file's current modification time |
| 413 | `{ "ok": false, "error": "Content too large (max 1MB)" }` | `content` is longer than 1,048,576 characters |
| 415 | `{ "ok": false, "error": "Cannot write binary files" }` | Extension is in the binary list |
| 501 | `{ "ok": false, "error": "Not supported for remote workspaces", "code": "REMOTE_WORKSPACE" }` | Remote workspace and `path` is not a top-level file name |
| 500 | `{ "ok": false, "error": "Failed to write file" }` | Write failed |
| 500 | `{ "error": "Internal server error" }` | Creating the parent directory failed (for example a parent of `path` is an existing file). This is the global error handler's body, without `ok` |

### `POST /api/files/rename`

Renames a file or directory within its current directory.

**Rate limit:** None

**Request body:**

```json
{ "path": "notes/today.md", "newName": "tomorrow.md", "agentId": "research" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | Yes | Existing relative path |
| `newName` | `string` | Yes | New name for the last path segment. Trimmed; not `.` or `..`; no `/` or `\`; no control characters; at most 255 bytes (UTF-8); not an excluded name |
| `agentId` | `string` | No | Workspace agent id. Falls back to the `agentId` query parameter, then `main` |

**Response:**

```json
{ "ok": true, "from": "notes/today.md", "to": "notes/tomorrow.md" }
```

`from` and `to` are workspace-relative paths. Renaming to the current name succeeds without changing anything.

**Errors:**

| Status | Code | Body `error` | Condition |
|--------|------|--------------|-----------|
| 400 | none | `Invalid JSON body`, `Missing path`, `Missing newName` | Malformed request |
| 400 | none | `Invalid agent id: <id>` | `agentId` fails the id rule |
| 400 | `invalid_name` | `Name cannot be empty`, `Invalid name`, `Name cannot include path separators`, `Name contains unsupported control characters`, `Name is too long (max 255 bytes)` | `newName` is not allowed |
| 403 | none | `Invalid or excluded path` | `path` is outside the workspace, excluded, or does not exist |
| 403 | `invalid_path` | `Invalid or excluded path` | The new path is not valid (for example `newName` starts with `..`) |
| 403 | `excluded_name` | `Name is not allowed` | `newName` is an excluded name |
| 404 | `not_found` | `Path not found` | The source disappeared after validation |
| 409 | `conflict` | `A file or folder with this name already exists` | Target name is taken |
| 422 | `protected_path` | `This path is protected` | `path` is the `.trash` root |
| 422 | `protected_path` | `Cannot target reserved .trash root path` | The new path would be the `.trash` root |
| 501 | `REMOTE_WORKSPACE` | `Not supported for remote workspaces` | Remote workspace |
| 500 | none | The error message, or `Operation failed` | Other failure |

Error bodies have the form `{ "ok": false, "error": "<error>", "code": "<code>" }`; `code` is omitted where the table says none.

### `POST /api/files/move`

Moves a file or directory into another directory. The name is kept.

**Rate limit:** None

**Request body:**

```json
{ "sourcePath": "notes/today.md", "targetDirPath": "archive", "agentId": "research" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sourcePath` | `string` | Yes | Existing relative path to move |
| `targetDirPath` | `string` | Yes | Existing target directory. An empty string means the workspace root |
| `agentId` | `string` | No | Workspace agent id. Falls back to the `agentId` query parameter, then `main` |

**Response:**

```json
{ "ok": true, "from": "notes/today.md", "to": "archive/today.md" }
```

Moving an item to where it already is succeeds without changing anything. Moving an item out of `.trash` drops its restore record.

**Errors:**

| Status | Code | Body `error` | Condition |
|--------|------|--------------|-----------|
| 400 | none | `Invalid JSON body`, `Missing sourcePath`, `Missing targetDirPath` | Malformed request (`targetDirPath` must be a string, but may be empty) |
| 400 | none | `Invalid agent id: <id>` | `agentId` fails the id rule |
| 400 | `target_not_directory` | `Target must be a directory` | `targetDirPath` is a file |
| 403 | none | `Invalid or excluded path` | Source or target is outside the workspace, excluded, or does not exist |
| 404 | `not_found` | `Path not found` | Source or target disappeared after validation |
| 409 | `conflict` | `A file or folder with this name already exists` | The target directory already has an item with that name |
| 422 | `protected_path` | `This path is protected` or `Cannot target reserved .trash root path` | Source is the `.trash` root, or the destination path would be the `.trash` root |
| 422 | `use_trash_api` | `Use the trash action for deleting items` | Moving into `.trash` (default workspace only; allowed with `FILE_BROWSER_ROOT`) |
| 422 | `invalid_move` | `Cannot move a folder into itself` | Target is the folder or one of its descendants |
| 501 | `REMOTE_WORKSPACE` | `Not supported for remote workspaces` | Remote workspace |
| 500 | none | The error message, or `Operation failed` | Other failure |

### `POST /api/files/trash`

Moves a file or directory into the workspace's `.trash` directory. This is not the operating system trash. Items are renamed to `<name>--<8 hex digits><ext>` (directories: `<name>--<8 hex digits>`), and `.trash/.index.json` records the original path, deletion time and type of each item. Nerve does not empty `.trash` automatically.

If `FILE_BROWSER_ROOT` is set, there is no trash: the path is deleted permanently (recursively, for directories).

**Rate limit:** None

**Request body:**

```json
{ "path": "notes/today.md", "agentId": "research" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | Yes | Existing relative path to trash |
| `agentId` | `string` | No | Workspace agent id. Falls back to the `agentId` query parameter, then `main` |

**Response:**

```json
{ "ok": true, "from": "notes/today.md", "to": ".trash/today--a1b2c3d4.md", "undoTtlMs": 10000 }
```

`undoTtlMs` (10,000) is how long the UI offers an undo. The server does not enforce it; use `to` with `POST /api/files/restore` at any time. With `FILE_BROWSER_ROOT` set the response is `{ "ok": true, "from": "<path as sent>", "to": "" }`.

**Errors:**

| Status | Code | Body `error` | Condition |
|--------|------|--------------|-----------|
| 400 | none | `Invalid JSON body`, `Missing path` | Malformed request |
| 400 | none | `Invalid agent id: <id>` | `agentId` fails the id rule |
| 400 | none | `Deleting workspace root is not allowed` | `FILE_BROWSER_ROOT` mode and `path` is `.`, `./` or resolves to the root |
| 403 | none | `Invalid or excluded path` | `path` is outside the workspace, excluded, or does not exist |
| 404 | `not_found` | `Path not found` | The item disappeared after validation |
| 422 | `protected_path` | `This path is protected` | `path` is the `.trash` root |
| 422 | `already_in_trash` | `Path is already in trash` | `path` is inside `.trash` |
| 422 | `trash_path_conflict` | `Reserved .trash path is not a directory` | A file named `.trash` is in the way |
| 501 | `REMOTE_WORKSPACE` | `Not supported for remote workspaces` | Remote workspace |
| 500 | `trash_index_write_failed` | `Failed to persist trash index` | The index file could not be written |
| 500 | `trash_name_generation_failed` | `Failed to allocate trash path` | No free trash name after 100 attempts |
| 500 | none | The error message, or `Operation failed` | Other failure |

### `POST /api/files/restore`

Restores an item from `.trash` to its original location, creating missing parent directories.

**Rate limit:** None

**Request body:**

```json
{ "path": ".trash/today--a1b2c3d4.md", "agentId": "research" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | Yes | Path inside `.trash`, as returned in `to` by the trash route |
| `agentId` | `string` | No | Workspace agent id. Falls back to the `agentId` query parameter, then `main` |

**Response:**

```json
{ "ok": true, "from": ".trash/today--a1b2c3d4.md", "to": "notes/today.md" }
```

**Errors:**

| Status | Code | Body `error` | Condition |
|--------|------|--------------|-----------|
| 400 | none | `Invalid JSON body`, `Missing path` | Malformed request |
| 400 | none | `Invalid agent id: <id>` | `agentId` fails the id rule |
| 403 | none | `Invalid or excluded path` | `path` is outside the workspace, excluded, or does not exist |
| 403 | `invalid_path` | `Invalid or excluded path` | The original path recorded in the trash index no longer validates |
| 404 | `restore_metadata_missing` | `Restore metadata not found for this item` | The item has no record in `.trash/.index.json` |
| 409 | `conflict` | `A file or folder with this name already exists` | Something already exists at the original path |
| 422 | `not_restorable` | `Only trashed items can be restored` | `path` is outside `.trash`, or is the `.trash` root |
| 422 | `trash_path_conflict` | `Reserved .trash path is not a directory` | A file named `.trash` is in the way |
| 501 | `REMOTE_WORKSPACE` | `Not supported for remote workspaces` | Remote workspace |
| 500 | `trash_index_write_failed` | `Failed to persist trash index` | The index file could not be updated |
| 500 | none | The error message, or `Operation failed` | Other failure |

### `GET /api/files/raw`

Serves an image or PDF from the selected workspace for previews. The response is streamed and is not compressed.

**Rate limit:** None

**Query parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | Yes | Relative path of the file |
| `agentId` | `string` | No | Workspace agent id. Defaults to `main` |

**Supported types and size limits:**

| Extension | `Content-Type` | Maximum size |
|-----------|----------------|--------------|
| `.png` | `image/png` | 10 MB (10,485,760 bytes) |
| `.jpg`, `.jpeg` | `image/jpeg` | 10 MB |
| `.gif` | `image/gif` | 10 MB |
| `.webp` | `image/webp` | 10 MB |
| `.avif` | `image/avif` | 10 MB |
| `.svg` | `image/svg+xml` | 10 MB |
| `.ico` | `image/x-icon` | 10 MB |
| `.pdf` | `application/pdf` | 50 MB (52,428,800 bytes) |

**Response:** the file bytes, with `Content-Type`, `Content-Length` and `Cache-Control: no-cache`. SVG responses also carry `Content-Security-Policy: sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:`, which replaces the app-wide policy for that response.

For PDFs the response also has `Accept-Ranges: bytes`, and a single `Range` header of the form `bytes=<start>-<end>`, `bytes=<start>-` or `bytes=-<suffix length>` returns `206 Partial Content` with `Content-Range: bytes <start>-<end>/<size>`. A range that cannot be served returns `416` with an empty body and `Content-Range: bytes */<size>`. That includes a range whose `<end>` is at or beyond the file size: Nerve does not clamp the end, so `bytes=0-65535` on a 1,000-byte PDF gets `416` even though it overlaps the file, and `bytes=0-` or `bytes=0-999` is the form to use. It also includes a `<start>` greater than `<end>` and a suffix length of `0`. `Range` is ignored for other file types, and a malformed `Range` value is ignored (the whole file is returned).

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "ok": false, "error": "Missing path parameter" }` | `path` is missing or empty |
| 400 | `{ "ok": false, "error": "Invalid agent id: <id>" }` | `agentId` fails the id rule |
| 400 | `{ "ok": false, "error": "Not a file" }` | `path` is a directory whose name has a supported extension (the extension check runs first, so other directories get 415) |
| 403 | `{ "ok": false, "error": "Invalid or excluded path" }` | Traversal, excluded name, symlink leaving the workspace, or the path does not exist |
| 404 | `{ "ok": false, "error": "Binary files not available for remote workspaces", "remoteWorkspace": true }` | Remote workspace |
| 413 | `{ "ok": false, "error": "File too large (max 10MB)" }` or `(max 50MB)` for PDFs | File exceeds the size limit |
| 415 | `{ "ok": false, "error": "Unsupported file type" }` | Extension is not in the table above |
| 416 | Empty | Unsatisfiable PDF range |
| 500 | `{ "ok": false, "error": "Failed to read file" }` | Read failed |

---

## File serving

### `GET /api/files`

Serves local image files by absolute path, for images that chat messages and memory files reference. Access is limited to image types and a short list of directories. See [SECURITY.md](./SECURITY.md#file-serving) for the full threat model.

**Rate limit:** None

**Query parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | Yes | Absolute path to the image file. A leading `~` is replaced with the server user's home directory |

```
GET /api/files?path=/tmp/screenshot.png
GET /api/files?path=~/.openclaw/workspace/memory/image.jpg
```

**Allowed file types:**

| Extension | `Content-Type` |
|-----------|----------------|
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.webp` | `image/webp` |
| `.svg` | `image/svg+xml` |
| `.avif` | `image/avif` |

**Allowed directory prefixes:** `/tmp`, `~/.openclaw`, and the configured `MEMORY_DIR` (default `~/.openclaw/workspace/memory`). The path is resolved first (so `..` cannot escape), checked against the prefixes, then resolved through symlinks and checked again. Each prefix is also accepted in its real-path form (for example `/tmp` is `/private/tmp` on macOS).

**Response:** the raw image bytes with `Content-Type` and `Content-Length`. SVG files are sent with `Content-Disposition: attachment` so a browser downloads them instead of rendering embedded scripts. The handler sets `Cache-Control: public, max-age=3600`, but the global API cache middleware replaces it, so clients receive `Cache-Control: no-cache`. There is no file size limit; the whole file is read into memory.

**Errors:** plain text bodies (`text/plain`), not JSON.

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `Missing path parameter` | `path` is missing or empty |
| 403 | `Not an allowed file type` | Extension is not in the table above (checked before the file is looked up) |
| 403 | `Access denied` | Path is outside the allowed directories, before or after symlink resolution |
| 404 | `Not found` | The file does not exist |
| 500 | `Failed to read file` | Read failure |

---

## Chat media

### `GET /api/chat-media`

Proxies an image that the gateway hosts for a chat reply. When an agent delivers a generated image as an attachment, the gateway stores it and puts an image block in the assistant message whose `url` is a gateway path such as `/api/chat/media/outgoing/<sessionKey>/<id>/full`. That path needs the gateway token, which the browser never holds, so the client loads it through this route and Nerve fetches it with the token.

**Rate limit:** General (60/min)

**Query parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | Yes | Gateway media path of the form `/api/chat/media/outgoing/<sessionKey>/<mediaId>/<variant>` |

Only that one path shape is accepted: the session key segment may contain `A-Za-z0-9%._~-`, the media id `A-Za-z0-9_-`, and the variant lowercase letters (for example `full`). Query strings, fragments and dot segments (including percent-encoded ones) are refused.

```
GET /api/chat-media?path=%2Fapi%2Fchat%2Fmedia%2Foutgoing%2Fagent%253Amain%253Amain%2Fa1b2c3%2Ffull
```

**Behaviour.** Nerve sends `GET <gateway HTTP origin><path>` with `Authorization: Bearer <gateway token>`. A `ws://` or `wss://` `GATEWAY_URL` is converted to `http://` or `https://`. Redirects are not followed and the request times out after 30 seconds. The token is only used for trusted clients: when Nerve auth is enabled (the auth middleware has already checked the session), or when the client is on a loopback address (`X-Forwarded-For` and `X-Real-IP` are honoured only if the direct connection is loopback).

**Response:** 200 with the image bytes. Only `image/png`, `image/jpeg`, `image/gif`, `image/webp` and `image/avif` are passed through (SVG is refused because it could run script from Nerve's origin). Headers: `Content-Type` (the gateway's type without parameters), `X-Content-Type-Options: nosniff`, `Content-Length` when the gateway sent one, and `Cache-Control: no-cache` from the global API cache middleware.

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "ok": false, "error": "Not a chat media path" }` | `path` is missing or does not match the accepted shape |
| 403 | `{ "ok": false, "error": "Chat media is only served to trusted clients" }` | Nerve auth is off and the client is not on loopback |
| 404 | `{ "ok": false, "error": "Media not found" }` | The gateway answered 404 |
| 502 | `{ "ok": false, "error": "Gateway unreachable" }` | The request to the gateway failed or timed out |
| 502 | `{ "ok": false, "error": "Gateway did not return an image" }` | The gateway answered with another non-success status (redirects included) or a `Content-Type` outside the list above |
| 503 | `{ "ok": false, "error": "Gateway token is not configured" }` | Nerve has no gateway token |

Checks run in this order: path shape (400), gateway token (503), trusted client (403), then the gateway request.

---

## Uploads

These routes support chat attachments. The client reads the upload policy from `GET /api/upload-config`, and can ask `POST /api/upload-reference/resolve` to turn a workspace file, or an uploaded file, into a canonical file reference.

### `GET /api/upload-config`

Returns the attachment policy: which upload modes are on and the limits for inline images. Every value comes from an environment variable and falls back to a default.

**Rate limit:** General (60/min)

**Response:**

```json
{
  "twoModeEnabled": false,
  "inlineEnabled": true,
  "fileReferenceEnabled": false,
  "modeChooserEnabled": false,
  "inlineAttachmentMaxMb": 4,
  "inlineImageContextMaxBytes": 32768,
  "inlineImageAutoDowngradeToFileReference": true,
  "inlineImageShrinkMinDimension": 512,
  "inlineImageMaxDimension": 2048,
  "inlineImageWebpQuality": 82,
  "exposeInlineBase64ToAgent": false
}
```

| Field | Type | Default | Environment variable | Meaning |
|-------|------|---------|----------------------|---------|
| `twoModeEnabled` | `boolean` | `false` | `NERVE_UPLOAD_TWO_MODE_ENABLED` | One of the four flags (with `inlineEnabled`, `fileReferenceEnabled` and `modeChooserEnabled`) that must all be `true` for the client to show its upload mode chooser. Also lets the file picker accept any file type |
| `inlineEnabled` | `boolean` | `true` | `NERVE_UPLOAD_INLINE_ENABLED` | Attachments can be sent inline in the message |
| `fileReferenceEnabled` | `boolean` | `false` | `NERVE_UPLOAD_FILE_REFERENCE_ENABLED` | Attachments can be sent as workspace file references. Also enables attaching by path and "Add to chat" in the file browser, and lets the file picker accept any file type |
| `modeChooserEnabled` | `boolean` | `false` | `NERVE_UPLOAD_MODE_CHOOSER_ENABLED` | One of the four flags required for the client to show its upload mode chooser (see `twoModeEnabled`) |
| `inlineAttachmentMaxMb` | `number` | `4` | `NERVE_UPLOAD_INLINE_ATTACHMENT_MAX_MB` | Size cap in MB for inline attachments that are not images |
| `inlineImageContextMaxBytes` | `number` | `32768` | `NERVE_UPLOAD_INLINE_IMAGE_CONTEXT_MAX_BYTES` | Size budget in bytes for an inline image. Larger images are shrunk adaptively |
| `inlineImageAutoDowngradeToFileReference` | `boolean` | `true` | `NERVE_UPLOAD_INLINE_IMAGE_AUTO_DOWNGRADE_TO_FILE_REFERENCE` | When shrinking cannot reach the budget, fall back to a file reference (needs `fileReferenceEnabled` and an image that exists at a server path) |
| `inlineImageShrinkMinDimension` | `number` | `512` | `NERVE_UPLOAD_INLINE_IMAGE_SHRINK_MIN_DIMENSION` | Smallest dimension in pixels that shrinking goes down to |
| `inlineImageMaxDimension` | `number` | `2048` | `NERVE_UPLOAD_IMAGE_OPTIMIZATION_MAX_DIMENSION` | Largest dimension in pixels used when optimizing an image |
| `inlineImageWebpQuality` | `number` | `82` | `NERVE_UPLOAD_IMAGE_OPTIMIZATION_WEBP_QUALITY` | WebP quality used when re-encoding images |
| `exposeInlineBase64ToAgent` | `boolean` | `false` | `NERVE_UPLOAD_EXPOSE_INLINE_BASE64_TO_AGENT` | Keeps the inline base64 data in the upload descriptor sent to the agent |

Boolean variables accept `1`, `true`, `yes`, `on`, `0`, `false`, `no` and `off` (case-insensitive, trimmed). Any other value, or an unset variable, gives the default. Number variables must be finite and greater than 0 (fractions are allowed); otherwise the default is used.

**Errors:** none specific to this route.

### `POST /api/upload-reference/resolve`

Turns attachments into canonical workspace file references. It accepts either workspace paths (JSON), which are validated and returned as references to the existing files, or file uploads (multipart), which are staged inside the workspace first. The reference gives the agent a path it can open.

**Rate limit:** General (60/min)

The request mode is chosen by the `Content-Type` header: JSON when it contains `application/json`, otherwise the body is parsed as form data.

**Request body:**

JSON mode:

```json
{ "paths": ["docs/note.md", "images/shot.png"], "agentId": "research" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `paths` | `string[]` | One of `paths` or `path` | Relative workspace paths. Entries that are not strings, or are blank, are dropped. Takes precedence over `path` when it is an array |
| `path` | `string` | One of `paths` or `path` | A single relative workspace path |
| `agentId` | `string` | No | Workspace agent id for resolving the paths. When omitted, the root is `FILE_BROWSER_ROOT` if set, otherwise the main workspace. When sent, `FILE_BROWSER_ROOT` is not used |

Each path goes through the standard File browser path rules (inside the workspace root, no excluded names, symlinks must not leave the root). The target must exist and be a file.

Multipart mode: `multipart/form-data` with one or more file parts named `files` or `file` (both names are read, `files` first). Other parts are ignored. `agentId` is not read; uploads always go to the main workspace root (or `FILE_BROWSER_ROOT`). Each file is saved to:

```
<workspace root>/.temp/nerve-uploads/<YYYY>/<MM>/<DD>/<name>-<8 hex digits><ext>
```

The date is UTC. The upload directory can be moved with `NERVE_UPLOAD_STAGING_TEMP_DIR` (a leading `~/` is expanded), but it must stay inside the workspace root. `<name>` is the original file name reduced to its basename, with runs of characters outside `A-Za-z0-9._-` replaced by `-` and leading or trailing `-` removed (`upload.bin` if nothing is left). The route has no size limit of its own; the global request body limit applies (about 13 MB, answered with 413 and the plain text `Request body too large`). Files are not removed after staging.

**Response:**

```json
{
  "ok": true,
  "items": [
    {
      "kind": "direct_workspace_reference",
      "canonicalPath": "docs/note.md",
      "absolutePath": "/home/user/.openclaw/workspace/docs/note.md",
      "uri": "file:///home/user/.openclaw/workspace/docs/note.md",
      "mimeType": "text/markdown",
      "sizeBytes": 5,
      "originalName": "note.md"
    }
  ]
}
```

`items` has one entry per input, in input order.

| Field | Type | Description |
|-------|------|-------------|
| `kind` | `string` | `direct_workspace_reference` for JSON paths, `imported_workspace_reference` for uploaded files |
| `canonicalPath` | `string` | Path relative to the workspace root, with `/` separators |
| `absolutePath` | `string` | Real absolute path on the Nerve host (symlinks resolved) |
| `uri` | `string` | `file://` URI of `absolutePath` |
| `mimeType` | `string` | For uploads, the part's content type when set. Otherwise inferred from the file extension: `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `svg`, `ico`, `txt`, `md`, `json`, `pdf`, `mov` and `mp4` are known, anything else is `application/octet-stream` |
| `sizeBytes` | `number` | File size in bytes |
| `originalName` | `string` | Basename of the path, or the uploaded file's name |

**Errors:** all bodies are `{ "ok": false, "error": "<message>" }`. The request fails as a whole if any one input fails.

| Status | `error` | Condition |
|--------|---------|-----------|
| 400 | `At least one workspace path is required.` | JSON mode without a usable `paths` or `path`, or a body that is not valid JSON |
| 400 | `At least one file is required.` | Form data without any file part |
| 400 | `Invalid agent id: <id>` | `agentId` fails the id rule (see [Workspace files](#workspace-files)) |
| 400 | `Resolved attachment path is not a file.` | A path points to a directory |
| 403 | `Invalid or excluded workspace path.` | Path is outside the workspace, excluded, escapes through a symlink, or does not exist |
| 403 | `Resolved attachment path is outside the workspace root.` | The real path is outside the workspace root, or the staging directory is outside it |
| 500 | The error message, or `Failed to resolve canonical upload reference` | Any other failure, including a request that is neither JSON nor form data (message from the runtime, for example `Content-Type was not one of "multipart/form-data" or "application/x-www-form-urlencoded".`) |

---

## Codex limits

### `GET /api/codex-limits`

Returns OpenAI Codex rate limit information. Tries the ChatGPT usage API first (needs the access token in `~/.codex/auth.json`), then falls back to the newest local Codex session files (`~/.codex/sessions/**/*.jsonl`, latest 10 files). Results are cached for 5 minutes (30 seconds after an unavailable result).

**Rate limit:** None

**Response:**

```json
{
  "available": true,
  "source": "api",
  "five_hour_limit": {
    "used_percent": 45.2,
    "left_percent": 54.8,
    "resets_at": 1708110000,
    "resets_at_formatted": "14:00"
  },
  "weekly_limit": {
    "used_percent": 12.0,
    "left_percent": 88.0,
    "resets_at": 1708300000,
    "resets_at_formatted": "Feb 17, 14:00"
  },
  "credits": {
    "has_credits": true,
    "unlimited": false,
    "balance": 50.0
  },
  "plan_type": "pro"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `available` | `boolean` | `false` when no data source worked |
| `source` | `"api" \| "local"` | Where the numbers came from |
| `*_limit.resets_at` | `number \| null` | Reset time in epoch **seconds** |
| `*_limit.resets_at_formatted` | `string \| null` | 24-hour time on the server, with day and month for the weekly window |
| `credits.balance` | `number \| null` | Credit balance, when reported |
| `plan_type` | `string \| null` | Plan name, when reported |

When nothing is found the response is `{ "available": false, "error": "No Codex data found" }` with status 200. An unexpected failure returns 500 with `{ "available": false, "error": "Failed to fetch Codex limits" }`.

---

## Claude Code limits

### `GET /api/claude-code-limits`

Returns Claude Code usage limits by running the Claude CLI in a pseudo-terminal and parsing its `/usage` output. The CLI prints reset times in UTC as text; Nerve converts them to epoch milliseconds. Results are cached for 5 minutes (30 seconds after an unavailable result).

**Rate limit:** None

**Response:**

```json
{
  "available": true,
  "session_limit": {
    "used_percent": 30.0,
    "left_percent": 70.0,
    "resets_at_epoch": 1708110000000,
    "resets_at_raw": "7:59pm (UTC)"
  },
  "weekly_limit": {
    "used_percent": 8.5,
    "left_percent": 91.5,
    "resets_at_epoch": 1708300000000,
    "resets_at_raw": "Feb 18, 6:59pm"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `available` | `boolean` | `false` when the CLI is missing or its output could not be read |
| `session_limit`, `weekly_limit` | `object` | Present when the CLI reported that window |
| `*.resets_at_epoch` | `number \| null` | Reset time in epoch milliseconds, `null` if the text could not be parsed |
| `*.resets_at_raw` | `string` | The reset text as the CLI printed it |
| `error` | `string` | Present when `available` is `false` |

An unexpected failure returns 500 with `{ "available": false, "error": "Failed to fetch Claude Code limits" }`.

---

## Kanban

Task board with configurable columns, agent execution, and a proposal workflow. Tasks, proposals and the board config are stored in `${NERVE_DATA_DIR:-~/.nerve}/kanban/tasks.json`, with an append-only `audit.log` next to it. See [Architecture](./ARCHITECTURE.md#kanban-subsystem) for design details.

Every Kanban route uses the General rate limiter (60/min). The workflow endpoints (execute, approve, reject, abort) record the actor as `operator`; there is no per-actor permission check.

### Task object

All task endpoints return a `KanbanTask` object. Optional fields are left out of the JSON when unset.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Slug derived from the title: lowercased, other characters collapsed to `-`, at most 30 characters (`task` if nothing is left). A clash gets `-2`, `-3` and so on. Never changes |
| `title` | `string` | Task title (1 to 500 chars) |
| `description` | `string` | Optional description (max 10000 chars) |
| `status` | `string` | Column key: a built-in status (`backlog`, `todo`, `in-progress`, `review`, `done`, `cancelled`) or a custom column key from the board config |
| `priority` | `string` | One of: `critical`, `high`, `normal`, `low` |
| `createdBy` | `string` | `"operator"` or `"agent:<name>"`, as sent by the creator (default `"operator"`). For tasks created from a proposal, the proposal's `proposedBy` |
| `createdAt` | `number` | Epoch milliseconds |
| `updatedAt` | `number` | Epoch milliseconds |
| `version` | `number` | CAS version. Starts at 1 and goes up by 1 on every PATCH, reorder, workflow transition (execute, approve, reject, abort, run completion) and applied update proposal |
| `sourceSessionKey` | `string` | Optional originating session key |
| `assignee` | `string` | Optional. `"operator"` or `"agent:<id>"`, stored in canonical form (see below) |
| `labels` | `string[]` | Tags (max 50, each max 100 chars) |
| `columnOrder` | `number` | Position within the status column (lowest first) |
| `run` | `object` | Current or last run link (see below) |
| `result` | `string` | Agent result text with Kanban markers stripped (max 50000 chars when set through the API) |
| `resultAt` | `number` | When `result` was set (epoch ms) |
| `model` | `string` | Model override for execution |
| `thinking` | `string` | Thinking level: `off`, `low`, `medium`, `high` |
| `dueAt` | `number` | Due date (epoch ms) |
| `estimateMin` | `number` | Estimated minutes |
| `actualMin` | `number` | Actual minutes |
| `feedback` | `array` | Feedback entries `{ at, by, note }`, added by approve (with a note), reject, and abort (with a note) |

**Run link object** (`run`):

| Field | Type | Description |
|-------|------|-------------|
| `sessionKey` | `string` | Run correlation key generated by Nerve at execute time: `kb-<id>-<epoch ms>` for `sessions_spawn` runs, `kanban-root:kb-<title-slug>-<id>-v<version>-<epoch ms>` for assigned runs. It is not necessarily a gateway session key |
| `childSessionKey` | `string` | The worker session's real key, attached once the launch reports it |
| `sessionId` | `string` | Same value as `childSessionKey` |
| `runId` | `string` | Gateway run ID, when the launch returned one |
| `startedAt` | `number` | Epoch milliseconds |
| `endedAt` | `number` | Epoch milliseconds |
| `status` | `string` | `running`, `done`, `error`, `aborted` |
| `error` | `string` | Error message when the run failed, for example `Spawn failed: ...` or `Run timed out (polling limit reached)` |

The `run` link is owned by the server: `PATCH` ignores it.

**Assignee rules:**
- Accepted values are `"operator"` and `"agent:<id>"`. Anything after the agent ID is dropped, so `agent:designer:main` and `agent:designer:subagent:abc` are both stored as `agent:designer`.
- `agent:main` (with or without a suffix) is rejected with 400 `{ "error": "validation_error", "details": "Invalid Kanban assignee: agent:main" }`.
- The assignee decides how `execute` launches the task. An older task that still has `agent:main` stored is treated as unassigned.

### Statuses and workflow

A status key is lowercase kebab-case, 1 to 64 characters (`^[a-z0-9]+(?:-[a-z0-9]+)*$`). A task's status must be a built-in status or a key in the board config's `columns`; any other value returns 400 with an `allowed` list.

| From | To | Trigger |
|------|----|---------|
| `todo`, `backlog` | `in-progress` | `POST /api/kanban/tasks/:id/execute` |
| `in-progress` (run `running`) | `review` | The run finishes (server poller or `POST .../complete` without `error`) |
| `in-progress` (run `running`) | `todo` | The run fails, times out or cannot be launched (run `error`), or `POST .../abort` (run `aborted`) |
| `review` | `done` | `POST /api/kanban/tasks/:id/approve` |
| `review` | `todo` | `POST /api/kanban/tasks/:id/reject` (clears `run`, `result`, `resultAt`) |
| any | any allowed status | `PATCH` with `status`, reorder, or an applied update proposal. No workflow checks, and the run is not touched |

No workflow endpoint moves a task to `cancelled`; use `PATCH` or reorder. Every status change through these paths places the task at the end of its new column, except reorder, which places it at `targetIndex`.

### `GET /api/kanban/tasks`

List tasks with optional filters and pagination.

**Rate limit:** General (60/min)

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | `string` | *(all)* | Filter by status. Repeatable or comma-separated (e.g. `?status=todo,in-progress`). `status[]` also works |
| `priority` | `string` | *(all)* | Filter by priority. Repeatable or comma-separated. `priority[]` also works |
| `assignee` | `string` | *(all)* | Exact match against the stored (canonical) assignee, e.g. `agent:designer` |
| `label` | `string` | *(all)* | Exact label match. Only the first `label` parameter is used |
| `q` | `string` | *(none)* | Case-insensitive substring search over title, description, and labels |
| `limit` | `number` | `50` | Page size, clamped to 1 to 200 |
| `offset` | `number` | `0` | Pagination offset |

Filter values are not validated: an unknown status or priority matches nothing.

**Response:**

```json
{
  "items": [
    {
      "id": "refactor-auth-module",
      "title": "Refactor auth module",
      "status": "todo",
      "priority": "high",
      "createdBy": "operator",
      "createdAt": 1708100000000,
      "updatedAt": 1708100500000,
      "version": 3,
      "labels": ["backend"],
      "columnOrder": 0,
      "feedback": []
    }
  ],
  "total": 12,
  "limit": 50,
  "offset": 0,
  "hasMore": false
}
```

Tasks are sorted by the board's column order, then `columnOrder`, then most recently updated first.

### `GET /api/kanban/tasks/:id`

Fetch a single task by ID.

**Rate limit:** General (60/min)

**Response:** The matching `KanbanTask` object.

**Errors:**

| Status | Body | Condition |
|--------|------|-------------|
| 404 | `{ "error": "not_found" }` | Task not found (no `details` on this route) |

### `POST /api/kanban/tasks`

Create a new task. It is appended to the end of its column.

**Rate limit:** General (60/min)

**Request body:**

```json
{
  "title": "Refactor auth module",
  "description": "Extract session logic into its own service",
  "status": "todo",
  "priority": "high",
  "assignee": "agent:designer",
  "labels": ["backend", "refactor"],
  "model": "anthropic/claude-sonnet-4-20250514",
  "thinking": "medium",
  "dueAt": 1708200000000,
  "estimateMin": 60
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `string` | Yes | Task title (1 to 500 chars) |
| `description` | `string` | No | Description (max 10000 chars) |
| `status` | `string` | No | Initial status (any allowed status, no workflow check). Defaults to the board's `defaults.status` (`todo` by default) |
| `priority` | `string` | No | Priority. Defaults to the board's `defaults.priority` (`normal` by default) |
| `createdBy` | `string` | No | `"operator"` or `"agent:<name>"`. Default: `"operator"` |
| `sourceSessionKey` | `string` | No | Originating session key (max 500 chars) |
| `assignee` | `string` | No | `"operator"` or `"agent:<id>"`, canonicalized as described under Assignee rules |
| `labels` | `string[]` | No | Tags (max 50 items, each max 100 chars). Default: `[]` |
| `model` | `string` | No | Model for agent execution (max 200 chars) |
| `thinking` | `string` | No | Thinking level: `off`, `low`, `medium`, `high` |
| `dueAt` | `number` | No | Due date (epoch ms) |
| `estimateMin` | `number` | No | Estimated minutes (0 or more) |

**Response (201):** The created `KanbanTask` object, with `version: 1`.

**Errors:**

| Status | Body | Condition |
|--------|------|-------------|
| 400 | `{ "error": "validation_error", "details": "..." }` | Invalid JSON (`details: "Invalid JSON body"`) or schema failure (`details` lists `<field>: <message>` pairs joined by `; `) |
| 400 | `{ "error": "validation_error", "details": "status: Unknown status \"blocked\"", "allowed": ["backlog", "..."] }` | Well-formed status that is not a built-in status or a configured column |
| 400 | `{ "error": "validation_error", "details": "Invalid Kanban assignee: agent:main" }` | Assignee cannot be canonicalized |

### `PATCH /api/kanban/tasks/:id`

Update a task. Requires the current `version` for optimistic concurrency (CAS). Send `null` for nullable fields to clear them. Omitted fields are left alone.

**Rate limit:** General (60/min)

**Request body:**

```json
{
  "version": 3,
  "title": "Updated title",
  "priority": "critical",
  "assignee": null
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `number` | Yes | Current task version (integer, 1 or more) |
| `title` | `string` | No | New title (1 to 500 chars) |
| `description` | `string \| null` | No | New description (max 10000 chars). `null` clears |
| `status` | `string` | No | New status. No workflow checks; the task moves to the end of the new column |
| `priority` | `string` | No | New priority |
| `assignee` | `string \| null` | No | New assignee (canonicalized). `null` clears |
| `labels` | `string[]` | No | Replaces all labels (max 50, each max 100 chars) |
| `model` | `string \| null` | No | Model override (max 200 chars). `null` clears |
| `thinking` | `string \| null` | No | Thinking level. `null` clears |
| `dueAt` | `number \| null` | No | Due date. `null` clears |
| `estimateMin` | `number \| null` | No | Estimated minutes (0 or more). `null` clears |
| `actualMin` | `number \| null` | No | Actual minutes (0 or more). `null` clears |
| `result` | `string \| null` | No | Result text (max 50000 chars). `null` clears |
| `resultAt` | `number \| null` | No | Result timestamp. `null` clears |
| `feedback` | `array` | No | Replaces the whole feedback list. Each entry: `{ at: number, by: "operator" \| "agent:<name>", note: string }` |
| `run` | `object \| null` | No | Accepted by the schema but ignored: the run link is server-owned |

**Response:** The updated `KanbanTask` object (version incremented).

**Errors:**

| Status | Body | Condition |
|--------|------|-------------|
| 400 | `{ "error": "validation_error", "details": "..." }` | Invalid JSON, schema failure, or invalid assignee |
| 400 | `{ "error": "validation_error", "details": "status: Unknown status \"...\"", "allowed": [...] }` | Status not allowed on this board |
| 404 | `{ "error": "not_found", "details": "Task not found: <id>" }` | Task not found |
| 409 | `{ "error": "version_conflict", "serverVersion": 4, "latest": { ... } }` | Version mismatch. `latest` is the current `KanbanTask`, so you can retry with its `version` |

### `DELETE /api/kanban/tasks/:id`

Delete a task permanently. Works in any status and needs no `version`. It does not stop a running agent session.

**Rate limit:** General (60/min)

**Response:**

```json
{ "ok": true }
```

**Errors:**

| Status | Body | Condition |
|--------|------|-------------|
| 404 | `{ "error": "not_found", "details": "Task not found: <id>" }` | Task not found |

### `POST /api/kanban/tasks/:id/reorder`

Move a task to a position in its own column or in another column. CAS-versioned. This is a plain move: no workflow checks, and the run is not touched (moving a task to `in-progress` does not start a run).

**Rate limit:** General (60/min)

**Request body:**

```json
{
  "version": 3,
  "targetStatus": "in-progress",
  "targetIndex": 0
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `number` | Yes | Current task version |
| `targetStatus` | `string` | Yes | Target column key (any allowed status) |
| `targetIndex` | `number` | Yes | Zero-based position in the target column (integer, 0 or more). Values past the end are clamped to the end |

The target column's tasks are renumbered `0`, `1`, `2` and so on with the moved task inserted at `targetIndex`. Only the moved task's `version` goes up; the renumbered neighbours get a new `columnOrder` and `updatedAt` but keep their `version`.

**Response:** The moved `KanbanTask` object.

**Errors:**

| Status | Body | Condition |
|--------|------|-------------|
| 400 | `{ "error": "validation_error", "details": "..." }` | Invalid JSON or body (an unknown `targetStatus` also returns `allowed`) |
| 404 | `{ "error": "not_found", "details": "Task not found: <id>" }` | Task not found |
| 409 | `{ "error": "version_conflict", "serverVersion": 4, "latest": { ... } }` | Version mismatch |

### `POST /api/kanban/tasks/:id/execute`

Start an agent run for a task in `todo` or `backlog` and move it to `in-progress`. The response comes back before the agent is launched; launching and completion tracking run in the background.

**Rate limit:** General (60/min)

**Request body (optional):**

```json
{
  "model": "anthropic/claude-sonnet-4-20250514",
  "thinking": "high"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | `string` | No | Model override (max 200 chars). Saved on the task |
| `thinking` | `string` | No | Thinking override: `off`, `low`, `medium`, `high`. Saved on the task |

**Launch settings:**
- Model: request `model`, then the task's `model`, then the board's `defaultModel`. If none is set, no model is sent with the launch.
- Thinking: request `thinking`, then the task's `thinking`, then the board's `defaultThinking`. If the result is empty or `off`, the run is launched with `low`.
- The worker's prompt contains the task title and description (the title again when there is no description) and asks for a clear summary of what was done.

**Execution paths:**
- **Assigned tasks** (`assignee` is `agent:<id>`): the parent is the agent's root session `agent:<id>:main`. Nerve checks that it exists with `sessions.list` (sessions active in the last 7 days, then the full list, limit 1000 each). It then creates a child session `agent:<id>:subagent:<uuid>` with `sessions.create` (`parentSessionKey`, `label`, `model`) and sends the prompt with `sessions.send` (`thinking`). If the send fails, the child session is deleted. Nerve polls `sessions.list` until the child reports `status: "done"` or is idle and no longer busy, reads the last assistant message with `sessions.get`, and sends a completion report (result or error) into the parent root session. This path is used on every platform.
- **Unassigned or `operator` tasks**: Nerve launches the run with the gateway `sessions_spawn` tool (`mode: "run"`, `label` set to the run key) through `/tools/invoke`, polls the `subagents` tool for the run's status, and reads the result with `sessions_history`.
- **macOS:** unassigned and `operator` tasks are rejected with `invalid_execution_target`. Assign the task to a live worker agent first.

**Response:** The updated `KanbanTask` object with `status: "in-progress"`, a new `run` (`sessionKey`, `startedAt`, `status: "running"`), and `result`/`resultAt` cleared. `run.childSessionKey` and `run.runId` are attached later.

**Errors:**

| Status | Body | Condition |
|--------|------|-------------|
| 400 | `{ "error": "validation_error", "details": "..." }` | Invalid JSON or body fields |
| 404 | `{ "error": "not_found", "details": "Task not found: <id>" }` | Task not found |
| 409 | `{ "error": "duplicate_execution", "details": "Task is already being executed" }` | The task is already `in-progress` (with or without an active run) |
| 409 | `{ "error": "invalid_execution_target", "details": "Parent agent session not found: agent:<id>:main" }` | The assignee's root session does not exist |
| 409 | `{ "error": "invalid_execution_target", "details": "Kanban automation on macOS requires assigning the task to a live worker agent root (not @main)." }` | macOS and the task is unassigned or assigned to `operator` |
| 409 | `{ "error": "invalid_transition", "from": "done", "to": "in-progress", "message": "Cannot execute task in \"done\" status; must be \"todo\" or \"backlog\"" }` | Task is not in `todo` or `backlog` |
| 500 | `{ "error": "Internal server error" }` | The gateway session lookup for an assigned task failed |

**Notes:**
- Pollers check 3 seconds after launch, then every 5 seconds, for up to 720 checks (about 60 minutes). After that the run fails with `Run timed out (polling limit reached)`.
- On success the task moves to `review` with the agent's last message as `result` (`Completed (no result text)` when there is none). Kanban markers in it become proposals and are stripped from `result`.
- On failure the task moves back to `todo` with `run.status: "error"` and `run.error` set. A launch failure shows as `Spawn failed: <message>`.

### `POST /api/kanban/tasks/:id/complete`

Complete the task's active run. Nerve's own pollers update the store directly and do not call this endpoint; use it when you track a run yourself. There is no separate webhook secret: it uses the same authentication as every other API route.

**Rate limit:** General (60/min)

**Request body:**

```json
{
  "sessionKey": "kb-refactor-auth-module-1708100000000",
  "result": "Refactored auth module. Extracted SessionService class..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionKey` | `string` | Yes | Identifies the active run (1 to 500 chars). Matches the run's `sessionKey`, `childSessionKey`, `sessionId`, or `runId` |
| `result` | `string` | No | Agent output (max 50000 chars). Kanban markers are turned into proposals and stripped |
| `error` | `string` | No | Error message (max 5000 chars). If set, the run fails, the task moves to `todo`, `result` is cleared, and markers are not parsed |

Without `error`: `run.status` becomes `done`, the task moves to `review`, and a non-empty `result` is stored with `resultAt`. Proposals from markers use `proposedBy: "agent:<sessionKey>"` and `sourceSessionKey: <sessionKey>`; a marker that fails validation is skipped.

**Response:** The updated `KanbanTask` object.

**Errors:**

| Status | Body | Condition |
|--------|------|-------------|
| 400 | `{ "error": "validation_error", "details": "..." }` | Invalid JSON, missing `sessionKey`, or fields over their limits |
| 404 | `{ "error": "not_found", "details": "Task not found: <id>" }` | Task not found |
| 409 | `{ "error": "invalid_transition", "from": "<status>", "to": "review", "message": "No active run to complete on task \"<id>\"" }` | The task has no run with `status: "running"` (`to` is `todo` when `error` was sent) |
| 409 | `{ "error": "invalid_transition", "from": "<status>", "to": "review", "message": "Run key mismatch for task \"<id>\": active run is \"<key>\", got \"<sessionKey>\"" }` | `sessionKey` does not match the active run. Nothing is changed and no proposals are created |

### `POST /api/kanban/tasks/:id/approve`

Approve a task in review. Moves it to `done`.

**Rate limit:** General (60/min)

**Request body (optional):**

```json
{
  "note": "Looks good, nice work"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `note` | `string` | No | Approval note (max 5000 chars). Added to `feedback` as `operator` |

**Response:** The updated `KanbanTask` object with `status: "done"`.

**Errors:**

| Status | Body | Condition |
|--------|------|-------------|
| 400 | `{ "error": "validation_error", "details": "..." }` | Invalid JSON or `note` too long |
| 404 | `{ "error": "not_found", "details": "Task not found: <id>" }` | Task not found |
| 409 | `{ "error": "invalid_transition", "from": "<status>", "to": "done", "message": "Cannot approve task in \"<status>\" status; must be \"review\"" }` | Task not in `review` |

### `POST /api/kanban/tasks/:id/reject`

Reject a task in review. Moves it back to `todo` and clears `run`, `result`, and `resultAt` so it can be executed again.

**Rate limit:** General (60/min)

**Request body:**

```json
{
  "note": "Missing error handling for edge cases"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `note` | `string` | Yes | Rejection reason (1 to 5000 chars). Added to `feedback` as `operator` |

**Response:** The updated `KanbanTask` object with `status: "todo"`.

**Errors:**

| Status | Body | Condition |
|--------|------|-------------|
| 400 | `{ "error": "validation_error", "details": "..." }` | Missing body, invalid JSON, or missing or empty `note` |
| 404 | `{ "error": "not_found", "details": "Task not found: <id>" }` | Task not found |
| 409 | `{ "error": "invalid_transition", "from": "<status>", "to": "todo", "message": "Cannot reject task in \"<status>\" status; must be \"review\"" }` | Task not in `review` |

### `POST /api/kanban/tasks/:id/abort`

Abort a running task. Marks the run `aborted` (with `endedAt`) and moves the task back to `todo`. Nerve stops tracking the run but sends nothing to the gateway, so the agent session itself is not stopped.

**Rate limit:** General (60/min)

**Request body (optional):**

```json
{
  "note": "Taking too long, will retry with a different approach"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `note` | `string` | No | Abort reason (max 5000 chars). Added to `feedback` as `operator` |

**Response:** The updated `KanbanTask` object with `status: "todo"`.

**Errors:**

| Status | Body | Condition |
|--------|------|-------------|
| 400 | `{ "error": "validation_error", "details": "..." }` | Invalid JSON or `note` too long |
| 404 | `{ "error": "not_found", "details": "Task not found: <id>" }` | Task not found |
| 409 | `{ "error": "invalid_transition", "from": "<status>", "to": "todo", "message": "Cannot abort task: must be \"in-progress\" with an active run" }` | Task not `in-progress` with a running run |

### `GET /api/kanban/proposals`

List Kanban proposals (suggested task creations and updates).

**Rate limit:** General (60/min)

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | `string` | *(all)* | Filter by status: `pending`, `approved`, `rejected` |

**Response:**

```json
{
  "proposals": [
    {
      "id": "f8e7d6c5-1234-4abc-9def-0123456789ab",
      "type": "create",
      "payload": { "title": "Add rate limiting to API", "priority": "high" },
      "proposedBy": "agent:designer",
      "proposedAt": 1708100000000,
      "status": "pending",
      "version": 1
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID |
| `type` | `string` | `create` or `update` |
| `payload` | `object` | Proposed task fields (assignee canonicalized) |
| `sourceSessionKey` | `string` | Optional originating session key |
| `proposedBy` | `string` | `"operator"` or `"agent:<name>"` |
| `proposedAt` | `number` | Epoch milliseconds |
| `status` | `string` | `pending`, `approved`, `rejected` |
| `version` | `number` | 1 when created, 2 after it is approved or rejected through the API. Not used for concurrency checks |
| `resolvedAt` | `number` | When it was approved or rejected |
| `resolvedBy` | `string` | `operator` for API approvals and rejections; the proposer itself when applied automatically |
| `reason` | `string` | Rejection reason |
| `resultTaskId` | `string` | ID of the created or updated task |

Proposals are sorted most recent first.

**Errors:**

| Status | Body | Condition |
|--------|------|-------------|
| 400 | `{ "error": "validation_error", "details": "Invalid status filter" }` | Unknown `status` value |

### `POST /api/kanban/proposals`

Create a proposal. Agents usually create them through Kanban markers in their run result (see notes), but this endpoint creates one directly.

**Rate limit:** General (60/min)

**Request body:**

```json
{
  "type": "create",
  "payload": {
    "title": "Add rate limiting to API",
    "priority": "high",
    "labels": ["backend"]
  },
  "proposedBy": "agent:designer"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | Yes | `"create"` or `"update"` |
| `payload` | `object` | Yes | Task fields. Schema depends on `type` (see below). Unknown keys are dropped |
| `sourceSessionKey` | `string` | No | Originating session key (max 500 chars) |
| `proposedBy` | `string` | No | `"operator"` or `"agent:<name>"`. Default: `"operator"` |

**Create payload fields:** `title` (required, 1 to 500 chars), `description` (max 10000), `status`, `priority`, `assignee`, `labels` (max 50, each max 100), `model` (max 200), `thinking`, `dueAt`, `estimateMin` (0 or more). The created task gets `createdBy` set to the proposal's `proposedBy`.

**Update payload fields:** `id` (required, must reference an existing task), `title` (1 to 500), `description` (max 10000), `status`, `priority`, `assignee`, `labels` (max 50, each max 100), `result` (max 50000). Applying an update skips the version check and the workflow checks, increments the task's `version`, and moves the task to the end of its column if `status` changes.

**Response (201):** The created proposal object.

**Errors:**

| Status | Body | Condition |
|--------|------|-------------|
| 400 | `{ "error": "validation_error", "details": "..." }` | Invalid JSON, invalid body, payload invalid for `type`, or invalid assignee |
| 400 | `{ "error": "validation_error", "details": "status: Unknown status \"...\"", "allowed": [...] }` | Payload `status` not allowed on this board |
| 404 | `{ "error": "not_found", "details": "Referenced task not found: <id>" }` | Update proposal references a task that does not exist |

**Notes:**
- With `proposalPolicy: "confirm"` (default) the proposal stays `pending` until it is approved or rejected.
- With `proposalPolicy: "auto"` it is applied immediately and returned as `approved`, with `resolvedBy` set to the proposer and `resultTaskId` set.
- Kanban markers (`[kanban:create]{...}[/kanban:create]`, `[kanban:update]{...}[/kanban:update]`) in a run's result text are turned into proposals when the run completes: at most 5 per result, each JSON payload at most 2048 bytes and a JSON object with a non-empty `title` (create) or `id` (update). These skip the payload schemas above; only `status` and `assignee` are checked, and a marker that fails is skipped. `proposedBy` is `agent:<run key>` for `sessions_spawn` runs and `POST .../complete`, and the task's assignee (or `operator`) for assigned runs. See [Agent markers](./AGENT-MARKERS.md).

### `POST /api/kanban/proposals/:id/approve`

Approve a pending proposal. Creates or updates the task based on the proposal type. No request body.

**Rate limit:** General (60/min)

**Response:**

```json
{
  "proposal": { "id": "...", "status": "approved", "resolvedAt": 1708100500000, "resolvedBy": "operator", "resultTaskId": "add-rate-limiting-to-api", "version": 2 },
  "task": { "id": "add-rate-limiting-to-api", "title": "Add rate limiting to API" }
}
```

**Errors:**

| Status | Body | Condition |
|--------|------|-------------|
| 400 | `{ "error": "validation_error", "details": "...", "allowed": [...] }` | The proposed `status` is not allowed on this board |
| 404 | `{ "error": "not_found", "details": "Proposal not found: <id>" }` | Proposal not found |
| 404 | `{ "error": "not_found", "details": "Task not found: <id>" }` | Update proposal's task no longer exists |
| 409 | `{ "error": "already_resolved", "proposal": { ... } }` | Proposal already approved or rejected. `proposal` is the stored proposal |

### `POST /api/kanban/proposals/:id/reject`

Reject a pending proposal.

**Rate limit:** General (60/min)

**Request body (optional):**

```json
{
  "reason": "Not a priority right now"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | `string` | No | Rejection reason (max 5000 chars) |

**Response:**

```json
{
  "proposal": { "id": "...", "status": "rejected", "reason": "Not a priority right now", "resolvedBy": "operator", "version": 2 }
}
```

**Errors:**

| Status | Body | Condition |
|--------|------|-------------|
| 400 | `{ "error": "validation_error", "details": "..." }` | Invalid JSON or `reason` too long |
| 404 | `{ "error": "not_found", "details": "Proposal not found: <id>" }` | Proposal not found |
| 409 | `{ "error": "already_resolved", "proposal": { ... } }` | Proposal already approved or rejected |

### `GET /api/kanban/config`

Get the current board configuration.

**Rate limit:** General (60/min)

**Response (defaults):**

```json
{
  "columns": [
    { "key": "backlog", "title": "Backlog", "visible": true },
    { "key": "todo", "title": "To Do", "visible": true },
    { "key": "in-progress", "title": "In Progress", "visible": true },
    { "key": "review", "title": "Review", "visible": true },
    { "key": "done", "title": "Done", "visible": true },
    { "key": "cancelled", "title": "Cancelled", "visible": false }
  ],
  "defaults": {
    "status": "todo",
    "priority": "normal"
  },
  "reviewRequired": true,
  "allowDoneDragBypass": false,
  "quickViewLimit": 5,
  "proposalPolicy": "confirm"
}
```

`defaultModel` and `defaultThinking` are absent until set.

### `PUT /api/kanban/config`

Update the board configuration. Partial: send only the fields you want to change. `columns` replaces the whole list; other fields replace their current value.

**Rate limit:** General (60/min)

**Request body (partial):**

```json
{
  "proposalPolicy": "auto",
  "defaultModel": "anthropic/claude-sonnet-4-20250514",
  "defaults": { "status": "backlog", "priority": "normal" }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `columns` | `array` | *(see above)* | 1 to 10 columns. Must include `backlog`, `todo`, `in-progress`, `review`, and `done` (`cancelled` is optional). A column whose key is still used by a task or by any proposal's `status` cannot be removed |
| `defaults` | `object` | `{ "status": "todo", "priority": "normal" }` | Defaults for new tasks. Both `status` and `priority` are required when sent; `status` must be a built-in status or a configured column |
| `reviewRequired` | `boolean` | `true` | Stored and returned. Neither the server nor the current UI acts on it |
| `allowDoneDragBypass` | `boolean` | `false` | Stored and returned. Neither the server nor the current UI acts on it |
| `quickViewLimit` | `number` | `5` | Integer, 1 to 50. Stored and returned; the workspace quick view currently shows a fixed 5 rows |
| `proposalPolicy` | `string` | `"confirm"` | `"confirm"` (proposals wait for approval) or `"auto"` (applied immediately) |
| `defaultModel` | `string` | *(unset)* | Fallback model for execute (max 100 chars) |
| `defaultThinking` | `string` | *(unset)* | Fallback thinking level for execute (any string, max 20 chars). Empty or `off` launches as `low` |

Each column:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | `string` | Yes | Status key, lowercase kebab-case (1 to 64 chars). Custom keys are allowed |
| `title` | `string` | Yes | Display label (1 to 100 chars) |
| `wipLimit` | `number` | No | Integer, 0 or more. Stored only; not enforced |
| `visible` | `boolean` | Yes | Whether the board shows the column |

**Response:** The full updated config object.

**Errors:**

| Status | Body | Condition |
|--------|------|-------------|
| 400 | `{ "error": "validation_error", "details": "..." }` | Invalid JSON or schema failure |
| 400 | `{ "error": "validation_error", "details": "Missing required board columns: review", "statuses": ["review"] }` | A required column is missing |
| 400 | `{ "error": "validation_error", "details": "Cannot remove columns still in use: blocked", "statuses": ["blocked"] }` | A removed column is still referenced |
| 400 | `{ "error": "validation_error", "details": "status: Unknown status \"...\"", "allowed": [...] }` | `defaults.status` is not allowed |

---

## WebSocket proxy

Browsers do not talk to the gateway directly. They connect to Nerve at `/ws?target=<gateway-ws-url>` (for example `ws://127.0.0.1:18789/ws`), and Nerve relays the traffic, injecting its device identity and, for trusted clients connecting to the gateway in `GATEWAY_URL`, the gateway token during the connect handshake (see [Connect defaults](#connect-defaults)).

| Check | Failure |
|-------|---------|
| `Origin` must be a loopback host or listed in `ALLOWED_ORIGINS` (a request with no `Origin` is accepted only when Nerve binds to a loopback host) | HTTP 403 `Origin not allowed` on the upgrade |
| With `NERVE_AUTH=true`, a valid session cookie | HTTP 401 `Authentication required` on the upgrade |
| `target` must be present and a valid URL | Close code 1008, `Missing ?target= param` or `Invalid target URL` |
| `target` must use `ws:` or `wss:` and a host in the allowlist (`localhost`, `127.0.0.1`, `::1`, plus `WS_ALLOWED_HOSTS`) | Close code 1008, `Target not allowed` |
| `target` port must be 1 to 65535 | Close code 1008, `Invalid target port` |

Nerve pings both sides every 30 seconds and closes a connection whose peer stops answering.

---

## Error handling

An unhandled error in a route returns:

```
HTTP 500
Content-Type: application/json

{ "error": "Internal server error" }
```

Outside `/api/*` the same 500 is plain text (`Internal server error`). The error message and stack trace are logged to the server console (the stack unless `NODE_ENV=production`) and never sent to clients.

Other errors you may see on any route:

| Status | Body | Cause |
|--------|------|-------|
| 400 | `{ "error": "..." }` or `{ "ok": false, "error": "..." }` | A request body or parameter failed validation. Most routes return the message of the first failing schema issue. Each endpoint lists its own error bodies. A body that is not valid JSON returns 400 on some routes and 500 (`{ "error": "Internal server error" }`) on others |
| 401 | `{ "error": "Authentication required" }` or `{ "error": "Invalid or expired session" }` | `NERVE_AUTH=true` and the session cookie is missing, invalid or expired |
| 413 | plain text `Request body too large` | Body larger than the global limit (about 13 MB) |
| 429 | plain text `Too many requests. Please try again later.` | Rate limit exceeded (see below) |

---

## Rate limiting

Rate limiting is applied per route, not globally: each endpoint above states its limit, and endpoints marked "Rate limit: None" have no limiter. Limits are per client IP and per request path (so `/api/crons/a/run` and `/api/crons/b/run` count separately, while `GET` and `PUT` on one path share a counter), using an in-memory sliding window.

| Preset | Routes | Limit |
|--------|--------|-------|
| **Auth** | `POST /api/auth/login` | 5 requests / 60 seconds |
| **TTS** | `POST /api/tts` | 10 requests / 60 seconds |
| **Transcribe** | `POST /api/transcribe` | 30 requests / 60 seconds |
| **General** | Most other `/api/*` routes | 60 requests / 60 seconds |
| **Restart** | `POST /api/gateway/restart` | 3 requests / 60 seconds |

**Rate limit headers** are included on every response from a limited route:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
```

When exceeded the response is plain text `Too many requests. Please try again later.` with:

```
HTTP 429
Retry-After: 45
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1708100060
```

`X-RateLimit-Reset` is in epoch seconds.

**Client identification:** Uses the real TCP socket address (not spoofable headers). `X-Forwarded-For` and `X-Real-IP` are only trusted when the direct connection comes from a trusted proxy (loopback by default; extend via the `TRUSTED_PROXIES` env var). `TRUSTED_PROXY_HEADER` selects the header the proxy owns. With the default `x-forwarded-for`, `X-Forwarded-For` is read from the right, the first address that is not a trusted proxy is the client, and `X-Real-IP` is the fallback. With `x-real-ip`, only `X-Real-IP` is read and `X-Forwarded-For` is ignored.

---

## Global middleware

Applied to all requests in order:

1. **Error handler**: catches unhandled exceptions (see above)
2. **Logger**: request/response logging (Hono built-in)
3. **CORS**: an origin is allowed when it is a loopback host or listed in `ALLOWED_ORIGINS`; credentials are allowed (see [CONFIGURATION.md](./CONFIGURATION.md))
4. **Security headers**: CSP, HSTS (production only), X-Frame-Options and others (see [SECURITY.md](./SECURITY.md))
5. **Body limit**: about 13 MB (12 MiB plus 1 MiB) maximum body on `/api/*` routes, enforced before authentication
6. **Authentication**: with `NERVE_AUTH=true`, requires a valid session cookie on `/api/*` except the public routes (`/api/auth/login`, `/api/auth/logout`, `/api/auth/status`, `/api/version`) and `/health`
7. **Compression**: gzip/deflate on all routes except `/api/events` (SSE) and `/api/files/raw`
8. **Cache headers**: `no-cache` for API routes and `/health`, immutable for hashed assets

---

## Static files & SPA

- `/assets/*` and other non-API paths are served from the Vite build in `dist/`.
- A path that does not start with `/api/`, has no file extension and matches no file falls back to `dist/index.html`, so client-side routes work.
- A missing path under `/assets/` or ending in a file extension returns 404 instead of `index.html`. This keeps a stale page from loading HTML as JavaScript after an upgrade.
- Hashed assets (for example `index-Pbmes8jg.js`) get `Cache-Control: public, max-age=31536000, immutable`.
- Other static files (paths with a dot, such as `/favicon.svg`) get `Cache-Control: public, max-age=0, must-revalidate`.
- Static responses with status 400 or above get `Cache-Control: no-store`.
