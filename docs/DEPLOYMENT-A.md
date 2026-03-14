# Deployment: Local (Same Machine)

Gateway and Nerve on the same host. This is the default setup and has the fewest moving parts.

## Topology

```
Browser (localhost) → Nerve (127.0.0.1:3080) → Gateway (127.0.0.1:18789)
```

## Prerequisites

- Node.js 22+
- OpenClaw installed and gateway running
- Local shell access

## Setup

### 1. Install Nerve

```bash
curl -fsSL https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/install.sh | bash
```

### 2. Run setup if needed

If `.env` is missing or wrong:

```bash
cd ~/nerve
npm run setup
```

Recommended choices:
- Access mode: **This machine only (localhost)**
- Authentication: optional for localhost-only usage

### 3. Start or restart

```bash
# systemd service
sudo systemctl restart nerve.service

# or run directly
npm run prod
```

## Validation

```bash
openclaw gateway status
curl -sS http://127.0.0.1:18789/health
curl -sS http://127.0.0.1:3080/health
```

All three should succeed. Open `http://localhost:3080` in your browser.

## Common issues

### Token mismatch after OpenClaw updates

After an OpenClaw update or re-onboard, the connect dialog may fail with auth errors.

**Fix:** Re-run `npm run setup`, restart both services, and open a fresh browser tab.

### Missing scopes after first connect

Chat connects but actions fail with "missing scope" errors.

**Fix:** Re-run `npm run setup`, or manually approve the device:

```bash
openclaw devices list
openclaw devices approve <requestId>
```

### Browser keeps old credentials

**Fix:** Clear site data or remove `localStorage.oc-config`. Nerve stores the gateway URL and any manually-entered token there for reconnects, so a stale manual token can override the official managed connection path.

## Security notes

- Keep `HOST=127.0.0.1` for local-only deployments
- If you expose Nerve (`HOST=0.0.0.0`), enable `NERVE_AUTH=true`
- See [Security](SECURITY.md) for the full threat model

## Recommendation

If you're choosing your first deployment, start here. It has the fewest moving parts and the best support.
