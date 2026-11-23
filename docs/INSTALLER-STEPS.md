# Installer step-by-step reference

This document describes what `install.sh` does, in the order it runs, including the conditional branches.

- Script: `install.sh`
- Purpose: one-command install or update of **openclaw-nerve**
- Entry point: `curl -fsSL https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/install.sh | bash`

The script runs five numbered stages: Prerequisites, Download, Install and build, Configure, Service.

---

## Command line

| Flag | Description |
|------|-------------|
| `--dir <path>` | Install directory. Default `~/nerve`, or the `NERVE_INSTALL_DIR` environment variable. |
| `--version <vX.Y.Z>` | Install a release tag. The leading `v` is optional. Anything other than `X.Y.Z` exits 1. |
| `--branch <name>` | Install from a branch (dev override, skips the release lookup). Cannot be combined with `--version`. |
| `--repo <url>` | Git repository URL. Defaults to the upstream repository. |
| `--skip-setup` | Skip the setup wizard. If there is no `.env`, one is generated from the gateway config. |
| `--dry-run` | Simulate the install without changing anything. |
| `--gateway-token <token>` | Gateway token for the prerequisite check and for a generated `.env`. |
| `--gateway-url <url>` | Gateway URL: an absolute `http://` or `https://` URL without query or fragment. Used for the gateway probe and for a generated `.env`. |
| `--access-mode <mode>` | Run setup non-interactively with this access mode: `local`, `network`, `custom`, `tailscale-ip` or `tailscale-serve`. The legacy value `tailscale` means `tailscale-ip`. |
| `--help`, `-h` | Show usage. |

`--gateway-token` and `--gateway-url` are not passed to the setup wizard. They only affect the gateway probe and the `.env` that the installer generates itself (see 4.1).

Unknown options, missing values and invalid values exit 1.

Two environment variables matter: `NERVE_INSTALL_DIR` (default install directory) and `GITHUB_TOKEN` or `GH_TOKEN` (sent with the latest-release lookup to avoid anonymous rate limits).

---

## 0. Startup and initialization

### 0.1 Strict shell mode

The script starts with `set -euo pipefail`, so it fails fast on command errors, unset variables and pipeline failures. An `EXIT` trap removes temp files and stops leftover progress processes.

### 0.2 Default variables

It initializes:

- `INSTALL_DIR` (default `~/nerve`, overridable with `NERVE_INSTALL_DIR`)
- `BRANCH` (default `master`, used only for `--branch` or when the release lookup fails)
- `REPO`, `NODE_MIN=22`
- `SKIP_SETUP`, `DRY_RUN`, `VERSION`, `BRANCH_EXPLICIT`
- `GATEWAY_TOKEN`, `GATEWAY_URL_OVERRIDE`, `ACCESS_MODE`
- `ENV_MISSING` (tracks partial installs)
- `SERVICE_STARTED`, `NERVE_RUNNING`, `SERVICE_INCOMPLETE` and `START_STEPS` (record what the service step achieved, and drive the final message and exit code)

### 0.3 OS family detection

It detects the platform family for package-manager logic: macOS (`Darwin`), Debian-like (`apt-get`), or Fedora/RHEL-like (`dnf` or `yum`).

### 0.4 Helpers

- Output helpers (`ok`, `warn`, `fail`, `info`, `dry`).
- `run_with_dots` for animated progress and exit-code capture (`RWD_EXIT`).
- `detect_gateway_token`: reads `OPENCLAW_GATEWAY_TOKEN=` from `~/.config/systemd/user/openclaw-gateway.service` or `/etc/systemd/system/openclaw-gateway.service` first, then `gateway.auth.token` from `~/.openclaw/openclaw.json`.
- `env_file_value`, `nerve_port`, `nerve_health_url`: read Nerve's `.env` the way the server does (dotenv parsing, then `Number(PORT || 3080)`).
- Escaping helpers for the systemd unit and launchd plist (see Stage 5).
- The stage renderer (`[1/5]`, `[2/5]`, ...).

