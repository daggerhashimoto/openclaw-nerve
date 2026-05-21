# Deployment: Cloud (Remote Access)

This guide covers two very different cloud topologies.

If you only remember one thing, remember this:

> **Remote browser access does not automatically mean limited Nerve. Split-host workspace locality does.**

Same-host cloud deployment can preserve near-full deployment-A behavior. Split-host cloud deployment cannot, unless the Nerve host also has direct access to the same workspace filesystem.

## Topology options

### Same host, recommended

```text
Browser (remote) → Nerve cloud → Gateway cloud (same machine)
```

This is the cloud topology with the best feature parity. Nerve, the gateway, and the workspace live together.

### Split hosts, partial parity

```text
Browser (remote) → Nerve host A → Gateway host B
```

This behaves much more like deployment B. Chat can still work well, but workspace-heavy features degrade unless host A also has the workspace mounted locally.

## Choose based on what you need

| Cloud mode | Nerve ↔ gateway | Nerve ↔ workspace | Result |
|---|---|---|---|
| Same host | Local | Local | Best cloud experience. Closest to deployment A |
| Split hosts | Remote | Usually remote | Partial parity only. Inherits deployment-B style limitations |

If you care about full Files, Memory, Config, raw previews, and normal file operations, choose **same host**.

## Same-host setup

### 1. Install Nerve

```bash
curl -fsSL https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/install.sh | bash
```

### 2. Run setup for remote browser access

```bash
cd ~/nerve
npm run setup
```

Recommended choices:

- Access mode: **Network** or **Custom**
- `HOST=0.0.0.0`
- **Enable authentication**
- use HTTPS directly or put Nerve behind a reverse proxy with TLS

### 3. Start the service

```bash
sudo systemctl restart nerve.service
sudo systemctl status nerve.service
```

### 4. Set up TLS

Put Nerve behind a reverse proxy such as Nginx, Caddy, or Traefik, or serve HTTPS directly with local certs.

If you terminate TLS in a reverse proxy, also set `TRUSTED_PROXIES` in `.env` so rate limiting and client-IP resolution use the real client address instead of the proxy hop.

### 5. Keep the gateway local to the host

On same-host installs, keep the gateway on loopback if possible:

```bash
GATEWAY_URL=http://127.0.0.1:18789
```

This is the simplest and safest cloud path.

## Same-host behavior

This is the important part: remote browser access changes the **trust and auth model**, not the workspace model.

### What changes from deployment A

- the browser is no longer loopback, so **auth should be on**
- the browser should reach Nerve over HTTPS
- if you use a reverse proxy, set `TRUSTED_PROXIES` correctly
- server-side gateway token injection depends on the authenticated Nerve session for remote clients

### What does **not** need to degrade

Because Nerve and the gateway share the same host and workspace, these can still have normal deployment-A style behavior:

- full file browser
- nested directories
- rename / move / trash / restore
- raw image previews
- normal workspace config editing
- full memory parsing from local `MEMORY.md` plus daily files
- local watcher-based workspace updates

In other words: **same-host deployment C is the recommended remote-access topology if you want real Nerve, not a reduced control panel.**

## Split-host setup

Use this only when you have a specific infrastructure reason to separate Nerve and the gateway.

### 1. Install Nerve with remote gateway settings

```bash
curl -fsSL https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/install.sh \
  | bash -s -- --gateway-url https://gw.example.com --gateway-token <token> --skip-setup
```

Then:

```bash
cd ~/nerve
npm run setup
```

Recommended choices:

- Access mode: **Network** or **Custom**
- **Enable authentication**
- configure TLS or a reverse proxy

### 2. Point Nerve at the remote gateway

In `.env` on the Nerve host:

```bash
GATEWAY_URL=https://gw.example.com
WS_ALLOWED_HOSTS=gw.example.com
NERVE_PUBLIC_ORIGIN=https://nerve.example.com
```

### 3. Allow the public Nerve origin on the gateway host

On the gateway host, add the Nerve origin to `gateway.controlUi.allowedOrigins`:

```text
https://nerve.example.com
```

### 4. Ensure the gateway HTTP tool allowlist is complete

On the gateway host:

```json
"gateway": {
  "tools": {
    "allow": ["cron", "gateway", "sessions_spawn"]
  }
}
```

Restart both services after making the changes.

## Split-host behavior

This is **not** the same as same-host cloud deployment.

Because the Nerve host usually cannot reach the gateway host's workspace filesystem directly, split-host deployment inherits the same core limits as deployment B.

### What still works well

- chat
- session list and live session state
- cron management, if the gateway tool allowlist is correct
- Kanban execution, if the gateway tool allowlist is correct
- top-level allowlisted workspace-file fallback (`SOUL.md`, `TOOLS.md`, etc.)

### What becomes partial or unavailable

- file browser becomes top-level only
- nested directories are unavailable
- rename / move / trash / restore are unavailable
- raw image / binary previews are unavailable
- memory behavior is limited compared with same-host and deployment A
- some workspace-adjacent flows depend on the exact public origin being configured correctly on both sides

If you need these features, do one of the following instead:

1. move Nerve onto the same host as the gateway
2. mount the same workspace filesystem onto the Nerve host
3. stop using split-host and use deployment A or same-host deployment C

## Validation

### Same host

```bash
curl -sS http://127.0.0.1:3080/health
curl -sS https://<your-domain>/health
```

Verify in the browser:

1. login appears and succeeds
2. connect succeeds without manual token entry on the normal official-gateway path
3. file browser, memory, config, and raw previews all work normally
4. Crons and Kanban load without tool-availability errors

### Split hosts

```bash
curl -sS http://127.0.0.1:3080/health
curl -sS https://<your-domain>/health
curl -sS https://<gateway-domain>/health
```

Verify in the browser:

1. login succeeds
2. connect succeeds
3. Crons and Kanban load
4. workspace file access is limited in the ways documented above, which is expected in this topology

## Common issues

### Remote clients still see the token field in the connect dialog

This can still happen when:

- the browser is pointed at a custom gateway URL instead of the official Nerve-managed one
- the request path is not trusted for server-side token injection
- stale browser config is overriding the official URL path

### Chat works, but workspace-adjacent panels fail with `origin not allowed`

This is usually an origin mismatch between Nerve's public URL and `gateway.controlUi.allowedOrigins` on the gateway host.

**Fix:** set `NERVE_PUBLIC_ORIGIN` to the exact public Nerve origin and add that same origin to the gateway allowlist.

### Split-host install feels weaker than expected

That is not your imagination.

Split-host cloud deployment loses local workspace access unless you provide it yourself. If you want full Nerve behavior, use same-host cloud deployment.

## Recommendation

- **Want the best remote-access experience?** Use **same-host deployment C**.
- **Want a split topology anyway?** Accept deployment-B style workspace limits, or provide your own shared filesystem.
