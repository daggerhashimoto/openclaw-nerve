# Deployment Guide A: Gateway local + Nerve local

This guide covers the default setup where OpenClaw Gateway and Nerve run on the same machine.

## Topology

```
Browser (localhost) -> Nerve (127.0.0.1:3080) -> Gateway (127.0.0.1:18789)
```

Both services stay local. This is the most stable and lowest friction deployment.

## Prerequisites

- Node.js 22+
- OpenClaw installed
- OpenClaw gateway installed and running
- Local shell access to the machine

## Step by step setup

### 1) Install Nerve

```bash
curl -fsSL https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/install.sh | bash
```

### 2) Run setup if needed

If `.env` is missing or wrong, run:

```bash
cd ~/nerve
npm run setup
```

Recommended choices:

- Access mode: `This machine only (localhost)`
- Authentication: optional for localhost only usage

### 3) Start or restart Nerve

```bash
# if running as systemd service
sudo systemctl restart nerve.service

# or run directly
npm run prod
```

## Validation checklist

Run these commands on the same machine:

```bash
openclaw gateway status
curl -sS http://127.0.0.1:18789/health
curl -sS http://127.0.0.1:3080/health
```

Expected result:

- Gateway is running
- Both health endpoints return success
- Browser can connect without manual network setup

## Known frictions and current gaps

### 1) Token mismatch after OpenClaw updates

Symptom:

- Connect dialog suddenly fails with auth errors after update or re-onboard

Current workaround:

- Re-run `npm run setup`
- Restart gateway and Nerve
- Open a fresh browser tab

### 2) Missing scopes after first connect

Symptom:

- Chat connects but actions fail with missing scope errors

Current workaround:

- Re-run `npm run setup`
- Check pending devices and approve if required:

```bash
openclaw devices list
openclaw devices approve <requestId>
```

### 3) Browser keeps old credentials

Symptom:

- Valid token fails until browser state is reset

Current workaround:

- Open a new tab or private window
- Clear saved Nerve connection state in the browser

## Security notes

- Keep `HOST=127.0.0.1` for local-only deployments
- Do not expose Nerve or Gateway to network unless you need remote access
- If you expose Nerve (`HOST=0.0.0.0`), enable `NERVE_AUTH=true`

## Operational recommendation

If you are choosing a first deployment, choose this scenario first. It has the fewest moving parts and the best current support in setup and docs.