The installer reads `~/.openclaw/openclaw.json` directly and does not honor `OPENCLAW_CONFIG_PATH`. The setup wizard does.

### 0.5 Argument validation

- `--version` and `--branch` are mutually exclusive.
- `--access-mode` is normalized and checked against the supported values.
- `--gateway-url` is validated as described in the table above, with trailing slashes trimmed.

### 0.6 Interactive mode detection

Interactive mode is on if either:

- stdin is a TTY (`-t 0`), or
- `/dev/tty` resolves to a real controlling terminal.

This allows prompts even when invoked through `curl | bash`.

### 0.7 Banner

Prints the Nerve ASCII banner, plus a dry-run warning when relevant.

---

## 1. Stage 1 of 5: Prerequisites

The script runs these checks in order. None of them installs anything except build tools (see 1.4); a missing Node.js, npm, git or OpenClaw ends the run with install guidance.

### 1.1 `check_node`

- Verifies `node` exists and its major version is at least 22.
- On failure, prints upgrade guidance for how Node was installed (nvm, Homebrew, apt) and exits 1.

### 1.2 `check_npm`

- Verifies `npm` exists. If missing, explains how to reinstall and exits 1.

### 1.3 `check_git`

- Verifies `git` exists. If missing, prints the OS-specific install command and exits 1.

### 1.4 `check_build_tools`

Checks for `make` and `g++` (needed for native modules such as `node-pty`). If missing:

- Debian-like:
  - as root, installs `build-essential` (not in dry-run);
  - as a normal user, exits 1 with the `sudo apt install build-essential` command;
  - dry-run mirrors that split.
- macOS: runs `xcode-select --install` and waits for it to finish.
- Anything else: prints manual commands for Debian, Fedora and macOS, and exits 1.

### 1.5 `check_openclaw`

- Verifies `openclaw` is on `PATH`.
- If not, searches common locations (nvm, Homebrew, `/usr/local/bin`, `/usr/bin`, Volta, fnm) and prepends the directory it finds to `PATH`.
- If still missing, exits 1 with `npm install -g openclaw`.

This check is unconditional. A machine that has no OpenClaw CLI, such as a Nerve host that only talks to a remote gateway, cannot get past it and needs the manual path: clone the repo, install dependencies, build, and run `npm run setup`.

### 1.6 `check_gateway`

- Gateway URL: `--gateway-url` if given, otherwise `http://127.0.0.1:<port>` with the port from `gateway.port` in `~/.openclaw/openclaw.json` (fallback 18789).
- Probes `/health`, then `/`. An unreachable gateway is a warning, not a failure.
- Looks for a gateway token (`--gateway-token` or auto-detected). A missing token is a warning that points at `openclaw onboard --install-daemon`.

---

## 2. Stage 2 of 5: Download

### 2.1 Target ref resolution (release first)

1. `--version` given: use that release tag (`vX.Y.Z`).
2. Else `--branch` given: use that branch.
3. Else (default): ask the GitHub Releases API for the latest published release tag.
4. If that lookup fails or the repo URL is not a GitHub URL: fall back to the branch (`master` by default) with a warning.

### 2.2 Dry-run behavior

Prints the target ref and what the clone or update would do.

### 2.3 Real behavior

If `INSTALL_DIR/.git` exists:

- The installer checks for local changes with `git status --porcelain --untracked-files=normal`, so untracked files count too.
- With local changes:
  - interactive mode warns that updating discards tracked edits and asks `Continue and overwrite local changes? (y/N)`;
  - non-interactive mode, or a terminal it cannot read, aborts with exit 1.
- Branch mode: `git fetch origin <branch>`, `git checkout --force <branch>`, `git reset --hard origin/<branch>`.
- Release mode: `git fetch --tags origin`, `git checkout --force <tag>`.

Otherwise (fresh clone):

- Branch mode: `git clone --branch <branch> --depth 1 <repo> <dir>`.
- Release mode: `git clone --depth 1`, then fetch tags and check out the tag.

