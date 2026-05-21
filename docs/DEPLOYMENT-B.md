# Deployment: Remote Gateway + Local Nerve

Nerve runs on your laptop, while the OpenClaw gateway runs somewhere else.

This gives you a fast local UI, but it is **not** full deployment-A parity. The missing piece is workspace locality: the agent workspaces live on the remote gateway host, not on the Nerve host.

## Topology

```text
Browser (localhost) → Nerve local (127.0.0.1:3080) → Gateway remote (<host>:18789)
```

## Reality check

This topology splits three things:

- **browser ↔ Nerve** is local
- **Nerve ↔ gateway** is remote
- **Nerve ↔ workspace filesystem** is remote

Chat, sessions, cron, and Kanban can work well here.

Workspace-heavy features do **not** have full parity, because Nerve cannot directly walk or mutate the remote filesystem. Some routes fall back to gateway file RPC, but that fallback is intentionally narrow.

## What works, what degrades

| Surface | Status | Notes |
|---|---|---|
| Chat, session list, live agent status | Full | Requires the WebSocket proxy, gateway origins, and device identity path to be configured correctly |
| Official gateway auto-connect without manual token entry | Usually full | Works well on the normal localhost browser path. Custom gateway URLs or untrusted paths still require manual token entry |
| Allowlisted top-level workspace files (`SOUL.md`, `TOOLS.md`, `USER.md`, `AGENTS.md`, `HEARTBEAT.md`, `IDENTITY.md`) | Partial | Read/write fallback exists through gateway file RPC |
| File browser | Partial | Top-level listing plus top-level text read/write only |
| Nested directories | Not supported | No remote tree walk through subdirectories |
| Rename / move / trash / restore | Not supported | Remote workspace routes return `501 Not supported for remote workspaces` |
| Raw image / binary preview | Not supported | No remote raw-file fallback |
| Memory | Limited | `MEMORY.md` has some backend fallback, but daily files are local-only and the current UI treats remote workspaces as constrained, not as deployment-A parity |
| Crons | Full with extra config | Gateway must allow `cron`, `gateway`, and `sessions_spawn` on `/tools/invoke` |
| Kanban execution | Full with extra config | Same allowlist requirement as crons. Assignee execution still depends on the remote gateway having the right sessions available |
| Skills tab | Verify in your environment | Uses local `openclaw skills list`, not the remote file-browser fallback path |

If you need full Files, Memory, raw previews, and file mutation behavior, move Nerve onto the same machine as the gateway and workspace, or use same-host cloud deployment instead.

## Prerequisites

- Nerve installed on your laptop
- OpenClaw gateway running on the remote host
- A private network path to the gateway host (Tailscale, WireGuard, SSH tunnel, private VPC, etc.)
- Gateway token from the remote host
- Access to the remote host's OpenClaw config (`~/.openclaw/openclaw.json`)

## Recommended network approach

Use a private network path. Do **not** expose gateway port `18789` publicly unless you have a very specific reason.

## Setup

### 1. Prepare the remote gateway

On the remote host:

```bash
openclaw gateway status
curl -sS http://127.0.0.1:18789/health
```

### 2. Configure Nerve locally

If you are installing fresh, either run the installer and then the setup wizard, or point the installer at the remote gateway up front.

```bash
cd ~/nerve
npm run setup
```

When prompted:

- set **Gateway URL** to the remote gateway URL
- set **Gateway token** from the remote host
- keep access mode as **localhost** unless you intentionally want LAN / Tailscale access to the Nerve UI itself

### 3. Allow the remote gateway host in the WS proxy

Add the gateway hostname or IP to `.env` on the Nerve host:

```bash
WS_ALLOWED_HOSTS=<gateway-hostname-or-ip>
```

Restart Nerve after changing it.

### 4. Allow the Nerve origin on the remote gateway

On the remote gateway host, add the browser-facing Nerve origin to `gateway.controlUi.allowedOrigins` in `~/.openclaw/openclaw.json`.

For the normal localhost path, add both:

- `http://localhost:3080`
- `http://127.0.0.1:3080`

Then restart the gateway.

### 5. If Nerve is not being accessed via localhost, set `NERVE_PUBLIC_ORIGIN`

If the browser reaches Nerve through anything other than localhost, set the exact browser origin in `.env` on the Nerve host:

```bash
NERVE_PUBLIC_ORIGIN=https://nerve.example.com
```

Add that same origin to `gateway.controlUi.allowedOrigins` on the remote gateway.

Why this matters: some workspace fallback paths open their own server-side WebSocket to the gateway. Those paths need the real browser-facing origin, not an invented loopback default.

### 6. Ensure the gateway tool allowlist is complete

On the remote gateway host, `gateway.tools.allow` must include:

```json
"gateway": {
  "tools": {
    "allow": ["cron", "gateway", "sessions_spawn"]
  }
}
```

Restart the gateway after updating it.

## Validation

```bash
# On the Nerve host
curl -sS http://127.0.0.1:3080/health

# Connectivity to the remote gateway
curl -sS <your-gateway-url>/health
```

In the browser, verify these separately:

1. connect succeeds
2. session list loads
3. messages send and receive
4. Crons and Kanban load without `Tool not available` errors
5. the file browser only shows top-level remote files, which is expected in this topology

## Common issues

### `Target not allowed` on WebSocket connect

The remote gateway host is missing from `WS_ALLOWED_HOSTS`.

**Fix:** add the hostname or IP to `WS_ALLOWED_HOSTS`, then restart Nerve.

### Chat works, but Files / Config / workspace-adjacent panels fail with `origin not allowed`

The browser-facing Nerve origin is missing from `gateway.controlUi.allowedOrigins`, or `NERVE_PUBLIC_ORIGIN` is not set correctly for a non-localhost access path.

**Fix:** set `NERVE_PUBLIC_ORIGIN` to the exact browser origin and add that same origin to the gateway allowlist.

### Cron or Kanban says a tool is unavailable

The remote gateway is missing required HTTP tool allowlist entries.

**Fix:** add `cron`, `gateway`, and `sessions_spawn` to `gateway.tools.allow`, then restart the gateway.

### The file browser looks broken because directories are missing

That is expected in this topology.

Remote workspace fallback is top-level only. Nested directory browsing, file moves, trash/restore, and raw previews are not available unless Nerve can access the workspace locally.

## Recommendation

Choose this topology when you want a **local UI with a remote runtime** and you can live with partial workspace tooling.

If you want Nerve to behave like deployment A, move Nerve onto the same host as the gateway and workspace, or use same-host deployment C.
