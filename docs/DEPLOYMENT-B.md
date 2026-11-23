# Deployment B: remote gateway, local Nerve

Nerve runs on your laptop (the Nerve host) and the OpenClaw gateway runs somewhere else (the gateway host). You get a fast local UI, but not full [deployment A](DEPLOYMENT-A.md) parity: the agent workspaces live on the gateway host, not on the Nerve host.

## Topology

```text
Browser (localhost) → Nerve on the Nerve host (127.0.0.1:3080) → Gateway on the gateway host (<gateway-host>:18789)
```

This topology splits three things:

- **Browser to Nerve** is local.
- **Nerve to gateway** is remote.
- **Nerve to workspace filesystem** is remote.

Chat, sessions, Crons and Kanban work well. Workspace features do not have full parity, because Nerve cannot walk or change the remote filesystem. A few routes fall back to the gateway's file RPC, and that fallback is deliberately narrow.

## How Nerve decides the workspace is remote

- Nerve treats the workspace as remote when the agent's workspace directory does not exist on the Nerve host (by default `~/.openclaw/workspace` for the `main` agent). The result is cached for 60 seconds.
- `GATEWAY_URL` plays no part in this decision. A Nerve host that has its own OpenClaw install with a workspace directory is treated as local, and Nerve reads that directory instead of the gateway's.
- `NERVE_WORKSPACE_REMOTE=true` forces gateway-only mode. Set it in this topology. The file browser's write route checks only this variable, so without it a save lands on the Nerve host's disk and creates the folders there.

## What works, what degrades

| Surface | Status | Notes |
|---|---|---|
| Chat, session list, live agent status | Full | Needs the `WS_ALLOWED_HOSTS` entry, the gateway origin allowlist and device approval (steps 2 to 5) |
| Connect without typing a token | Full on the normal path | Nerve injects the token for loopback clients and authenticated sessions. A custom gateway URL still asks for the token |
| Crons tab | Full | Jobs are listed, created, edited, toggled and deleted, and run history is read, over gateway RPC. Nerve also logs manual runs on the Nerve host, in `~/.openclaw/cron/nerve-manual-runs`. **Run now** on an isolated agent-turn job uses the `sessions_spawn` HTTP tool, so it needs the allowlist entry |
| Kanban | Full with extra config | A task assigned to a worker agent (not `main`) launches over gateway RPC. An unassigned task launches with `sessions_spawn`, and a macOS Nerve host refuses it by default, so assign the task to a worker agent |
| Config tab: workspace files (`SOUL.md`, `TOOLS.md`, `USER.md`, `AGENTS.md`, `HEARTBEAT.md`, `IDENTITY.md`) | Partial | Read and written through the gateway's agent file API |
| File browser | Partial | Lists, reads and writes only the top-level files the gateway's agent file API serves (the agent's persona files). Writes need `NERVE_WORKSPACE_REMOTE=true` |
| Nested directories | Not available | A subdirectory listing comes back empty |
| Rename, move, trash, restore | Not available | These routes return `501 Not supported for remote workspaces` |
| Raw image and PDF preview, workspace paths in chat messages | Not available | Raw files return 404 and path lookups return 501, so clicking a path does nothing |
| Memory tab | Not available | Shows a "Sandboxed workspace" notice. Manage `MEMORY.md` and the daily files on the gateway host |
| Skills (in the Config tab) | Reflects the Nerve host | Runs `openclaw skills list --json` on the Nerve host, so it needs the `openclaw` CLI there and shows that install's skills |
| Model lists (model picker, new session dialog, cron dialog) | Reflect the Nerve host | Read `agents.defaults.model` and `agents.defaults.models` from `~/.openclaw/openclaw.json` on the Nerve host (or `OPENCLAW_CONFIG_PATH`). Without that file the model API answers "Could not read OpenClaw config." and the lists are empty |
| Cron delivery channels | Reflect the Nerve host | Read the `channels` keys from `~/.openclaw/openclaw.json` on the Nerve host. The list is empty without that file |
| Token and cost totals | Empty | Scanned from session transcripts in `SESSIONS_DIR` on the Nerve host, so they cover only sessions stored there (none for a remote gateway) |
| Cron sessions in the session list | Full on current OpenClaw | Current OpenClaw lists them itself. For older gateways Nerve also reads `sessions.json` from `SESSIONS_DIR`. That file is not on the Nerve host, so `/api/sessions/hidden` answers `storeMissing: true` and the browser asks again only every 5 minutes |
| Older images in chat history | Full on current OpenClaw | Current OpenClaw gives each omitted image an artifact id, and Nerve downloads it through the gateway. On older gateways Nerve needs `sessions.json`, which is not on the Nerve host, so `/api/sessions/media` answers 404 and the image shows as unavailable |
| **Restart the local gateway** (Settings) | Not for this topology | Runs `openclaw gateway restart` on the Nerve host. Restart the remote gateway on its own host |
| Live workspace updates | Off | Nerve starts no file watchers when the workspace is remote |

