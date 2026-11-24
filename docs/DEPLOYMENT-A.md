# Deployment A: local (same machine)

Nerve and the OpenClaw gateway run on one machine, and you open Nerve in a browser on that machine. This is the default setup and has the fewest moving parts.

## Topology

```text
Browser (localhost) → Nerve (127.0.0.1:3080) → Gateway (127.0.0.1:18789)
```

Nerve, the gateway and the agent workspace share one filesystem, so every feature works: the file browser (nested directories, rename, move, trash and restore), raw image previews, Memory, Config, Skills, Crons and Kanban.

## Prerequisites

- Node.js 22 or later
- OpenClaw installed and its gateway running (the gateway must support connect protocol version 4)
- A local shell

## Setup

### 1. Install Nerve

```bash
curl -fsSL https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/install.sh | bash
```

The installer builds Nerve, runs the setup wizard, and installs and starts a service (systemd on Linux, launchd on macOS). When it finishes it prints the URL to open.

### 2. Run setup if needed

If `.env` is missing or wrong:

```bash
cd ~/nerve
npm run setup
```

Recommended choices:

- Gateway URL: keep the default (`http://127.0.0.1:18789`)
- Access mode: **This machine only (localhost)**
- Password: not needed when only localhost can reach Nerve

The gateway is on this machine, so setup also brings its OpenClaw config in line with Nerve, asking first in interactive mode. It fixes device scopes, pairs Nerve's device, adds `cron`, `gateway` and `sessions_spawn` to `gateway.tools.allow`, and restarts the gateway when something changed.

### 3. Start or restart Nerve

```bash
# Linux (systemd)
sudo systemctl restart nerve.service

# macOS (launchd)
launchctl kickstart -k gui/$(id -u)/com.nerve.server

# No service: build and run in the foreground, from the install directory
npm run prod
```

## Validation

```bash
openclaw gateway status
curl -sS http://127.0.0.1:3080/health
cd ~/nerve && npm run setup -- --check
```

- `openclaw gateway status` shows the gateway running.
- `/health` returns JSON that includes `"status":"ok"` and `"gateway":"ok"`. `"gateway":"unreachable"` means Nerve cannot reach the URL in `GATEWAY_URL`.
- `setup --check` validates `.env` and confirms the gateway accepts the token.

Open `http://localhost:3080` in your browser. Nerve connects without asking for a token.

## Notes

- Kanban tasks launch in one of two ways. A task assigned to a worker agent (not `main`) launches over gateway RPC. An unassigned task launches with the `sessions_spawn` HTTP tool. When Nerve runs on macOS it refuses unassigned tasks by default, so assign each task to a worker agent first.
- Nerve calls only `sessions_spawn` among the three allowlisted tools: for the Crons tab's manual run of an isolated agent-turn job, and for unassigned Kanban tasks. Crons are otherwise managed over gateway RPC. Setup still writes all three entries.

## Common issues

### Token mismatch after OpenClaw updates

After an OpenClaw update or re-onboard, the connect dialog may fail with auth errors because `GATEWAY_TOKEN` in `.env` no longer matches the gateway.

**Fix:** Run `npm run setup`, choose **Update existing configuration**, answer **No** to "Keep existing gateway token", and enter the gateway's current token. Setup keeps the stored token by default, so a plain re-run does not change it. Then restart Nerve and open a fresh browser tab. You can also edit `GATEWAY_TOKEN` in `.env` by hand. Find the token in `~/.openclaw/openclaw.json` or with `openclaw gateway status`.

### Missing scopes after first connect

Chat connects but actions fail with "missing scope" errors. Nerve's device has not been approved, or the gateway was reset.

**Fix:** Re-run `npm run setup`, which fixes the device scopes and pairs Nerve's device. Or approve the device by hand:

```bash
openclaw devices list
openclaw devices approve <requestId>
```

### Run now on a cron or an unassigned Kanban task fails with a tool error

`gateway.tools.allow` is missing `sessions_spawn`, for example because an OpenClaw update reset the config.

**Fix:** Re-run `npm run setup`, or add the entries and restart the gateway:

```json
"gateway": {
  "tools": {
    "allow": ["cron", "gateway", "sessions_spawn"]
  }
}
```

### Browser keeps old credentials

Nerve saves the gateway URL and any token you typed into the connect dialog in the browser (`localStorage`, key `oc-config`). A stale manual token can override the managed connection.

**Fix:** Clear the site's data, or remove `oc-config`, and reload.

## Security notes

- Keep `HOST=127.0.0.1` for local-only use.
- If you bind Nerve to `0.0.0.0`, enable `NERVE_AUTH=true`. Nerve refuses to start with `HOST=0.0.0.0` and authentication off unless `NERVE_ALLOW_INSECURE=true` is set.
- See [Security](SECURITY.md) for the full threat model.

## Recommendation

If you are choosing a first deployment, start here. It has the fewest moving parts and every feature works.
