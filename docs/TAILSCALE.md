# Add Tailscale to an existing Nerve install

This guide is for when Nerve is already installed and working, and you want to add private remote access afterwards.

Use one of two paths:

- **Tailnet IP**: the quickest. Nerve listens on the Tailscale IP and you open `http://100.x.y.z:3080`.
- **Tailscale Serve**: the better default for phones and voice input. Nerve stays on `127.0.0.1` and Tailscale publishes `https://<node>.<tailnet>.ts.net`.

If you are starting from scratch, use the installer and setup wizard and pick a Tailscale access mode there. Come back here only to retrofit Tailscale onto an existing machine.

## Before you change anything

Make sure all of this is already true:

- Nerve runs locally and `curl -fsS http://127.0.0.1:3080/health` works
- The OpenClaw gateway is healthy and `openclaw gateway status` works
- Tailscale is installed on the Nerve machine, and logged in on it and on the client device
- You know where Nerve is installed (the default is `~/nerve`)

If the gateway runs on another machine, make the gateway changes in this guide on that machine instead, as described in [deployment B, step 4](DEPLOYMENT-B.md#4-configure-the-gateway-host). Setup does the same: it leaves a remote gateway's config alone and prints the steps.

Back up your config first:

```bash
cd ~/nerve
cp .env .env.before-tailscale.bak
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.before-tailscale.bak
```

## Which mode should you use?

Choose **Tailnet IP** if:

- you want the simplest setup
- plain HTTP on the tailnet is fine (the browser will not allow the microphone, see below)
- you are okay with Nerve binding to `0.0.0.0`

Choose **Tailscale Serve** if:

- you want Nerve to stay private on localhost
- you want an HTTPS URL for phone access
- you want voice input to work, which needs HTTPS

## The quick way: re-run setup

Setup supports both modes. In `~/nerve`:

```bash
npm run setup
```

Choose **Via Tailscale tailnet IP** or **Via Tailscale Serve**. For Serve, setup offers to run `tailscale serve --bg http://127.0.0.1:3080` for you. Setup then writes `HOST`, `ALLOWED_ORIGINS` and `CSP_CONNECT_EXTRA` as listed under each option below, plus `WS_ALLOWED_HOSTS` for the tailnet IP. If the gateway is on this machine, it also adds the origin to the gateway config and restarts the gateway, after asking.

Authentication differs by mode. Setup asks for a password (or turns authentication on with the gateway token as the password) only when Nerve binds to `0.0.0.0`, which is the tailnet-IP case. Serve keeps Nerve on `127.0.0.1`, so setup does not ask. For an install that was localhost-only, add `NERVE_AUTH=true` to `.env` and restart Nerve before you start Serve or run setup with it, so tailnet clients never reach Nerve with authentication off. Setup keeps it on later runs when you choose **Update existing configuration**. **Start fresh** clears it, and in Serve mode setup does not ask again, so after a Start fresh run check that `.env` still has `NERVE_AUTH=true` before you restart Nerve.

Non-interactive, with Serve already running (`tailscale serve --bg http://127.0.0.1:3080`):

```bash
npm run setup -- --defaults --access-mode tailscale-serve
```

If setup cannot confirm the Serve hostname, it falls back to tailnet IP access, or keeps localhost-only access if Tailscale is not connected, and prints what is left to do. Use `--access-mode tailscale-ip` for the tailnet IP.

Setup rewrites the settings it manages, such as `ALLOWED_ORIGINS` and `CSP_CONNECT_EXTRA`, and keeps the rest as written (the previous file is saved as `.env.backup`). Other settings, such as `NERVE_PUBLIC_ORIGIN`, `TRUSTED_PROXIES` or `NERVE_WORKSPACE_REMOTE`, stay under a `# Preserved from your previous .env (not managed by setup)` heading, unless you choose Start fresh.

The manual steps below make the same changes by hand.

## Option A: Tailnet IP

This exposes Nerve on the machine's Tailscale IP and allows that origin in both Nerve and the gateway.

### 1. Get the Tailscale IPv4 address

```bash
tailscale ip -4
```

Example output:

```text
100.64.0.42
```

This guide calls that value `<tailscale-ip>`.

### 2. Update Nerve `.env`

Open `~/nerve/.env` and set:

```bash
HOST=0.0.0.0
ALLOWED_ORIGINS=http://<tailscale-ip>:3080
CSP_CONNECT_EXTRA=http://<tailscale-ip>:3080 ws://<tailscale-ip>:3080
WS_ALLOWED_HOSTS=<tailscale-ip>
NERVE_AUTH=true
```

Notes:

- `HOST=0.0.0.0` is required for direct tailnet-IP access.
- `NERVE_AUTH=true` is required with `HOST=0.0.0.0`: Nerve refuses to start without authentication unless `NERVE_ALLOW_INSECURE=true` is set. If no password hash is configured, the gateway token works as the password.
- `ALLOWED_ORIGINS` must match what you type in the browser. If you use the MagicDNS name instead of the IP, use `http://your-host.tailnet-name.ts.net:3080` here, in the CSP line, and in the gateway list.
- The WebSocket proxy forwards only to loopback and the hosts in `WS_ALLOWED_HOSTS`, checked against the gateway URL's host. Setup adds the tailnet IP; it matters only if `GATEWAY_URL` uses that address. If `WS_ALLOWED_HOSTS` already lists hosts, such as a remote gateway, keep them and add the tailnet IP after a comma.
- If `ALLOWED_ORIGINS` or `CSP_CONNECT_EXTRA` already hold values you still need, append instead of replacing. Nerve's own server-side connection to the gateway presents the first non-loopback entry in `ALLOWED_ORIGINS` (or `NERVE_PUBLIC_ORIGIN` if set), so that origin must be in the gateway's list too.

### 3. Allow the origin on the gateway

Add the same origin to `gateway.controlUi.allowedOrigins` in `~/.openclaw/openclaw.json`. This script merges it into the existing list:

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

The script reads the file as strict JSON and rewrites it as plain JSON. If your `openclaw.json` has comments or trailing commas, edit it by hand instead.

### 4. Restart Nerve and the gateway

```bash
# Nerve on Linux (systemd)
sudo systemctl restart nerve.service

# Nerve on macOS (launchd)
launchctl kickstart -k gui/$(id -u)/com.nerve.server

openclaw gateway restart
```

### 5. Validate

On the Nerve machine:

```bash
curl -fsS http://127.0.0.1:3080/health
openclaw gateway status
```

From another device on the tailnet, open:

```text
http://<tailscale-ip>:3080
```

Expected result:

- The page loads.
- Login works.
- Sessions load.
- Chat connects without origin errors.

Voice input does not work over this plain HTTP address (see Common failures).

## Option B: Tailscale Serve

This keeps Nerve on localhost and lets Tailscale publish a private HTTPS URL.

### 1. Turn on authentication first

Serve makes Nerve reachable from the whole tailnet as soon as it starts, so turn on authentication before you start it. Open `~/nerve/.env`, set:

```bash
NERVE_AUTH=true
```

then restart Nerve:

```bash
# Nerve on Linux (systemd)
sudo systemctl restart nerve.service

# Nerve on macOS (launchd)
launchctl kickstart -k gui/$(id -u)/com.nerve.server
```

If you run Nerve in the foreground without a service (`npm run prod`), stop it and run `npm run prod` again.

With no password hash configured, the gateway token works as the password.

### 2. Enable Tailscale Serve

On the Nerve machine:

```bash
tailscale serve --bg http://127.0.0.1:3080
```

### 3. Find the Serve origin

```bash
tailscale serve status --json | node -e '
let text = "";
process.stdin.on("data", (chunk) => (text += chunk));
process.stdin.on("end", () => {
  const key = Object.keys(JSON.parse(text || "{}").Web || {})[0];
  if (!key) {
    console.error("No Tailscale Serve web origin found");
    process.exit(1);
  }
  const [, host, port] = key.match(/^(.*):(\d+)$/) || [, key, "443"];
  console.log(port === "443" ? `https://${host}` : port === "80" ? `http://${host}` : `https://${host}:${port}`);
});
'
```

Example output:

```text
https://your-host.tailnet-name.ts.net
```

This guide calls that value `<serve-origin>`, and its hostname without the scheme `<serve-host>`.

### 4. Update Nerve `.env`

Open `~/nerve/.env` and set:

```bash
HOST=127.0.0.1
ALLOWED_ORIGINS=<serve-origin>
CSP_CONNECT_EXTRA=<serve-origin> wss://<serve-host>
NERVE_AUTH=true
```

For example:

```bash
HOST=127.0.0.1
ALLOWED_ORIGINS=https://your-host.tailnet-name.ts.net
CSP_CONNECT_EXTRA=https://your-host.tailnet-name.ts.net wss://your-host.tailnet-name.ts.net
NERVE_AUTH=true
```

Notes:

- If `HOST` is missing, Nerve binds to `127.0.0.1`, which is also fine.
- `NERVE_PUBLIC_ORIGIN` is not needed here: Nerve's server-side gateway connection uses the Serve origin from `ALLOWED_ORIGINS`. If you append other non-loopback origins, keep the Serve origin first.
- Remove a leftover `WS_ALLOWED_HOSTS` entry for the tailnet IP if you are switching to Serve only. It does no harm, but it no longer does anything useful.
- Keep `NERVE_AUTH=true` even though Serve is private. Serve reaches Nerve from the same machine, and Nerve trusts local clients with the gateway token when authentication is off. With `NERVE_AUTH=true` and no password hash configured, the gateway token works as the password.

### 5. Allow the origin on the gateway

Add the same origin to `~/.openclaw/openclaw.json`:

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

The same strict-JSON caveat applies as in Option A.

### 6. Restart Nerve and the gateway

```bash
# Nerve on Linux (systemd)
sudo systemctl restart nerve.service

