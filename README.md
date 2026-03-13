<div align="center">

<img src="docs/nerve-logo-animated.svg" alt="Nerve" width="200" />

# Nerve

**The cockpit for your [OpenClaw](https://github.com/openclaw/openclaw) agents.**

[![MIT License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Node 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
[![Discord](https://img.shields.io/discord/1474924531683688478?color=5865F2&logo=discord&logoColor=white&label=Discord)](https://discord.gg/Sh9ZGtctva)

</div>

```bash
curl -fsSL https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/install.sh | bash
```

## What is Nerve?

You can already chat with your OpenClaw agent through webchat, Telegram, WhatsApp, Discord. Nerve is what you open when chatting isn't enough.

Nerve is a self-hosted web UI for [OpenClaw](https://github.com/openclaw/openclaw) AI agents. Voice conversations, live workspace editing, inline charts, cron scheduling, and full token-level visibility. One install script. Running in 30 seconds.

## Why Nerve?

Messaging channels are great for chatting. But you can't watch charts render in real-time, edit your agent's workspace mid-conversation, browse its files, manage tasks on a kanban board, or monitor token spend from a Telegram window. Nerve is the dashboard that gives you the full picture.

<div align="center">

![Nerve Demo](docs/demo.gif)

</div>

## What makes it different

### Voice that actually works
Talk to your agent in 12 languages. Explicit language selection (no flaky auto-detect), wake-word activation, per-language stop/cancel phrases, and on-device Whisper transcription with model selection (tiny, base, small) plus GPU detection. No API key needed. Multi-provider TTS with Edge, OpenAI, and Replicate.

### Full workspace visibility
Your sub-agent sessions, workspace files, memory, config, tools. All visible, all editable, all live. No file hunting, no guessing what it remembers.

### Kanban task board
Drag-and-drop task management with agent execution, review workflow, and proposal inbox. Create tasks, assign them to your agent, and watch the work happen — all from a visual board.

### Responsive by default
Nerve adapts cleanly across desktop, tablet, and mobile, with touch-friendly controls on smaller screens and no core workflow loss.

### Live charts from a chat message
Your agent can drop interactive TradingView charts, candlestick plots, and data visualizations directly into the conversation. Say "show me gold this year" and get a real chart, not a code block.

### Cron and scheduling from the UI
Create recurring jobs and one-shot reminders. Every scheduled run shows up as its own session in the sidebar. You can watch it execute live, read the full transcript, and see exactly what it did.

## Everything else

| | |
|---|---|
| **Voice I/O** | Push-to-talk + wake word, live transcription preview, language-aware stop/cancel phrases, local Whisper model picker, TTS providers (Edge/OpenAI/Replicate) |
| **Streaming chat** | Markdown, syntax highlighting, diff views, image paste, file previews. All rendering as it streams |
| **File browser** | Browse your workspace, rename, move, trash, and restore files. Open files in tabs. Support for custom workspace roots via `FILE_BROWSER_ROOT` |
| **Built-in editor** | CodeMirror editor with syntax highlighting, conflict-safe saves, and automatic lock protection during concurrent agent edits |
| **Multi-session** | Session tree with sub-agents, per-session model overrides, unread indicators |
| **Kanban board** | Drag-and-drop task management with agent execution, review workflow, and proposal inbox |
| **Responsive UI** | Fully responsive layout across desktop, tablet, and mobile with touch-friendly controls |
| **Sub-agents** | Spawn background workers with custom models and reasoning levels |
| **Monitoring** | Token usage, context window meter, cost tracking, activity logs |
| **Command palette** | Cmd+K to search, switch sessions, change models. Keyboard-first |
| **Search** | Full-text search across all messages in the current session |
| **Images** | Paste from clipboard, drag & drop files, full-screen lightbox with download |
| **Skills browser** | Browse installed skills, check status and requirements from the workspace panel |
| **Local STT** | On-device Whisper — tiny, base, or small models with multilingual support, explicit language selection, GPU detection, and auto-download. No API key needed |
| **Code actions** | Copy or save-to-file buttons on every code block |
| **API key management** | Add provider keys from settings — writes to .env and hot-reloads, no restart needed |
| **14 themes** | Dark, light, and everything in between. Resizable panels, custom fonts |
| **Auto-updater** | Built-in updater with automatic rollback. One command to update, verify, and restart |

## Get Started

### One command

```bash
curl -fsSL https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/install.sh | bash
```

The installer handles dependencies, cloning, building, and launching. It runs a setup wizard that auto-detects your gateway token and walks you through configuration.

### Pick your setup

- **[Run everything on one machine](docs/DEPLOYMENT-A.md)**
- **[Use a cloud Gateway with Nerve on your laptop](docs/DEPLOYMENT-B.md)**
- **[Run both Nerve and Gateway in the cloud](docs/DEPLOYMENT-C.md)**

### Manual install

```bash
git clone https://github.com/daggerhashimoto/openclaw-nerve.git
cd openclaw-nerve
npm install
npm run setup    # interactive wizard — configures .env
npm run prod     # builds and starts the server
```

### Updating

```bash
npm run update -- --yes
```

Fetches the latest release, rebuilds, restarts, and verifies health. Auto-rolls back on failure. See [docs/UPDATING.md](docs/UPDATING.md) for flags and details.

### Development

```bash
npm run dev            # frontend — Vite HMR on :3080
npm run dev:server     # backend — watch mode on :3081
```

**Requires:** Node.js 22+ and an [OpenClaw](https://github.com/openclaw/openclaw) gateway.

## How it works

```
Browser ─── Nerve (:3080) ─── OpenClaw Gateway (:18789)
  │            │
  ├─ WS ──────┤  proxied to gateway
  ├─ SSE ─────┤  file watchers, real-time sync
  └─ REST ────┘  files, memories, TTS, models
```

Nerve proxies WebSocket traffic to your gateway and adds its own REST layer.

**Frontend:** React 19 · Tailwind CSS 4 · shadcn/ui · Vite 7
**Backend:** Hono 4 on Node.js

## Security

Nerve binds to `127.0.0.1` (localhost) by default — only you can access it. When you expose it to the network (`HOST=0.0.0.0`), built-in password authentication protects all endpoints. The setup wizard auto-prompts for a password when network access is configured.

- **Session cookies** — `HttpOnly`, `SameSite=Strict`, HMAC-SHA256 signed
- **Password storage** — scrypt with 32-byte salt
- **WebSocket auth** — cookie verified on upgrade
- **Gateway token injection** — Automatically injected server-side for trusted connections

See [Security](docs/SECURITY.md) for the full threat model.

## Docs

| | |
|---|---|
| **[Architecture](docs/ARCHITECTURE.md)** | How the codebase is organized |
| **[Configuration](docs/CONFIGURATION.md)** | Every `.env` variable explained |
| **[Deployment Guides](docs/README.md#deployment-guides)** | Practical guides for local, remote Gateway, and cloud setups |
| **[Agent Markers](docs/AGENT-MARKERS.md)** | TTS markers, inline charts, and how agents render rich UI |
| **[Security](docs/SECURITY.md)** | What's locked down and how |
| **[API](docs/API.md)** | REST and WebSocket endpoints |
| **[Contributing](CONTRIBUTING.md)** | Dev setup, code style, PRs |
| **[Troubleshooting](docs/TROUBLESHOOTING.md)** | Common issues and fixes |
| **[Changelog](CHANGELOG.md)** | Release notes and shipped changes |

## Community

Join the [Nerve Discord](https://discord.gg/Sh9ZGtctva) — get help, share your setup, report bugs, and follow development.

## License

[MIT](LICENSE)
