# Deployment: Cloud (Remote Access)

Both Nerve and Gateway hosted remotely. Access from any device, anywhere.

## Topology options

### Same host (recommended)

```
Browser (remote) → Nerve cloud → Gateway cloud (same machine)
```

### Split hosts

```
Browser (remote) → Nerve (host A) → Gateway (host B)
```

Same-host is simpler and has fewer failure points. Use split hosts only if you have a specific reason.

## Prerequisites

- Cloud Linux host with Node.js 22+
- OpenClaw gateway running
- Domain or stable IP for Nerve
- TLS termination plan (reverse proxy or direct certs)

## Same-host setup

### 1. Install Nerve

```bash
curl -fsSL https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/install.sh | bash
```

### 2. Run setup with network access

```bash
cd ~/nerve
npm run setup
```

Recommended choices:
- Access mode: **Network** or **Custom**
- `HOST=0.0.0.0`
- **Enable authentication** and set a password
- Enable HTTPS if serving directly

### 3. Start the service

```bash
sudo systemctl restart nerve.service
sudo systemctl status nerve.service
```

### 4. Set up TLS

Put Nerve behind a reverse proxy (Nginx, Caddy, or Traefik) that handles HTTPS and forwards HTTP + WebSocket traffic to Nerve.

Or generate certs directly:

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/key.pem -out certs/cert.pem -days 365 \
  -subj "/CN=your-domain.com"
```

Nerve auto-detects certificates at `certs/cert.pem` and `certs/key.pem`.

## Split-host setup

Follow the same-host steps for Nerve, then add:

### Point Nerve to remote gateway

In `.env`:

```bash
GATEWAY_URL=<remote-gateway-url>
WS_ALLOWED_HOSTS=<remote-gateway-hostname-or-ip>
```

### Patch remote gateway allowed origins

On the gateway host, add Nerve's public origin to `gateway.controlUi.allowedOrigins`:

```
https://nerve.example.com
```

### Ensure gateway tools allowlist

```json
"gateway": {
  "tools": {
    "allow": ["cron", "gateway"]
  }
}
```

Restart both services.

## Validation

```bash
# Nerve host
curl -sS http://127.0.0.1:3080/health

# Public endpoint
curl -sS https://<nerve-domain>/health
```

In the browser: login screen appears, connect succeeds, sessions load, messages work.

## Common issues

### Remote clients may still need manual credentials

Remote clients can still auto-connect when Nerve trusts the request and the browser is using the official gateway URL. In that case `/api/connect-defaults` reports `serverSideAuth=true`, the browser sends an empty token, and Nerve injects `GATEWAY_TOKEN` server-side during the WebSocket handshake.

Manual token entry is only required for custom gateway URLs or untrusted access paths.

### Reverse proxy and trusted proxy settings

Wrong IP detection affects rate limiting and logs.

**Fix:** Set `TRUSTED_PROXIES` in `.env` to your reverse proxy addresses.

## Security notes

- **Always** enable `NERVE_AUTH=true` for remote access
- Use HTTPS end-to-end or at least at the edge
- Keep the gateway on loopback when Nerve and Gateway share a host
- Rotate gateway token on access changes

## Recommendation

Choose same-host unless you have a hard requirement for split hosts. It's easier to secure and support.
