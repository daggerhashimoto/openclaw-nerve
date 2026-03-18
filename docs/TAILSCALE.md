# Add Tailscale to an Existing Nerve Install

This guide is for the case where **Nerve is already installed and working**, and you want to add private remote access afterward.

Use one of these two paths:

- **Tailnet IP**: quickest path, Nerve listens on the Tailscale IP and you open `http://100.x.y.z:3080`
- **Tailscale Serve**: better default for phones and voice input, Nerve stays on `127.0.0.1` and Tailscale exposes `https://<node>.tail<id>.ts.net`

If you are starting from scratch, use the normal installer/setup flow first, then come back here only if you need to retrofit Tailscale onto an existing machine.

## Before you change anything

Make sure all of this is already true:

- Nerve starts locally and `curl http://127.0.0.1:3080/health` works
- OpenClaw gateway is healthy and `openclaw gateway status` works
- Tailscale is installed on the Nerve machine
- Tailscale is logged in on the Nerve machine and on the client device you want to use
- You know where your Nerve install lives, default is usually `~/nerve`

Back up your current config first:

```bash
cd ~/nerve
cp .env .env.before-tailscale.bak
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.before-tailscale.bak
```

## Which mode should you use?

Choose **Tailnet IP** if:
- you want the simplest possible setup
- plain HTTP on the tailnet is fine
- you are okay with Nerve binding to `0.0.0.0`

Choose **Tailscale Serve** if:
- you want Nerve to stay private on localhost
- you want an HTTPS URL for phone access
- you want the least surprising path for microphone access on mobile browsers

## Option A: Tailnet IP

This exposes Nerve on the machine's Tailscale IP and patches both Nerve and the gateway to allow that origin.

### 1. Get the Tailscale IPv4 address

```bash
tailscale ip -4
```

Example output:

```bash
100.64.0.42
```

Save that value, this guide calls it `<tailscale-ip>` below.

### 2. Update Nerve `.env`

Open `~/nerve/.env` and make sure these values are set:

```bash
HOST=0.0.0.0
ALLOWED_ORIGINS=http://<tailscale-ip>:3080
CSP_CONNECT_EXTRA=http://<tailscale-ip>:3080 ws://<tailscale-ip>:3080
WS_ALLOWED_HOSTS=<tailscale-ip>
NERVE_AUTH=true
```

Notes:
- `HOST=0.0.0.0` is required for direct tailnet-IP access
- `NERVE_AUTH=true` is strongly recommended whenever Nerve is reachable over the network, including Tailscale
- if you do not already have a password hash configured, Nerve accepts the `GATEWAY_TOKEN` as a fallback password
- if `ALLOWED_ORIGINS` or `CSP_CONNECT_EXTRA` already contains other values you still need, append instead of replacing

### 3. Patch the gateway allowlist

Add the same origin to `~/.openclaw/openclaw.json`:

```bash
ORIGIN="http://<tailscale-ip>:3080" node - <<'NODE'
const fs = require('fs');
const path = `${process.env.HOME}/.openclaw/openclaw.json`;
const origin = process.env.ORIGIN;
const cfg = JSON.parse(fs.readFileSync(path, 'utf8'));

cfg.gateway ??= {};
cfg.gateway.controlUi ??= {};
const existing = cfg.gateway.controlUi.allowedOrigins || [];
cfg.gateway.controlUi.allowedOrigins = [...new Set([...existing, origin])];

fs.writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`);
console.log(`Added ${origin} to ${path}`);
NODE
```

### 4. Restart Nerve and the gateway

```bash
sudo systemctl restart nerve.service
openclaw gateway restart
```

### 5. Validate

On the Nerve machine:

```bash
curl -fsS http://127.0.0.1:3080/health
openclaw gateway status
```

From another Tailscale-connected device, open:

```text
http://<tailscale-ip>:3080
```

Expected result:
- the page loads
- login works
- sessions load
- chat connects without origin errors

## Option B: Tailscale Serve

This keeps Nerve on localhost and lets Tailscale publish a private HTTPS URL.

### 1. Enable Tailscale Serve

On the Nerve machine:

```bash
tailscale serve --bg 443 http://127.0.0.1:3080
```

### 2. Find the Serve URL

```bash
tailscale serve status --json | node - <<'NODE'
let text = '';
process.stdin.on('data', chunk => text += chunk);
process.stdin.on('end', () => {
  const data = JSON.parse(text || '{}');
  const key = Object.keys(data.Web || {})[0];
  if (!key) {
    console.error('No Tailscale Serve web origin found');
    process.exit(1);
  }
  const host = key.replace(/:\d+$/, '');
  console.log(`https://${host}`);
});
NODE
```

Example output:

```text
https://example-node.tail0000.ts.net
```

Save that value, this guide calls it `<serve-origin>` below.

### 3. Update Nerve `.env`

Open `~/nerve/.env` and make sure these values are set:

```bash
HOST=127.0.0.1
ALLOWED_ORIGINS=<serve-origin>
CSP_CONNECT_EXTRA=<serve-origin> wss://<serve-host>
NERVE_AUTH=true
```

Where `<serve-host>` is the hostname without `https://`.

