# Deployment Guide B: Gateway cloud + Nerve local (laptop)

This guide covers a split setup where Nerve runs on your laptop and Gateway runs on a cloud host.

## Who should use this

Use this when:

- You want local Nerve UI responsiveness
- Your OpenClaw runtime lives in the cloud
- You do not want to run Nerve on the cloud host

## Topology

```
Browser (localhost) -> Nerve local (127.0.0.1:3080) -> Gateway cloud (<host>:18789)
```

## Important behavior to understand

- Nerve setup can edit local OpenClaw config files
- In this scenario, gateway config is remote, so local auto-patching cannot fix remote gateway settings
- You must configure remote gateway allowlists manually

## Prerequisites

- Nerve installed on your laptop
- Cloud Gateway reachable from your laptop
- Gateway token from the cloud host
- Access to cloud host config (`~/.openclaw/openclaw.json`)

## Recommended network approach

Use a private network path (Tailscale, WireGuard, SSH tunnel, or private VPC). Avoid exposing port `18789` publicly.

## Step by step setup

### 1) Prepare cloud gateway

On the cloud host:

```bash
openclaw gateway status
curl -sS http://127.0.0.1:18789/health
```

Confirm gateway is healthy.

### 2) Configure Nerve locally

On your laptop:

```bash
cd ~/nerve
npm run setup
```

When prompted:

- Set `Gateway URL` to your cloud gateway URL
- Set `Gateway token` from cloud host
- Keep Nerve access mode as `localhost` unless you need LAN access

### 3) Allow gateway host in Nerve WS proxy

If your gateway hostname is not localhost, add it:

```env
WS_ALLOWED_HOSTS=<gateway-hostname-or-ip>
```

Then restart Nerve.

### 4) Patch remote gateway allowed origins

On the cloud gateway host, add your local Nerve origin to gateway allowlist:

- `http://localhost:3080`
- `http://127.0.0.1:3080`
- Any other local origin you actually use

Then restart gateway.

### 5) Optional: allow HTTP tools needed by Nerve

On cloud gateway config, ensure:

```json
"gateway": {
  "tools": {
    "allow": ["cron", "gateway"]
  }
}
```

## Validation checklist

### On laptop

```bash
curl -sS http://127.0.0.1:3080/health
```

### Connectivity from laptop to cloud gateway

```bash
curl -sS <your-gateway-url>/health
```

### In browser

- Open Nerve on localhost
- Connect succeeds
- Session list loads
- Sending a message works

## Known frictions and current gaps

### 1) Installer has no `--gateway-url` flag

Impact:

- Non-interactive installs are awkward for this scenario

Current workaround:

- Run `npm run setup` interactively after install

### 2) Remote gateway config is not auto-patched by local setup

Impact:

- Origin or tools allowlist drift causes hard-to-debug failures

Current workaround:

- Patch remote `~/.openclaw/openclaw.json` manually
- Restart remote gateway

### 3) WS target host allowlist mismatch

Impact:

- WebSocket closes with `Target not allowed`

Current workaround:

- Add gateway host to `WS_ALLOWED_HOSTS`

### 4) Device scope or pairing errors from remote gateway state

Impact:

- Connection works but actions fail with scope errors

Current workaround:

- Repair pairing/scopes on gateway host
- Re-run setup flows where possible on gateway host itself

## Security notes

- Do not expose cloud gateway directly to the public internet if you can avoid it
- Prefer private addressing and strict firewall rules
- Rotate gateway token if it has been shared widely
- If you expose local Nerve to LAN, enable `NERVE_AUTH=true`

## Operational recommendation

This scenario is workable today but has manual steps. If you want low maintenance and multi-user access, scenario C with Nerve in cloud is usually cleaner.
