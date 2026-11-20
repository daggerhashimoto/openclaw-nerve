<div align="center">

<img src="docs/nerve-logo-animated.svg" alt="Nerve" width="200" />

# Nerve

**The cockpit OpenClaw deserves.**

A self-hosted web app for running OpenClaw agents: talk to them by text or voice, watch every session, schedule crons, hand work to a task board, and edit each agent's workspace from one browser tab.

[![Star Nerve on GitHub](https://img.shields.io/github/stars/daggerhashimoto/openclaw-nerve?style=for-the-badge&logo=github&label=Star%20Nerve%20on%20GitHub&color=0f172a)](https://github.com/daggerhashimoto/openclaw-nerve)
[![MIT License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![Discord](https://img.shields.io/discord/1474924531683688478?style=for-the-badge&color=5865F2&logo=discord&logoColor=white&label=Discord)](https://discord.gg/Sh9ZGtctva)

[Website](https://nerve.zone) · [Docs](docs/README.md) · [Discord](https://discord.gg/Sh9ZGtctva) · [Changelog](CHANGELOG.md)

</div>

```bash
curl -fsSL https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/install.sh | bash
```

Needs Node.js 22 or later and an [OpenClaw](https://github.com/openclaw/openclaw) gateway, on macOS or Linux. The installer sets everything up and walks you through connecting to your gateway.

<div align="center">

<https://github.com/user-attachments/assets/25d65a85-1d42-45bc-baae-5e6fca531705>

<table>
<tr>
<td align="center"><img src="https://y7qrgowhkj.ufs.sh/f/WxqUPjL9oRPTRBre6go2FRlk6Tbtc5WnrMZ9AUKdBC3vsNi0" alt="Nerve on a phone" width="200" /></td>
<td align="center"><img src="https://y7qrgowhkj.ufs.sh/f/WxqUPjL9oRPTW4tYWWL9oRPTJEIWbY7sVfKzjyrSCXqMdGv6" alt="Nerve on a phone" width="200" /></td>
<td align="center"><img src="https://y7qrgowhkj.ufs.sh/f/WxqUPjL9oRPTSe31HqKJOvEcMqm9djw1Y5srz3GQTIUlFg84" alt="Nerve on a phone" width="200" /></td>
</tr>
</table>

</div>

## Why Nerve

Chat is fine for talking to one agent. It is too small for running several. Once you care about what your agents are doing, you want their sessions, schedules, tasks, files, memory and usage in one place, live.

Nerve sits in front of your OpenClaw gateway and proxies it, so you operate the real fleet, not a copy. OpenClaw stays the engine; Nerve is the cockpit.

## What you get

**Chat that shows its work.** Streaming replies with markdown, highlighted code, diffs, math, inline charts and embedded Google Maps. Tool calls render as readable rows. Paste images, search the conversation, and switch model and effort per session.

**Voice built in.** Push-to-talk or a wake word. Speech-to-text runs locally with whisper.cpp (no API key) or through OpenAI. Replies can be spoken through OpenAI, Replicate, Edge (free) or Xiaomi. Stop and cancel phrases work in your language.

**Every agent and session in one tree.** Subagents nest under the session that spawned them, and cron runs appear as their own sessions. Spawn, pin, rename and delete sessions, and jump to any agent or session from the command palette.

**Each agent's workspace, editable live.** A file browser and code editor that catches conflicting saves, plus markdown, image and PDF viewers. Edit memory, the agent's `SOUL.md`, `IDENTITY.md`, `TOOLS.md` and other config files, and browse its skills.

**Crons you can see.** Create, edit, enable, run and inspect the gateway's scheduled jobs.

**A task board agents work from.** Put a task on the Kanban board and run it on an agent. The result lands in review for you to approve or reject. Agents can also propose new tasks to an inbox.

**Usage at a glance.** Token use and cost, a context meter for the current session, Claude Code and Codex plan limits, an agent activity log and the raw gateway event log.

**Made for long sessions, at a desk or on a phone.** Four themes: Workbench Night (the default), Workbench Paper, Night and Daylight. Choose the font and a text size from 10 to 24 px. On a phone, the file browser opens with an edge swipe.

## Install

### One command

```bash
curl -fsSL https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/install.sh | bash
```

The installer checks prerequisites, clones Nerve into `~/nerve`, builds it, and runs the setup wizard:
- the gateway connection;
- where Nerve should be reachable: this machine only, your network, your tailnet, or Tailscale Serve;
- an optional password.

It then installs Nerve as a service (systemd on Linux, launchd on macOS), starts it, and prints the URL. By default that is `http://127.0.0.1:3080`.

Installer flags and every step are documented in [Installer steps](docs/INSTALLER-STEPS.md).

### Let an AI agent do it

Paste this into an agent that can run shell commands on the target machine:

```text
Install, configure, and validate Nerve on this machine.

Fetch and follow instructions from:
https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/docs/INSTALL.md
```

The agent keeps Nerve on localhost and asks before exposing it, installing OpenClaw or touching an existing install. See [AI agent setup](docs/AI_SETUP.md).

### Pick a topology

| Setup | Nerve | Gateway | Guide |
|---|---|---|---|
| **Local** (recommended) | This machine | This machine | [Deployment A](docs/DEPLOYMENT-A.md) |
| **Hybrid** | Your laptop | A server | [Deployment B](docs/DEPLOYMENT-B.md) |
| **Cloud** | A server | A server | [Deployment C](docs/DEPLOYMENT-C.md) |

To reach Nerve privately from other devices, add [Tailscale](docs/TAILSCALE.md).

<details>
<summary><strong>Manual install</strong></summary>

```bash
git clone https://github.com/daggerhashimoto/openclaw-nerve.git
cd openclaw-nerve
npm ci
npm run setup   # gateway connection, access mode, password
npm run prod    # build, then start the server
```

This runs Nerve in the foreground. The one-command installer also sets it up as a service.

</details>

## Update

When a new release is out, the status bar shows an **Update** button with the command for your install:

```bash
cd ~/nerve
npm run update -- --yes
```

The updater fetches the latest release, rebuilds, restarts the service and checks that the new version is serving. If the build, restart or health check fails, it rolls back to the version you had. See [Updating](docs/UPDATING.md).

## Security

Nerve binds to `127.0.0.1` by default, so nothing outside the machine can reach it until you choose otherwise.

When you expose it on your network, setup offers password login, which protects the API and the WebSocket. The server refuses to listen on `0.0.0.0` with auth off unless you explicitly allow it. The gateway token stays on the server and never reaches the browser.

The threat model and hardening guide are in [Security](docs/SECURITY.md).

## How it works

```text
Browser ──── Nerve (:3080) ──── OpenClaw gateway (:18789)
   │
   ├─ WebSocket /ws   proxied to the gateway
   ├─ REST /api/*     files, crons, Kanban, voice, usage
   └─ SSE /api/events live file and memory updates
```

Frontend: React 19, Tailwind CSS 4 and Vite 7. Backend: Hono 4 on Node.js. The UI follows [DESIGN.md](DESIGN.md). The code layout and data flow are described in [Architecture](docs/ARCHITECTURE.md).

## Documentation

| | |
|---|---|
| [Configuration](docs/CONFIGURATION.md) | `.env` variables, setup wizard, auth, voice providers, HTTPS |
| [Agent markers](docs/AGENT-MARKERS.md) | How agents put charts, speech and tasks into their replies |
| [API](docs/API.md) | Every server endpoint |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Common failures and the messages they print |
| [Security](docs/SECURITY.md) | Threat model and hardening |
| [All docs](docs/README.md) | The full index |

## Development

```bash
npm ci
npm run dev                    # Vite on :3080, proxies /api and /ws to :3081
PORT=3081 npm run dev:server   # the backend, with reload
npm test -- --run              # tests
npm run lint
```

Read [Contributing](CONTRIBUTING.md) before opening a pull request.

## Community

Join the [Nerve Discord](https://discord.gg/Sh9ZGtctva) for help, setups and development news. If Nerve is the interface you want around OpenClaw, star the repo.

[![Contributors](https://contrib.rocks/image?repo=daggerhashimoto/openclaw-nerve)](https://github.com/daggerhashimoto/openclaw-nerve/graphs/contributors)

## License

[MIT](LICENSE)