Example:

```bash
HOST=127.0.0.1
ALLOWED_ORIGINS=https://example-node.tail0000.ts.net
CSP_CONNECT_EXTRA=https://example-node.tail0000.ts.net wss://example-node.tail0000.ts.net
NERVE_AUTH=true
```

Notes:
- if `HOST` is missing entirely, Nerve defaults to localhost, which is also fine
- remove stale `WS_ALLOWED_HOSTS` if you previously used tailnet-IP mode and are switching to Serve-only access
- `NERVE_AUTH=true` is still recommended, even though Serve is private by default

### 4. Patch the gateway allowlist

Add the same Serve origin to `~/.openclaw/openclaw.json`:

```bash
ORIGIN="<serve-origin>" node - <<'NODE'
const fs = require('fs');
const path = `${process.env.HOME}/.openclaw/openclaw.json`;
const origin = process.env.ORIGIN;
const cfg = JSON.parse(fs.readFileSync(path, 'utf8'));

cfg.gateway ??= {};
cfg.gateway.controlUi ??= {};
const existing = cfg.gateway.controlUi.allowedOrigins || [];
cfg.gateway.controlUi.allowedOrigins = [...new Set([...existing, origin])];

fs.writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`);
console.log(`Added ${origin} to ${path}`);
NODE
```

### 5. Restart Nerve and the gateway

```bash
sudo systemctl restart nerve.service
openclaw gateway restart
```

### 6. Validate

On the Nerve machine:

```bash
curl -fsS http://127.0.0.1:3080/health
openclaw gateway status
tailscale serve status
```

From another Tailscale-connected device, open:

```text
<serve-origin>
```

Expected result:
- the page loads over HTTPS
- login works
- chat connects without `origin not allowed`
- phone access works without exposing Nerve directly on `0.0.0.0`

## Switching from one mode to the other

If you switch modes later, update both layers:

- Nerve `.env`
- OpenClaw `gateway.controlUi.allowedOrigins`

Common cleanup when switching to **Serve**:
- change `HOST` back to `127.0.0.1`
- replace IP-based `ALLOWED_ORIGINS`
- replace IP-based `CSP_CONNECT_EXTRA`
- remove `WS_ALLOWED_HOSTS` if you no longer need direct IP access

Common cleanup when switching to **Tailnet IP**:
- set `HOST=0.0.0.0`
- replace `ALLOWED_ORIGINS` with the IP origin
- replace `CSP_CONNECT_EXTRA` with the IP origin + `ws://...`
- set `WS_ALLOWED_HOSTS=<tailscale-ip>`

## Common failures

### `Auth failed: origin not allowed`

Cause:
- the Serve or tailnet origin is missing from `gateway.controlUi.allowedOrigins`

Fix:
- patch `~/.openclaw/openclaw.json`
- restart the gateway

### WebSocket upgrade fails or chat never connects

Cause:
- the browser origin is missing from `ALLOWED_ORIGINS`
- or you kept stale `WS_ALLOWED_HOSTS` / `HOST` values from the other mode

Fix:
- clean up `.env` so it matches the mode you actually want
- restart Nerve

### Microphone access is flaky on phone

Use **Tailscale Serve**, not plain `http://<tailscale-ip>:3080`.

Mobile browsers are much happier with HTTPS for microphone access.

## Security notes

- Do **not** expose OpenClaw gateway port `18789` publicly just because Nerve is on Tailscale
- Keep `NERVE_AUTH=true` for any non-localhost access
- If you shared gateway tokens while debugging, rotate them afterward

## Recommendation

If you only need one answer:
- use **Tailnet IP** for the fastest manual retrofit
- use **Tailscale Serve** for the cleanest long-term remote setup, especially on phone
