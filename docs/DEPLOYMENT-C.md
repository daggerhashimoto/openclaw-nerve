# Deployment Guide C: Nerve cloud + Gateway cloud

This guide covers hosted deployments where users access Nerve remotely.

## Who should use this

Use this when:

- You want to access Nerve from multiple devices
- You want one always-on deployment

## Topology options

### C1) Same host (recommended)

```
Browser remote -> Nerve cloud -> Gateway cloud (same machine)
```

### C2) Split hosts

```
Browser remote -> Nerve cloud host A -> Gateway cloud host B
```

C1 is simpler and has fewer failure points.

## Prerequisites

- Cloud Linux host with Node.js 22+
- OpenClaw gateway running
- Domain or stable IP for Nerve
- TLS termination plan (reverse proxy or direct certs)

## C1 setup (same host)

### 1) Install Nerve on cloud host

```bash
curl -fsSL https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/install.sh | bash
```

### 2) Run setup and choose network access

```bash
cd ~/nerve
npm run setup
```

Recommended choices:

- Access mode: network or custom
- `HOST=0.0.0.0`
- Enable authentication and set password
- Enable HTTPS if serving directly

### 3) Start service

```bash
sudo systemctl restart nerve.service
sudo systemctl status nerve.service
```

### 4) Put Nerve behind TLS reverse proxy

Use Nginx, Caddy, or Traefik. Forward HTTP and WebSocket traffic to Nerve.

## C2 setup (split hosts)

Follow C1 for Nerve host, then add these extra steps:

### 1) Point Nerve to remote gateway

In Nerve `.env`:

```env
GATEWAY_URL=<remote-gateway-url>
WS_ALLOWED_HOSTS=<remote-gateway-hostname-or-ip>
```

### 2) Patch remote gateway allowed origins

On gateway host, add Nerve public origin to `gateway.controlUi.allowedOrigins`.

Example origin:

- `https://nerve.example.com`

### 3) Ensure remote gateway tools allowlist includes required entries

```json
"gateway": {
  "tools": {
    "allow": ["cron", "gateway"]
  }
}
```

### 4) Restart both services

- Restart Gateway on host B
- Restart Nerve on host A

## Validation checklist

### Nerve host

```bash
curl -sS http://127.0.0.1:3080/health
```

### Public endpoint

```bash
curl -sS https://<nerve-domain>/health
```

### Browser tests

- Login screen appears when auth enabled
- Connect to gateway succeeds
- Session list loads
- Send message and receive response
- File browser and workspace actions succeed

## Known frictions and current gaps

### 1) Remote clients do not get auto token prefill

Impact:

- `/api/connect-defaults` does not return token to non-loopback clients
- Users need gateway token in Connect dialog

Current workaround:

- Provide token to operators out of band
- Keep user count limited to trusted operators

### 2) Multi-user credential model is rough

Impact:

- Gateway token handling is user-facing in hosted mode
- Hard to delegate access cleanly

Current workaround:

- Treat deployment as single-operator or small trusted group

### 3) Reverse proxy and trusted proxy settings can drift

Impact:

- Wrong IP detection for rate limiting or logs

Current workaround:

- Set `TRUSTED_PROXIES` to your reverse proxy addresses
- Re-test after infrastructure changes

### 4) Split-host deployments inherit scenario B manual steps

Impact:

- More config points to keep in sync

Current workaround:

- Use same-host C1 if possible

## Security notes

- Always enable `NERVE_AUTH=true` for public or shared access
- Use HTTPS end to end or at least at the edge
- Restrict gateway network exposure to trusted paths only
- Keep gateway on loopback when Nerve and Gateway share host
- Rotate gateway token on ownership or access changes

## Operational recommendation

Choose C1 unless you have a hard requirement for split hosts. C1 is easier to secure and easier to support.
