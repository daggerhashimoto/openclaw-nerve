# Deployment: Remote Gateway + Local Nerve

Nerve runs on your laptop, Gateway runs on a cloud host. Good when you want local UI responsiveness but your OpenClaw runtime lives in the cloud.

## Topology

```
Browser (localhost) → Nerve local (127.0.0.1:3080) → Gateway cloud (<host>:18789)
```

## Prerequisites

- Nerve installed on your laptop
- Cloud Gateway reachable from your laptop
- Gateway token from the cloud host
- Access to cloud host config (`~/.openclaw/openclaw.json`)

## Recommended network approach

Use a private network path (Tailscale, WireGuard, SSH tunnel, or private VPC). Avoid exposing port `18789` publicly.

## Setup

### 1. Prepare cloud gateway

On the cloud host:

```bash
openclaw gateway status
curl -sS http://127.0.0.1:18789/health
```

### 2. Configure Nerve locally

```bash
cd ~/nerve
npm run setup
```

When prompted:
- Set **Gateway URL** to your cloud gateway URL
- Set **Gateway token** from cloud host
- Keep access mode as **localhost** unless you need LAN access

### 3. Allow gateway host in WS proxy

If your gateway hostname isn't localhost, add it to `.env`:

```bash
WS_ALLOWED_HOSTS=<gateway-hostname-or-ip>
```

Restart Nerve after.

### 4. Patch remote gateway allowed origins

On the cloud host, add your local Nerve origin to the gateway allowlist in `~/.openclaw/openclaw.json`:

- `http://localhost:3080`
- `http://127.0.0.1:3080`

Restart the gateway.

### 5. Optional: allow required gateway tools

On the cloud host config:

```json
"gateway": {
  "tools": {
    "allow": ["cron", "gateway"]
  }
}
```

## Validation

```bash
# On laptop
curl -sS http://127.0.0.1:3080/health

# Connectivity to cloud gateway
curl -sS <your-gateway-url>/health
```

In the browser: connect succeeds, session list loads, messages send/receive.

## Common issues

### "Target not allowed" WebSocket error

The gateway hostname isn't in `WS_ALLOWED_HOSTS`.

**Fix:** Add the hostname to `WS_ALLOWED_HOSTS` in `.env`.

### Scope or pairing errors

Connection works but actions fail with scope errors.

**Fix:** Repair pairing/scopes on the gateway host. Re-run setup flows on the gateway host itself.

## Security notes

- Use private addressing and strict firewall rules
- Rotate gateway token if it's been shared
- If you expose local Nerve to LAN, enable `NERVE_AUTH=true`

## Recommendation

This works today but has manual steps. If you want low maintenance and multi-device access, consider [cloud deployment](DEPLOYMENT-C.md) instead.