# Nerve on macOS (launchd)
launchctl kickstart -k gui/$(id -u)/com.nerve.server

openclaw gateway restart
```

Without a service, stop the foreground `npm run prod` and start it again.

### 7. Validate

On the Nerve machine:

```bash
curl -fsS http://127.0.0.1:3080/health
openclaw gateway status
tailscale serve status
```

From another device on the tailnet, open `<serve-origin>`.

Expected result:

- The page loads over HTTPS.
- Login works.
- Chat connects without `origin not allowed`.
- Phone access works without exposing Nerve directly on `0.0.0.0`.

## Switching from one mode to the other

Update both layers: Nerve `.env` and the gateway's `gateway.controlUi.allowedOrigins`.

When switching to **Serve**:

- set `HOST=127.0.0.1`
- replace the IP-based `ALLOWED_ORIGINS`
- replace the IP-based `CSP_CONNECT_EXTRA`
- remove `WS_ALLOWED_HOSTS` if you no longer need direct IP access

When switching to **Tailnet IP**:

- set `HOST=0.0.0.0`
- replace `ALLOWED_ORIGINS` with the IP origin
- replace `CSP_CONNECT_EXTRA` with the IP origin and its `ws://` form
- add `<tailscale-ip>` to `WS_ALLOWED_HOSTS`, keeping any hosts already listed