Then it changes into `INSTALL_DIR`.

---

## 3. Stage 3 of 5: Install and build

### 3.1 Dependency install (`npm ci`)

- Runs `npm ci` with output captured to a temp log.
- On success, backs up any existing `dist/` and `server-dist/` to a temp directory.
- On failure, prints the last 10 lines and the full log path, and detects common patterns for targeted help:
  - permission errors,
  - node-gyp or compiler errors,
  - dependency resolution conflicts.

### 3.2 Project build

- Runs `npm run build`, which type-checks, builds the client with Vite, and runs `build:server` (the server and the updater CLI).
- On failure, restores the backed-up `dist/` and `server-dist/`, prints the last 10 log lines, the full log path and hints, and exits 1.

### 3.3 Temp log cleanup

Deletes the npm and build temp logs on success.

### 3.4 Local speech model bootstrap

- Reads `WHISPER_MODEL` from `.env` (default `base`). Supported values: `tiny`, `base`, `small`, `tiny.en`, `base.en`, `small.en`. An unknown value warns and falls back to `base`.
- Ensures the matching `ggml-<model>.bin` file exists in `~/.nerve/models/`, downloading it from Hugging Face (`ggerganov/whisper.cpp`) if missing. The installer always uses this directory, even if `.env` sets `WHISPER_MODEL_DIR`.
- A failed download is a warning. Local speech-to-text then fails unless `STT_PROVIDER=openai` with an `OPENAI_API_KEY` is configured.

### 3.5 `ffmpeg` check

If `ffmpeg` is missing:

- macOS: warning plus a `brew install ffmpeg` hint.
- Debian-like: tries `sudo apt-get install`.
- Fedora-like: tries `sudo dnf install`.

A failed install is a warning, not a failure.

---

## 4. Stage 4 of 5: Configure

This stage provisions `.env` and decides whether the setup wizard runs.

### 4.1 `generate_env_from_gateway`

The installer's own minimal `.env` writer. If `.env` already exists, it keeps it. Otherwise it:

1. Reads the gateway token: `--gateway-token` first, then `detect_gateway_token`.
2. Resolves the gateway URL: `--gateway-url` first, otherwise `http://127.0.0.1:<port>` from `~/.openclaw/openclaw.json` (fallback `http://127.0.0.1:18789`).
3. Writes a minimal `.env`:
   - `GATEWAY_URL=<resolved-url>`
   - `GATEWAY_TOKEN=<token>`
   - `PORT=3080` (or the free port you chose, see below)

It does not verify the token and does not touch any OpenClaw config.

If no token is found, it warns and sets `ENV_MISSING=true` (no `.env` is written).

If a token is found but port `3080` is occupied:

- interactive mode prompts for an available port; if the terminal cannot be read, the installer exits 1 instead of looping;
- non-interactive mode exits 1 and tells the user to free the port or configure another one.

### 4.2 Configure decision order

In a real run, the first matching case applies.

| Case | Behavior |
|------|----------|
| Dry-run | Prints the simulated setup path (and `GATEWAY_URL` if `--gateway-url` is set), then continues. |
| `--skip-setup` | `.env` exists: keep it. No `.env`: run `generate_env_from_gateway`. |
| `.env` exists, interactive, no `--access-mode` | Asks `Run setup wizard anyway? (y/N)`. Yes: `NERVE_INSTALLER=1 npm run setup` (a failure only warns). No, or the answer cannot be read: keep the existing config. |
| `.env` exists, any other situation | Keep it. This includes any run with `--access-mode`, which is ignored when `.env` exists. |
| No `.env`, `--access-mode` given | Runs `NERVE_INSTALLER=1 npm run setup -- --defaults --access-mode <mode>`, in interactive and non-interactive runs alike. A failure exits 1 with `Setup failed for --access-mode <mode>`. It never falls back to raw `.env` generation. |
| No `.env`, interactive | Runs the wizard (`NERVE_INSTALLER=1 npm run setup`). If the wizard fails or exits early, for example because the gateway token is rejected, the installer falls back to `generate_env_from_gateway`, which does not verify the token. |
| No `.env`, non-interactive | Runs `generate_env_from_gateway`. |

