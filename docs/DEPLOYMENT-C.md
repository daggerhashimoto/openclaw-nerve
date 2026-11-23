# Deployment C: cloud (remote access)

This guide covers two cloud topologies that behave very differently.

> Remote browser access does not by itself limit Nerve. Splitting Nerve and the gateway onto different hosts does, because Nerve then loses the workspace filesystem.

## Topology options

### Same host (recommended)

```text
Browser (remote) → Nerve → Gateway (same machine)
```

Nerve, the gateway and the workspace live together, so you get the same features as [deployment A](DEPLOYMENT-A.md).

### Split hosts (partial parity)

```text
Browser (remote) → Nerve host → Gateway host
```

This behaves like [deployment B](DEPLOYMENT-B.md). Chat works well, but workspace features degrade unless the Nerve host can also see the workspace directory.

| Cloud mode | Nerve to gateway | Nerve to workspace | Result |
|---|---|---|---|
| Same host | Local | Local | Closest to deployment A |
| Split hosts | Remote | Usually remote | The limits in the [deployment B table](DEPLOYMENT-B.md#what-works-what-degrades) apply |

If you need the full file browser, Memory, Config, raw previews and file operations, choose same host.

## Prerequisites

- Node.js 22 or later on the Nerve host
- An OpenClaw gateway that supports connect protocol version 4
- A domain name or a fixed IP address for Nerve, and TLS for it (voice input needs HTTPS)
- Split hosts only: a private network path from the Nerve host to the gateway host, and the gateway token

## Setup

### 1. Install Nerve

```bash
curl -fsSL https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/install.sh | bash
```

For split hosts, you can pass the gateway up front and run setup yourself afterwards:

```bash
curl -fsSL https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/install.sh \
  | bash -s -- --gateway-url https://gw.example.com --gateway-token <gateway-token> --skip-setup
```

### 2. Run setup for remote browser access

```bash
cd ~/nerve
npm run setup
```

Recommended choices:

- **Gateway URL** and **Gateway Auth Token (required)**: the default for same host. For split hosts, the remote gateway URL and token.
- **How will you connect to Nerve?**: **From other devices on my network** (enter the host's IP address; setup also offers HTTPS with a self-signed certificate and allows its origin) or **Custom setup** (HTTP port, bind address, HTTPS).
- **Set a password for Nerve access?**: yes. Setup asks only when Nerve binds to `0.0.0.0`. Without a password, the gateway token is the login password.

Setup writes `HOST`, `ALLOWED_ORIGINS`, `CSP_CONNECT_EXTRA` and `WS_ALLOWED_HOSTS` for the IP address you give it. It does not know a domain name or a reverse proxy, so step 3 covers that.

With split hosts, setup does not touch any OpenClaw config. It adds the gateway's host to `WS_ALLOWED_HOSTS` and prints the gateway-host steps (step 5).

### 3. Adjust `.env` for how browsers reach Nerve

Make these edits after your last `npm run setup`. Setup rewrites `HOST`, `ALLOWED_ORIGINS` and `CSP_CONNECT_EXTRA` on every run. It keeps `NERVE_PUBLIC_ORIGIN`, `TRUSTED_PROXIES` and `NERVE_WORKSPACE_REMOTE` as written, unless you choose **Start fresh** (the previous file is saved as `.env.backup`).

For Nerve behind a reverse proxy on the same host, keep Nerve on loopback and list the public origin. Edit the existing lines rather than adding duplicates:

```bash
HOST=127.0.0.1
NERVE_AUTH=true
ALLOWED_ORIGINS=https://nerve.example.com
CSP_CONNECT_EXTRA=https://nerve.example.com wss://nerve.example.com
NERVE_PUBLIC_ORIGIN=https://nerve.example.com
```

- `ALLOWED_ORIGINS` must include the exact origin the browser uses. Nerve rejects a WebSocket from any other non-loopback origin.
- Turn `NERVE_AUTH=true` on for any public setup. Setup only offers a password when Nerve binds to `0.0.0.0`; with `NERVE_AUTH=true` and no `NERVE_PASSWORD_HASH`, the gateway token works as the password. Without `NERVE_SESSION_SECRET`, sessions do not survive a restart.
- `NERVE_PUBLIC_ORIGIN` is the origin Nerve's own server-side gateway connection presents. If you leave it unset, Nerve uses the first non-loopback entry in `ALLOWED_ORIGINS`.
- If the proxy connects to Nerve from an address other than loopback, add that address to `TRUSTED_PROXIES` so rate limiting sees client addresses. Loopback is trusted by default. With more than one proxy (for example a remote proxy in front of a local one), list every proxy address. Otherwise all clients behind the outer proxy share one rate-limit bucket.
- Split hosts: also set `NERVE_WORKSPACE_REMOTE=true`, and keep `WS_ALLOWED_HOSTS` (setup writes it) set to the gateway's host.

Restart Nerve after changing `.env`.

### 4. Set up TLS

Browsers allow the microphone only on HTTPS (or localhost), so voice input needs TLS. Choose one:

- **Reverse proxy** (Nginx, Caddy or Traefik) in front of Nerve. The proxy must:
  - forward WebSocket upgrades on `/ws`
  - pass the `Origin` header through unchanged
  - send `X-Forwarded-For`
  - not buffer `/api/events` (a server-sent event stream)
  - accept request bodies of at least 13 MB, Nerve's own limit
- **Nerve's own HTTPS.** Nerve serves HTTPS on `SSL_PORT` (default `3443`) when `certs/cert.pem` and `certs/key.pem` exist in the install directory. Setup can generate a self-signed pair. For a real certificate, put your certificate and key at those paths, and bind Nerve to `0.0.0.0`.

### 5. Configure the gateway

**Same host.** Add the origin browsers use to the local gateway. Setup added only the origins it knew about, such as the IP address you gave it:

```json
"gateway": {
  "controlUi": {
    "allowedOrigins": ["https://nerve.example.com"]
  }
}
```

Merge it into the existing `~/.openclaw/openclaw.json` and restart the gateway with `openclaw gateway restart`. Keep the gateway on loopback:

```bash
GATEWAY_URL=http://127.0.0.1:18789
```

**Split hosts.** On the gateway host, follow [deployment B, step 4](DEPLOYMENT-B.md#4-configure-the-gateway-host), but add the origin browsers use to reach Nerve (`https://nerve.example.com`) to the origins list. The IP and loopback origins that setup prints can stay; they matter only if you also reach Nerve that way. With `NERVE_PUBLIC_ORIGIN` set to the public origin (step 3), both the browser's connection and Nerve's server-side connection present it. The tool allowlist and the gateway restart are the same as in deployment B.

Nerve's own side, `GATEWAY_URL` and `WS_ALLOWED_HOSTS`, comes from step 2.

Do not expose the gateway port `18789` to the internet. Reach the gateway over a private network path where you can, and put it behind TLS if it must be public.

### 6. Start Nerve

```bash
# Linux (systemd)
sudo systemctl restart nerve.service
sudo systemctl status nerve.service

# macOS (launchd)
launchctl kickstart -k gui/$(id -u)/com.nerve.server

# No service: build and run in the foreground, from the install directory
npm run prod
```

Split hosts: open Nerve once so it connects, then approve its device on the gateway host:

```bash
openclaw devices list
openclaw devices approve <requestId>
```

## Same-host behavior

Remote browser access changes the trust and auth model, not the workspace model.

What changes from deployment A:

- The browser is no longer on loopback, so authentication must be on.
- The browser should reach Nerve over HTTPS.
- Nerve injects the gateway token only for authenticated sessions (or loopback clients), so a remote client sees no token field on the official gateway URL once it has logged in.

What does not degrade, because Nerve and the gateway share the host and workspace:

- Full file browser with nested directories, rename, move, trash and restore
- Raw image and PDF previews
- Config, Skills and Memory with `MEMORY.md` and the daily files
- Live workspace updates from the file watcher
- Crons and Kanban

## Split-host behavior

The Nerve host usually cannot reach the gateway host's workspace filesystem, so split-host deployment inherits the limits in the [deployment B table](DEPLOYMENT-B.md#what-works-what-degrades). Chat, sessions, Crons and Kanban work. The file browser is top-level only, Memory is unavailable, and moves, trash and raw previews are unavailable.

To get those features back, do one of the following:

1. Move Nerve onto the gateway host.
2. Make the workspace directory exist on the Nerve host, for example with a network mount, and leave `NERVE_WORKSPACE_REMOTE` unset.
3. Use deployment A or same-host deployment C.

## Validation

Same host, on the Nerve host and from anywhere:

```bash
curl -sS http://127.0.0.1:3080/health
curl -sS https://nerve.example.com/health
```

Both should report `"gateway":"ok"`. `/health` stays open when authentication is on.

Split hosts, on the Nerve host:

```bash
curl -sS http://127.0.0.1:3080/health
cd ~/nerve && npm run setup -- --check
```

The `gateway` field is Nerve's own request to `GATEWAY_URL`. `setup --check` also confirms the gateway accepts the token.

In the browser, check these in order:

1. The login page appears and login succeeds.
2. Connect succeeds with no token field on the official gateway URL.
3. The session list loads and messages send and receive.
4. The Crons tab lists jobs and **Run now** works on an isolated agent-turn job.
5. Same host: the file browser, Memory, Config and raw previews all work. Split hosts: workspace access is limited as described above, which is expected.

## Common issues

### Nerve exits at startup with `Refusing to start`

`HOST=0.0.0.0` with authentication off. Set `NERVE_AUTH=true` (run `npm run setup` for a password) or bind to `127.0.0.1`. `NERVE_ALLOW_INSECURE=true` overrides the check and is not recommended.

### The browser's WebSocket is rejected with `Origin not allowed`

The origin the browser uses is not in `ALLOWED_ORIGINS`.

**Fix:** add the exact origin (scheme, host and port), then restart Nerve.

### Chat works, but Crons, Kanban or Files fail with `origin not allowed`

The gateway is rejecting an origin. Either the browser's origin or the origin of Nerve's server-side connection is missing from `gateway.controlUi.allowedOrigins`.

**Fix:** add the public Nerve origin to the gateway allowlist (step 5), set `NERVE_PUBLIC_ORIGIN` to the same origin, and restart Nerve and the gateway.

### Connect hangs or reconnects in a loop behind a proxy

The proxy is not forwarding WebSocket upgrades on `/ws`, or it is changing the `Origin` header.

**Fix:** apply the proxy checklist in step 4.

### Remote clients still see the token field in the connect dialog

This happens when:

- The browser points at a custom gateway URL instead of the official one Nerve provides.
- The request is not trusted for token injection: the client is not logged in, or `NERVE_AUTH` is off and the client is not on loopback.
- Stale browser config (`localStorage`, key `oc-config`) overrides the official URL.

### Every user is rate limited together

Nerve sees the proxy's address for every request. Add the proxy's address to `TRUSTED_PROXIES` (step 3), and add every proxy in the chain if there is more than one.

### Split-host install feels weaker than expected

It is. Split-host deployment loses local workspace access unless you provide it. See the [deployment B table](DEPLOYMENT-B.md#what-works-what-degrades) for what is affected, or use same host.

## Security notes

- Keep `NERVE_AUTH=true` for any non-loopback access, and use HTTPS.
- Never expose the gateway port `18789` publicly.
- `/health` is public by design and reports whether the gateway is reachable.
- See [Security](SECURITY.md) for the full threat model.

## Recommendation

- For the best remote-access experience, use same-host deployment C.
- If you need split hosts, accept the deployment B limits or provide a workspace mount on the Nerve host.
