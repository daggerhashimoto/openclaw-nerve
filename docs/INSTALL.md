# Nerve Agent Install Contract

Use this file as the operational contract when you are installing, configuring, or validating Nerve on a machine.

## Hard gate

You must be able to:
- read files
- run shell commands

Supported operating systems:
- macOS
- Linux

Stop and say so if any of the following are true:
- you cannot read files
- you cannot run shell commands
- the machine is not macOS or Linux
- the request would require you to invent a Windows flow

Do not claim success without validation.

## Default behavior

Unless the user clearly asks for something else, use these defaults:
- install path: `~/nerve`
- preferred install method: this repo's `install.sh`
- preferred initial topology: local / same machine
- preferred access mode: localhost-only
- preferred config path: setup wizard first
- if the setup wizard is unavailable, skipped, or fails: fall back to explicit manual config
- install, configure, and validate before reporting completion

## Telemetry defaults

- Fresh installs created by `install.sh` or `npm run setup` default to `minimal` telemetry.
- Legacy upgrades stay `off` until explicitly configured.
- The first-run telemetry notice appears only for fresh installs in `minimal` mode.
- The first-run notice is informational only. It does not change the server setting.
- To disable telemetry entirely, set `NERVE_TELEMETRY_MODE=off` in `.env` and restart Nerve.
- For the exact telemetry contract, see [TELEMETRY.md](./TELEMETRY.md).

## Existing install handling

If `~/nerve` already exists:
1. inspect it first
2. determine whether it is an existing Nerve install
3. prefer safe validation, restart, repair, or non-destructive reconfigure work
4. ask before reinstalling, replacing, deleting, or hard-resetting anything

## OpenClaw dependency handling

Nerve depends on an OpenClaw gateway.

You must:
1. detect whether a usable gateway already exists
2. prefer using an existing reachable gateway
3. explain the dependency if no usable gateway is found
4. ask before installing OpenClaw if it is missing

You may apply minimal localhost-safe OpenClaw changes automatically when needed for the default local path. Examples:
- adding missing local control UI origins
- adding required gateway tool allow entries such as `cron`, `gateway`, and `sessions_spawn`
- fixing local device pairing or scopes needed for Nerve to connect

Ask first before any OpenClaw change that is remote, public, security-sensitive, destructive, or changes network exposure.

## Prerequisite handling

For supported local installs, you may automatically install missing core prerequisites required by the installer or build flow, including package-manager-installed dependencies such as:
- Node.js 22+
- npm
- git
- build tools required for native modules

Ask before optional or network-affecting extras such as:
- Tailscale setup
- reverse proxy setup
- public DNS, TLS, or internet exposure changes

If prerequisite installation is impossible, fail clearly and say what is missing.

## Consent boundaries

Ask for confirmation before any of the following:
- installing OpenClaw
- exposing Nerve beyond localhost
- LAN exposure
- public internet exposure
- reverse proxy setup
- Tailscale changes
- cloud-hosted assumptions that change exposure or security posture
- destructive reinstall, replacement, deletion, or reset actions
- remote gateway allowlist or auth changes

## Auto-allowed actions

For the common local path, you may automatically:
- inspect current install state
- inspect local gateway state
- detect the gateway token and gateway URL
- run the installer
- run the setup wizard
- use defaults mode for local-only setup when no TTY is available
- write minimal manual config if the wizard cannot be used
- restart local services or processes
- run validation and smoke checks

## Common-path install flow

Follow this order unless the user explicitly asks for a different topology.

### 1. Inspect before changing

Check:
- whether `~/nerve` already exists
- whether `openclaw` is installed
- whether the OpenClaw gateway is reachable
- whether a gateway token can be detected

### 2. Prefer the installer

If you are inside a local checkout of this repo, prefer:

```bash
./install.sh
```

If you are operating from GitHub or a raw-doc context without a local checkout, prefer:

```bash
curl -fsSL https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/install.sh | bash
```

### 3. Prefer the setup wizard

If the installer finishes and the setup wizard is available, use it.

If no TTY is available and this is a brand-new safe local install, you may use:

```bash
cd ~/nerve
npm run setup -- --defaults --fresh-install
```

If you are rerunning setup for an existing checkout or regenerating `.env`, omit `--fresh-install`.

If the requested topology is LAN, Tailscale, remote gateway, cloud, or any other non-localhost path, do not guess. Ask first unless the user already specified that topology clearly.

### 4. Manual fallback when needed

If the installer or wizard cannot be used, do the smallest correct manual fallback.

If the repo is not present locally:

```bash
git clone https://github.com/daggerhashimoto/openclaw-nerve.git ~/nerve
cd ~/nerve
npm install
```

If you need explicit minimal local config, write `.env` with at least:

```bash
PORT=3080
HOST=127.0.0.1
GATEWAY_URL=http://127.0.0.1:18789
GATEWAY_TOKEN=<detected-token>
```

Then handle runtime like this:

1. if the installer already configured a service manager, use that instead of starting a duplicate foreground process
2. on Linux, check for `systemd` service management via `nerve.service`
3. on macOS, check for `launchd` management via `~/Library/LaunchAgents/com.nerve.server.plist`
4. if no service manager is configured, run Nerve directly with the production entrypoint

Typical commands:

```bash
# build artifacts
npm run build

# Linux, service managed
sudo systemctl restart nerve.service

# macOS, service managed
launchctl stop com.nerve.server || true
launchctl start com.nerve.server

# no service manager present
npm run prod
```

## Topology branching

Stay self-contained for the common path, then branch by user intent:
- Local / same machine: [DEPLOYMENT-A.md](./DEPLOYMENT-A.md)
- Hybrid / remote gateway + local Nerve: [DEPLOYMENT-B.md](./DEPLOYMENT-B.md)
- Cloud / remote Nerve: [DEPLOYMENT-C.md](./DEPLOYMENT-C.md)
- Tailscale retrofit: [TAILSCALE.md](./TAILSCALE.md)

Choose the branch based on the user's intended topology, not on low-level subsystem details.

## Done criteria

Only report success when all of the following are true:
- Nerve is installed at the intended path
- Nerve starts successfully
- it is configured against the intended OpenClaw gateway
- access and auth behavior match the chosen mode
- a minimal smoke test passes

## Smoke test

Keep the smoke test small and explicit.

1. Confirm the Nerve process or service is running.
2. Confirm the expected Nerve URL responds.
   - local default: `http://127.0.0.1:3080/health`
3. Confirm the intended OpenClaw gateway is reachable.
4. Confirm `.env` points to that gateway.
5. If auth is enabled or network access was requested, confirm the login surface or expected protected access behavior is present.

Useful checks:

```bash
openclaw gateway status
curl -fsS http://127.0.0.1:18789/health
curl -fsS http://127.0.0.1:3080/health
```

Adjust host, port, and URL to match the chosen topology.

## Failure handling

If any step fails, report:
- the exact failed step
- what you checked
- what you changed
- what worked
- what still needs user input or approval

Do not use vague completion text. Do not loop blindly.
