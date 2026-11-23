# Nerve agent install contract

Use this file as the operational contract when you install, configure, or validate Nerve on a machine. It is meant to be fetched on its own, so every link below is an absolute URL.

## Hard gate

You must be able to:
- read files
- run shell commands

Supported operating systems: macOS and Linux.

Stop and say so if any of the following are true:
- you cannot read files
- you cannot run shell commands
- the machine is not macOS or Linux
- the request would require you to invent a Windows flow

Do not claim success without validation.

## Defaults

Unless the user clearly asks for something else:
- install path: `~/nerve`
- install method: this repo's `install.sh`
- topology: local, same machine
- access mode: localhost-only
- configuration: setup wizard first, explicit manual config only if the wizard is unavailable, skipped, or fails
- install, configure, and validate before reporting completion

## Existing install handling

If `~/nerve` already exists:
1. inspect it first
2. determine whether it is an existing Nerve install
3. prefer safe validation, restart, repair, or non-destructive reconfiguration
4. ask before reinstalling, replacing, deleting, or hard-resetting anything

Re-running `install.sh` on an existing install runs `git checkout --force` to the latest release and discards edits to tracked files. It asks (interactive) or aborts (non-interactive) only when the checkout has local changes, so treat a re-run as a replacement and ask before doing it. If the user asks to update an existing install to a newer release, follow [UPDATING.md](https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/docs/UPDATING.md) (the built-in updater, with rollback) instead of re-running the installer.

## OpenClaw dependency

Nerve depends on an OpenClaw gateway. You must:
1. detect whether a usable gateway already exists
2. prefer an existing reachable gateway
3. explain the dependency if none is found
4. ask before installing OpenClaw

`install.sh` also requires the `openclaw` CLI on the machine it runs on, even when the gateway is remote, and exits 1 without it. If only the CLI is missing, ask before installing it, or use the manual fallback below.

For the default local path, you may apply the minimal OpenClaw changes that `npm run setup` makes itself:
- fixing local device scopes and pre-pairing Nerve's device in `~/.openclaw/devices/paired.json`
- adding `cron`, `gateway`, and `sessions_spawn` to `gateway.tools.allow`
- restarting the local gateway so those take effect

Setup adds origins to `gateway.controlUi.allowedOrigins` only for non-localhost access modes, and those need consent anyway.

Setup never edits a gateway on another machine. It prints the changes to make there (origins, tool allowlist, restart, device approval). Relay them to the user instead of applying them yourself. Setup also treats a loopback `GATEWAY_URL` as remote when the machine has no OpenClaw (an SSH tunnel or container port); `NERVE_GATEWAY_LOCATION=remote|local` overrides its guess.

Ask first before any OpenClaw change that is remote, public, security-sensitive, destructive, or changes network exposure.

## Prerequisites

`install.sh` does not install Node.js, npm, git, or the `openclaw` CLI. It exits 1 and prints instructions when one is missing. For supported local installs, you may install the missing core prerequisites yourself, using the system package manager or nvm:
- Node.js 22 or later
- npm
- git
- build tools for native modules (`make` and `g++`; the installer installs these itself only as root on Debian-like systems or through Xcode tools on macOS)

If a prerequisite cannot be installed, fail clearly and say what is missing.

## Consent boundaries

Ask for confirmation before any of the following:
- installing OpenClaw
- exposing Nerve beyond localhost (LAN, Tailscale, or public internet)
- reverse proxy setup, public DNS, or TLS changes
- Tailscale changes
- cloud-hosted assumptions that change exposure or security posture
- destructive reinstall, replacement, deletion, or reset actions
- remote gateway allowlist or auth changes

For the common local path, you may do these without asking:
- inspect the install, the OpenClaw install, and the local gateway
- detect the gateway token and URL
- run the installer and the setup wizard
- run setup in defaults mode when no TTY is available
- write minimal manual config if the wizard cannot be used
- restart local services or processes
- run validation and smoke checks

## Install flow

Follow this order unless the user asks for a different topology.

### 1. Inspect before changing

Check whether `~/nerve` exists, whether `openclaw` is installed, whether the gateway is reachable, and whether a gateway token can be detected.

### 2. Run the installer

From a local checkout of this repo:

```bash
./install.sh --access-mode local
```

Without a checkout:

```bash
curl -fsSL https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/install.sh | bash -s -- --access-mode local
```

Useful flags: `--dir <path>` (default `~/nerve`), `--version <vX.Y.Z>`, `--dry-run`, `--skip-setup`. The full list and every branch of the script are in [INSTALLER-STEPS.md](https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/docs/INSTALLER-STEPS.md).

Pass `--access-mode local` when nobody can answer prompts. Without it, an install that has no TTY only writes a minimal `.env` from the detected gateway token and applies no gateway config changes. With a TTY and no `--access-mode`, the installer starts the interactive wizard. Do not start a wizard you cannot answer. If `.env` already exists, the installer keeps it and ignores `--access-mode`.

The installer also installs and starts the service (a systemd unit on Linux, a launchd agent on macOS), waits up to 30 seconds for `/health`, and exits with:

