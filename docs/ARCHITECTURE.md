# Architecture

> **Nerve** is a local-first web interface for OpenClaw: chat, voice input, TTS, workspace tooling, and agent monitoring in the browser. It usually talks to the OpenClaw gateway over WebSocket, but some UI surfaces also depend on whether the Nerve server can reach the agent workspace on its own filesystem.

## System Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (React SPA)                                             │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌────────────────┐  │
│  │ ChatPanel│  │ Sessions │  │ Workspace │  │ Command Palette│  │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘  └────────────────┘  │
│       │              │              │                             │
│  ┌────┴──────────────┴──────────────┴────────────────────────┐   │
│  │           React Contexts (Gateway, Session, Chat, Settings)│   │
│  └────────────────────────────┬──────────────────────────────┘   │
│                               │ WebSocket (/ws proxy)            │
└───────────────────────────────┼──────────────────────────────────┘
                                │
┌───────────────────────────────┼──────────────────────────────────┐
│  Nerve Server (Hono + Node)   │                                  │
│                               │                                  │
│  ┌────────────────────────────┴─────────────┐                    │
│  │         WebSocket Proxy (ws-proxy.ts)     │                   │
│  │  - Intercepts connect.challenge           │                   │
│  │  - Injects device identity (Ed25519)      │                   │
│  └────────────────────────────┬──────────────┘                   │
│                               │                                  │
│  ┌───────────────┐  ┌────────┴─────┐  ┌───────────────────────┐ │
│  │ REST API      │  │ SSE Stream   │  │ Static File Server    │ │
│  │ /api/*        │  │ /api/events  │  │ Vite build → dist/    │ │
│  └───────┬───────┘  └──────────────┘  └───────────────────────┘ │
│          │                                                       │
│  ┌───────┴──────────────────────────────────────────────────┐    │
│  │  Services: TTS (OpenAI, Replicate, Edge), Whisper,       │    │
│  │  Claude Usage, TTS Cache, Usage Tracker                  │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────┬───────────────────────────────────┘
                               │ HTTP / WS
                    ┌──────────┴───────────────┐
                    │  OpenClaw Gateway         │
                    │  (default:                │
                    │   ws://127.0.0.1:18789,   │
                    │   but may be remote)      │
                    └──────────────────────────┘
```

## Locality model

Nerve is easiest to reason about if you separate three boundaries:

1. **Browser ↔ Nerve server**
2. **Nerve server ↔ OpenClaw gateway**
3. **Nerve server ↔ agent workspace filesystem**

The biggest docs trap is assuming only the gateway matters. It does not.

Full deployment-A behavior depends on **Nerve having local access to the same workspace filesystem as the gateway-backed agent**. That is true in deployment A, and usually also in same-host deployment C. It is **not** true in deployment B, or in split-host deployment C, unless you deliberately mount or replicate the workspace onto the Nerve host.

### What each boundary changes

| Boundary | Local case | Remote case |
|----------|------------|-------------|
| Browser ↔ Nerve | Loopback browser access is implicitly trusted for official gateway auto-connect flows | Remote browsers should use `NERVE_AUTH=true`. Trusted authenticated sessions can still get server-side gateway token injection for the official gateway URL |
| Nerve ↔ Gateway | Default path. Minimal config, loopback origin, simplest support surface | Requires `WS_ALLOWED_HOSTS`, correct gateway `controlUi.allowedOrigins`, and in some cases `NERVE_PUBLIC_ORIGIN` so server-side gateway RPC uses the real browser-facing origin |
| Nerve ↔ workspace filesystem | Full file browser, file mutations, raw previews, local watchers, and normal workspace UX | Falls back to gateway RPC only where specific routes support it. This is partial, not full parity |

### Remote workspace fallback boundaries

When the Nerve server cannot access the workspace directory locally, the app enters a partial fallback mode.

| Surface | Local workspace | Remote workspace |
|---------|-----------------|------------------|
| Allowlisted config files (`SOUL.md`, `TOOLS.md`, `USER.md`, `AGENTS.md`, `HEARTBEAT.md`, `IDENTITY.md`) | Normal local read/write | Gateway fallback read/write for allowlisted top-level files only |
| File tree | Full nested tree | Top-level listing only |
| Text file read/write | Any allowed path in the workspace | Top-level text files only |
| Rename / move / trash / restore | Supported | `501 Not supported for remote workspaces` |
| Raw image / binary preview | Supported | Not available |
| Memory data | Full `MEMORY.md` plus recent daily files | Limited fallback for `MEMORY.md`; daily files are local-only, and the current UI treats remote workspaces as a constrained path rather than deployment-A parity |
| Skills tab | Local `openclaw skills list` scoped to the selected workspace | No dedicated gateway file fallback. Verify behavior in split-topology installs instead of assuming parity |

This is why deployment B and split-host deployment C feel different from deployment A even when chat itself is healthy.

## Frontend Structure

Built with **React 19**, **TypeScript**, **Vite**, and **Tailwind CSS v4**.

### Entry Point

| File | Purpose |
|------|---------|
| `src/main.tsx` | Mounts the React tree: `ErrorBoundary → StrictMode → AuthGate`. The auth gate checks session status before rendering the app |
| `src/App.tsx` | Root layout — wires contexts to lazy-loaded panels, manages keyboard shortcuts and command palette |

### Context Providers (State Management)

All global state flows through four React contexts, nested in dependency order:

| Context | File | Responsibilities |
|---------|------|-----------------|
| **GatewayContext** | `src/contexts/GatewayContext.tsx` | WebSocket connection lifecycle, RPC method calls, event fan-out via pub/sub pattern, model/thinking status polling, activity sparkline |
| **SettingsContext** | `src/contexts/SettingsContext.tsx` | Sound, TTS provider/model, wake word, panel ratio, theme, font, font size, telemetry/events visibility. Persists to `localStorage` |
| **SessionContext** | `src/contexts/SessionContext.tsx` | Session list (via gateway RPC), granular agent status tracking (IDLE/THINKING/STREAMING/DONE/ERROR), busy state derivation, unread session tracking, agent log, event log, session CRUD (delete, spawn, rename, abort) |
| **ChatContext** | `src/contexts/ChatContext.tsx` | Thin orchestrator composing 4 hooks: `useChatMessages` (CRUD, history, scroll), `useChatStreaming` (deltas, processing stage, activity log), `useChatRecovery` (reconnect, retry, gap detection), `useChatTTS` (playback, voice fallback, sound feedback) |

**Data flow pattern:** Contexts subscribe to gateway events via `GatewayContext.subscribe()`. The `SessionContext` listens for `agent` and `chat` events to update granular status. The `ChatContext` listens for streaming deltas and lifecycle events to render real-time responses.

### Feature Modules

Each feature lives in `src/features/<name>/` with its own components, hooks, types, and operations.

#### `features/auth/`
Authentication gate and login UI.

| File | Purpose |
|------|---------|
| `AuthGate.tsx` | Top-level component — shows loading spinner, login page, or the full app depending on auth state |
| `LoginPage.tsx` | Full-screen password form matching Nerve's dark theme. Auto-focus, Enter-to-submit, gateway token hint |
| `useAuth.ts` | Auth state via `useSyncExternalStore`. Module-level fetch checks `/api/auth/status` once on load. Exposes `login`/`logout` callbacks |
| `index.ts` | Barrel export |

#### `features/chat/`
The main chat interface.

| File | Purpose |
|------|---------|
| `ChatPanel.tsx` | Full chat view — message list with infinite scroll, input bar, streaming indicator, search |
| `InputBar.tsx` | Text input with voice recording, image attachment, tab completion, input history |
| `MessageBubble.tsx` | Renders individual messages (user, assistant, tool, system) with markdown |
| `ToolCallBlock.tsx` | Renders tool call blocks with name, arguments, and results |
| `DiffView.tsx` | Side-by-side diff rendering for file edits |
| `FileContentView.tsx` | Syntax-highlighted file content display |
| `ImageLightbox.tsx` | Full-screen image viewer |
| `SearchBar.tsx` | In-chat message search (Cmd+F) |
| `MemoriesSection.tsx` | Inline memory display within chat |
| `edit-blocks.ts` | Parses edit/diff blocks from tool output |
| `extractImages.ts` | Extracts image content blocks from messages |
| `image-compress.ts` | Client-side image compression before upload |
| `types.ts` | Chat-specific types (`ChatMsg`, `ImageAttachment`) |
| `utils.ts` | Chat utility functions |
| `useMessageSearch.ts` | Hook for message search filtering |
| `operations/` | Pure business logic (no React): `loadHistory.ts`, `sendMessage.ts`, `streamEventHandler.ts` |
| `components/` | Sub-components: `ActivityLog`, `ChatHeader`, `HeartbeatPulse`, `ProcessingIndicator`, `ScrollToBottomButton`, `StreamingMessage`, `ThinkingDots`, `ToolGroupBlock`, `useModelEffort` |

#### `features/sessions/`
Session management sidebar.

| File | Purpose |
|------|---------|
| `SessionList.tsx` | Hierarchical session tree with parent-child relationships |
| `SessionNode.tsx` | Individual session row with status indicator, context menu |
| `SessionInfoPanel.tsx` | Session detail panel (model, tokens, thinking level) |
| `SpawnAgentDialog.tsx` | Dialog for spawning top-level agents and subagents with task, model, thinking, and subagent **After run** cleanup config |
| `sessionTree.ts` | Builds tree structure from flat session list using `parentId` |
| `statusUtils.ts` | Maps agent status to icons and labels |

#### `features/file-browser/`
Full workspace file browser with tabbed CodeMirror editor.

| File | Purpose |
|------|---------|
| `FileTreePanel.tsx` | Collapsible file tree sidebar with directory expand/collapse |
| `FileTreeNode.tsx` | Individual file/directory row with icon and indent |
| `EditorTabBar.tsx` | Tab bar for open files with close buttons |
| `EditorTab.tsx` | Single editor tab with modified indicator |
| `FileEditor.tsx` | CodeMirror 6 editor — syntax highlighting, line numbers, search, Cmd+S save |
| `TabbedContentArea.tsx` | Manages chat/editor tab switching (chat never unmounts) |
| `editorTheme.ts` | One Dark-inspired CodeMirror theme matching Nerve's dark aesthetic |
| `hooks/useFileTree.ts` | File tree data fetching and directory toggle state |
| `hooks/useOpenFiles.ts` | Open file tab management, save with mtime conflict detection |
| `utils/fileIcons.tsx` | File extension → icon mapping |
| `utils/languageMap.ts` | File extension → CodeMirror language extension mapping |
| `types.ts` | Shared types (FileNode, OpenFile, etc.) |

#### `features/workspace/`
Workspace file editor and management tabs.

The workspace scope is derived from the **owning top-level agent**. Memory, Config, Skills, file-browser state, and persisted drafts follow that top-level agent. Crons and Kanban stay global.

| File | Purpose |
|------|---------|
| `WorkspacePanel.tsx` | Container for workspace tabs, scoped by the current top-level workspace agent |
| `WorkspaceTabs.tsx` | Tab switcher (Memory, Config, Crons, Skills) |
| `tabs/MemoryTab.tsx` | View/edit the selected top-level agent's `MEMORY.md` and daily files |
| `tabs/ConfigTab.tsx` | Edit scoped workspace files (`SOUL.md`, `TOOLS.md`, `USER.md`, etc.) for the selected top-level agent |
| `tabs/CronsTab.tsx` | Cron job management (list, create, toggle, run). Remains global |
| `tabs/CronDialog.tsx` | Cron creation/edit dialog |
| `tabs/SkillsTab.tsx` | View installed skills for the selected top-level agent workspace |
| `hooks/useWorkspaceFile.ts` | Fetch/save scoped workspace files via REST API + `agentId` |
| `hooks/useCrons.ts` | Cron CRUD operations via REST API |
| `hooks/useSkills.ts` | Fetch scoped skills list via `agentId` |
| `workspaceScope.ts` | Derives workspace scope and localStorage keys from the owning top-level agent |
| `workspaceSwitchGuard.ts` | Pure guard logic for dirty-file prompts when switching between top-level agents |

### Workspace scope rules

- Root sessions use their own top-level agent as workspace scope
- Subagent and cron-run views inherit the owning top-level agent workspace
- The child session itself does **not** create a separate workspace scope
- Cross-agent dirty file prompts only fire when the owning top-level agent changes
- Crons and Kanban stay global even while Memory, Config, Skills, and file-browser state switch per agent

#### `features/settings/`
Settings drawer with tabbed sections.

| File | Purpose |
|------|---------|
| `SettingsDrawer.tsx` | Slide-out drawer container. Includes logout button when auth is enabled |
| `ConnectionSettings.tsx` | Gateway URL/token, reconnect |
| `AudioSettings.tsx` | TTS provider, model, voice, wake word |
| `AppearanceSettings.tsx` | Theme, font family, font size selection |

#### `features/tts/`
Text-to-speech integration.

| File | Purpose |
|------|---------|
| `useTTS.ts` | Core TTS hook, speaks text via server `/api/tts` endpoint. Supports OpenAI, Replicate, Edge (default), and Xiaomi MiMo providers |
| `useTTSConfig.ts` | Server-side TTS voice configuration management for Qwen, OpenAI, Edge, and Xiaomi MiMo settings |

#### `features/voice/`
Voice input and audio feedback.

| File | Purpose |
|------|---------|
| `useVoiceInput.ts` | Web Speech API integration for voice-to-text with Whisper fallback |
| `audio-feedback.ts` | Notification sounds (ping on response complete) |

#### `features/markdown/`
Markdown rendering pipeline.

| File | Purpose |
|------|---------|
| `MarkdownRenderer.tsx` | `react-markdown` with `remark-gfm`, syntax highlighting via `highlight.js` |
| `CodeBlockActions.tsx` | Copy/run buttons on code blocks |

#### `features/charts/`
Inline chart rendering with three renderers: **TradingView widgets** for live financial data, **Lightweight Charts** for custom time-series and candlestick data, and **Recharts** for bar/pie charts.

| File | Purpose |
|------|---------|
| `InlineChart.tsx` | Chart router — dispatches `[chart:{...}]` markers to the correct renderer based on `type` |
| `extractCharts.ts` | Bracket-balanced parser for `[chart:{...}]` markers. Validates chart data by type (bar, line, pie, area, candle, tv) |
| `LightweightChart.tsx` | Renders line, area, and candlestick charts using `lightweight-charts` (TradingView). Dark theme, gradient fills, crosshair, percentage change badges |
| `TradingViewWidget.tsx` | Embeds TradingView Advanced Chart widget via official script injection for real financial tickers (e.g. `TVC:GOLD`, `BITSTAMP:BTCUSD`) |

**Chart type routing:**

| Type | Renderer | Use case |
|------|----------|----------|
| `tv` | TradingView Widget | Live financial tickers (stocks, crypto, forex, commodities) |
| `line`, `area` | Lightweight Charts | Custom time-series data |
| `candle` | Lightweight Charts | Custom OHLC candlestick data |
| `bar`, `pie` | Recharts | Category comparisons, proportions |

#### `features/command-palette/`
Cmd+K command palette.

| File | Purpose |
|------|---------|
| `CommandPalette.tsx` | Fuzzy-search command list |
| `commands.ts` | Command definitions (new session, reset, theme, TTS, etc.) |

#### `features/connect/`
| File | Purpose |
|------|---------|
| `ConnectDialog.tsx` | Initial gateway connection dialog. Uses official gateway URL + `serverSideAuth` metadata from `/api/connect-defaults` to decide whether the token field is needed |

#### `features/activity/`
| File | Purpose |
|------|---------|
| `AgentLog.tsx` | Scrolling agent activity log (tool calls, lifecycle events) |
| `EventLog.tsx` | Raw gateway event stream display |

#### `features/dashboard/`
| File | Purpose |
|------|---------|
| `TokenUsage.tsx` | Token usage and cost display |
| `MemoryList.tsx` | Memory listing component |
| `useLimits.ts` | Claude Code / Codex rate limit polling |

#### `features/memory/`
| File | Purpose |
|------|---------|
| `MemoryEditor.tsx` | Inline memory editing |
| `MemoryItem.tsx` | Individual memory display with edit/delete |
| `AddMemoryDialog.tsx` | Dialog for adding new memories |
| `ConfirmDeleteDialog.tsx` | Delete confirmation |
| `useMemories.ts` | Memory CRUD operations |

### Shared Components

| Path | Purpose |
|------|---------|
| `components/TopBar.tsx` | Header with agent log, token data, event indicators |
| `components/StatusBar.tsx` | Footer with connection state, session count, sparkline, context meter |
| `components/ResizablePanels.tsx` | Draggable split layout (chat left, panels right) |
| `components/ContextMeter.tsx` | Visual context window usage bar |
| `components/ConfirmDialog.tsx` | Reusable confirmation modal |
| `components/ErrorBoundary.tsx` | Top-level error boundary |
| `components/PanelErrorBoundary.tsx` | Per-panel error boundary (isolates failures) |
| `components/NerveLogo.tsx` | SVG logo component |
| `components/skeletons/` | Loading skeleton components (Message, Session, Memory) |
| `components/ui/` | Primitives: `button`, `card`, `dialog`, `input`, `switch`, `scroll-area`, `collapsible`, `AnimatedNumber`, `InlineSelect` |

### Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useWebSocket` | `hooks/useWebSocket.ts` | Core WebSocket management — connect, RPC, auto-reconnect with exponential backoff |
| `useConnectionManager` | `hooks/useConnectionManager.ts` | Auto-connect logic, official gateway resolution, `serverSideAuth` gating, and credential persistence in `localStorage` |
| `useDashboardData` | `hooks/useDashboardData.ts` | Fetches memories and token data via REST + SSE |
| `useServerEvents` | `hooks/useServerEvents.ts` | SSE client for `/api/events` |
| `useInputHistory` | `hooks/useInputHistory.ts` | Up/down arrow input history |
| `useTabCompletion` | `hooks/useTabCompletion.ts` | Tab completion for slash commands |
| `useKeyboardShortcuts` | `hooks/useKeyboardShortcuts.ts` | Global keyboard shortcut registration |
| `useGitInfo` | `hooks/useGitInfo.ts` | Git branch/status display |

### Libraries

| File | Purpose |
|------|---------|
| `lib/constants.ts` | App constants: context window limits (with dynamic `getContextLimit()` fallback), wake/stop/cancel phrase builders, attachment limits |
| `lib/themes.ts` | Theme definitions and CSS variable application |
| `lib/fonts.ts` | Font configuration |
| `lib/formatting.ts` | Message formatting utilities |
| `lib/sanitize.ts` | HTML sanitization via DOMPurify |
| `lib/highlight.ts` | Syntax highlighting configuration |
| `lib/utils.ts` | `cn()` classname merge utility (clsx + tailwind-merge) |
| `lib/progress-colors.ts` | Color scales for progress indicators |
| `lib/text/isStructuredMarkdown.ts` | Detects structured markdown for rendering decisions |

---

## Backend Structure

Built with **Hono** (lightweight web framework), **TypeScript**, running on **Node.js ≥22**.

### Entry Point

| File | Purpose |
|------|---------|
| `server/index.ts` | Starts HTTP + HTTPS servers, sets up WebSocket proxy, file watchers, graceful shutdown |
| `server/app.ts` | Hono app definition — middleware stack, route mounting, static file serving with SPA fallback |

### Middleware Stack

Applied in order in `app.ts`:

| Middleware | File | Purpose |
|------------|------|---------|
| Error handler | `middleware/error-handler.ts` | Catches unhandled errors, returns consistent JSON. Shows stack in dev |
| Logger | Hono built-in | Request logging |
| CORS | Hono built-in + custom | Whitelist of localhost origins + `ALLOWED_ORIGINS` env var. Validates via `URL` constructor. Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS |
| Security headers | `middleware/security-headers.ts` | Standard security headers (CSP, X-Frame-Options, etc.) |
| Body limit | Hono built-in | Configurable max body size (from `config.limits.maxBodyBytes`) |
| Auth | `middleware/auth.ts` | When `NERVE_AUTH=true`, requires a valid signed session cookie on `/api/*` routes (except auth endpoints and health). WebSocket upgrades checked separately in `ws-proxy.ts` |
| Compression | Hono built-in | gzip/brotli on all routes **except** SSE (`/api/events`) |
| Cache headers | `middleware/cache-headers.ts` | Hashed assets → immutable, API → no-cache, non-hashed static → must-revalidate |
| Rate limiting | `middleware/rate-limit.ts` | Per-IP sliding window. Separate limits for general API vs TTS/transcribe. Client ID from socket or custom header |

### API Routes

| Route | File | Methods | Purpose |
|-------|------|---------|---------|
| `/health` | `routes/health.ts` | GET | Health check with gateway connectivity probe |
| `/api/auth/status` | `routes/auth.ts` | GET | Check whether auth is enabled and current session validity |
| `/api/auth/login` | `routes/auth.ts` | POST | Authenticate with password, set signed session cookie |
| `/api/auth/logout` | `routes/auth.ts` | POST | Clear session cookie |
| `/api/connect-defaults` | `routes/connect-defaults.ts` | GET | Returns the official gateway WS URL plus `authEnabled` / `serverSideAuth` metadata. `token` is always `null`; trusted flows use server-side token injection |
| `/api/events` | `routes/events.ts` | GET, POST | SSE stream for real-time push (memory.changed, tokens.updated, status.changed, ping). POST for test events |
| `/api/tts` | `routes/tts.ts` | POST | Text-to-speech with provider auto-selection (OpenAI → Replicate → Edge). LRU cache with TTL |
| `/api/tts/config` | `routes/tts.ts` | GET, PUT | TTS voice configuration per provider (read / partial update) |
| `/api/transcribe` | `routes/transcribe.ts` | POST | Audio transcription via OpenAI Whisper or local whisper.cpp (`STT_PROVIDER`). Multipart file upload, MIME validation |
| `/api/transcribe/config` | `routes/transcribe.ts` | GET, PUT | STT runtime config (provider/model/language), model readiness/download status, hot-reload updates |
| `/api/language` | `routes/transcribe.ts` | GET, PUT | Language preference + Edge voice gender management (`NERVE_LANGUAGE`, `EDGE_VOICE_GENDER`) |
| `/api/language/support` | `routes/transcribe.ts` | GET | Full provider × language compatibility matrix + current local model multilingual state |
| `/api/voice-phrases` | `routes/voice-phrases.ts` | GET | Merged recognition phrase set (selected language + English fallback) |
| `/api/voice-phrases/status` | `routes/voice-phrases.ts` | GET | Per-language custom phrase configuration status |
| `/api/voice-phrases/:lang` | `routes/voice-phrases.ts` | GET, PUT | Read/save language-specific stop/cancel/wake phrase overrides |
| `/api/agentlog` | `routes/agent-log.ts` | GET, POST | Agent activity log persistence. Zod-validated entries. Mutex-protected file I/O |
| `/api/tokens` | `routes/tokens.ts` | GET | Token usage statistics — scans session transcripts, persists high water mark |
| `/api/memories` | `routes/memories.ts` | GET, POST, DELETE | Agent-scoped memory management. Full local behavior reads `MEMORY.md` plus daily files. Remote fallback is limited to `MEMORY.md` because gateway file access does not cover subdirectories |
| `/api/memories/section` | `routes/memories.ts` | GET, PUT | Read/replace a specific memory section by title, scoped via `agentId`. Remote fallback applies to `MEMORY.md`, not daily files |
| `/api/gateway/models` | `routes/gateway.ts` | GET | Config-backed model catalog from the active OpenClaw config. Returns `{ models, error, source: "config" }` |
| `/api/gateway/session-info` | `routes/gateway.ts` | GET | Current session model/thinking level |
| `/api/gateway/session-patch` | `routes/gateway.ts` | POST | HTTP fallback for model changes. Thinking changes belong on WS `sessions.patch` |
| `/api/server-info` | `routes/server-info.ts` | GET | Server time, gateway uptime, agent name |
| `/api/version` | `routes/version.ts` | GET | Package version from `package.json` |
| `/api/version/check` | `routes/version-check.ts` | GET | Check whether a newer published version is available |
| `/api/channels` | `routes/channels.ts` | GET | List configured messaging channels from OpenClaw config |
| `/api/gateway/restart` | `routes/gateway.ts` | POST | Restart the OpenClaw gateway service and verify readiness |
| `/api/sessions/hidden` | `routes/sessions.ts` | GET | List hidden cron-like sessions from stored session metadata |
| `/api/sessions/:id/model` | `routes/sessions.ts` | GET | Read the actual model used by a session from its transcript |
| `/api/workspace` | `routes/workspace.ts` | GET | List allowlisted workspace files for the selected agent workspace. Falls back to gateway file RPC when the workspace is not local |
| `/api/workspace/:key` | `routes/workspace.ts` | GET, PUT | Read/write allowlisted workspace files (`soul`, `tools`, `identity`, `user`, `agents`, `heartbeat`) via `agentId`. Remote fallback is top-level allowlisted files only |
| `/api/crons` | `routes/crons.ts` | GET, POST, PATCH, DELETE | Cron job CRUD via gateway tool invocation |
| `/api/crons/:id/toggle` | `routes/crons.ts` | POST | Toggle cron enabled/disabled |
| `/api/crons/:id/run` | `routes/crons.ts` | POST | Run cron job immediately |
| `/api/crons/:id/runs` | `routes/crons.ts` | GET | Cron run history |
| `/api/skills` | `routes/skills.ts` | GET | List skills for the selected agent workspace via a scoped local OpenClaw config. This route does not use the remote file-browser fallback path |
| `/api/keys` | `routes/api-keys.ts` | GET, PUT | Read API-key presence and persist updated key values to `.env` |
| `/api/files` | `routes/files.ts` | GET | Serve local image files (MIME-type restricted, directory traversal blocked) |
| `/api/files/tree` | `routes/file-browser.ts` | GET | Agent-scoped workspace directory tree. Full nested tree locally, top-level-only fallback remotely |
| `/api/files/read` | `routes/file-browser.ts` | GET | Read scoped file contents with mtime for conflict detection. Remote fallback is top-level text files only |
| `/api/files/write` | `routes/file-browser.ts` | PUT | Write scoped file contents with optimistic concurrency (409 on conflict). Remote fallback is top-level text files only |
| `/api/files/rename` | `routes/file-browser.ts` | POST | Rename a file or directory within the selected workspace. Local workspaces only |
| `/api/files/move` | `routes/file-browser.ts` | POST | Move a file or directory within the selected workspace. Local workspaces only |
| `/api/files/trash` | `routes/file-browser.ts` | POST | Trash a file or directory, or permanently delete when using `FILE_BROWSER_ROOT`. Local workspaces only |
| `/api/files/restore` | `routes/file-browser.ts` | POST | Restore a trashed file or directory. Local workspaces only |
| `/api/files/raw` | `routes/file-browser.ts` | GET | Serve scoped image previews from the selected workspace. No remote fallback |
| `/api/claude-code-limits` | `routes/claude-code-limits.ts` | GET | Claude Code rate limits via PTY + CLI parsing |
| `/api/codex-limits` | `routes/codex-limits.ts` | GET | Codex rate limits via OpenAI API with local file fallback |
| `/api/kanban/tasks` | `routes/kanban.ts` | GET, POST | Task CRUD -- list (with filters/pagination) and create |
| `/api/kanban/tasks/:id` | `routes/kanban.ts` | GET, PATCH, DELETE | Get, update (CAS-versioned), and delete tasks |
| `/api/kanban/tasks/:id/reorder` | `routes/kanban.ts` | POST | Reorder/move tasks across columns |
| `/api/kanban/tasks/:id/execute` | `routes/kanban.ts` | POST | Spawn agent session for task |
| `/api/kanban/tasks/:id/complete` | `routes/kanban.ts` | POST | Complete a running task (auto-called by poller) |
| `/api/kanban/tasks/:id/approve` | `routes/kanban.ts` | POST | Approve task in review -> done |
| `/api/kanban/tasks/:id/reject` | `routes/kanban.ts` | POST | Reject task in review -> todo |
| `/api/kanban/tasks/:id/abort` | `routes/kanban.ts` | POST | Abort running task -> todo |
| `/api/kanban/proposals` | `routes/kanban.ts` | GET, POST | List and create proposals |
| `/api/kanban/proposals/:id/approve` | `routes/kanban.ts` | POST | Approve pending proposal |
| `/api/kanban/proposals/:id/reject` | `routes/kanban.ts` | POST | Reject pending proposal |
| `/api/kanban/config` | `routes/kanban.ts` | GET, PUT | Board configuration |

### Server Libraries

| File | Purpose |
|------|---------|
| `lib/config.ts` | Centralized configuration from env vars — ports, keys, paths, limits, auth settings. Validated at startup |
| `lib/session.ts` | Session token creation/verification (HMAC-SHA256), password hashing (scrypt), cookie parsing for WS upgrade requests |
| `lib/ws-proxy.ts` | WebSocket proxy — client→gateway with session cookie auth on upgrade and Ed25519 device identity injection |
| `lib/device-identity.ts` | Ed25519 keypair generation/persistence (`~/.nerve/device-identity.json`). Builds signed connect blocks for gateway auth |
| `lib/gateway-client.ts` | HTTP client for gateway tool invocation API (`/tools/invoke`) |
| `lib/file-watcher.ts` | Discovers agent workspaces, watches each `MEMORY.md` and `memory/` directory, and optionally watches full workspaces recursively. Broadcasts agent-tagged `memory.changed` / `file.changed` SSE events |
| `lib/file-utils.ts` | File browser utilities — path validation, directory exclusions, binary file detection |
| `lib/files.ts` | Async file helpers (`readJSON`, `writeJSON`, `readText`) |
| `lib/mutex.ts` | Async mutex for serializing file read-modify-write. Includes keyed mutex variant |
| `lib/env-file.ts` | Mutex-protected `.env` key upserts for hot-reload settings writes (`writeEnvKey`) |
| `lib/language.ts` | Language/provider compatibility helpers (`isLanguageSupported`, fallback metadata) |
| `lib/voice-phrases.ts` | Runtime per-language phrase storage/merge (custom overrides + English fallback) |
| `lib/cached-fetch.ts` | Generic TTL cache with in-flight request deduplication |
| `lib/usage-tracker.ts` | Persistent token usage high water mark tracking |
| `lib/tts-config.ts` | TTS voice configuration file management |
| `lib/openclaw-bin.ts` | Resolves `openclaw` binary path (env → sibling of node → common paths → PATH) |

### Services

| File | Purpose |
|------|---------|
| `services/openai-tts.ts` | OpenAI TTS API client (gpt-4o-mini-tts, tts-1, tts-1-hd) |
| `services/replicate-tts.ts` | Replicate API client for hosted TTS models (Qwen3-TTS). WAV→MP3 via ffmpeg |
| `services/edge-tts.ts` | Microsoft Edge Read-Aloud TTS via WebSocket protocol. Free, zero-config. Includes Sec-MS-GEC token generation |
| `services/tts-cache.ts` | LRU in-memory TTS cache with TTL expiry (100 MB budget) |
| `services/openai-whisper.ts` | OpenAI Whisper transcription client |
| `services/whisper-local.ts` | Local whisper.cpp STT via `@fugood/whisper.node`. Singleton model context, auto-download from HuggingFace, GPU detection |
| `services/claude-usage.ts` | Claude Code CLI usage/limits parser via node-pty |

### Updater (`server/lib/updater/`)

Self-update system invoked via `npm run update` (entrypoint: `bin/nerve-update.ts` → `bin-dist/bin/nerve-update.js`).

| File | Purpose |
|------|---------|
| `orchestrator.ts` | State machine: lock → preflight → resolve → snapshot → update → build → restart → health → rollback |
| `preflight.ts` | Validates git, Node.js, npm versions and git repo state |
| `release-resolver.ts` | Finds latest semver tag via `git ls-remote --tags`, falls back to local tags |
| `snapshot.ts` | Saves current git ref, version, and `.env` backup to `~/.nerve/updater/` |
| `installer.ts` | `git fetch + checkout --force`, `npm install`, `npm run build + build:server` |
| `service-manager.ts` | Auto-detects systemd or launchd, provides restart/status/logs |
| `health.ts` | Polls `/health` and `/api/version` with exponential backoff (60s deadline) |
| `rollback.ts` | Restores snapshot ref, clean rebuilds, restarts service |
| `lock.ts` | PID-based exclusive lock file (`wx` flag) with stale detection |
| `reporter.ts` | Formatted terminal output with stage progress, colors, and dry-run markers |
| `types.ts` | Shared types, exit codes, `UpdateError` class |

Compiled separately via `config/tsconfig.bin.json` to avoid changing the server's `rootDir`.

---

## Data Flow

### WebSocket Proxy

```
Browser WS → /ws?target=ws://gateway:18789/ws → ws-proxy.ts → OpenClaw Gateway
```

1. Client connects to `/ws` endpoint on Nerve server
2. When auth is enabled, the session cookie is verified on the HTTP upgrade request (rejects with 401 if invalid)
3. Proxy validates target URL against `WS_ALLOWED_HOSTS` allowlist. This matters in hybrid and split-host deployments where the gateway is not on loopback
4. Proxy opens upstream WebSocket to the gateway
5. On `connect.challenge` event, proxy intercepts the client's `connect` request and injects Ed25519 device identity (`device` block with signed nonce)
6. If the gateway rejects the device (close code 1008), proxy retries without device identity (reduced scopes)
7. After handshake, all messages are transparently forwarded bidirectionally
8. Pending messages are buffered (capped at 100 messages / 1 MB) while upstream connects

### Server-Sent Events (SSE)

```
Browser → GET /api/events → SSE stream (text/event-stream)
```

Events pushed by the server:
- `memory.changed` — File watcher or memory API detects `MEMORY.md` / daily file changes, tagged with `agentId`
- `file.changed` — File watcher detects a workspace file change, tagged with `agentId`
- `tokens.updated` — Token usage data changed
- `status.changed` — Gateway status changed
- `ping` — Keep-alive every 30 seconds

SSE is excluded from compression middleware to avoid buffering.

### REST API

REST endpoints serve two purposes:
1. **Proxy to gateway** — Routes like `/api/crons`, `/api/memories` (POST/DELETE), `/api/gateway/*` invoke gateway tools via `invokeGatewayTool()`
2. **Local server data** — Routes like `/api/tokens`, `/api/agentlog`, `/api/server-info` read from local files or process info

### Gateway RPC (via WebSocket)

The frontend calls gateway methods via `GatewayContext.rpc()`:

| Method | Purpose |
|--------|---------|
| `status` | Get current agent model, thinking level |
| `sessions.list` | List active sessions |
| `sessions.delete` | Delete a session |
| `sessions.reset` | Clear session context |
| `sessions.patch` | Patch session metadata and settings, including rename/model/thinking flows the gateway supports |
| `chat.send` | Send a message (with idempotency key) |
| `chat.history` | Load message history |
| `chat.abort` | Abort current generation |
| `connect` | Initial handshake with auth/device identity |

### Event Types (Gateway → Client)

| Event | Payload | Purpose |
|-------|---------|---------|
| `connect.challenge` | `{ nonce }` | Auth handshake initiation |
| `chat` | `{ sessionKey, state, message?, content? }` | Chat state changes: `started`, `delta`, `final`, `error`, `aborted` |
| `agent` | `{ sessionKey, state, stream, data? }` | Agent lifecycle: `lifecycle.start/end/error`, `tool.start/result`, `assistant` stream |
| `cron` | `{ name }` | Cron job triggered |
| `exec.approval.request` | — | Exec approval requested |
| `exec.approval.resolved` | — | Exec approval granted |
| `presence` | — | Presence updates |

---

## Kanban Subsystem

The kanban board provides task management with agent execution, drag-and-drop reordering, and a proposal system for agent-initiated changes.

### Store Design

```
${NERVE_DATA_DIR:-~/.nerve}/kanban/tasks.json   -- single JSON file (tasks + proposals + config)
${NERVE_DATA_DIR:-~/.nerve}/kanban/audit.log    -- append-only audit log (JSONL)
```

All data lives in one JSON file (`StoreData`). Every mutation acquires an async mutex, reads the file, applies the change, and writes back atomically via temp-file rename. This guarantees consistency under concurrent requests without a database. On first startup, the store migrates legacy data from `server-dist/data/kanban/` or `server/data/kanban/` into the canonical runtime directory if needed.

| File | Purpose |
|------|---------|
| `server/lib/kanban-store.ts` | `KanbanStore` class -- mutex-protected CRUD, workflow transitions, CAS versioning, proposal management |
| `server/routes/kanban.ts` | Hono routes, Zod validation, gateway session spawning, poll loop |
| `server/lib/parseMarkers.ts` | Regex-based `[kanban:create]`/`[kanban:update]` marker extraction |

The store schema is versioned (`meta.schemaVersion`). A `migrate()` function runs on every read to backfill new fields transparently.

### State Machine

```
                    execute          complete (success)        approve
  backlog --------+                  +---- review ------------ done
                  v                  |       |
  todo --------- in-progress -------+       | reject
                  |                          v
                  | abort / error         todo (run cleared)
                  +---------------------> todo
```

| Transition | From | To | Trigger |
|------------|------|----|---------|
| Execute | `backlog`, `todo` | `in-progress` | `POST .../execute` |
| Complete (success) | `in-progress` | `review` | Poller or `POST .../complete` |
| Complete (error) | `in-progress` | `todo` | Poller or `POST .../complete` with `error` |
| Approve | `review` | `done` | `POST .../approve` |
| Reject | `review` | `todo` | `POST .../reject` (clears run + result) |
| Abort | `in-progress` | `todo` | `POST .../abort` |

The `cancelled` status exists in the schema but has no automatic transitions -- tasks are moved there manually via `PATCH`.

### CAS Versioning

Every task has a `version` field (starts at 1, incremented on every mutation). Mutating endpoints (`PATCH`, reorder, workflow actions) require the client to send the current version. If it doesn't match, the server returns **409** with the latest task so the client can retry:

```json
{ "error": "version_conflict", "serverVersion": 5, "latest": { "..." } }
```

This prevents stale overwrites from concurrent editors (drag-and-drop, API clients, agent completions).

### Agent Execution Flow

```
1. POST /api/kanban/tasks/:id/execute
   +-- withMutex(`kanban-execute:${id}`) prevents double-launch races
   +-- if task already in-progress: return 409 duplicate_execution
   +-- if task has an assignee root:
   |    +-- resolve assignee root -> agent:<assignee>:main
   |    +-- gatewayRpcCall('sessions.list', ...) confirms the parent root exists
   |    +-- store.executeTask(..., { sessionKey }) -> status = in-progress, run.status = running
   |    +-- launchKanbanFallbackSubagentViaRpc({ label, task, parentSessionKey, model?, thinking? })
   |         +-- gatewayRpcCall('sessions.create', { key: childSessionKey, parentSessionKey, label, model? })
   |         +-- gatewayRpcCall('sessions.send', { key: childSessionKey, message: task, thinking?, idempotencyKey })
   |         +-- if send fails after create: best-effort gatewayRpcCall('sessions.delete', { key: childSessionKey, deleteTranscript: true })
   |         +-- return correlationKey + childSessionKey + runId?
   |         +-- attach childSessionKey / runId immediately when available
   |         +-- start pollFallbackSessionCompletion(taskId, { correlationKey, parentSessionKey, childSessionKey?, expectedChildLabel, knownSessionKeysBefore, runId? })
   |
   +-- else if task is unassigned / operator:
   |    +-- on macOS: return 409 invalid_execution_target
   |    +-- otherwise use invokeGatewayTool('sessions_spawn', { task, mode:'run', label: runSessionKey, model?, thinking? })
   |    +-- attach childSessionKey / runId when available
   |    +-- start pollSessionCompletion(taskId, { correlationKey: runSessionKey, childSessionKey?, runId? })
   |
   +-- if an assigned parent root is missing: return 409 invalid_execution_target
   +-- on launch failure: store.completeRun(taskId, sessionKey, undefined, 'Spawn failed: ...')

2. pollSessionCompletion() / pollFallbackSessionCompletion()
   +-- sessions_spawn path polls gateway subagents by correlation key / childSessionKey / runId
   +-- assignee-root path polls gateway RPC sessions.list every 5s (max 720 attempts / 60 min)
   +-- assignee-root path prefers the known childSessionKey; otherwise it discovers the new child beneath the parent root and attaches it
   +-- if the child completes successfully:
       |   fetch child history via sessions.get / sessions_history
       |   parseKanbanMarkers(resultText) -> create proposals
       |   stripKanbanMarkers(resultText) -> clean result
       |   store.completeRun(taskId, sessionKey, cleanResult)
       +-- gatewayRpcCall('sessions.send', { key: parentSessionKey, message: completionReport })
   +-- if status=error/failed:
       |   store.completeRun(taskId, sessionKey, undefined, errorMsg)
       +-- gatewayRpcCall('sessions.send', { key: parentSessionKey, message: failureReport })
   +-- if task/run no longer matches the active session key:
       +-- stop polling as stale
   +-- otherwise:
       +-- schedule next poll

3. store.completeRun()
   |-- success -> run.status = done, task.status = review
   +-- error   -> run.status = error, task.status = todo
```

Assigned-root execution now uses real session primitives instead of synthetic marker-message spawn conventions. The model cascade is: execute request `model` -> task `model` -> board config `defaultModel` -> OpenClaw's configured default model. Thinking follows the same pattern with `defaultThinking`.

### Marker Parsing

When agent output arrives (via poller or `POST .../complete`), it's scanned for kanban markers:

```
[kanban:create]{"title":"Fix login bug","priority":"high"}[/kanban:create]
[kanban:update]{"id":"abc","status":"done"}[/kanban:update]
```

Each valid marker creates a **proposal** in the store. The markers are then stripped from the result text before it's saved on the task. See [Agent Markers](./AGENT-MARKERS.md#kanban-markers----kanbancreate--kanbanupdate) for the full format.

### Proposal System

Proposals let agents suggest task changes without directly modifying the board:

1. Agent emits `[kanban:create]` or `[kanban:update]` markers in its output
2. Backend parses markers -> creates proposals with `status: "pending"`
3. Frontend polls proposals every 5 seconds -> shows inbox notification
4. Operator approves or rejects each proposal

The `proposalPolicy` config controls behavior:
- `"confirm"` (default) -- proposals stay pending until the operator acts
- `"auto"` -- proposals are applied immediately on creation

### Polling Architecture

| What | Who | Interval | Purpose |
|------|-----|----------|---------|
| Task list | Frontend | 5s | Sync board state across tabs/users |
| Proposals | Frontend | 5s | Show new proposals in inbox |
| Gateway subagents | Backend | 5s | Detect when agent runs complete |

Backend polling for each running task is independent -- each `executeTask` call starts its own poll loop (capped at 720 attempts = 60 minutes). Stale runs are reconciled by `reconcileStaleRuns()`.

---

## Build System

### Development

```bash
npm run dev          # Vite dev server (frontend) — port 3080
npm run dev:server   # tsx watch (backend) — port 3081
```

Vite proxies `/api` and `/ws` to the backend dev server.

### Production

```bash
npm run prod         # Builds frontend + backend, then starts
# Equivalent to:
npm run build        # tsc -b && vite build → dist/
npm run build:server # tsc -p config/tsconfig.server.json → server-dist/
npm start            # node server-dist/index.js
```

### Vite Configuration

- **Plugins:** `@vitejs/plugin-react`, `@tailwindcss/vite`
- **Path alias:** `@/` → `./src/`
- **Manual chunks:** `react-vendor`, `markdown` (react-markdown + highlight.js), `ui-vendor` (lucide-react), `utils` (clsx, tailwind-merge, dompurify)
- **HTTPS:** Auto-enabled if `certs/cert.pem` and `certs/key.pem` exist

### TypeScript Configuration

Project references with four configs:
- `config/tsconfig.app.json` — Frontend (src/)
- `config/tsconfig.node.json` — Vite/build tooling
- `config/tsconfig.server.json` — Backend (server/) → compiled to `server-dist/`
- `config/tsconfig.scripts.json` — Setup scripts
- `config/tsconfig.bin.json` — CLI tools (bin/) → compiled to `bin-dist/`

---

## Testing

**Framework:** Vitest with jsdom environment for React tests.

```bash
npm test              # Run all tests
npm run test:coverage # With V8 coverage
```

### Test Coverage Areas

The Vitest suite spans server code, client features, hooks, and shared utilities. Representative areas:

| Area | Files | Coverage |
|------|-------|----------|
| Server lib | `config`, `device-identity`, `env-file`, `gateway-client`, `mutex`, `voice-language-coverage`, `ws-proxy` | Auth, config resolution, WS proxy relay, device identity signing |
| Server routes | `auth`, `events`, `files`, `gateway`, `health`, `sessions`, `skills` | API endpoints, error handling, gateway proxy |
| Server middleware | `auth`, `error-handler`, `rate-limit`, `security-headers` | Request pipeline |
| Chat operations | `sendMessage`, `streamEventHandler`, `loadHistory`, `mergeRecoveredTail` | Message lifecycle, streaming, history recovery |
| Client features | `extractCharts`, `extractImages`, `edit-blocks`, `MarkdownRenderer`, `ContextMeter`, `ErrorBoundary`, `sessionTree` | Rendering, parsing, UI components |
| Hooks | `useAuth`, `useInputHistory`, `useKeyboardShortcuts`, `useServerEvents`, `useTTS` | Client-side state and interaction |
| Voice/audio | `audio-feedback`, `useVoiceInput`, `voice-prefix` | Voice input, TTS, wake/stop phrase parsing |
| Utilities | `constants`, `formatting`, `sanitize`, `unreadSessions` | Shared logic |

### Configuration

- **Environment:** jsdom (browser APIs mocked)
- **Setup:** `src/test/setup.ts`
- **Exclusions:** `node_modules/`, `server-dist/` (avoids duplicate compiled test files)
- **Coverage:** V8 provider, text + HTML + lcov reporters