A non-interactive install without `--access-mode` therefore only writes a minimal `.env`. It applies none of the gateway config changes in 4.3. Running `npm run setup -- --defaults` afterwards applies them.

#### Tailscale choices in the wizard

The access-mode question offers `Via Tailscale tailnet IP` and `Via Tailscale Serve` as separate choices.

- Tailnet IP:
  - Nerve binds `0.0.0.0` and is reachable at `http://<tailnet-ip>:<port>`;
  - the origin is added to Nerve's `ALLOWED_ORIGINS` and to the gateway's allowed origins.
- Tailscale Serve:
  - Nerve stays on `127.0.0.1`;
  - setup asks whether to run `tailscale serve --bg http://127.0.0.1:<PORT>`;
  - it reads the resulting `https://<node>.tail<id>.ts.net` origin from `tailscale serve status --json`;
  - it patches both Nerve and the gateway for that origin;
  - if the origin cannot be confirmed, it asks whether to fall back to tailnet IP or stop.

If Tailscale is installed but not connected, setup tells you to run `tailscale up` and either waits (up to about two minutes) or exits so you can rerun later. If Tailscale is missing, setup says so, prints the install and login steps, and exits 1.

#### Non-interactive `--access-mode` behavior

- `local`: localhost-only (`HOST=127.0.0.1`).
- `network` and `custom`: use the existing `HOST` if it is not a loopback address, otherwise the machine's first non-internal IPv4 address.
- `tailscale-ip`: uses the tailnet IPv4 address if Tailscale is usable. Otherwise keeps localhost-only access and prints follow-up steps.
- `tailscale-serve`: never waits for login or Serve activation. If no usable `*.ts.net` origin is confirmed, it falls back to `tailscale-ip`. If that is not ready either, it keeps localhost-only access and prints follow-up steps.

### 4.3 Gateway config step (inside the setup wizard)

The wizard decides whether the gateway runs on this machine, then either patches its config or prints what to change.

When it runs:

- Interactive wizard: right after the access mode is chosen, before the authentication prompts, so before `.env` is written.
- `--defaults`: after `.env` is written.

#### Local or remote

`GATEWAY_URL` is classified by its host:

| Result | When |
|--------|------|
| local | The host is loopback, an unspecified address (`0.0.0.0`, `::`), `*.localhost`, one of this machine's interface addresses, or this machine's hostname (short name, `.local` name, or Tailscale MagicDNS name). |
| remote | Any other host. |
| unknown | The URL is missing, unparseable, or not `http(s)` or `ws(s)`. Setup keeps its local behavior. |

Two exceptions cover what a URL cannot show:

- `NERVE_GATEWAY_LOCATION=remote` or `local` overrides the result. Use `remote` for an SSH tunnel on a machine that also runs OpenClaw, and `local` for a DNS alias of this machine. Any other value is ignored.
- A URL that reaches this machine counts as remote when this machine runs no OpenClaw (`hasLocalOpenClaw()` is false: none of `openclaw.json`, `identity/device.json` or `devices/paired.json` exists in the OpenClaw home). This covers an SSH tunnel or a container port.

#### Remote gateway

Setup does not read, write or restart anything. It prints why, then the steps to run where the gateway lives:

1. Add the Nerve browser origins to `gateway.controlUi.allowedOrigins`: the origins from the access plan plus `http://localhost:<port>` and `http://127.0.0.1:<port>`.
2. Add `cron`, `gateway` and `sessions_spawn` to `gateway.tools.allow`.
3. Run `openclaw gateway restart`.
4. After starting Nerve, run `openclaw devices list`, then `openclaw devices approve <requestId>` for the Nerve request.

