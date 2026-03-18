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
- `BRANCH` (default `master`, used only for explicit/fallback branch installs)
- `REPO`
- `NODE_MIN=22`
- flags: `SKIP_SETUP`, `DRY_RUN`
- `VERSION` (optional pinned release version)
- `BRANCH_EXPLICIT` (tracks whether `--branch` was set)
- `GATEWAY_TOKEN` (optional CLI override)
- `ACCESS_MODE` (optional explicit setup mode such as `tailscale-ip` or `tailscale-serve`)
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
- `--version <vX.Y.Z>`
- `--branch <name>` (dev override; bypasses release-first flow)
- `--repo <url>`
- `--skip-setup`
- `--dry-run`
- `--gateway-token <token>`
- `--access-mode <mode>`
- `--help`

Supported `--access-mode` values:
- `local`
- `network`
- `custom`
- `tailscale-ip`
- `tailscale-serve`

Backward compatibility:
- legacy `tailscale` is normalized to `tailscale-ip`

`--version` and `--branch` are mutually exclusive.

Unknown or malformed args exit with error.

### 0.6 Interactive mode detection
Interactive mode is true if either:

- stdin is a TTY (`-t 0`), or
- `/dev/tty` resolves to a real controlling terminal

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
  - Debian:
    - when running as root, auto-installs `build-essential` (unless dry-run)
    - when running as a normal user, exits with the explicit `sudo apt install build-essential` command
    - dry-run mirrors that split instead of pretending non-root installs would succeed automatically
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

### 2.1 Target ref resolution (release-first)
The installer resolves a target ref before clone/update:

1. If `--version` is provided: use that release tag (`vX.Y.Z`)
2. Else if `--branch` is provided: use that branch
3. Else (default): query GitHub Releases API for latest published release tag
4. If release API fails: fallback to branch (`master` by default)

### 2.2 Dry-run behavior
- Prints target ref and what clone/update would do.

### 2.3 Real behavior
- If `INSTALL_DIR/.git` exists:
  - checks whether the repo has local changes
  - interactive mode: warns and asks before overwriting them
  - non-interactive mode: aborts rather than discarding them
  - Branch mode: `git fetch origin <branch>` + checkout + hard reset to `origin/<branch>`
  - Release mode: `git fetch --tags origin` + checkout `<tag>`
- Else (fresh clone):
  - Branch mode: `git clone --branch <branch> --depth 1 <repo> <dir>`
  - Release mode: clone repo, fetch tags, checkout `<tag>`
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

### 3.2 Project build
- Runs `npm run build`.
- This already includes the server build through the package script.
- On failure: prints last 10 log lines + full path + hints.

### 3.3 Temp log cleanup
- Deletes npm/build temp log files on success.

### 3.4 Local speech model bootstrap
- Resolves target model from `.env` `WHISPER_MODEL` (defaults to `base`).
- Ensures matching file exists in `~/.nerve/models/` (for example `ggml-base.bin`).
- If missing, downloads the selected model from Hugging Face.
- If download fails, continues with warning (local STT may fail unless OpenAI STT is configured).
- Runtime default STT model is `base` (multilingual) unless user overrides `WHISPER_MODEL`.

### 3.5 `ffmpeg` check/install
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

If token exists but port `3080` is already occupied:

- interactive mode: prompts for an available port
- if the terminal cannot be read for that prompt, the installer exits instead of looping
- non-interactive mode: fails cleanly and tells the user to free the port or configure another one

### 4.2 Configure decision matrix

#### Dry-run
- Shows simulated setup path only.
- Exits `0` if the simulation itself succeeds.

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

Inside the interactive setup wizard, access mode now splits Tailscale into two explicit choices:
- `tailnet IP`
- `Tailscale Serve`

Behavior by interactive profile:
- `tailnet IP`
  - configures direct tailnet-IP access
  - keeps Nerve network-reachable
  - patches gateway allowed origins using the tailnet IP origin
- `Tailscale Serve`
  - keeps Nerve on `127.0.0.1`
  - asks whether to run `tailscale serve --bg 443 http://127.0.0.1:<PORT>`
  - detects the resulting `https://<node>.tail<id>.ts.net` origin
  - patches both Nerve and the gateway for that `*.ts.net` origin
  - if Serve cannot be confirmed, asks whether to fall back to `tailnet IP` or stop

If Tailscale is installed but not logged in:
- setup guides the operator to run the browser URL login flow with `tailscale up`
- setup can wait and re-check, or exit and let the user rerun later

If Tailscale is missing:
- setup explains that clearly
- prints the install/login next steps
- exits instead of pretending setup succeeded

#### Non-interactive mode (no `--skip-setup`)
- If `.env` exists: keep it.
- If no `.env` and no explicit `--access-mode`: auto-generate from gateway.
- If `--access-mode` is provided:
  - route through `npm run setup -- --defaults --access-mode <mode>`
  - do not bypass setup with raw `.env` generation

Non-interactive Tailscale behavior:
- `--access-mode tailscale-ip`
  - attempts direct tailnet-IP setup if Tailscale state is usable
  - otherwise keeps the safest supported config and prints exact follow-up steps
- `--access-mode tailscale-serve`
  - never hangs waiting for login or Serve activation
  - if a usable `*.ts.net` origin is not confirmed, falls back to `tailscale-ip`
  - if even `tailscale-ip` is not ready, keeps localhost-only config and prints exact follow-up steps

### 4.3 Gateway config patching (inside setup wizard)

After `.env` is written, the setup wizard detects and applies pending OpenClaw gateway config changes. This uses a detection layer (`detectNeededConfigChanges`) that checks what needs changing without applying, then presents all changes as a bundled consent prompt.

#### Possible changes detected:
1. **Device scopes** — bootstraps `~/.openclaw/devices/paired.json` with full operator scopes if missing or incomplete
2. **Pre-pair Nerve device** — registers Nerve's Ed25519 identity in `paired.json` so it can connect without manual `openclaw devices approve`
3. **Tools allow** — adds `"cron"` and `"gateway"` to `gateway.tools.allow` in `~/.openclaw/openclaw.json` (required for OpenClaw ≥2026.2.23 which denies these tools on `/tools/invoke` by default)
4. **Allowed origins** — adds all required Nerve browser origins to `gateway.controlUi.allowedOrigins`
   - LAN or tailnet-IP mode: `http://<ip>:<port>`
   - Tailscale Serve mode: `https://<node>.tail<id>.ts.net`

#### Interactive mode:
- Shows a numbered list of all pending changes
- One yes/no confirmation prompt
- If declined, prints per-change manual fix instructions
- If accepted, applies all changes, then a single gateway restart

#### `--defaults` mode:
- All changes applied silently (implicit consent)
- Allowed origins come from the computed setup access plan, not just `HOST` and `PORT`
- `--access-mode tailscale-ip` and `--access-mode tailscale-serve` are supported explicitly
- legacy `--access-mode tailscale` maps to `tailscale-ip`
- if `tailscale-serve` cannot confirm a usable `*.ts.net` origin, defaults mode falls back to the safest supported path and prints follow-up steps

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

- changes into `<INSTALL_DIR>` first so manual invocation resolves `.env` the same way as the service
- sets `NODE_ENV=production`
- executes `node server-dist/index.js`

The Node server loads `.env` at runtime, so config updates still take effect on restart without rewriting the plist.

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
- `exit 0`: dry-run completed successfully
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
