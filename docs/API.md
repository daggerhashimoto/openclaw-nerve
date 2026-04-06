# API Reference

Nerve exposes a REST + SSE API served by [Hono](https://hono.dev/) on the configured `PORT` (default **3080**). All API routes are prefixed with `/api/` except the health endpoint. Responses are JSON unless otherwise noted.

> **Authentication:** When `NERVE_AUTH=true`, all API endpoints (except `/api/auth/*` and `/health`) require a valid session cookie. Obtain one via `POST /api/auth/login`. When `NERVE_AUTH=false` (default for localhost), no authentication is required. See [SECURITY.md](./SECURITY.md) for details.

---

## Table of Contents

- [Authentication](#authentication)
- [Health](#health)
- [Server Info](#server-info)
- [Version](#version)
- [Connect Defaults](#connect-defaults)
- [Events (SSE)](#events-sse)
- [Text-to-Speech](#text-to-speech)
- [Transcription](#transcription)
- [Language & Voice Phrases](#language--voice-phrases)
- [Token Usage](#token-usage)
- [Memories](#memories)
- [Agent Log](#agent-log)
- [Gateway](#gateway)
- [Sessions](#sessions)
- [Workspace Files](#workspace-files)
- [Cron Jobs](#cron-jobs)
- [Skills](#skills)
- [File Serving](#file-serving)
- [Codex Limits](#codex-limits)
- [Claude Code Limits](#claude-code-limits)
- [Kanban](#kanban)
- [Error Handling](#error-handling)
- [Rate Limiting](#rate-limiting)

---

## Authentication

### `GET /api/auth/status`

Check whether authentication is enabled and whether the current request is authenticated.

**Rate Limit:** None (public endpoint)

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

**Rate Limit:** General (60/min)

**Request Body:**

```json
{
  "password": "your-password"
}
```

**Success Response (200):**

```json
{ "ok": true }
```

Sets an `HttpOnly` session cookie (`nerve_session_{PORT}`) on success.

**Error Responses:**

| Status | Body | Description |
|--------|------|-------------|
| 400 | `{ "error": "Password required" }` | Empty or missing password |
| 401 | `{ "error": "Invalid password" }` | Wrong password |

**Notes:**
- When auth is disabled, always returns `{ "ok": true }` without checking password.
- Accepts the gateway token as a fallback password when no password hash is configured.

### `POST /api/auth/logout`

Clear the session cookie.

**Rate Limit:** None (public endpoint)

**Response:**

```json
{ "ok": true }
```

---

## Health

### `GET /health`

Health check with gateway connectivity probe.

**Rate Limit:** None

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
| `gateway` | `"ok" \| "unreachable"` | Result of a 3-second gateway health probe |

---

## Server Info

### `GET /api/server-info`

Returns server time, gateway process uptime, timezone, and agent name.

**Rate Limit:** General (60/min)

**Response:**

```json
{
  "serverTime": 1708100000000,
  "gatewayStartedAt": 1708090000000,
  "timezone": "Europe/Berlin",
  "agentName": "Agent"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `serverTime` | `number` | Current epoch milliseconds |
| `gatewayStartedAt` | `number \| null` | Gateway process start time (epoch ms), when the host OS can resolve it (Linux via `/proc`, macOS via `ps`) |
| `timezone` | `string` | IANA timezone of the server |
| `agentName` | `string` | Configured agent display name |

---

## Version

### `GET /api/version`

Returns the application name and version from `package.json`.

**Rate Limit:** None

**Response:**

```json
{
  "version": "1.3.0",
  "name": "openclaw-nerve"
}
```

---

## Connect Defaults

### `GET /api/connect-defaults`

Provides the official gateway WebSocket URL and trust metadata for the frontend's auto-connect flow. The `token` field is always `null`; when `serverSideAuth` is `true`, Nerve expects the browser to connect with an empty token and injects `GATEWAY_TOKEN` server-side during the WebSocket handshake.

**Rate Limit:** General (`60 requests / minute`)

**Response (trusted / auto-connect path):**

```json
{
  "wsUrl": "ws://127.0.0.1:18789/ws",
  "token": null,
  "agentName": "Agent",
  "authEnabled": false,
  "serverSideAuth": true
}
```

**Response (manual token still required):**

```json
{
  "wsUrl": "ws://127.0.0.1:18789/ws",
  "token": null,
  "agentName": "Agent",
  "authEnabled": true,
  "serverSideAuth": false
}
```

`serverSideAuth` becomes `true` when Nerve can safely inject the configured gateway token for this request, such as:
- loopback / tunneled local access to the official gateway URL
- authenticated sessions on a network-exposed Nerve instance

If the browser is pointed at a custom gateway URL, or the request is not trusted for server-side injection, the connect dialog keeps the token field visible and the user must supply it manually.

---

## Events (SSE)

### `GET /api/events`

Server-Sent Events stream for real-time push updates. Compression is **disabled** on this route to prevent chunk buffering.

**Headers sent by server:**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

**Event format:**

Each SSE message has an `event` field and a JSON `data` payload:

```
event: memory.changed
data: {"event":"memory.changed","data":{"source":"api","action":"create","section":"General"},"ts":1708100000000}
```

### Event Types

| Event | Trigger | Data Fields |
|-------|---------|-------------|
| `connected` | On initial connection | `{ ts }` |
| `ping` | Every 30 seconds (keep-alive) | `{ ts }` |
| `memory.changed` | Memory file modified via API or file watcher | `{ source, action?, section?, file?, agentId? }` |
| `file.changed` | Workspace file modified by the file watcher | `{ path, agentId }` |
| `tokens.updated` | Token usage changed | varies |
| `status.changed` | Gateway status changed | varies |

### `POST /api/events/test`

**Development only** (`NODE_ENV=development`). Broadcasts a test event.

**Body:**

```json
{
  "event": "test",
  "data": { "message": "Hello" }
}
```

---

## Text-to-Speech

### `POST /api/tts`

Synthesizes speech from text. Returns raw audio binary.

**Rate Limit:** TTS (10/min)  
**Body Size Limit:** 64 KB

**Request Body:**

```json
{
  "text": "Hello, world!",
  "provider": "openai",
  "voice": "alloy",
  "model": "tts-1"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | `string` | Yes | Text to synthesize (1–5000 chars, non-empty after trim) |
| `provider` | `"openai" \| "replicate" \| "edge" \| "qwen" \| "xiaomi"` | No | TTS provider. `"qwen"` is a legacy alias for `"replicate"` + model `"qwen-tts"` |
| `voice` | `string` | No | Provider-specific voice name |
| `model` | `string` | No | Provider-specific model ID |

**Provider Selection (when `provider` is omitted):**

1. OpenAI, if `OPENAI_API_KEY` is set
2. Replicate, if `REPLICATE_API_TOKEN` is set
3. Edge TTS, always available (free, no API key)

Xiaomi MiMo is available when `provider: "xiaomi"` is requested and `MIMO_API_KEY` is configured. It is not part of the automatic fallback chain.

**Response:** `audio/mpeg` binary for OpenAI, Replicate, and Edge, or `audio/wav` for Xiaomi MiMo (200)

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Validation failure (empty text, exceeds 5000 chars) |
| 429 | Rate limit exceeded |
| 500 | TTS synthesis failed |

Results are cached in-memory keyed by `provider:model:voice:text` (MD5 hash). Cache: up to `TTS_CACHE_MAX` entries (default 200), TTL `TTS_CACHE_TTL_MS` (default 1 hour).

### `GET /api/tts/config`

Returns the current TTS voice configuration.

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
    "model": "gpt-4o-mini-tts",
    "voice": "nova",
    "instructions": "Speak naturally and conversationally, like a real person. Warm, friendly tone with a slight British accent. Keep it casual and relaxed, not robotic or overly formal."
  },
  "edge": { "voice": "en-US-AriaNeural" },
  "xiaomi": { "model": "mimo-v2-tts", "voice": "mimo_default", "style": "" }
}
```

### `PUT /api/tts/config`

Partially updates the TTS voice configuration. Only known keys are accepted.

**Request Body (partial update):**

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
| `qwen` | `mode`, `language`, `speaker`, `voiceDescription`, `styleInstruction` |
| `openai` | `model`, `voice`, `instructions` |
| `edge` | `voice` |
| `xiaomi` | `model`, `voice`, `style` |

All values must be strings, max 2000 characters each.

### `GET /api/keys`

Returns whether optional provider keys are configured. Key values are never returned.

**Response:**

```json
{
  "openaiKeySet": true,
  "replicateKeySet": false,
  "xiaomiKeySet": true
}
```

### `PUT /api/keys`

Writes optional provider keys to `.env` and hot-reloads the in-memory config.

**Request Body (partial update):**

```json
{
  "openaiKey": "sk-...",
  "replicateToken": "r8_...",
  "mimoApiKey": "sk-mimo-..."
}
```

Any subset of fields may be provided. Sending an empty string clears that key.

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

---

## Transcription

### `POST /api/transcribe`

Transcribes audio using the configured STT provider.

**Rate Limit:** Transcribe (30/min)  
**Body Size Limit:** 12 MB

**Providers:**

| Provider | Config | Requirements |
|----------|--------|-------------|
| `openai` | `STT_PROVIDER=openai` | `OPENAI_API_KEY` |
| `local` | `STT_PROVIDER=local` | `ffmpeg` (auto-installed). Downloads whisper model on first use |

**Local STT** uses `@fugood/whisper.node` (whisper.cpp bindings). Available models:

| Model | Size | Speed | Quality |
|-------|------|-------|---------|
| `tiny` | 75 MB | Fastest | Good baseline, multilingual |
| `base` (default) | 142 MB | Fast | Better conversational accuracy, multilingual |
| `small` | 466 MB | Moderate | Best accuracy (CPU-intensive), multilingual |
| `tiny.en` | 75 MB | Fastest | English-only variant |
| `base.en` | 142 MB | Fast | English-only variant |
| `small.en` | 466 MB | Moderate | English-only variant |

Configure model via `WHISPER_MODEL`. Language hints come from `NERVE_LANGUAGE` (or `PUT /api/language` / `PUT /api/transcribe/config`). Models auto-download from HuggingFace on first use and are stored in `WHISPER_MODEL_DIR` (default `~/.nerve/models/`).

**Request:** `multipart/form-data` with a `file` field containing audio data.

**Accepted MIME types:** `audio/webm`, `audio/mp3`, `audio/mpeg`, `audio/mp4`, `audio/m4a`, `audio/wav`, `audio/x-wav`, `audio/ogg`, `audio/flac`, `audio/x-flac`

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

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | No file in request |
| 413 | File exceeds 12 MB |
| 415 | Unsupported audio format |
| 500 | API key not configured / transcription failed |

### `GET /api/transcribe/config`

Returns current STT runtime config + local model readiness/download state.

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
    "tiny": { "size": "75MB", "ready": true, "multilingual": true },
    "base": { "size": "142MB", "ready": true, "multilingual": true },
    "tiny.en": { "size": "75MB", "ready": true, "multilingual": false }
  },
  "download": null
}
```

### `PUT /api/transcribe/config`

Hot-reloads STT config at runtime.

**Request Body (partial):**

```json
{
  "provider": "local",
  "model": "base",
  "language": "tr"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `provider` | `"local" \| "openai"` | STT provider |
| `model` | `string` | Whisper model id (`tiny`, `base`, `small`, plus `.en` variants) |
| `language` | `string` | ISO 639-1 language code (`en`, `tr`, `de`, etc.) |

Language changes persist to `.env` as `NERVE_LANGUAGE`.

---

## Language & Voice Phrases

### `GET /api/language`

Returns current language settings and compatibility flags.

**Rate Limit:** General (60/min)

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

### `PUT /api/language`

Hot-reloads language settings at runtime.

**Rate Limit:** General (60/min)

**Request Body (partial):**

```json
{
  "language": "tr",
  "edgeVoiceGender": "male"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `language` | `string` | ISO 639-1 language code |
| `edgeVoiceGender` | `"female" \| "male"` | Preferred Edge TTS voice gender |

Persists to `.env` keys:
- `NERVE_LANGUAGE`
- `EDGE_VOICE_GENDER`

### `GET /api/language/support`

Returns full provider × language support matrix and current local model state.

**Rate Limit:** General (60/min)

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

### `GET /api/voice-phrases`

Returns merged phrase set for recognition matching (selected language + English fallback).

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `lang` | `string` | No | ISO 639-1 code. Defaults to current server language |

**Response:**

```json
{
  "stopPhrases": ["gönder", "send it"],
  "cancelPhrases": ["iptal", "cancel"],
  "wakePhrases": ["selam kim"]
}
```

### `GET /api/voice-phrases/status`

Returns whether each supported language has custom phrase overrides configured.

**Response (example):**

```json
{
  "en": { "configured": false, "hasDefaults": true },
  "tr": { "configured": true, "hasDefaults": true }
}
```

### `GET /api/voice-phrases/:lang`

Returns language-only phrase config (no English merge).

**Response:**

```json
{
  "source": "custom",
  "stopPhrases": ["gönder"],
  "cancelPhrases": ["iptal"],
  "wakePhrases": ["selam kim"]
}
```

`source` is one of `custom`, `defaults`, or `none`.

### `PUT /api/voice-phrases/:lang`

Saves per-language custom phrase overrides.

**Request Body (partial):**

```json
{
  "stopPhrases": ["gönder"],
  "cancelPhrases": ["iptal"],
  "wakePhrases": ["selam kim"]
}
```

At least one of `stopPhrases`, `cancelPhrases`, or `wakePhrases` is required.

Custom phrase overrides are stored in `~/.nerve/voice-phrases.json` (created on first save).

---

## Token Usage

### `GET /api/tokens`

Returns token usage statistics from session transcript files, plus persistent cumulative totals.

**Rate Limit:** General (60/min)

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
    "lastUpdated": "2025-02-15T10:00:00Z"
  },
  "updatedAt": 1708100000000
}
```

Session data is cached for 60 seconds to avoid repeated filesystem scans.

---

## Memories

All memory routes accept an optional `agentId` scope. If omitted, Nerve uses `main`. The UI normally derives this from the owning top-level agent when you switch sessions.

### `GET /api/memories`

Returns parsed memory data from `MEMORY.md` (sections + bullet items) and the 7 most recent daily files (section headers only) for the selected workspace agent.

**Rate Limit:** General (60/min)

**Query Parameters:**

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

### `GET /api/memories/section`

Returns the raw markdown content of a specific section.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `string` | Yes | Section title (exact match) |
| `date` | `string` | No | `YYYY-MM-DD` for daily files; omit for MEMORY.md |
| `agentId` | `string` | No | Workspace agent id. Defaults to `main` |

**Response:**

```json
{
  "ok": true,
  "content": "- Prefers dark mode\n- Likes TypeScript"
}
```

**Errors:** 400 (missing title, invalid date), 404 (file/section not found)

### `POST /api/memories`

Creates a new memory entry. Writes a bullet point to `MEMORY.md` under the specified section (creating it if needed), and optionally stores in the gateway's vector database.

**Rate Limit:** General (60/min)

**Request Body:**

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
| `text` | `string` | Yes | Memory text (1–10000 chars) |
| `section` | `string` | No | Section heading (default: "General", max 200 chars) |
| `category` | `"preference" \| "fact" \| "decision" \| "entity" \| "other"` | No | Category for vector store |
| `importance` | `number` | No | 0–1 importance score (default: 0.7) |
| `agentId` | `string` | No | Workspace agent id. Defaults to `main` |

**Response:**

```json
{ "ok": true, "result": { "written": true, "section": "Preferences" } }
```

Broadcasts `memory.changed` SSE event on success, tagged with the affected `agentId`.

### `PUT /api/memories/section`

Replaces the content of an existing section.

**Request Body:**

```json
{
  "title": "Preferences",
  "content": "- Prefers dark mode\n- Likes TypeScript",
  "date": "2025-02-15"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `string` | Yes | Section title (1–200 chars) |
| `content` | `string` | Yes | New markdown content (max 50000 chars) |
| `date` | `string` | No | `YYYY-MM-DD` for daily files; omit for MEMORY.md |
| `agentId` | `string` | No | Workspace agent id. Defaults to `main` |

### `DELETE /api/memories`

Deletes a memory entry from the file.

**Request Body:**

```json
{
  "query": "Prefers dark mode",
  "type": "item",
  "date": "2025-02-15"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | `string` | Yes | Text to find (exact match for items, section title for sections) |
| `type` | `"section" \| "item" \| "daily"` | No | What to delete. `section`/`daily` removes header + all content. Default: item |
| `agentId` | `string` | No | Workspace agent id. Defaults to `main` |
| `date` | `string` | No | `YYYY-MM-DD` — required when `type` is `"daily"` |

**Response:**

```json
{ "ok": true, "result": { "deleted": 1, "source": "file", "file": "MEMORY.md", "type": "item" } }
```

---

## Agent Log

### `GET /api/agentlog`

Returns the full agent log (JSON array, max 200 entries).

**Response:**

```json
[
  { "ts": 1708100000000, "type": "action", "message": "Started task", "level": "info" }
]
```

### `POST /api/agentlog`

Appends an entry to the agent log.

**Rate Limit:** General (60/min)

**Request Body:**

```json
{
  "type": "action",
  "message": "Completed deployment",
  "level": "info",
  "data": { "duration": 45 }
}
```

All fields are optional. A `ts` (epoch ms) is automatically set on write. The log is capped at 200 entries (oldest trimmed on write).

---

## Gateway

### `GET /api/gateway/models`

Returns the models defined in the active OpenClaw config. This endpoint is config-backed now, not CLI-discovered or cache-backed.

**Rate Limit:** General (60/min)

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
| `models` | `array` | Configured models from `agents.defaults.model` and `agents.defaults.models` in the active OpenClaw config |
| `error` | `string \| null` | Read error or configuration problem, for example config unreadable or no configured models |
| `source` | `"config"` | Identifies the backing source |

Model roles are `primary`, `fallback`, or `allowed`. If the config cannot be read, or no models are configured, the endpoint returns an empty `models` array with an explanatory `error` string.

### `GET /api/gateway/session-info`

Returns the current session's model and thinking level.

**Query Parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `sessionKey` | `agent:main:main` | Session identifier |

**Response:**

```json
{
  "model": "anthropic/claude-opus-4-6",
  "thinking": "medium"
}
```

Resolution order: per-session data from `sessions_list` → global `gateway_status` / `status` / `session_status` tools.

### `POST /api/gateway/session-patch`

HTTP fallback for **model changes** when the frontend cannot apply `sessions.patch` over WebSocket. Thinking-only changes are not supported here.

**Rate Limit:** General (60/min)

**Request Body:**

```json
{
  "sessionKey": "agent:main:main",
  "model": "anthropic/claude-sonnet-4-20250514",
  "thinkingLevel": "high"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionKey` | `string` | No | Target session. If omitted, Nerve tries to pick a preferred active root session |
| `model` | `string` | No | Model to apply via the gateway's `session_status` tool |
| `thinkingLevel` | `string \| null` | No | Accepted by the schema, but not applied by this HTTP fallback |

**Response:**

```json
{ "ok": true, "model": "anthropic/claude-sonnet-4-20250514" }
```

**Behavior notes:**
- Thinking changes belong on WebSocket RPC `sessions.patch`, alongside other session metadata/settings updates.
- A request that only changes `thinkingLevel` returns **501**.
- If no active root session can be found and `sessionKey` is omitted, the endpoint returns **409**.
- If both `model` and `thinkingLevel` are sent, the model change is applied and the thinking change is ignored.

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Invalid JSON or validation error |
| 409 | No active root session available |
| 501 | Thinking-only changes are not supported over HTTP |
| 502 | Model change failed |

### `POST /api/gateway/restart`

Restarts the OpenClaw gateway service, then waits for the service to report healthy status and for the gateway port to become reachable.

**Rate Limit:** Restart (3/min)

**Response:**

```json
{ "ok": true, "output": "Gateway restarted successfully" }
```

**Errors:** 500 if restart or post-restart verification fails.

---

## Sessions

### `GET /api/sessions/hidden`

Returns hidden cron-like sessions from `sessions.json`, sorted by recent activity. Used to surface session metadata that is not part of the normal active session tree.

**Rate Limit:** General (60/min)

**Query Parameters:**

| Param | Default | Description |
|-------|---------|-------------|
| `activeMinutes` | `1440` | Include sessions updated within the last N minutes |
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

If the backing `sessions.json` file is unavailable, the endpoint returns `{ "ok": true, "sessions": [] }`. In remote-workspace cases it may also include `remoteWorkspace: true`.

### `GET /api/sessions/:id/model`

Reads the actual model used by a session from its transcript. This is mainly for cron-run sessions where gateway session listings may only expose the parent agent's default model.

**Rate Limit:** General (60/min)

**Path Parameters:**

| Param | Description |
|-------|-------------|
| `id` | Session UUID |

**Response:**

```json
{ "ok": true, "model": "openai/gpt-5", "missing": false }
```

If the transcript cannot be found, the endpoint returns `{ "ok": true, "model": null, "missing": true }`.

**Errors:** 400 if `id` is not a valid UUID.

---

## Workspace Files

Workspace file routes accept an optional `agentId` scope. If omitted, Nerve uses the `main` workspace.

### `GET /api/workspace`

Lists available workspace file keys and their existence status for the selected workspace agent.

**Query Parameters:**

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
    { "key": "heartbeat", "filename": "HEARTBEAT.md", "exists": false }
  ]
}
```

### `GET /api/workspace/:key`

Reads a workspace file by key.

**Valid keys:** `soul`, `tools`, `identity`, `user`, `agents`, `heartbeat`

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | `string` | No | Workspace agent id. Defaults to `main` |

**Response:**

```json
{ "ok": true, "content": "# SOUL.md\n\nYou are..." }
```

**Errors:** 400 (unknown key), 404 (file not found)

### `PUT /api/workspace/:key`

Writes content to a workspace file.

**Request Body:**

```json
{ "content": "# Updated content\n\nNew text here.", "agentId": "research" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | `string` | Yes | New file contents |
| `agentId` | `string` | No | Workspace agent id. Defaults to `main` |

Content must be a string, max 100 KB.

---

## Cron Jobs

All cron routes proxy to the OpenClaw gateway via `invokeGatewayTool('cron', ...)`.

**Rate Limit:** General (60/min) on all endpoints.

### `GET /api/crons`

Lists all cron jobs (including disabled).

**Response:**

```json
{ "ok": true, "result": { "jobs": [...] } }
```

### `POST /api/crons`

Creates a new cron job.

**Request Body:**

```json
{ "job": { "schedule": "*/30 * * * *", "prompt": "Check email", "channel": "webchat" } }
```

### `PATCH /api/crons/:id`

Updates a cron job.

**Request Body:**

```json
{ "patch": { "schedule": "0 9 * * *" } }
```

### `DELETE /api/crons/:id`

Deletes a cron job.

### `POST /api/crons/:id/toggle`

Toggles a cron job's enabled state.

**Request Body:**

```json
{ "enabled": false }
```

### `POST /api/crons/:id/run`

Triggers immediate execution of a cron job. Timeout: 60 seconds.

### `GET /api/crons/:id/runs`

Returns the last 10 run history entries for a cron job.

**All cron errors return 502** when the gateway tool invocation fails.

---

## Skills

### `GET /api/skills`

Lists all OpenClaw skills via `openclaw skills list --json` for the selected workspace agent.

Nerve scopes this by creating a temporary OpenClaw config whose `agents.defaults.workspace` points at the selected agent workspace, then runs the CLI against that workspace.

**Rate Limit:** General (60/min)

**Query Parameters:**

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

---

## File Browser

Browse, read, and edit workspace files. All paths are restricted to the selected workspace directory with traversal protection.

All file-browser routes accept an optional `agentId` scope. If omitted, Nerve uses `main`. If `FILE_BROWSER_ROOT` is set, file-browser agent scoping is bypassed and all sessions browse the same custom root.

### `GET /api/files/tree`

Returns the workspace directory tree. Excludes `node_modules`, `.git`, `dist`, `server-dist`, and other build artifacts.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | No | Relative directory path to expand. Defaults to root |
| `depth` | `number` | No | Expansion depth, clamped to 1–5 |
| `agentId` | `string` | No | Workspace agent id. Defaults to `main` |

**Response:**
```json
{
  "ok": true,
  "root": ".",
  "entries": [
    {
      "name": "MEMORY.md",
      "path": "MEMORY.md",
      "type": "file",
      "mtime": 1771355007542
    },
    {
      "name": "memory",
      "path": "memory",
      "type": "directory",
      "children": null
    }
  ],
  "workspaceInfo": {
    "isCustomWorkspace": false,
    "rootPath": "/home/user/.openclaw/workspace"
  }
}
```

### `GET /api/files/read`

Read a text file's contents with its modification time (for conflict detection on save).

**Query Parameters:**

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

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Missing `path`, not a file, or other invalid request |
| 403 | Path traversal or excluded path |
| 404 | File not found |
| 413 | File too large |
| 415 | Binary file |

### `PUT /api/files/write`

Write text file contents with optimistic concurrency via mtime comparison. If the file was modified since it was last read, returns 409 Conflict.

**Request Body:**
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
| `content` | `string` | Yes | UTF-8 file contents |
| `expectedMtime` | `number` | No | Expected current mtime for optimistic concurrency |
| `agentId` | `string` | No | Workspace agent id. Defaults to `main` |

**Response (success):**
```json
{
  "ok": true,
  "mtime": 1771355107000
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Missing fields or invalid request |
| 403 | Path traversal or excluded path |
| 409 | File modified since last read (`currentMtime` returned) |
| 413 | Content too large |
| 415 | Binary file write attempted |

### `POST /api/files/rename`

Rename a file or directory within the selected workspace.

**Request Body:**
```json
{ "path": "notes/today.md", "newName": "tomorrow.md", "agentId": "research" }
```

### `POST /api/files/move`

Move a file or directory into another directory within the selected workspace.

**Request Body:**
```json
{ "sourcePath": "notes/today.md", "targetDirPath": "archive", "agentId": "research" }
```

### `POST /api/files/trash`

Move a file or directory into `.trash` when using the default workspace root. If `FILE_BROWSER_ROOT` is set, deletion is permanent instead.

**Request Body:**
```json
{ "path": "notes/today.md", "agentId": "research" }
```

### `POST /api/files/restore`

Restore an item from `.trash` back to its original location.

**Request Body:**
```json
{ "path": ".trash/2026-03-20-notes-today.md", "agentId": "research" }
```

### `GET /api/files/raw`

Serves supported image files from the selected workspace for previews.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | Yes | Relative image path |
| `agentId` | `string` | No | Workspace agent id. Defaults to `main` |

Supported image types: `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `svg`, `ico`.

---

## File Serving

### `GET /api/files`

Serves local image files with strict security controls. See [SECURITY.md](./SECURITY.md#file-serving) for the full threat model.

**Query Parameters:**

| Param | Description |
|-------|-------------|
| `path` | Absolute or `~`-prefixed path to the image file |

```
GET /api/files?path=/tmp/screenshot.png
GET /api/files?path=~/.openclaw/workspace/memory/image.jpg
```

**Allowed file types:** `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.avif`

**Allowed directory prefixes:** `/tmp`, `~/.openclaw`, the configured `MEMORY_DIR`

**Response:** Raw image binary with appropriate `Content-Type` header and 1-hour cache.

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Missing `path` parameter |
| 403 | Not an allowed file type, or path outside allowed directories (including after symlink resolution) |
| 404 | File not found |
| 500 | Read failure |

---

## Codex Limits

### `GET /api/codex-limits`

Returns OpenAI Codex rate limit information. Tries the API first (requires `~/.codex/auth.json`), then falls back to parsing local session files.

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
    "resets_at_formatted": "17 Feb, 14:00"
  },
  "credits": {
    "has_credits": true,
    "unlimited": false,
    "balance": 50.0
  },
  "plan_type": "pro"
}
```

---

## Claude Code Limits

### `GET /api/claude-code-limits`

Returns Claude Code rate limit information by spawning the CLI parser. Reset times are normalised to epoch milliseconds.

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

---

## Kanban

Task board with drag-and-drop columns, agent execution, and a proposal workflow. Tasks flow through a state machine: `backlog` → `todo` → `in-progress` → `review` → `done`. See [Architecture](./ARCHITECTURE.md#kanban-subsystem) for design details.

### Task Object

All task endpoints return a `KanbanTask` object:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID |
| `title` | `string` | Task title (1--500 chars) |
| `description` | `string \| undefined` | Optional description (max 10000 chars) |
| `status` | `string` | One of: `backlog`, `todo`, `in-progress`, `review`, `done`, `cancelled` |
| `priority` | `string` | One of: `critical`, `high`, `normal`, `low` |
| `createdBy` | `string` | `"operator"` or `"agent:<label>"` |
| `createdAt` | `number` | Epoch milliseconds |
| `updatedAt` | `number` | Epoch milliseconds |
| `version` | `number` | CAS version (incremented on every mutation) |
| `sourceSessionKey` | `string \| undefined` | Originating session |
| `assignee` | `string \| undefined` | `"operator"` or `"agent:<label>"` |
| `labels` | `string[]` | Tags (max 50, each max 100 chars) |
| `columnOrder` | `number` | Position within the status column |
| `run` | `object \| undefined` | Active or last run link (see below) |
| `result` | `string \| undefined` | Agent output text (max 50000 chars) |
| `resultAt` | `number \| undefined` | When the result was set |
| `model` | `string \| undefined` | Model override for execution |
| `thinking` | `string \| undefined` | Thinking level: `off`, `low`, `medium`, `high` |
| `dueAt` | `number \| undefined` | Due date (epoch ms) |
| `estimateMin` | `number \| undefined` | Estimated minutes |
| `actualMin` | `number \| undefined` | Actual minutes |
| `feedback` | `array` | Review feedback entries: `{ at, by, note }` |

**Run link object** (`run`):

| Field | Type | Description |
|-------|------|-------------|
| `sessionKey` | `string` | Gateway session key |
| `sessionId` | `string \| undefined` | Session ID |
| `runId` | `string \| undefined` | Run ID |
| `startedAt` | `number` | Epoch milliseconds |
| `endedAt` | `number \| undefined` | Epoch milliseconds |
| `status` | `string` | `running`, `done`, `error`, `aborted` |
| `error` | `string \| undefined` | Error message if failed |

### `GET /api/kanban/tasks`

List tasks with optional filters and pagination.

**Rate Limit:** General (60/min)

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | `string` | *(all)* | Filter by status. Repeatable or comma-separated (e.g. `?status=todo,in-progress`) |
| `priority` | `string` | *(all)* | Filter by priority. Repeatable or comma-separated |
| `assignee` | `string` | *(all)* | Filter by assignee (exact match) |
| `label` | `string` | *(all)* | Filter by label (exact match) |
| `q` | `string` | *(none)* | Search title, description, and labels (case-insensitive substring) |
| `limit` | `number` | `50` | Page size (1--200) |
| `offset` | `number` | `0` | Pagination offset |

**Response:**

```json
{
  "items": [
    {
      "id": "a1b2c3d4-...",
      "title": "Refactor auth module",
      "status": "todo",
      "priority": "high",
      "version": 3,
      "labels": ["backend"],
      "columnOrder": 0,
      "createdBy": "operator",
      "createdAt": 1708100000000,
      "updatedAt": 1708100500000,
      "feedback": []
    }
  ],
  "total": 12,
  "limit": 50,
  "offset": 0,
  "hasMore": false
}
```

Tasks are sorted by status order → column order → most recently updated.

### `GET /api/kanban/tasks/:id`

Fetch a single task by ID.

**Rate Limit:** General (60/min)

**Response:** The matching `KanbanTask` object.

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| 404 | `{ "error": "not_found" }` | Task not found |

### `POST /api/kanban/tasks`

Create a new task.

**Rate Limit:** General (60/min)

**Request Body:**

```json
{
  "title": "Refactor auth module",
  "description": "Extract session logic into its own service",
  "status": "todo",
  "priority": "high",
  "assignee": "operator",
  "labels": ["backend", "refactor"],
  "model": "anthropic/claude-sonnet-4-20250514",
  "thinking": "medium",
  "dueAt": 1708200000000,
  "estimateMin": 60
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `string` | Yes | Task title (1--500 chars) |
| `description` | `string` | No | Description (max 10000 chars) |
| `status` | `string` | No | Initial status. Defaults to board config `defaults.status` (usually `todo`) |
| `priority` | `string` | No | Priority. Defaults to board config `defaults.priority` (usually `normal`) |
| `createdBy` | `string` | No | Creator. Default: `"operator"` |
| `sourceSessionKey` | `string` | No | Originating session key (max 500 chars) |
| `assignee` | `string` | No | `"operator"` or `"agent:<label>"` |
| `labels` | `string[]` | No | Tags (max 50 items, each max 100 chars). Default: `[]` |
| `model` | `string` | No | Model for agent execution (max 200 chars) |
| `thinking` | `string` | No | Thinking level: `off`, `low`, `medium`, `high` |
| `dueAt` | `number` | No | Due date (epoch ms) |
| `estimateMin` | `number` | No | Estimated minutes (≥0) |

**Response (201):** The created `KanbanTask` object.

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Validation error (missing title, invalid field values) |

### `PATCH /api/kanban/tasks/:id`

Update a task. Requires the current `version` for optimistic concurrency (CAS). Send `null` for nullable fields to clear them.

**Rate Limit:** General (60/min)

**Request Body:**

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
| `version` | `number` | Yes | Current task version (for conflict detection) |
| `title` | `string` | No | Updated title |
| `description` | `string \| null` | No | Updated description. `null` to clear |
| `status` | `string` | No | New status |
| `priority` | `string` | No | New priority |
| `assignee` | `string \| null` | No | New assignee. `null` to clear |
| `labels` | `string[]` | No | Replace labels |
| `model` | `string \| null` | No | Model override. `null` to clear |
| `thinking` | `string \| null` | No | Thinking level. `null` to clear |
| `dueAt` | `number \| null` | No | Due date. `null` to clear |
| `estimateMin` | `number \| null` | No | Estimated minutes. `null` to clear |
| `actualMin` | `number \| null` | No | Actual minutes. `null` to clear |
| `result` | `string \| null` | No | Result text (max 50000 chars). `null` to clear |

**Response:** The updated `KanbanTask` object.

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "validation_error", "details": "..." }` | Invalid field values |
| 404 | `{ "error": "not_found" }` | Task not found |
| 409 | `{ "error": "version_conflict", "serverVersion": 4, "latest": {...} }` | Version mismatch. Response includes the current task so you can retry |

### `DELETE /api/kanban/tasks/:id`

Delete a task permanently.

**Rate Limit:** General (60/min)

**Response:**

```json
{ "ok": true }
```

**Errors:** 404 if task not found.

### `POST /api/kanban/tasks/:id/reorder`

Move a task to a different position within its column or to another column. CAS-versioned.

**Rate Limit:** General (60/min)

**Request Body:**

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
| `targetStatus` | `string` | Yes | Target column status |
| `targetIndex` | `number` | Yes | Zero-based position in the target column |

**Response:** The updated `KanbanTask` object.

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Invalid body |
| 404 | Task not found |
| 409 | Version conflict (returns `serverVersion` and `latest` task) |

### `POST /api/kanban/tasks/:id/execute`

Execute a task and move it to `in-progress`. The launch path depends on the task's assignee and platform. The task must be in `todo` or `backlog` status. Moves the task to `in-progress` and starts polling the agent session for completion.

**Rate Limit:** General (60/min)

**Request Body (optional):**

```json
{
  "model": "anthropic/claude-sonnet-4-20250514",
  "thinking": "high"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | `string` | No | Execution model override (max 200 chars). Cascade: execute request → task `model` → board `defaultModel` → OpenClaw configured default |
| `thinking` | `string` | No | Thinking override: `off`, `low`, `medium`, `high` |

**Response:** The updated `KanbanTask` object with `status: "in-progress"` and a `run` object.

**Execution paths:**
- **Assigned tasks** create a real child session beneath the assignee's live root. Nerve verifies that the parent root exists, creates the child with `sessions.create(parentSessionKey=...)`, then sends the task into that child with `sessions.send`.
- **Unassigned or `operator` tasks** use the normal `sessions_spawn` path.
- **macOS fallback rule:** unassigned or `operator` tasks are rejected. Assign the task to a live worker root first.

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| 404 | `{ "error": "not_found" }` | Task not found |
| 409 | `{ "error": "duplicate_execution" }` | Task is already running |
| 409 | `{ "error": "invalid_execution_target" }` | Required parent root is missing, or macOS requires an assigned live worker root |
| 409 | `{ "error": "invalid_transition", "from": "done", "to": "in-progress" }` | Task not in `todo` or `backlog` status |

**Notes:**
- The spawned worker receives the task title and description as its prompt.
- Assigned-task runs keep both a deterministic run correlation key and the real `childSessionKey`.
- When an assigned child session finishes or fails, Nerve sends a completion report back to the parent root session.
- Backend pollers run every 5 seconds for up to **720 attempts / 60 minutes**.
- On success the task moves to `review`. On error it moves back to `todo`.

### `POST /api/kanban/tasks/:id/complete`

Complete a running task. Called by the backend poller automatically, but can also be called directly.

**Rate Limit:** General (60/min)

**Request Body:**

```json
{
  "sessionKey": "kb-auth-refactor-123-v4-1708100000000",
  "result": "Refactored auth module. Extracted SessionService class...",
  "error": "Agent session timed out"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionKey` | `string` | Yes | Active run session key used to match the task run |
| `result` | `string` | No | Agent output text (max 50000 chars). Kanban markers are parsed and stripped automatically |
| `error` | `string` | No | Error message (max 5000 chars). If set, task moves to `todo` instead of `review` |

**Response:** The updated `KanbanTask` object.

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Invalid body or missing `sessionKey` |
| 404 | Task not found |
| 409 | No active matching run to complete |

### `POST /api/kanban/tasks/:id/approve`

Approve a task in review. Moves it to `done`.

**Rate Limit:** General (60/min)

**Request Body (optional):**

```json
{
  "note": "Looks good, nice work"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `note` | `string` | No | Approval note (max 5000 chars). Added to task feedback |

**Response:** The updated `KanbanTask` object with `status: "done"`.

**Errors:**

| Status | Condition |
|--------|-----------|
| 404 | Task not found |
| 409 | Task not in `review` status |

### `POST /api/kanban/tasks/:id/reject`

Reject a task in review. Moves it back to `todo` and clears the run and result so it can be re-executed.

**Rate Limit:** General (60/min)

**Request Body:**

```json
{
  "note": "Missing error handling for edge cases"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `note` | `string` | Yes | Rejection reason (1--5000 chars). Added to task feedback |

**Response:** The updated `KanbanTask` object with `status: "todo"`.

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Missing or empty `note` |
| 404 | Task not found |
| 409 | Task not in `review` status |

### `POST /api/kanban/tasks/:id/abort`

Abort a running task. Marks the run as aborted and moves the task back to `todo`.

**Rate Limit:** General (60/min)

**Request Body (optional):**

```json
{
  "note": "Taking too long, will retry with a different approach"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `note` | `string` | No | Abort reason (max 5000 chars). Added to task feedback |

**Response:** The updated `KanbanTask` object with `status: "todo"`.

**Errors:**

| Status | Condition |
|--------|-----------|
| 404 | Task not found |
| 409 | Task not `in-progress` with an active run |

### `GET /api/kanban/proposals`

List kanban proposals (agent-suggested task changes).

**Rate Limit:** General (60/min)

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | `string` | *(all)* | Filter by status: `pending`, `approved`, `rejected` |

**Response:**

```json
{
  "proposals": [
    {
      "id": "f8e7d6c5-...",
      "type": "create",
      "payload": { "title": "Add rate limiting to API", "priority": "high" },
      "proposedBy": "agent:kanban-abc123",
      "proposedAt": 1708100000000,
      "status": "pending",
      "version": 1
    }
  ]
}
```

Proposals are sorted most-recent first.

### `POST /api/kanban/proposals`

Create a proposal manually. Typically proposals are created automatically when agents emit kanban markers, but this endpoint allows direct creation.

**Rate Limit:** General (60/min)

**Request Body:**

```json
{
  "type": "create",
  "payload": {
    "title": "Add rate limiting to API",
    "priority": "high",
    "labels": ["backend"]
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | Yes | `"create"` or `"update"` |
| `payload` | `object` | Yes | Task fields. Schema depends on `type` (see below) |
| `sourceSessionKey` | `string` | No | Originating session key (max 500 chars) |
| `proposedBy` | `string` | No | Actor. Default: `"operator"` |

**Create payload fields:** `title` (required), `description`, `status`, `priority`, `assignee`, `labels`, `model`, `thinking`, `dueAt`, `estimateMin`

**Update payload fields:** `id` (required -- references existing task), `title`, `description`, `status`, `priority`, `assignee`, `labels`, `result`

**Response (201):** The created proposal object.

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Invalid payload for the given type |
| 404 | Update proposal references a non-existent task |

**Notes:**
- When `proposalPolicy` is `"auto"`, the proposal is immediately applied (created as `approved`).
- When `proposalPolicy` is `"confirm"` (default), the proposal stays `pending` until manually approved or rejected.

### `POST /api/kanban/proposals/:id/approve`

Approve a pending proposal. Creates or updates the task based on the proposal type.

**Rate Limit:** General (60/min)

**Response:**

```json
{
  "proposal": { "id": "...", "status": "approved", "resolvedAt": 1708100500000 },
  "task": { "id": "...", "title": "Add rate limiting to API" }
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| 404 | Proposal not found |
| 409 | Proposal already resolved (`{ "error": "already_resolved", "proposal": {...} }`) |

### `POST /api/kanban/proposals/:id/reject`

Reject a pending proposal.

**Rate Limit:** General (60/min)

**Request Body (optional):**

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
  "proposal": { "id": "...", "status": "rejected", "reason": "Not a priority right now" }
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| 404 | Proposal not found |
| 409 | Proposal already resolved |

### `GET /api/kanban/config`

Get the current board configuration.

**Rate Limit:** General (60/min)

**Response:**

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

### `PUT /api/kanban/config`

Update board configuration. Partial updates -- only include the fields you want to change.

**Rate Limit:** General (60/min)

**Request Body (partial):**

```json
{
  "proposalPolicy": "auto",
  "defaultModel": "anthropic/claude-sonnet-4-20250514",
  "quickViewLimit": 10
}
```

See [Configuration -- Kanban](./CONFIGURATION.md#kanban) for all available fields and defaults.

**Response:** The full updated config object.

**Errors:** 400 if validation fails.

---

## Error Handling

All unhandled errors return:

```
HTTP 500
Content-Type: text/plain

Internal server error
```

In development (`NODE_ENV=development`), stack traces are logged to the server console but never sent to clients.

Validation errors from Zod schemas return **400** with a human-readable message from the first validation issue.

---

## Rate Limiting

All `/api/*` routes have rate limiting applied. Limits are per-client-IP per-path using a sliding window.

| Preset | Routes | Limit |
|--------|--------|-------|
| **TTS** | `POST /api/tts` | 10 requests / 60 seconds |
| **Transcribe** | `POST /api/transcribe` | 30 requests / 60 seconds |
| **General** | Most `/api/*` routes | 60 requests / 60 seconds |
| **Restart** | `POST /api/gateway/restart` | 3 requests / 60 seconds |

**Rate limit headers** are included on every response:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
```

When exceeded:

```
HTTP 429
Retry-After: 45
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1708100060
```

**Client identification:** Uses the real TCP socket address (not spoofable headers). `X-Forwarded-For` and `X-Real-IP` are only trusted when the direct connection comes from a trusted proxy (loopback by default; extend via `TRUSTED_PROXIES` env var).

---

## Global Middleware

Applied to all requests in order:

1. **Error handler** — catches unhandled exceptions
2. **Logger** — request/response logging (Hono built-in)
3. **CORS** — restricts to configured origins (see [CONFIGURATION.md](./CONFIGURATION.md))
4. **Security headers** — CSP, HSTS, X-Frame-Options, etc. (see [SECURITY.md](./SECURITY.md))
5. **Body limit** — ~13 MB global max on `/api/*` routes
6. **Compression** — gzip/deflate on all routes except `/api/events` (SSE)
7. **Cache headers** — `no-cache` for API routes, immutable for hashed assets

---

## Static Files & SPA

- `/assets/*` — Vite-built static assets, served from `dist/`
- All non-API routes — SPA fallback to `dist/index.html` for client-side routing
- Hashed assets (e.g. `index-Pbmes8jg.js`) get `Cache-Control: public, max-age=31536000, immutable`
- Non-hashed files get `Cache-Control: public, max-age=0, must-revalidate`