| Exit code | Meaning |
|-----------|---------|
| 0 | Nerve answered `/health`. Also 0 when no service was set up (systemd not running, or the user declined): it prints the `npm start` command to run. |
| 1 | Hard failure: missing prerequisite, download, install or build failure, or invalid option. |
| 2 | Partial: `.env` is missing, or Nerve is not running (no root access for the Linux service, service failed to start, or no `/health` answer). Follow the steps it printed. |

On Linux, installing the unit needs root: root, passwordless sudo, or a sudo password in an interactive terminal. Without it, the installer saves the unit to `~/.nerve/nerve.service`, prints the commands to install it, and exits 2. Run those commands if you already have root access, otherwise give them to the user.

### 3. Run setup if the installer did not

If the installer did not run the wizard (you used `--skip-setup`, or a non-interactive run wrote only a minimal `.env`), run it in defaults mode:

```bash
cd ~/nerve
npm run setup -- --defaults
```

Defaults mode tests the gateway token (it refuses to write `.env` if the token is rejected), applies the local gateway config changes silently, and restarts the gateway if a change needs it. Restart Nerve afterwards.

For LAN, Tailscale, a remote gateway, cloud, or any other non-localhost topology, do not guess. Ask first unless the user already specified it. `--access-mode` accepts `local`, `network`, `custom`, `tailscale-ip`, and `tailscale-serve`.

### 4. Manual fallback

If the installer and the wizard cannot be used, do the smallest correct fallback.

If the repo is not present:

```bash
git clone https://github.com/daggerhashimoto/openclaw-nerve.git ~/nerve
cd ~/nerve
git checkout <release-tag>   # optional: the installer uses the latest release
npm ci
```

If the repo is already present, run `npm ci` in it when `node_modules` is missing. The build step below needs the dependencies, so it fails without them.

If you need explicit minimal config, write `.env` with at least:

```bash
PORT=3080
HOST=127.0.0.1
GATEWAY_URL=http://127.0.0.1:18789
GATEWAY_TOKEN=<detected-token>
```

Then handle runtime:

1. If the installer already set up a service manager, use it. Do not start a duplicate foreground process.
2. On Linux, look for `nerve.service` in systemd.
3. On macOS, look for `~/Library/LaunchAgents/com.nerve.server.plist`.
4. If there is no service manager, start Nerve directly.

```bash
# build artifacts
npm run build

# Linux, service managed
sudo systemctl restart nerve.service

# macOS, service managed
launchctl kickstart -k gui/$(id -u)/com.nerve.server

# no service manager present
npm start
```

## Topology branching

The steps above cover the common local path. For anything else, branch by the user's intended topology, not by low-level subsystem details:

- Local, same machine: [DEPLOYMENT-A.md](https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/docs/DEPLOYMENT-A.md)
- Hybrid, remote gateway with local Nerve: [DEPLOYMENT-B.md](https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/docs/DEPLOYMENT-B.md)
- Cloud, remote Nerve: [DEPLOYMENT-C.md](https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/docs/DEPLOYMENT-C.md)
- Tailscale on an existing install: [TAILSCALE.md](https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/docs/TAILSCALE.md)

## Done criteria

Report success only when all of these are true:
- Nerve is installed at the intended path
- Nerve starts successfully
- it is configured against the intended OpenClaw gateway
- access and auth behavior match the chosen mode
- a minimal smoke test passes

A script finishing is not enough. The install must respond and connect.

## Smoke test

Keep it small and explicit.

1. Confirm the Nerve process or service is running.
2. Confirm Nerve's `/health` responds. Local default: `http://127.0.0.1:3080/health`. The JSON reply includes `"gateway":"ok"` when Nerve can reach its gateway.
3. Confirm the intended gateway is reachable.
4. Confirm `.env` points at that gateway. `npm run setup -- --check` validates `.env` and tests the gateway token.
5. If auth is enabled or network access was requested, confirm the login surface or the protected-access behavior.
6. Confirm Nerve can make its own gateway calls, which needs its device paired. `curl -s http://127.0.0.1:3080/api/crons` should return `{"ok":true,...}` (with auth on, log in first and send the session cookie). The `/health` and `--check` steps above pass even while the device waits for approval. A `502` here usually means it is waiting: run `openclaw devices list` on the gateway host and approve Nerve's request with `openclaw devices approve <requestId>`, asking the user first if the gateway is not local.

```bash
openclaw gateway status
curl -fsS http://127.0.0.1:18789/health
curl -fsS http://127.0.0.1:3080/health
cd ~/nerve && npm run setup -- --check
```

Adjust hosts, ports, and URLs to the chosen topology.

## Failure handling

If any step fails, report:
- the exact failed step
- what you checked
- what you changed
- what worked
- what still needs user input or approval

Common cases:
- **No gateway found:** explain that Nerve depends on OpenClaw and ask before installing it.
- **Gateway token rejected:** setup exits without writing `.env`. Ask the user for the correct token.
- **Port, auth, or access mismatch:** adjust the config, restart, and revalidate. A running process is not success.
- **Remote or public topology without details:** ask for the missing details (Tailscale, reverse proxies, public domains, remote gateway allowlists) instead of guessing.

Do not use vague completion text. Do not loop blindly.