A token found in this machine's OpenClaw config is flagged as possibly not matching the remote gateway. The interactive prompt then defaults to No, and defaults mode prints a warning. Interactive setup, and `--defaults` with `--access-mode`, also add a non-loopback gateway host to `WS_ALLOWED_HOSTS` so the WebSocket proxy can reach it.

#### Local gateway

A detection layer (`detectNeededConfigChanges`) lists what needs changing without applying it. The OpenClaw home is `~/.openclaw`, or the directory that holds the file named by `OPENCLAW_CONFIG_PATH`. The possible changes are:

1. **Device scopes**: makes sure the gateway's own device in `devices/paired.json` (and the CLI's `identity/device-auth.json`) has the five operator scopes `operator.admin`, `operator.read`, `operator.write`, `operator.approvals` and `operator.pairing`. If `paired.json` is missing, it creates it from `identity/device.json`.
2. **Pre-pair Nerve device**: registers Nerve's Ed25519 identity (`${NERVE_DATA_DIR:-~/.nerve}/device-identity.json`, generated if absent) in `paired.json` with full operator scopes and the gateway token. The metadata matches Nerve's browser client (platform `web`, client id `webchat-ui`, mode `webchat`, display name `Nerve UI`), so Nerve connects without a manual `openclaw devices approve`.
3. **Tools allow**: adds `cron`, `gateway` and `sessions_spawn` to `gateway.tools.allow` when any is missing. Of the three, Nerve's server only invokes `sessions_spawn` over `/tools/invoke` (Kanban task execution and manual runs of isolated cron jobs). Cron management itself goes through gateway RPC.
4. **Allowed origins**: adds the access plan's origins that are missing from `gateway.controlUi.allowedOrigins`.
   - Localhost-only mode has none, so nothing is added.
   - LAN, tailnet IP or a custom non-loopback bind: `http://<host>:<port>`, plus `https://<host>:<ssl-port>` when HTTPS is enabled. The HTTP origin stays first. The wizard offers HTTPS for LAN and custom binds only. A tailnet IP gets the HTTPS origin only from `--defaults --access-mode tailscale-ip` when `.env` already has `SSL_PORT`.
   - Tailscale Serve: `https://<node>.tail<id>.ts.net`.

If nothing needs changing, the step ends silently.

#### Interactive mode

- Shows a numbered list of the pending changes and asks one question, `Apply these changes?` (default yes).
- If declined, prints a manual fix for each skipped change.
- If accepted, applies all changes, then restarts the gateway once.

#### `--defaults` mode

- Applies all changes silently (implicit consent).
- Allowed origins come from `ALLOWED_ORIGINS` in the `.env` it just wrote, which holds the access plan's origins. Without `--access-mode`, `HOST` and the origins are left as they were.

#### After applying

- If any change needs a restart, setup runs `openclaw gateway restart`, falling back to `pkill -f "openclaw gateway"`, then waits 3 seconds.
- If device scopes or pre-pair were applied, setup then runs `approvePendingNerveDevice()`. It approves only the single pending request that matches Nerve's device id and public key, and prints a manual `openclaw devices list` hint when it cannot identify exactly one.
- Failures are logged with `warn()` in both modes.

#### Dependency ordering

- Device scopes always run before pre-pair, because pre-pair needs `paired.json`.
- If device scopes fail, pre-pair is skipped.

### 4.4 What else the wizard does

- Token order: the existing `.env` token, then a token detected from the systemd service file or `openclaw.json` (env and file secret references are resolved where possible), then `OPENCLAW_GATEWAY_TOKEN` from the environment.
- It tests the gateway (`GET /health`, then `POST /tools/invoke` with `sessions_list` and the token) before writing anything. A failed test exits 1, and `--defaults` prints `Refusing to write .env because gateway auth could not be verified`.
- Authentication prompts appear only when the chosen mode binds `0.0.0.0`. Declining a password still enables auth, with the gateway token as the password. In `--defaults` mode, auth is enabled automatically when `HOST=0.0.0.0` and a token exists.
- It generates `NERVE_SESSION_SECRET` if missing, writes `.env` with mode `0600`, backs up the previous file to `.env.backup` (or `.env.backup.<date>` if that exists), and keeps the settings it does not manage as written unless you choose Start fresh.
- It copies the bundled skills from `skills/` to `~/.openclaw/workspace/skills/`.
- With `NERVE_INSTALLER=1` (set by the installer) it skips the banner and the "next steps" text, and draws its summary inside the installer's rail.
- `npm run setup -- --check` validates an existing `.env` and tests the gateway without changing anything.