## Common failures

### `Auth failed: origin not allowed`

The gateway is rejecting the origin. The Serve or tailnet origin is missing from `gateway.controlUi.allowedOrigins`.

**Fix:** add the origin to `~/.openclaw/openclaw.json` (on the gateway host if it is a different machine) and restart the gateway.

### The page loads but chat never connects (WebSocket 403)

Nerve rejects a WebSocket whose origin is not in `ALLOWED_ORIGINS`. This happens when `ALLOWED_ORIGINS` still holds the other mode's origin.

**Fix:** make `ALLOWED_ORIGINS` match the URL you open in the browser, then restart Nerve.

### The page does not load over the tailnet IP

`HOST` is still `127.0.0.1`, so Nerve is not listening on the Tailscale interface.

**Fix:** set `HOST=0.0.0.0` (with `NERVE_AUTH=true`) and restart Nerve.

### Microphone does not work on a phone or laptop

Browsers block microphone access on plain HTTP addresses other than localhost. A tailnet-IP address over `http://` counts as plain HTTP.

**Fix:** use **Tailscale Serve**, which gives you an HTTPS URL.

## Security notes

- Do not expose the OpenClaw gateway port `18789` publicly just because Nerve is on Tailscale.
- Keep `NERVE_AUTH=true` for any non-localhost access.
- If you shared gateway tokens while debugging, rotate them afterwards.

## Recommendation

- Use **Tailnet IP** for the fastest manual retrofit.
- Use **Tailscale Serve** for the cleanest long-term remote setup, especially on a phone.