If you need the full file browser, Memory, raw previews and file changes, put Nerve on the gateway host (deployment A or same-host [deployment C](DEPLOYMENT-C.md)), or make the workspace directory exist on the Nerve host, for example with a network mount. With a mount, remove `NERVE_WORKSPACE_REMOTE=true` from `.env` and restart Nerve, because that override keeps Nerve in gateway-only mode even when the directory exists.

## Prerequisites

- Node.js 22 or later on the Nerve host
- The `openclaw` CLI on the Nerve host if you use the installer (`npm install -g openclaw`). `install.sh` checks for it and exits without it, even though the gateway is remote. Without the CLI, use the manual install in step 2
- An OpenClaw gateway running on the gateway host (it must support connect protocol version 4)
- A private network path to the gateway host (Tailscale, WireGuard, an SSH tunnel or a private VPC)
- The gateway token
- Access to the gateway host's OpenClaw config (`~/.openclaw/openclaw.json`)

Do not expose gateway port `18789` publicly unless you have a specific reason to.

For an SSH tunnel, forward the gateway port and use the loopback address as the gateway URL:

```bash
ssh -N -L 18789:127.0.0.1:18789 <user>@<gateway-host>
```

## Setup

### 1. Check the gateway

On the gateway host:

```bash
openclaw gateway status
curl -sS http://127.0.0.1:18789/health
```

From the Nerve host, confirm the gateway answers over your private path:

```bash
curl -sS <gateway-url>/health
```

Find the token on the gateway host in `~/.openclaw/openclaw.json`, or run `openclaw gateway status` there.

### 2. Install Nerve and run setup

On the Nerve host, run the installer. It runs the setup wizard for you, so you can answer the prompts below during the install:

```bash
curl -fsSL https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/install.sh | bash
```

To skip the wizard and point the installer at the gateway up front, pass the gateway URL and token, then run setup yourself:

```bash
curl -fsSL https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/install.sh \
  | bash -s -- --gateway-url https://gw.example.com --gateway-token <gateway-token> --skip-setup

cd ~/nerve
npm run setup
```

Without the `openclaw` CLI on the Nerve host, install by hand instead. Setup itself does not need the CLI:

```bash
git clone https://github.com/daggerhashimoto/openclaw-nerve.git ~/nerve
cd ~/nerve
npm ci
npm run setup
```

A manual install sets up no service, so start Nerve with `npm run prod` in step 5.

When prompted:

- **Gateway URL**: the remote gateway URL.
- **Gateway Auth Token (required)**: the gateway's token. If setup found only this machine's own OpenClaw token, it warns that it may not match the gateway and defaults to No.
- **How will you connect to Nerve?**: keep **This machine only (localhost)** unless you want LAN or Tailscale access to the Nerve UI itself (see [deployment C](DEPLOYMENT-C.md) and [Tailscale](TAILSCALE.md)).

Setup tests the connection and stops if the gateway is unreachable or rejects the token.

Because the gateway is on another machine, setup does not read or change any OpenClaw config here. It adds the gateway's host to `WS_ALLOWED_HOSTS` (a loopback gateway address needs no entry) and prints what to change on the gateway host: the origins, the tool allowlist, a gateway restart and approving Nerve's device. Steps 4 and 5 below are those steps.

Setup counts a gateway as remote when `GATEWAY_URL` points at another machine, or when it points at this machine but this machine runs no OpenClaw (an SSH tunnel or a container port). On a machine that also runs OpenClaw, run `NERVE_GATEWAY_LOCATION=remote npm run setup` for a tunnel (use `local` for a DNS alias of this machine).

### 3. Adjust `.env` on the Nerve host

Setup keeps `NERVE_WORKSPACE_REMOTE` and `NERVE_PUBLIC_ORIGIN` when it rewrites `.env`, so you can set them before or after `npm run setup`. Choosing **Start fresh** in the wizard drops them (the previous file is saved as `.env.backup`).

```bash
# Force gateway-only workspace access (see "How Nerve decides the workspace is remote")
NERVE_WORKSPACE_REMOTE=true

# Only if the browser reaches Nerve through anything other than localhost
NERVE_PUBLIC_ORIGIN=https://nerve.example.com
```

If you edit `.env` by hand instead of running setup, also set `WS_ALLOWED_HOSTS=<gateway-hostname-or-ip>` (setup keeps this one across runs).

Restart Nerve after changing `.env`.

### 4. Configure the gateway host

On the gateway host, edit `~/.openclaw/openclaw.json` and merge in these entries (keep any values already there):

```json
"gateway": {
  "controlUi": {
    "allowedOrigins": ["http://localhost:3080", "http://127.0.0.1:3080"]
  },
  "tools": {
    "allow": ["cron", "gateway", "sessions_spawn"]
  }
}
```

Then restart the gateway:

```bash
openclaw gateway restart
```

