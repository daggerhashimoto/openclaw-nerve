# Nerve Installer Script: Step-by-Step Reference

This document describes exactly what `install.sh` does, in the order it executes, including conditional branches.

- Script: `install.sh`
- Purpose: One-command install/update of **openclaw-nerve**
- Primary entrypoint: `curl .../install.sh | bash`

---

## 0) Startup and Initialization

### 0.1 Strict shell mode
The script starts with:

- `set -euo pipefail`

This makes it fail fast on command errors, unset variables, and pipeline failures.

### 0.2 Default variables
It initializes defaults such as:

- `INSTALL_DIR` (default `~/nerve`, overridable via `NERVE_INSTALL_DIR`)
- `BRANCH` (default `master`)
- `REPO`
- `NODE_MIN=22`
- flags: `SKIP_SETUP`, `DRY_RUN`
- `GATEWAY_TOKEN` (optional CLI override)
- `ENV_MISSING` (tracks partial installs)

### 0.3 OS family detection
It pre-detects platform family for package-manager logic:

- macOS (`Darwin`)
- Debian-like (`apt-get`)
- Fedora/RHEL-like (`dnf`/`yum`)

### 0.4 Utility helpers
Defines output helpers (`ok`, `warn`, `fail`, `info`, `dry`) and utility functions:

- `run_with_dots` for animated progress + exit capture (`RWD_EXIT`)
- `detect_gateway_token` (systemd service token first, then `~/.openclaw/openclaw.json`)
- stage renderer (`stage`) for `[1/5]`, `[2/5]`, etc.

### 0.5 CLI argument parsing
Supported flags:

- `--dir <path>`
- `--branch <name>`
- `--repo <url>`
- `--skip-setup`
- `--dry-run`
- `--gateway-token <token>`
- `--help`

Unknown or malformed args exit with error.

### 0.6 Interactive mode detection
Interactive mode is true if either:

- stdin is a TTY (`-t 0`), or
- `/dev/tty` is readable+writable

This allows prompts even when invoked via `curl | bash`.

### 0.7 Banner output
Prints the Nerve ASCII banner and a dry-run warning banner when relevant.

---

## 1) Stage 1/5 — Prerequisites

The script runs these checks in order:

### 1.1 `check_node`
- Verifies `node` exists.
- Verifies major version is `>=22`.
- On failure, prints targeted upgrade guidance (nvm/Homebrew/etc.) and exits.

### 1.2 `check_npm`
- Verifies `npm` exists.
- If missing, explains reinstall path and exits.

### 1.3 `check_git`
- Verifies `git` exists.
- If missing, prints OS-specific install command and exits.

### 1.4 `check_build_tools`
- Checks for `make` and `g++` (needed for native modules like `node-pty`).
- If missing:
  - Debian: auto-installs `build-essential` (unless dry-run)
  - macOS: triggers Xcode CLI tools install and waits
  - otherwise: prints manual install commands and exits

### 1.5 `check_openclaw`
- Verifies `openclaw` is in PATH.
- If not, searches common install locations (nvm, Homebrew, Volta, fnm, etc.).
- If found in fallback path, prepends that directory to `PATH`.
- If still missing, exits with install instructions.

### 1.6 `check_gateway`
- Reads gateway port from `~/.openclaw/openclaw.json` (fallback 18789).
- Probes gateway (`/health` then `/`) and warns if unreachable.
- Verifies gateway token exists (CLI arg or auto-detected).
- Warns (does not hard fail) if token is missing.

---

## 2) Stage 2/5 — Download

### 2.1 Dry-run behavior
- Prints what would happen (clone vs update).

### 2.2 Real behavior
- If `INSTALL_DIR/.git` exists:
  - `git pull origin <branch>`
- Else:
  - `git clone --branch <branch> --depth 1 <repo> <dir>`
- Then `cd` into `INSTALL_DIR`.

---

## 3) Stage 3/5 — Install & Build

### 3.1 Dependency install (`npm ci`)
- Runs `npm ci` with logs captured to temp file.
- On failure, prints last 10 lines + full log path.
- Detects common error patterns and prints targeted troubleshooting:
  - permission errors
  - node-gyp/build tool errors
  - dependency resolve conflicts

### 3.2 Client build
- Runs `npm run build`.
- On failure: prints last 10 log lines + full path + hints.

### 3.3 Server build
- Runs `npm run build:server`.
- On failure: same structured diagnostics.

### 3.4 Temp log cleanup
- Deletes npm/build temp log files on success.

### 3.5 Local speech model bootstrap
- Ensures `~/.nerve/models/ggml-tiny.en.bin` exists.
- If missing, downloads ~75MB from Hugging Face.
- If download fails, continues with warning (voice input can still use OpenAI API).

### 3.6 `ffmpeg` check/install
- If `ffmpeg` missing:
  - macOS: warning + brew install hint
  - Debian: attempts apt install
  - Fedora: attempts dnf install
- Install failures are warnings, not hard failures.

---

## 4) Stage 4/5 — Configure

This stage controls `.env` provisioning and setup wizard behavior.

### 4.1 `generate_env_from_gateway` helper
When called (and `.env` doesn’t already exist), it:

1. Reads gateway token (`--gateway-token` first, then auto-detect)
2. Reads gateway port from `openclaw.json` (fallback 18789)
3. Writes minimal `.env`:
   - `GATEWAY_URL=http://127.0.0.1:<port>`
   - `GATEWAY_TOKEN=<token>`
   - `PORT=3080`

