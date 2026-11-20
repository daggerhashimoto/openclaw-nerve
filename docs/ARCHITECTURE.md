# Architecture

Nerve is a local-first web cockpit for OpenClaw agents: chat, voice input, TTS, workspace files, crons, a task board and fleet monitoring in the browser. The browser talks to the OpenClaw gateway over a WebSocket that the Nerve server proxies. Some surfaces also depend on whether the Nerve server can read the agent workspace on its own filesystem.

For UI design rules (colour, type, the pane state marker, row unit, motion), see [DESIGN.md](../DESIGN.md). This document covers code structure and data flow only.

## System diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (React SPA)                                             │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌────────┐ ┌─────────┐  │
│  │ Chat     │ │ Sessions │ │ Workspace │ │ Kanban │ │ Files   │  │
│  └────┬─────┘ └────┬─────┘ └─────┬─────┘ └───┬────┘ └────┬────┘  │
│       │            │             │           │           │       │
│  ┌────┴────────────┴─────────────┴───────────┴───────────┴────┐  │
│  │  React contexts: Gateway, Settings, Session, Chat          │  │
│  └──────────────┬──────────────────────────────┬──────────────┘  │
│                 │ WebSocket (/ws)              │ fetch /api/*,   │
│                 │                              │ SSE /api/events │
└─────────────────┼──────────────────────────────┼─────────────────┘
                  │                              │
┌─────────────────┼──────────────────────────────┼─────────────────┐
│  Nerve server (Hono on Node.js)                │                 │
│                 │                              │                 │
│  ┌──────────────┴──────────────┐  ┌────────────┴──────────────┐  │
│  │ WebSocket proxy             │  │ REST API + SSE            │  │
│  │ (server/lib/ws-proxy.ts)    │  │ (server/routes/*)         │  │
│  │ origin + auth check,        │  │ middleware stack,         │  │
│  │ Ed25519 device identity,    │  │ static dist/ + SPA        │  │
│  │ gateway token injection     │  │ fallback                  │  │
│  └──────────────┬──────────────┘  └────────────┬──────────────┘  │
│                 │                              │                 │
│                 │   ┌──────────────────────────┴──────────────┐  │
│                 │   │ Gateway RPC client, HTTP tool client,   │  │
│                 │   │ kanban store, file watcher, TTS / STT   │  │
│                 │   │ services, usage tracking                │  │
│                 │   └──────────────────────────┬──────────────┘  │
└─────────────────┼──────────────────────────────┼─────────────────┘
                  │ WS                           │ WS RPC + HTTP
                  └──────────────┬───────────────┘
                     ┌───────────┴───────────────┐
                     │  OpenClaw gateway         │
                     │  (default                 │
                     │   ws://127.0.0.1:18789,   │
                     │   may be remote)          │
                     └───────────────────────────┘
```

## Locality model

Nerve has three boundaries, and each can be local or remote:

1. Browser ↔ Nerve server
2. Nerve server ↔ OpenClaw gateway
3. Nerve server ↔ agent workspace filesystem

Chat only needs the first two. Full workspace behaviour also needs the third: Nerve must be able to read the same workspace directories the agents use. That holds in deployment A and usually in same-host deployment C. It does not hold in deployment B, or in split-host deployment C, unless you mount or replicate the workspace onto the Nerve host.

| Boundary | Local case | Remote case |
|----------|------------|-------------|
| Browser ↔ Nerve | Loopback browsers are trusted for gateway token injection when auth is off | Use `NERVE_AUTH=true`. Authenticated sessions still get server-side token injection for the configured gateway |
| Nerve ↔ gateway | Default. Minimal config, loopback origin | Needs `WS_ALLOWED_HOSTS`, the gateway's `controlUi.allowedOrigins`, and sometimes `NERVE_PUBLIC_ORIGIN` so server-side RPC presents the real browser-facing origin |
| Nerve ↔ workspace | Full file browser, file mutations, raw previews, file watchers | Gateway RPC fallback (`agents.files.*`) on specific routes only. Partial, not full parity |

### Remote workspace fallback

When the workspace directory is not on the Nerve host (`server/lib/workspace-detect.ts`), routes fall back as follows:

| Surface | Local workspace | Remote workspace |
|---------|-----------------|------------------|
| Allowlisted config files (`SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `AGENTS.md`, `HEARTBEAT.md`, `CHAT_PATH_LINKS.json`) | Local read and write | Gateway read and write, top-level files only |
| File tree | Full nested tree with paging | Top-level listing only |
| Text file read and write | Any allowed path | Top-level text files only |
| Rename, move, trash, restore, path resolve | Supported | `501` with `Not supported for remote workspaces` |
| Raw image and binary preview (`/api/files/raw`) | Supported | `404`, not available |
| Memory | `MEMORY.md` plus daily files under `memory/` | `MEMORY.md` only |
| Skills | `openclaw skills list --json` scoped to the agent's workspace | No gateway fallback |

## Frontend

React 19, TypeScript, Vite 7 and Tailwind CSS v4. The `@/` import alias maps to `src/`.

### Entry and shell

- `src/main.tsx` applies the stored theme before the first render, then mounts `ErrorBoundary → StrictMode → AuthGate`.
- `src/features/auth/AuthGate.tsx` checks `/api/auth/status`. It shows a loading mark, the login page, or the app wrapped in its providers: `GatewayProvider → SettingsProvider → SessionProvider → ChatProvider → App`.
- `src/App.tsx` is the layout and wiring layer. It owns the view mode (`chat` or `kanban`), keyboard shortcuts, the command palette, the connect dialog, the reconnect banner ("Signal lost. Reconnecting...") and the dialogs for reset, gateway restart, workspace switch and spawn.

Layout, left to right: the file explorer column (collapsible; on compact layouts it is a drawer that also opens with an edge swipe), the chat column (`TabbedContentArea`: the chat plus open file and bead tabs), and a resizable right column with the session list and the workspace panel. The top bar and status bar frame the room. Kanban replaces the columns as a full view. Settings, the command palette, the session list and the workspace panel are lazy-loaded inside `PanelErrorBoundary`; the Kanban view is lazy-loaded too.

### Contexts

| Context | File | Responsibilities |
|---------|------|------------------|
| `GatewayContext` | `src/contexts/GatewayContext.tsx` | Wraps `useWebSocket`: connection state, `connect`/`disconnect`, `rpc()`, event fan-out through `subscribe()`, model and thinking from the `status` RPC, activity sparkline. Saves the gateway URL and token in `localStorage` (`oc-config`) |
| `SettingsContext` | `src/contexts/SettingsContext.tsx` | UI sounds and their volume, TTS provider and model, STT provider, input mode and model, wake word, panel ratio, theme, font, font sizes, panel visibility toggles, performance mode. Persists to `localStorage`; STT changes are also sent to the server |
| `SessionContext` | `src/contexts/SessionContext.tsx` | Session list (`sessions.list` RPC plus `/api/sessions/hidden`), per-session agent status (`IDLE`, `THINKING`, `STREAMING`, `DONE`, `ERROR`), busy and unread state, agent log and event log, and session actions: spawn, rename, delete, abort |
| `ChatContext` | `src/contexts/ChatContext.tsx` | Run state and gateway event handling for the open session. Composes `useChatMessages` (message buffer, history, infinite scroll), `useChatStreaming` (stream rendering, processing stage, activity log), `useChatRecovery` (reconnect and gap recovery) and `useChatTTS` (spoken replies, completion sounds) |

Contexts subscribe to gateway events with `GatewayContext.subscribe()`. `SessionContext` tracks `agent` and `chat` events to drive status; `ChatContext` renders the open session's stream and subscribes to that session with `sessions.messages.subscribe` so runs started outside Nerve (a channel message, a heartbeat) appear too.

### Feature modules (`src/features/`)

Each feature keeps its components, hooks, types and pure logic together. Many expose an `index.ts` barrel.

| Directory | What lives there |
|-----------|------------------|
| `activity/` | `AgentLog` (one line per thing the fleet did) and `EventLog` (raw gateway events) |
| `auth/` | `AuthGate`, `LoginPage`, `useAuth` (reads `/api/auth/status` once, exposes `login`/`logout`) |
| `beads/` | Bead viewer tabs: `links.ts` parses bead links in markdown, `useBeadDetail` fetches `/api/beads/:id`, `BeadViewerTab` renders the bead |
| `charts/` | `extractCharts` parses `[chart:{...}]` markers; `InlineChart` routes them to lazy renderers (see below) |
| `chat/` | `ChatPanel`, `InputBar` (attachments, voice, slash commands, history), `MessageBubble`, `ToolCallBlock` with lazy `DiffView` and `FileContentView`, `SearchBar` + `useMessageSearch`, `ImageLightbox`, `LiveHorizon`. `operations/` holds pure logic with no React: `loadHistory`, `sendMessage`, `streamEventHandler` (classifies gateway frames, including protocol v4 `status` and `deltaText`), `mergeRecoveredTail` (history recovery that keeps unsent prompts), `realtimeState`, `heartbeatRuns`. `components/` holds the chat header, streaming message, tool rows and processing indicators, plus `useModelEffort` (model and effort pickers) |
| `command-palette/` | `CommandPalette` and `commands.ts`: app commands (`createCommands`) and jump-to-agent or session entries (`createSessionCommands`) |
| `connect/` | `ConnectDialog`, prefilled from `/api/connect-defaults` |
| `dashboard/` | `TokenUsage`, `MemoryList`, `useLimits` (Claude Code and Codex limits, polled every 60 s) |
| `file-browser/` | `FileTreePanel` (virtualised rows), `useFileTree` with `utils/fetchTreeListing` (follows the server's `nextCursor` paging), `useOpenFiles` (tabs, save with mtime conflict detection), `TabbedContentArea`, lazy `FileEditor` (CodeMirror 6), `MarkdownDocumentView`, `ImageViewer`, `PdfViewer`, `hooks/useEdgeSwipeToOpen` |
| `kanban/` | `KanbanPanel`, `KanbanBoard`/`KanbanColumn`/`KanbanCard` (drag and drop with `@dnd-kit`), `TaskDetailDrawer`, `CreateTaskDialog`, `ProposalInbox`, `KanbanQuickView` (the workspace Tasks tab), hooks `useKanban`, `useKanbanDragDrop`, `useProposals` |
| `markdown/` | `MarkdownRenderer`: `react-markdown` with `remark-gfm`, TeX math through `remarkTexMath` + `rehype-katex`, `highlight.js` code blocks (sanitised), workspace path links (`inlineReferences`), bead links, and standalone `https://www.google.com/maps/embed?pb=...` links rendered as a map iframe in chat. `CodeBlockActions` adds copy buttons |
| `memory/` | Memory dialogs (`AddMemoryDialog`, `ConfirmDeleteDialog`, `MemoryEditor`, `MemoryItem`) and `useMemories` |
| `sessions/` | `SessionList`, `SessionNode`, `SessionInfoPanel`, `SpawnAgentDialog`, `sessionTree` (parent and child tree), `sessionKeys` (session key parsing and types), `pinnedSessions` (pins kept per browser in `localStorage`), `sessionDeletion` (which sessions the gateway refuses to delete), `statusUtils` |
| `settings/` | `SettingsDrawer` with `ConnectionSettings`, `AudioSettings`, `AppearanceSettings`, and `VoicePhrasesModal` |
| `tts/` | `useTTS` (plays `/api/tts` audio; providers `openai`, `replicate`, `edge`, `xiaomi`) and `useTTSConfig` (`/api/tts/config`) |
| `voice/` | `useVoiceInput` (Web Speech API and MediaRecorder, wake word, stop and cancel phrases, server transcription through `/api/transcribe`), `audio-feedback` (UI sounds), `wakeWordSupport` |
| `workspace/` | `WorkspacePanel` with tabs Memory, Crons, Tasks and Config (Skills is a view under Config), hooks `useWorkspaceFile`, `useCrons`, `useSkills`, plus `workspaceScope`, `workspaceSwitchGuard` and `persistedDrafts` |

Chart routing in `InlineChart`:

| Type | Renderer | Use |
|------|----------|-----|
| `tv` | TradingView widget | Live market tickers |
| `line`, `area`, `candle` | Lightweight Charts | Custom time series and OHLC data |
| `bar`, `pie` | Recharts | Categories and proportions |

### Workspace scope rules

The workspace scope follows the owning top-level agent:

- Root sessions use their own agent's workspace.
- Subagent and cron-run sessions inherit the owning top-level agent's workspace.
- A child session never creates its own workspace scope.
- The dirty-file prompt fires only when the owning top-level agent changes.
- Memory, Config, Skills, file-browser state and persisted drafts switch per agent. Crons and Kanban stay global.

### Shared code

- `src/components/`: app chrome and shared pieces: `TopBar`, `StatusBar`, `ResizablePanels`, `ContextMeter`, `UpdateBadge`, `ConfirmDialog`, `WorkspaceSwitchDialog`, `ErrorBoundary`, `PanelErrorBoundary`, `NerveLogo`, `skeletons/`.
- `src/components/ui/`: primitives (`button`, `card`, `collapsible`, `dialog`, `input`, `switch`, `InlineSelect`, `AnimatedNumber`) and `Pane`, the lit state marker described in DESIGN.md.
- `src/lib/`: themes (`themes.ts`: Workbench Night, Workbench Paper, Night, Daylight), fonts, agent identity hues (`agentColors.ts`), pane states (`paneState.ts`), constants and context-window limits, formatting, DOMPurify sanitising, `highlight.js` setup, gateway URL comparison, performance mode.
- `src/types.ts`: gateway frame and payload types shared by the client. `src/utils/helpers.ts`: content extraction and tool-call descriptions.
- `src/test/`: Vitest setup and a mock gateway.

### Hooks (`src/hooks/`)

| Hook | Purpose |
|------|---------|
| `useWebSocket` | Gateway WebSocket: connect handshake (protocol v4), RPC with timeouts, event dispatch, reconnect with exponential backoff and jitter |
| `useConnectionManager` | Auto-connect, official gateway URL resolution from `/api/connect-defaults`, `serverSideAuth` gating, saved credentials |
| `useChatMessages`, `useChatStreaming`, `useChatRecovery`, `useChatTTS` | The four parts of `ChatContext` |
| `useDashboardData` | Memories and token usage over REST, refreshed by SSE events |
| `useServerEvents` | SSE client for `/api/events` |
| `useGatewayRestart` | Gateway restart confirmation, progress and result notice |
| `useInputHistory` | Up and down arrow history for the composer, stored in `localStorage` |
| `useTabCompletion` | Tab completion in the composer |
| `useKeyboardShortcuts` | Global shortcut registration |

## Backend

Hono on Node.js 22 or later, TypeScript, ES modules.

### Entry points

- `server/index.ts`: validates config and prints the banner, starts the file watchers, the HTTP server, and an HTTPS server when certificates exist. Attaches the WebSocket proxy to both. Handles graceful shutdown on `SIGTERM` and `SIGINT`.
- `server/app.ts`: the Hono app: middleware, route mounting, static files from `dist/`, and the SPA fallback (extensionless paths get `index.html`; missing assets get `404`).

### Middleware

In order, from `server/app.ts`:

| Step | Source | Notes |
|------|--------|-------|
| Error handler | `middleware/error-handler.ts` (`app.onError`) | JSON `{ error }` for `/api/*`, plain text otherwise. Logs stacks outside production |
| Logger | `hono/logger` | Request logging |
| CORS | `hono/cors` + `lib/origin-utils.ts` | Allows loopback origins and `ALLOWED_ORIGINS`. Credentials on. Methods GET, POST, PUT, PATCH, DELETE, OPTIONS |
| Security headers | `middleware/security-headers.ts` | CSP, `X-Frame-Options: SAMEORIGIN`, `nosniff`, referrer policy, HSTS when `NODE_ENV=production`, default `Cache-Control: no-store` |
| Body limit | `hono/body-limit` | `/api/*` only, `config.limits.maxBodyBytes`, `413` when exceeded |
| Auth | `middleware/auth.ts` | With `NERVE_AUTH=true`, requires a valid session cookie on `/api/*`, except the auth endpoints, `/api/version` and `/health`. Static files pass through; the login gate handles them |
| Compression | `hono/compress` | Skipped for `/api/events` (SSE) and `/api/files/raw` |
| Cache headers | `middleware/cache-headers.ts` | API and `/health`: `no-cache`. Hashed assets: immutable for a year. Other static files: `must-revalidate` |

Rate limiting is not global. Routes opt in with presets from `middleware/rate-limit.ts` (sliding window per client IP and path; `X-Forwarded-For` trusted only from loopback or `TRUSTED_PROXIES`):

| Preset | Limit per minute | Used by |
|--------|------------------|---------|
| `rateLimitGeneral` | 60 | Most API routes |
| `rateLimitTTS` | 10 | `POST /api/tts` |
| `rateLimitTranscribe` | 30 | `POST /api/transcribe` |
| `rateLimitAuth` | 5 | `POST /api/auth/login` |
| `rateLimitRestart` | 3 | `POST /api/gateway/restart` |

### API routes

Every route file in `server/routes/` is mounted from `server/app.ts`. See [API.md](./API.md) for request and response details.

| File | Routes | Purpose |
|------|--------|---------|
| `health.ts` | `GET /health` | Server status plus a gateway reachability probe |
| `auth.ts` | `GET /api/auth/status`, `POST /api/auth/login`, `POST /api/auth/logout` | Password login with a signed session cookie |
| `connect-defaults.ts` | `GET /api/connect-defaults` | Gateway WS URL, agent name, `authEnabled`, `serverSideAuth`. `token` is always `null` |
| `events.ts` | `GET /api/events`, `POST /api/events/test` (development only) | SSE stream |
| `version.ts`, `version-check.ts` | `GET /api/version`, `GET /api/version/check` | Running version; newer release check (GitHub release, then semver tag) |
| `server-info.ts` | `GET /api/server-info` | Server time, timezone, gateway start time, agent name |
| `gateway.ts` | `GET /api/gateway/models`, `GET /api/gateway/session-info`, `POST /api/gateway/session-patch`, `POST /api/gateway/restart` | Config-backed model catalog, session model and thinking, HTTP model change, gateway restart |
| `sessions.ts` | `GET /api/sessions/hidden`, `GET /api/sessions/runtime`, `GET /api/sessions/:id/model`, `GET /api/sessions/media`, `POST /api/sessions/spawn-subagent` | Hidden cron sessions, model and thinking read from transcripts, transcript images, and a server-side subagent spawn. `hidden`, `runtime` and `media` look sessions up in the agent's local `sessions.json`, which current OpenClaw (database-backed) and remote gateways do not provide: `hidden` then returns `storeMissing: true`, `runtime` returns `missing: true`, and `media` fails with `500` |
| `chat-media.ts` | `GET /api/chat-media` | Proxies raster images the gateway hosts for chat replies, so the browser never needs the gateway token |
| `channels.ts` | `GET /api/channels` | Messaging channels configured in OpenClaw |
| `crons.ts` | `GET`/`POST /api/crons`, `PATCH`/`DELETE /api/crons/:id`, `POST /api/crons/:id/toggle`, `POST /api/crons/:id/run`, `GET /api/crons/:id/runs` | Cron jobs through the gateway's `cron.*` RPC methods. A manual run of an isolated agent-turn job goes through the `sessions_spawn` HTTP tool |
| `workspace.ts` | `GET /api/workspace`, `GET`/`PUT /api/workspace/:key` | Allowlisted workspace files per agent |
| `memories.ts` | `GET`/`POST`/`DELETE /api/memories`, `GET`/`PUT /api/memories/section` | Agent-scoped `MEMORY.md` and daily files. New memories are also sent to the gateway's `memory_store` tool (best effort) |
| `file-browser.ts` | `GET /api/files/tree`, `/resolve`, `/read`, `/raw`; `PUT /api/files/write`; `POST /api/files/rename`, `/move`, `/trash`, `/restore` | Workspace file browser. The tree is paged (`limit`, `cursor`, `nextCursor`); writes use mtime conflict detection (`409`) |
| `files.ts` | `GET /api/files` | Serves local image files by path (image types only, traversal blocked) |
| `upload-config.ts`, `upload-reference.ts` | `GET /api/upload-config`, `POST /api/upload-reference/resolve` | Attachment upload mode and limits; turns uploads or workspace paths into canonical workspace references |
| `beads.ts` | `GET /api/beads/:id` | Bead details through the `bd` CLI (`bd show <id> --json`) |
| `kanban.ts` | `/api/kanban/tasks` (CRUD, `reorder`, `execute`, `complete`, `approve`, `reject`, `abort`), `/api/kanban/proposals` (list, create, `approve`, `reject`), `/api/kanban/config` | Task board. See [Kanban subsystem](#kanban-subsystem) |
| `skills.ts` | `GET /api/skills` | `openclaw skills list --json` for the agent's workspace |
| `agent-log.ts` | `GET`/`POST /api/agentlog` | Persisted agent log (Zod-validated, mutex-protected) |
| `tokens.ts` | `GET /api/tokens` | Token and cost totals from session transcripts, with a persisted high-water mark |
| `tts.ts` | `POST /api/tts`, `GET`/`PUT /api/tts/config` | Speech synthesis and voice config |
| `transcribe.ts` | `POST /api/transcribe`, `GET`/`PUT /api/transcribe/config`, `GET`/`PUT /api/language`, `GET /api/language/support` | Speech-to-text, STT config, language and provider support |
| `voice-phrases.ts` | `GET /api/voice-phrases`, `GET /api/voice-phrases/status`, `GET`/`PUT /api/voice-phrases/:lang` | Wake, stop and cancel phrases per language |
| `api-keys.ts` | `GET`/`PUT /api/keys` | Which API keys are set; writes keys to `.env` |
| `claude-code-limits.ts`, `codex-limits.ts` | `GET /api/claude-code-limits`, `GET /api/codex-limits` | Claude Code limits from the `claude` CLI in a PTY; Codex limits from OpenAI with a local session-file fallback. Cached 5 minutes |

### How the server reaches the gateway

- `server/lib/gateway-rpc.ts` (`gatewayRpcCall`): one persistent WebSocket to the gateway, signed with Nerve's device identity, negotiating protocol v4. Used for `cron.*`, `sessions.*`, `agents.files.*` (remote workspace fallback) and the Kanban assignee launch path.
- `server/lib/gateway-client.ts` (`invokeGatewayTool`): HTTP `POST /tools/invoke`. Still used for `sessions_spawn` (Kanban runs and manual cron runs), `subagents` and `sessions_history` (Kanban polling), `sessions_list` and `session_status` (`/api/gateway/session-info` and `session-patch`), and `memory_store`.

### Server modules (`server/lib/`)

| Area | Modules |
|------|---------|
| Config and auth | `config.ts` (env, defaults, startup validation, refuses `HOST=0.0.0.0` without auth unless `NERVE_ALLOW_INSECURE=true`), `constants.ts`, `session.ts` (HMAC-SHA256 session tokens, scrypt passwords), `trust-utils.ts`, `origin-utils.ts`, `env-file.ts` |
| Gateway | `ws-proxy.ts`, `ws-backpressure.ts`, `device-identity.ts` (Ed25519 keypair in `${NERVE_DATA_DIR:-~/.nerve}/device-identity.json`), `gateway-rpc.ts`, `gateway-client.ts`, `subagent-spawn.ts`, `openclaw-config.ts`, `openclaw-bin.ts` |
| Workspace and files | `agent-workspace.ts`, `workspace-detect.ts`, `file-utils.ts`, `file-ops.ts` (rename, move, trash, restore), `file-watcher.ts`, `files.ts`, `upload-config.ts`, `upload-reference.ts`, `chat-path-links-config.ts` |
| Kanban | `kanban-store.ts`, `kanban-assignee.ts`, `kanban-subagent-fallback.ts`, `parseMarkers.ts` |
| Beads and plans | `beads.ts`, `plans.ts` |
| Usage, voice, utilities | `token-usage.ts`, `usage-tracker.ts`, `tts-config.ts`, `language.ts`, `voice-phrases.ts`, `cached-fetch.ts`, `mutex.ts`, `sse-backpressure.ts`, `release-source.ts` |

`file-watcher.ts` watches each agent's `MEMORY.md` and `memory/` directory, and the whole workspace recursively unless `NERVE_WATCH_WORKSPACE_RECURSIVE=false`. It broadcasts agent-tagged `memory.changed` and `file.changed` SSE events.

### Services (`server/services/`)

External provider clients: `openai-tts.ts`, `openai-realtime-tts.ts`, `replicate-tts.ts`, `edge-tts.ts`, `xiaomi-tts.ts`, `tts-cache.ts` (in-memory LRU with TTL and a 100 MB budget), `openai-whisper.ts`, `whisper-local.ts` (whisper.cpp through `@fugood/whisper.node`, downloads models on demand), and `claude-usage.ts` (runs `claude` in a PTY and parses `/usage`).

`POST /api/tts` uses the requested provider, otherwise OpenAI when an OpenAI key is set, then Replicate when a Replicate token is set, then Edge.

### Updater

`npm run update` runs `bin/nerve-update.ts` (compiled to `bin-dist/bin/nerve-update.js`), which drives `server/lib/updater/`: lock, preflight, resolve the target release, snapshot, check out, build, restart the service, health check, and roll back on failure. State lives in `~/.nerve/updater/`. See [UPDATING.md](./UPDATING.md).

### Setup and install

`npm run setup` runs the interactive wizard in `scripts/setup.ts` with helpers in `scripts/lib/` (gateway detection and locality, access plan, `.env` writer, certificates, Tailscale, prerequisite checks). `install.sh` installs, builds and registers the service. See [INSTALLER-STEPS.md](./INSTALLER-STEPS.md) and [CONFIGURATION.md](./CONFIGURATION.md).

## Data flow

### WebSocket proxy

```
Browser WS → /ws?target=<gateway ws url> → server/lib/ws-proxy.ts → OpenClaw gateway
```

1. The browser opens `/ws` on the Nerve server (HTTP or HTTPS).
2. The upgrade is refused with `403` if the `Origin` is not allowed, and with `401` if auth is on and the session cookie is invalid.
3. The `target` must be a `ws:` or `wss:` URL whose host is in `WS_ALLOWED_HOSTS`, or the socket closes with `1008`.
4. The proxy opens the upstream socket. It holds the client's `connect` request until the gateway's `connect.challenge` arrives, then signs the nonce with Nerve's Ed25519 device identity and, for trusted clients that sent no token, injects the gateway token. If no challenge arrives within 5 seconds, it sends the request without device identity.
5. If the gateway closes with `1008` for a device problem (unknown device, pairing required, token or signature mismatch), the proxy retries once without device identity, with reduced scopes.
6. After the handshake, frames pass through in both directions. Frames sent before the gateway is ready are buffered (up to 100 frames or 1 MB).

### Gateway RPC from the browser

The client calls gateway methods with `GatewayContext.rpc()`:

| Method | Used for |
|--------|----------|
| `connect` | Handshake, protocol v4, sent by `useWebSocket` |
| `status` | Current model and thinking level |
| `sessions.list` | Session list |
| `sessions.patch` | Label, model and thinking changes |
| `sessions.reset` | Clear a session's context |
| `sessions.delete` | Delete a session |
| `sessions.messages.subscribe`, `sessions.messages.unsubscribe` | Follow the open session, including runs Nerve did not start |
| `agents.create` | Register a new top-level agent when spawning one |
| `chat.send` | Send a message (with an idempotency key) |
| `chat.history` | Load history |
| `chat.abort` | Stop the current run |

Subagent spawns go through `POST /api/sessions/spawn-subagent` instead, so the server owns the child's lifecycle.

### Gateway events

| Event | Purpose |
|-------|---------|
| `connect.challenge` | Starts the handshake (`{ nonce }`) |
| `chat` | Run state for a session: `started` (protocol v4 gateways send repeated `status` frames instead), `delta` (`deltaText`, with a `message` snapshot on the first frame), `final`, `aborted`, `error` |
| `agent` | Agent streams: `lifecycle`, `tool` (start and result), `assistant` |
| `session.message` | A row committed to a subscribed session's transcript |
| `sessions.changed` | With `phase: "message"`, reports a committed row the gateway could not send as `session.message` |
| `cron` | A cron job fired |
| `exec.approval.requested`, `exec.approval.resolved` | Exec approval flow (shown in the agent log) |
| `presence` | Presence updates (event log only) |

### Server-sent events

```
Browser → GET /api/events → text/event-stream
```

The server emits `memory.changed` and `file.changed` (from the file watcher and the memories API, tagged with `agentId`) and a `ping` every 30 seconds. The client also listens for `tokens.updated` and `status.changed`, but nothing on the server emits them today. SSE is excluded from compression, and slow clients are handled by `sse-backpressure.ts`.

### REST

REST routes either call the gateway (crons, gateway info, Kanban, remote workspace fallback, subagent spawn) or read local state (workspace files, transcripts, tokens, agent log, server info, the Kanban store).

## Kanban subsystem

A task board with agent execution, drag-and-drop ordering, and proposals that let agents suggest changes.

### Store

```
${NERVE_DATA_DIR:-~/.nerve}/kanban/tasks.json   tasks, proposals and board config in one JSON file
${NERVE_DATA_DIR:-~/.nerve}/kanban/audit.log    append-only audit log (JSONL)
```

`KanbanStore` (`server/lib/kanban-store.ts`) serialises every mutation through an async mutex, reads the file, applies the change, and writes it back through a temp file and rename. The schema is versioned (`meta.schemaVersion`) and `migrate()` backfills new fields on every read. On first start, data from the legacy `server-dist/data/kanban/` or `server/data/kanban/` locations is migrated into the data directory.

### State machine

```
                   execute                  run succeeds          approve
  backlog ─────┐                     ┌───────> review ─────────────> done
               ├──────> in-progress ─┤           │
  todo ────────┘           │         │           │ reject (note required,
                           │         │           │ clears run and result)
                           │         │           v
                           │         └─ run fails or times out ──> todo
                           └──── abort ────────────────────────> todo
```

| Transition | From | To | Trigger |
|------------|------|----|---------|
| Execute | `backlog`, `todo` | `in-progress` | `POST .../execute` |
| Complete (success) | `in-progress` | `review` | Poller or `POST .../complete` |
| Complete (error) | `in-progress` | `todo` | Poller, timeout, or `POST .../complete` with `error` |
| Approve | `review` | `done` | `POST .../approve` |
| Reject | `review` | `todo` | `POST .../reject` |
| Abort | `in-progress` | `todo` | `POST .../abort` |

`cancelled` exists as a status (hidden column by default) but has no workflow transition; tasks move there with `PATCH`.

### Versioning

Every task has a `version` that increments on each mutation. `PATCH /api/kanban/tasks/:id` and `POST .../reorder` must send the current version. On a mismatch the server returns `409`:

```json
{ "error": "version_conflict", "serverVersion": 5, "latest": { "...": "..." } }
```

Workflow actions (execute, complete, approve, reject, abort) do not take a version; they check the task's status instead.

### Execution

`POST /api/kanban/tasks/:id/execute` runs inside a per-task mutex (`kanban-execute:<id>`). A task already in progress gets `409 duplicate_execution`. Then one of two launch paths runs:

- **Assigned to a worker agent** (`agent:<id>`, other than `main`): the parent root `agent:<id>:main` must exist in `sessions.list`, or the request fails with `409 invalid_execution_target`. `kanban-subagent-fallback.ts` creates a child session under that root (`sessions.create`) and sends it the task (`sessions.send`), deleting the child if the send fails. The poller reads `sessions.list` every 5 seconds until the child finishes, fetches the reply with `sessions.get`, and reports the outcome back to the parent session with `sessions.send`.
- **Unassigned, operator or `agent:main`**: the server spawns a run with the `sessions_spawn` HTTP tool (`mode: "run"`). The poller reads the `subagents` tool every 5 seconds and fetches the reply with `sessions_history`. This path is refused with `409 invalid_execution_target` in fallback mode, which is the default on macOS; `NERVE_KANBAN_EXECUTION_MODE=primary` or `fallback` overrides the platform default.

Both pollers stop after 720 attempts (60 minutes) and fail the run with "Run timed out (polling limit reached)". They also stop when the task no longer matches the run. A successful run moves the task to `review` with the reply as its result; a failed one returns it to `todo`.

Model and thinking resolve as: execute request, then task, then the board's `defaultModel` and `defaultThinking`, then OpenClaw's default model. Thinking falls back to `low` when unset or `off`.

### Markers and proposals

When a run finishes (through the poller or `POST .../complete`), its result is scanned for markers:

```
[kanban:create]{"title":"Fix login bug","priority":"high"}[/kanban:create]
[kanban:update]{"id":"abc","status":"done"}[/kanban:update]
```

Each valid marker becomes a proposal, and the markers are stripped from the saved result. The full format is in [Agent Markers](./AGENT-MARKERS.md). The board's `proposalPolicy` decides what happens next: `confirm` (default) keeps proposals pending until the operator approves or rejects them in the inbox; `auto` applies them on creation.

### Polling

| What | Who | Interval |
|------|-----|----------|
| Task list | Frontend (`useKanban`) | 5 s |
| Proposals | Frontend (`useProposals`) | 5 s |
| Running tasks | Backend, one loop per run | 5 s, up to 60 minutes |

## Build system

### Development

```bash
npm run dev                    # Vite on :3080 (VITE_PORT), proxies /api and /ws to :3081
PORT=3081 npm run dev:server   # tsx watch server/index.ts
```

Vite proxies to `http://localhost:${PORT:-3081}` (the `PORT` of the Vite process). The backend defaults to `:3080`, so set `PORT=3081` for it in this split setup.

### Production

```bash
npm run build          # tsc -b, vite build → dist/, then npm run build:server
npm run build:server   # server → server-dist/, updater CLI → bin-dist/
npm start              # node server-dist/index.js
npm run prod           # npm run build, then start
```

### Vite

- Plugins: `@vitejs/plugin-react`, `@tailwindcss/vite`.
- `@/` alias to `src/`; `__APP_VERSION__` is defined from `package.json`.
- Manual chunks: `react-vendor`, `markdown`, `charts-vendor`, `lightweight-charts`, `editor-vendor`, `ui-vendor`, `utils`. No production sourcemaps.
- Dev server binds `VITE_HOST` (default `127.0.0.1`) and uses HTTPS when `certs/cert.pem` and `certs/key.pem` exist, unless `VITE_DISABLE_HTTPS=true`.

### TypeScript

`tsconfig.json` references four type-check-only projects, all `strict`:

- `config/tsconfig.app.json`: `src/` (tests excluded)
- `config/tsconfig.node.json`: `vite.config.ts`
- `config/tsconfig.server.json`: `server/` (emitted to `server-dist/` by `build:server`)
- `config/tsconfig.scripts.json`: `scripts/`

`config/tsconfig.bin.json` compiles `bin/` and `server/lib/updater/` to `bin-dist/` separately.

## Testing

Vitest with jsdom and global test APIs. Tests sit next to the code they cover in `src/`, `server/` and `scripts/`.

```bash
npm test                # watch mode in a terminal
npm test -- --run       # single run, as CI does
npm run test:coverage   # V8 coverage: text, HTML, lcov
```

- Setup: `src/test/setup.ts` (jest-dom matchers, a `localStorage` shim). `src/test/mock-gateway.ts` helps tests that need a gateway.
- Excluded: `node_modules/`, `server-dist/` (compiled copies of tests) and `.worktrees/`.
- CI (`.github/workflows/ci.yml`) runs on every push and pull request with Node 22: `npm ci`, `npm run lint`, `npm run build`, `npm run build:server`, `npm test -- --run`.