---

## 5. Stage 5 of 5: Service

Service setup is OS-specific. Paths are escaped before anything is written (see 5A.1 and 5B.2).

## 5A. Linux with systemd

### 5A.1 Unit generation (`setup_systemd`)

Creates `/etc/systemd/system/nerve.service` with:

- `Type=simple`, `User=` and `Group=` set to the service user
- `ExecStart=<node> server-dist/index.js`
- `WorkingDirectory=<INSTALL_DIR>`
- `Environment=NODE_ENV=production`, plus explicit `HOME` and `PATH`
- `Restart=on-failure` with `RestartSec=5`

The unit does not load `.env` (no `EnvironmentFile=`). The server loads `<INSTALL_DIR>/.env` itself with dotenv, from its working directory, exactly as it does under launchd. systemd parses `.env` files differently (it rejects `export KEY=...` and keeps inline comments), and anything it set would win, because dotenv never overrides a variable that is already set. Units written by older installers still carry `EnvironmentFile=`; the next installer run with root access replaces them.

Escaping:

- `%` is doubled in `User=`, `Group=`, `WorkingDirectory=`, `ExecStart=` and `Environment=`, because systemd reads it as a specifier.
- The `ExecStart=` path and the `Environment=` assignments are double-quoted whenever they contain anything other than letters, digits and `_./:@+,=-`, with backslashes and double quotes escaped.
- Before writing anything, the installer refuses paths the unit cannot hold:
  - the Node.js path contains a control character, quote, backslash, `*`, `?`, `[` or `$`;
  - the install directory contains a line break, or ends with whitespace or a backslash;
  - the home directory contains a control character.

A refused path prints `Not installing the systemd service: <reason>`, leaves any existing unit and the service it runs untouched, marks the install incomplete (exit 2), and lists `cd <INSTALL_DIR> && npm start` as the way to start Nerve. If a unit already existed, the headline says `Nerve was updated, but nerve.service was not restarted.`

### 5A.2 Service user detection

The service user and home come from:

1. `SUDO_USER`, or `USER`.
2. A home lookup through `getent`, `dscl` or `/etc/passwd` (when running through sudo).
3. When running as root: the owner inferred from the `openclaw` binary path under `/home/<user>/...`.

### 5A.3 Root access

Installing the unit needs root:

- As root: runs the commands directly.
- Non-root with passwordless sudo: uses `sudo -n` and says so first.
- Non-root, interactive: asks for the sudo password once (`sudo -v`), then uses `sudo -n`.
- Otherwise (no sudo, wrong password, or non-interactive without passwordless sudo):
  - saves the unit to `~/.nerve/nerve.service`, which survives a reboot;
  - prints the exact commands to install, enable and restart it;
  - leaves an existing unit and the service it runs untouched.

With root access it writes the unit with `install -m 0644`, then runs `daemon-reload`, `enable`, and (if `.env` exists) `restart`. If `.env` is missing it enables the unit but does not start it, and lists `npm run setup` as a next step.

### 5A.4 When service install is triggered

Only when systemd is the running init system (`/run/systemd/system` exists). A `systemctl` binary alone, as in some containers and WSL setups, counts as no systemd.

- Existing unit: rewritten and restarted in place (never stopped first).
- Interactive new install: asks `Install as a systemd service? (Y/n)` (default yes). If the answer cannot be read, it installs.
- Non-interactive: installs (root access as in 5A.3).

### 5A.5 Linux without systemd