If token missing, it warns and sets `ENV_MISSING=true`.

### 4.2 Configure decision matrix

#### Dry-run
- Shows simulated setup path only.

#### `--skip-setup`
- If `.env` exists: keep it.
- If no `.env`: auto-generate from gateway config.

#### Interactive mode (no `--skip-setup`)
- If `.env` exists:
  - ask: “Run setup wizard anyway?”
  - if yes: run `NERVE_INSTALLER=1 npm run setup`
  - if no: keep existing config
- If no `.env`:
  - run setup wizard
  - if wizard fails, fallback to auto-generate `.env`

#### Non-interactive mode (no `--skip-setup`)
- If `.env` exists: keep it.
- If no `.env`: auto-generate from gateway.

### 4.3 Gateway config patching (inside setup wizard)

After `.env` is written, the setup wizard detects and applies pending OpenClaw gateway config changes. This uses a detection layer (`detectNeededConfigChanges`) that checks what needs changing without applying, then presents all changes as a bundled consent prompt.

#### Possible changes detected:
1. **Device scopes** — bootstraps `~/.openclaw/devices/paired.json` with full operator scopes if missing or incomplete
2. **Pre-pair Nerve device** — registers Nerve's Ed25519 identity in `paired.json` so it can connect without manual `openclaw devices approve`
3. **Tools allow** — adds `"cron"` to `gateway.tools.allow` in `~/.openclaw/openclaw.json` (required for OpenClaw ≥2026.2.23 which denies cron on `/tools/invoke` by default)
4. **Allowed origins** — adds Nerve's HTTP/HTTPS origins to `gateway.controlUi.allowedOrigins` (network access modes only)

#### Interactive mode:
- Shows a numbered list of all pending changes
- One yes/no confirmation prompt
- If declined, prints per-change manual fix instructions
- If accepted, applies all changes, then a single gateway restart

#### `--defaults` mode:
- All changes applied silently (implicit consent)
- Origins computed automatically from `HOST` and `PORT`
- Treats any non-loopback HOST as network mode

#### Post-apply:
- Single gateway restart after all patches
- `approveAllPendingDevices()` only runs when device-scopes or pre-pair changes were applied
- Failures are logged with `warn()` in both interactive and defaults modes

#### Dependency ordering:
- Device-scopes always runs before pre-pair (pre-pair needs `paired.json` to exist)
- If device-scopes fails, pre-pair is explicitly skipped

---

## 5) Stage 5/5 — Service Setup

Service setup is OS-specific.

## 5A) Linux/systemd path

### 5A.1 Unit generation (`setup_systemd`)
Creates a unit file at `/etc/systemd/system/nerve.service` with:

- `ExecStart=<node> server-dist/index.js`
- `WorkingDirectory=<INSTALL_DIR>`
- `EnvironmentFile=<INSTALL_DIR>/.env`
- `NODE_ENV=production`
- explicit `HOME` and `PATH`
- `Restart=on-failure`

### 5A.2 Service user detection
Determines service user/home by:

1. `SUDO_USER`/`USER`
2. `getent` home lookup (if via sudo)
3. fallback heuristic: infer user from `openclaw` binary path under `/home/<user>/...`

### 5A.3 Root vs non-root behavior
- If root:
  - installs service file directly
  - `daemon-reload`, `enable`, and (if `.env` exists) `start`
  - if `.env` missing: enables but does not start
- If non-root:
  - prints exact sudo commands to install/start manually
  - leaves temp service file path in instructions

### 5A.4 When service install is triggered
- Existing service: stop + update
- Interactive new install: asks user (default yes)
- Non-interactive:
  - if root: installs automatically
  - if non-root: generates instructions/files

## 5B) macOS/launchd path

### 5B.1 Wrapper script creation
Creates `<INSTALL_DIR>/start.sh` that:

- sources `.env` at runtime
- sets `NODE_ENV=production`
- executes `node server-dist/index.js`

This allows config updates by restarting service (no plist rewrite needed).

### 5B.2 Plist creation
Writes `~/Library/LaunchAgents/com.nerve.server.plist` with:

- program args -> wrapper script
- working directory
- PATH env
- keepalive + run-at-load
- stdout/stderr logs to `<INSTALL_DIR>/nerve.log`

### 5B.3 Service load behavior
Attempts:

1. `launchctl bootstrap gui/<uid> ...`
2. fallback `launchctl load ...`

If both fail, leaves plist and prints manual load command.

### 5B.4 When launchd install is triggered
- Existing plist: update/reload
- Interactive new install: asks user (default yes)
- Non-interactive: installs by default

---

## 6) Final Output and Exit Codes

### 6.1 Completion UI
Prints “Done” and a final success box with URL.

URL logic:

- Reads `PORT` from `.env` (default `3080`)
- If `HOST=0.0.0.0`, tries to show a detected LAN IP URL
- Otherwise shows `http://localhost:<port>`

Also prints restart/log commands based on platform/service manager.

### 6.2 Exit semantics
- `exit 0`: fully configured install (`.env` present)
- `exit 2`: partial success (installed, but `.env` missing or unusable)
- `exit 1`: hard failure in prerequisite/build/etc.

---

## Quick Flow Summary

1. Initialize + parse args + detect interactivity
2. Check prerequisites
3. Clone/update repo
4. Install deps + build
5. Fetch optional voice prerequisites (model + ffmpeg)
6. Configure `.env` (wizard or auto-generation)
7. Configure service (launchd/systemd)
8. Print final URL and operational commands
9. Exit with readiness-aware status code