**Origins.** Two kinds of connection reach the gateway, and every origin they present must be in `gateway.controlUi.allowedOrigins`:

- The browser's WebSocket goes through Nerve's proxy, which forwards the browser's own `Origin`. On your laptop that is `http://localhost:3080` or `http://127.0.0.1:3080`, whichever you typed.
- Nerve's server opens its own WebSocket for Crons, Kanban, spawning subagents and the remote file fallback. It presents `NERVE_PUBLIC_ORIGIN` if set, otherwise the first non-loopback entry in `ALLOWED_ORIGINS`, otherwise `http://127.0.0.1:<PORT>`.

The loopback pair covers a default install. If you reach Nerve at another origin, add that exact origin too, and set `NERVE_PUBLIC_ORIGIN` to it.

**Tool allowlist.** Nerve calls gateway tools over HTTP (`POST /tools/invoke`). Setup writes `cron`, `gateway` and `sessions_spawn`, and the list above matches. Among them Nerve itself calls only `sessions_spawn`, for **Run now** on an isolated agent-turn cron and for unassigned Kanban tasks. Crons are otherwise managed over gateway RPC. Nerve also calls `sessions_list`, `session_status`, `sessions_history`, `subagents` and `memory_store` over HTTP; setup does not change the allowlist for those.

### 5. Start Nerve and approve its device

Restart Nerve:

```bash
# Linux (systemd)
sudo systemctl restart nerve.service

# macOS (launchd)
launchctl kickstart -k gui/$(id -u)/com.nerve.server

# No service: build and run in the foreground, from the install directory
npm run prod
```

Open Nerve once so it connects, then approve its device on the gateway host:

```bash
openclaw devices list
openclaw devices approve <requestId>
```

Until the device is approved, chat can connect with reduced scopes (the proxy retries without Nerve's device identity), and features that use Nerve's server-side connection may fail.

## Validation

On the Nerve host:

```bash
curl -sS http://127.0.0.1:3080/health
cd ~/nerve && npm run setup -- --check
```

- `/health` should report `"gateway":"ok"`. That is Nerve's own request to `GATEWAY_URL`, so it tests the real path.
- `setup --check` confirms `.env` is valid and the gateway accepts the token.

In the browser, check these separately:

1. Connect succeeds.
2. The session list loads.
3. Messages send and receive.
4. The Crons tab lists jobs, and **Run now** works on an isolated agent-turn job.
5. The file browser shows only the top-level files the gateway serves, and the Memory tab shows the "Sandboxed workspace" notice. Both are expected in this topology.

## Common issues

### `Target not allowed` on WebSocket connect

The gateway host is missing from `WS_ALLOWED_HOSTS`. Nerve closes the connection with code 1008.

**Fix:** add the gateway hostname or IP to `WS_ALLOWED_HOSTS`, then restart Nerve.

### The browser's WebSocket is rejected with `Origin not allowed`

Nerve's own proxy returns 403 when the browser's origin is not in `ALLOWED_ORIGINS`. Loopback origins are always accepted, so this only happens when you reach Nerve at another address.

**Fix:** add the exact browser origin to `ALLOWED_ORIGINS`, then restart Nerve.

### Chat works, but Crons, Kanban or Files fail with `origin not allowed`

The gateway is rejecting the origin of Nerve's server-side connection, or the browser origin is not in `gateway.controlUi.allowedOrigins`.

**Fix:** add the origin to the gateway allowlist (step 4). If you reach Nerve at a non-localhost address, set `NERVE_PUBLIC_ORIGIN` to that exact origin and add the same origin to the gateway allowlist. Restart Nerve and the gateway.

### Missing scopes, or Crons and Kanban fail right after setup

Nerve's device has not been approved on the gateway host.

**Fix:** run `openclaw devices list` and `openclaw devices approve <requestId>` there, then reload the browser.

### Run now or an unassigned Kanban task fails with a tool error

The gateway is missing `sessions_spawn` in `gateway.tools.allow`.

**Fix:** add the entries from step 4 and restart the gateway.

### The file browser shows only top-level files

That is expected here. Nested directories, moves, trash and restore, and raw previews need a workspace that is local to Nerve.

### The file browser shows or changes files on the Nerve host

Nerve found a workspace directory on the Nerve host, or `NERVE_WORKSPACE_REMOTE=true` is missing.

**Fix:** set `NERVE_WORKSPACE_REMOTE=true` in `.env` (step 3) and restart Nerve.

## Security notes

- Keep the gateway on a private network path.
- Keep `HOST=127.0.0.1` unless you also want network access to Nerve. If you bind to `0.0.0.0`, enable `NERVE_AUTH=true` (see [deployment C](DEPLOYMENT-C.md)).
- `.env` holds the gateway token. Setup writes it with owner-only permissions.

## Recommendation

Choose this topology when you want a local UI with a remote runtime and can live with partial workspace tooling.

For Nerve to behave like deployment A, run it on the gateway host, or use same-host deployment C.