Prints `cd <INSTALL_DIR> && npm start` as the way to start Nerve. This is not an error.

## 5B. macOS with launchd

### 5B.1 Wrapper script creation

Creates `<INSTALL_DIR>/start.sh`, which:

- changes into its own directory first, so manual invocation resolves `.env` the same way as the service;
- puts the Node directory on `PATH` and sets `NODE_ENV=production`;
- runs `exec node server-dist/index.js`.

The Node server loads `.env` at runtime, so config updates take effect on restart without rewriting the plist.

### 5B.2 Plist creation

Writes `~/Library/LaunchAgents/com.nerve.server.plist` with:

- program arguments: the wrapper script
- working directory
- a `PATH` that starts with the Node directory
- `RunAtLoad` and `KeepAlive`
- stdout and stderr both going to `<INSTALL_DIR>/nerve.log`

Every path is XML-escaped (`& < > " '`, and line breaks as character references). If a path holds a control character a property list cannot hold, the installer prints `Not installing the launchd service: ...`, leaves the existing agent running, marks the install incomplete (exit 2), and lists `cd <INSTALL_DIR> && npm start`. An existing agent is only stopped (`launchctl bootout`, falling back to `launchctl stop`) after the paths pass this check.

### 5B.3 Service load behavior

Tries:

1. `launchctl bootstrap gui/<uid> <plist>`
2. fallback `launchctl load <plist>`

If both fail, it leaves the plist, marks the install incomplete (exit 2), and prints `launchctl load <plist>` as the next step.

### 5B.4 When launchd install is triggered

- Existing plist: updated and reloaded.
- Interactive new install: asks `Install as a launchd service (starts on login)? (Y/n)` (default yes).
- Non-interactive: installs.

---

## 6. Final output and exit codes

### 6.1 Health check

When systemd or launchd started Nerve, the installer polls `http://<HOST>:<PORT>/health` once a second, for up to 20 tries or 30 seconds. It reads `HOST` and `PORT` from `.env` the way the server does. Wildcard hosts (`0.0.0.0`, `::`) are probed on loopback, like the updater does. If `PORT` is not a usable port (an integer from 1 to 65535), it says so instead of probing.

### 6.2 Completion output

Prints "Done", then one of:

- Nerve answered `/health`: the success box with the URL, plus the restart and log commands for the platform.
- Otherwise: a headline that says what happened (not started yet, service failed to start, started but not responding, or updated but not restarted), the log command when a service exists, the exact commands to start it, and the URL to open once it runs.

Both also list the deployment guides (from `scripts/lib/deployment-guides.json`, when readable) and the install directory.

URL logic:

- Reads `PORT` from `.env` (default `3080`).
- If `HOST=0.0.0.0`, tries to show a detected LAN IP URL.
- Otherwise shows `http://localhost:<port>`.

### 6.3 Exit semantics

| Code | Meaning |
|------|---------|
| 0 | Nerve answered its health check. |
| 0 | Installed and configured, but no service was set up (systemd not running, or the user declined the service). The printed `npm start` command starts it. |
| 0 | Dry-run completed successfully. |
| 2 | Partial success. Installed, but `.env` is missing or unusable, or Nerve is not running because the service could not be installed (no root access, or a refused path), failed to start, or did not answer its health check. |
| 1 | Hard failure: a prerequisite, download, install or build step failed, an option was rejected, `--access-mode` setup failed, or port `3080` was busy and no other port could be chosen (non-interactive run, or an unreadable terminal). |

---

## Quick flow summary

1. Initialize, parse arguments, detect interactivity.
2. Check prerequisites.
3. Clone or update the repo.
4. Install dependencies and build.
5. Fetch the optional voice prerequisites (speech model and `ffmpeg`).
6. Configure `.env` (wizard, defaults mode, or the installer's own minimal file).
7. Install and start the service (launchd or systemd).
8. Check that Nerve answers `/health`.
9. Print the URL and operational commands, or what to run to start Nerve.
10. Exit with a readiness-aware status code.
