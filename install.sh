#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# Nerve Installer — one-command setup for the Nerve web interface
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/install.sh | bash
#
# Or with options:
#   curl -fsSL ... | bash -s -- --dir ~/nerve --version v1.4.4
#   curl -fsSL ... | bash -s -- --dir ~/nerve --branch main
#   curl -fsSL ... | bash -s -- --gateway-url https://gw.example.com --gateway-token <token> --skip-setup
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Cleanup trap ──────────────────────────────────────────────────────
TEMP_FILES=()
RWD_PIDS=()

cleanup() {
  # The ${arr[@]+...} form keeps bash 3.2 (macOS /bin/bash) from failing on an
  # empty array under set -u, which would turn exit 0 into exit 1 here.
  # Kill any lingering run_with_dots background processes
  for pid in ${RWD_PIDS[@]+"${RWD_PIDS[@]}"}; do
    kill -0 "$pid" 2>/dev/null && kill "$pid" 2>/dev/null || true
  done
  # Remove temp files and directories (stderr captures, build backups)
  for f in ${TEMP_FILES[@]+"${TEMP_FILES[@]}"}; do
    rm -rf "$f" 2>/dev/null || true
  done
}
trap cleanup EXIT

# ── Defaults ──────────────────────────────────────────────────────────
INSTALL_DIR="${NERVE_INSTALL_DIR:-${HOME}/nerve}"
BRANCH="master"
BRANCH_EXPLICIT=false
VERSION=""
REPO="https://github.com/daggerhashimoto/openclaw-nerve.git"
NODE_MIN=22
SKIP_SETUP=false
DRY_RUN=false
GATEWAY_TOKEN=""
GATEWAY_URL_OVERRIDE=""
ACCESS_MODE=""
ENV_MISSING=false
SYSTEMD_UNIT_FILE="/etc/systemd/system/nerve.service"
SYSTEMD_RUN_DIR="/run/systemd/system"  # exists only while systemd is the running init system
SERVICE_STARTED=false     # a service manager (re)started Nerve during this run
NERVE_RUNNING=false       # Nerve then answered its /health check
SERVICE_INCOMPLETE=false  # the service step failed or needs root, so Nerve is not running
START_STEPS=()            # commands the user still has to run to start Nerve
LOGS_HINT=""              # command that shows the service logs, once a service exists
RESTART_CMD=""            # command that restarts the service, once a service exists
NOT_RUNNING_HEADLINE="Nerve is installed but not running yet."
ROOT_PREFIX="sudo "       # prefix for printed commands that need root
if [[ $EUID -eq 0 ]]; then ROOT_PREFIX=""; fi

# ── Colors ────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
ORANGE='\033[38;5;208m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

RAIL="${DIM}│${NC}"

ok()   { echo -e "  ${RAIL}  ${GREEN}✓${NC} $*"; }
warn() { echo -e "  ${RAIL}  ${YELLOW}⚠${NC} $*"; }
fail() { echo -e "  ${RAIL}  ${RED}✗${NC} $*"; }
info() { echo -e "  ${RAIL}  ${CYAN}→${NC} $*"; }
dry()  { echo -e "  ${RAIL}  ${YELLOW}⊘${NC} ${DIM}[dry-run]${NC} $*"; }

# ── Helpers ────────────────────────────────────────────────────────────
# Detect OS family once
IS_MAC=false; IS_DEBIAN=false; IS_FEDORA=false
if [[ "$(uname -s)" == "Darwin" ]]; then IS_MAC=true;
elif command -v apt-get &>/dev/null; then IS_DEBIAN=true;
elif command -v dnf &>/dev/null || command -v yum &>/dev/null; then IS_FEDORA=true; fi

# Display a copy-pasteable command hint
hint() { echo -e "  ${RAIL}"; echo -e "  ${RAIL}  ${BOLD}$1${NC}"; echo -e "  ${RAIL}"; }
cmd()  { echo -e "  ${RAIL}    ${CYAN}\$ $1${NC}"; }

print_deployment_guides() {
  local guides_file="${INSTALL_DIR}/scripts/lib/deployment-guides.json"
  local rendered_guides

  [[ -r "$guides_file" ]] || return 1

  rendered_guides="$(node - "$guides_file" <<'EOF'
const fs = require('node:fs');

const guidesPath = process.argv[2];

try {
  const guides = JSON.parse(fs.readFileSync(guidesPath, 'utf8'));
  if (!Array.isArray(guides)) process.exit(0);

  const rendered = [];
  for (const guide of guides) {
    if (guide && typeof guide.title === 'string' && typeof guide.url === 'string') {
      rendered.push(`     ${guide.title}: ${guide.url}`);
    }
  }

  process.stdout.write(rendered.join('\n'));
} catch {
  process.exit(0);
}
EOF
)" || return 1

  [[ -n "$rendered_guides" ]] || return 1

  echo "     Deployment guides:"
  printf '%s\n' "$rendered_guides"
}

# Check if a port is already in use. Returns 0 if port is free, 1 if occupied.
check_port() {
  local port="$1"
  if command -v ss &>/dev/null; then
    ss -tlnH "sport = :${port}" 2>/dev/null | grep -q . && return 1
  elif command -v lsof &>/dev/null; then
    lsof -iTCP:"${port}" -sTCP:LISTEN -P -n &>/dev/null && return 1
  elif command -v netstat &>/dev/null; then
    netstat -tlnp 2>/dev/null | grep -q ":${port} " && return 1
  fi
  return 0
}

repo_has_local_changes() {
  local repo_dir="$1"
  git -C "$repo_dir" status --porcelain --untracked-files=normal 2>/dev/null | grep -q .
}

# Run a command as root: directly when the installer is root, otherwise through
# sudo -n. Call can_run_as_root first so sudo never waits on a hidden prompt.
as_root() {
  if [[ $EUID -eq 0 ]]; then
    "$@"
  else
    sudo -n "$@"
  fi
}

# Succeeds when as_root can work. Interactive installs may be asked for the sudo
# password once; non-interactive installs only use passwordless sudo.
can_run_as_root() {
  [[ $EUID -eq 0 ]] && return 0
  command -v sudo &>/dev/null || return 1
  sudo -n true &>/dev/null && return 0
  [[ "$INTERACTIVE" == "true" ]] || return 1
  info "Installing the service needs sudo, so you may be asked for your password"
  sudo -v < /dev/tty
}

# Succeeds when systemd is the running init system (the same check as sd_booted).
# A systemctl binary alone is not enough: containers and WSL can ship one without
# systemd running, and every systemctl call then fails.
systemd_running() {
  command -v systemctl &>/dev/null && [[ -d "$SYSTEMD_RUN_DIR" ]]
}

# Value of KEY in Nerve's .env, read the way the server reads it: the server and
# the updater load .env with dotenv, and the script below is dotenv 17's parse()
# (export prefix, spaces around =, inline comments, quotes, CRLF, last one wins).
# Prints nothing when the file or the key is missing.
env_file_value() {
  [[ -f "${INSTALL_DIR}/.env" ]] || return 0
  node - "${INSTALL_DIR}/.env" "$1" <<'EOF' || true
const fs = require('node:fs');
const [file, key] = process.argv.slice(2);
const LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg;
const lines = fs.readFileSync(file, 'utf8').replace(/\r\n?/mg, '\n');
let value;
let match;
while ((match = LINE.exec(lines)) !== null) {
  if (match[1] !== key) continue;
  value = (match[2] || '').trim();
  const quote = value[0];
  value = value.replace(/^(['"`])([\s\S]*)\1$/mg, '$2');
  if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
}
if (value !== undefined) process.stdout.write(value);
EOF
}

# Nerve's port, converted the way server/lib/config.ts does it:
# Number(PORT || 3080), so "+4123", "4123.0" and "0x1F90" all count. Prints
# nothing when the server could not be reached on that value: listen() rejects
# anything but an integer up to 65535, and 0 means a random port.
nerve_port() {
  local raw
  raw=$(env_file_value PORT)
  node -e 'const port = Number(process.argv[1] || 3080); if (Number.isInteger(port) && port >= 1 && port <= 65535) process.stdout.write(String(port));' -- "$raw" || true
}

# URL of Nerve's /health endpoint. Mirrors the updater's health check: wildcard
# bind addresses are probed on loopback. Unlike the updater it ignores PORT and
# HOST in its own environment, which the service never sees.
nerve_health_url() {
  local port host
  port=$(nerve_port)
  [[ -n "$port" ]] || return 0  # no reachable port, so no URL
  host=$(env_file_value HOST)
  host="${host#"${host%%[![:space:]]*}"}"
  host="${host%"${host##*[![:space:]]}"}"
  case "$host" in
    ""|0.0.0.0) host="127.0.0.1" ;;
    ::|"[::]") host="[::1]" ;;
    \[*) ;;
    *:*) host="[${host}]" ;;
  esac
  echo "http://${host}:${port}/health"
}

# Quote a path for a command the user is meant to copy and paste.
shell_quote() {
  printf '%q' "$1"
}

# Poll a /health URL once a second, for up to 20 tries or 30 seconds. Each try
# allows 5 seconds because /health itself waits up to 3 seconds on its gateway probe.
wait_for_nerve() {
  local url="$1" deadline=$((SECONDS + 30))
  for _ in $(seq 1 20); do
    curl -sf --max-time 5 -o /dev/null "$url" && return 0
    (( SECONDS < deadline )) || return 1
    sleep 1
  done
  return 1
}

# Animated dots while a background process runs
# Usage: run_with_dots "message" command arg1 arg2 ...
# Sets RWD_EXIT to the command's exit code after completion.
run_with_dots() {
  local msg="$1"; shift
  local stderr_file
  stderr_file=$(mktemp /tmp/nerve-rwd-XXXXXX)
  TEMP_FILES+=("$stderr_file")
  printf "  ${RAIL}  ${CYAN}→${NC} %s " "$msg"
  "$@" 2>"$stderr_file" &
  local pid=$!
  RWD_PIDS+=("$pid")
  while kill -0 "$pid" 2>/dev/null; do
    printf "."
    sleep 1
  done
  if wait "$pid"; then
    RWD_EXIT=0
  else
    RWD_EXIT=$?
  fi
  echo ""
  if [[ $RWD_EXIT -ne 0 && -s "$stderr_file" ]]; then
    echo -e "  ${RAIL}  ${RED}stderr:${NC}"
    while IFS= read -r line; do
      echo -e "  ${RAIL}    ${DIM}${line}${NC}"
    done < "$stderr_file"
  fi
  return $RWD_EXIT
}

# Read the real gateway token. Systemd service file takes priority because
# the gateway process uses its env var over openclaw.json (known 2026.2.19 bug).
detect_gateway_token() {
  local token=""
  # 1. Check systemd service file (source of truth when present)
  local svc_files=(
    "${HOME}/.config/systemd/user/openclaw-gateway.service"
    "/etc/systemd/system/openclaw-gateway.service"
  )
  for svc in "${svc_files[@]}"; do
    if [[ -f "$svc" ]]; then
      token=$(grep -oP 'OPENCLAW_GATEWAY_TOKEN=\K\S+' "$svc" 2>/dev/null || true)
      if [[ -n "$token" ]]; then
        echo "$token"
        return 0
      fi
    fi
  done
  # 2. Fall back to openclaw.json
  local config_file="${HOME}/.openclaw/openclaw.json"
  if [[ -f "$config_file" ]]; then
    token=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$config_file','utf8'));console.log(c.gateway?.auth?.token??'')}catch{}" 2>/dev/null || echo "")
    if [[ -n "$token" ]]; then
      echo "$token"
      return 0
    fi
  fi
  echo ""
}

normalize_version_tag() {
  local raw="$1"
  local normalized="${raw#v}"
  if [[ "$normalized" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "v${normalized}"
    return 0
  fi
  return 1
}

github_repo_path_from_url() {
  local url="$1"
  local path=""

  if [[ "$url" =~ ^https://github.com/([^/]+)/([^/]+)(\.git)?/?$ ]]; then
    path="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  elif [[ "$url" =~ ^git@github.com:([^/]+)/([^/]+)(\.git)?/?$ ]]; then
    path="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  elif [[ "$url" =~ ^ssh://git@github.com/([^/]+)/([^/]+)(\.git)?/?$ ]]; then
    path="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  else
    return 1
  fi

  path="${path%.git}"
  echo "$path"
}

fetch_latest_release_tag() {
  local repo_path
  repo_path=$(github_repo_path_from_url "$REPO") || return 1

  local api_url="https://api.github.com/repos/${repo_path}/releases/latest"
  local response
  local token="${GITHUB_TOKEN:-${GH_TOKEN:-}}"

  if [[ -n "$token" ]]; then
    response=$(curl -fsSL \
      -H "Accept: application/vnd.github+json" \
      -H "User-Agent: nerve-installer" \
      -H "Authorization: Bearer ${token}" \
      "$api_url" 2>/dev/null) || return 1
  else
    response=$(curl -fsSL \
      -H "Accept: application/vnd.github+json" \
      -H "User-Agent: nerve-installer" \
      "$api_url" 2>/dev/null) || return 1
  fi

  local tag
  tag=$(printf '%s' "$response" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);if(typeof j.tag_name==="string")process.stdout.write(j.tag_name);}catch{}});') || return 1

  normalize_version_tag "$tag" || return 1
}

STAGE_CURRENT=0
STAGE_TOTAL=5
stage() {
  STAGE_CURRENT=$((STAGE_CURRENT + 1))
  if [[ $STAGE_CURRENT -gt 1 ]]; then
    echo -e "  ${RAIL}"
  fi
  echo -e "  ${ORANGE}●${NC} ${ORANGE}${BOLD}${1}${NC}  ${DIM}[${STAGE_CURRENT}/${STAGE_TOTAL}]${NC}"
  echo -e "  ${RAIL}"
}

stage_done() {
  echo -e "  ${RAIL}"
}

# ── Parse args ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)       [[ $# -ge 2 ]] || { echo "Missing value for --dir"; exit 1; }; INSTALL_DIR="$2"; shift 2 ;;
    --branch)    [[ $# -ge 2 ]] || { echo "Missing value for --branch"; exit 1; }; BRANCH="$2"; BRANCH_EXPLICIT=true; shift 2 ;;
    --version)   [[ $# -ge 2 ]] || { echo "Missing value for --version"; exit 1; }; VERSION="$2"; shift 2 ;;
    --repo)      [[ $# -ge 2 ]] || { echo "Missing value for --repo"; exit 1; }; REPO="$2"; shift 2 ;;
    --skip-setup) SKIP_SETUP=true; shift ;;
    --dry-run)    DRY_RUN=true; shift ;;
    --gateway-token) [[ $# -ge 2 ]] || { echo "Missing value for --gateway-token"; exit 1; }; GATEWAY_TOKEN="$2"; shift 2 ;;
    --gateway-url) [[ $# -ge 2 ]] || { echo "Missing value for --gateway-url"; exit 1; }; GATEWAY_URL_OVERRIDE="$2"; shift 2 ;;
    --access-mode) [[ $# -ge 2 ]] || { echo "Missing value for --access-mode"; exit 1; }; ACCESS_MODE="$2"; shift 2 ;;
    --help|-h)
      echo "Nerve Installer"
      echo ""
      echo "Options:"
      echo "  --dir <path>         Install directory (default: ~/nerve)"
      echo "  --version <vX.Y.Z>   Install a specific release version"
      echo "  --branch <name>      Install from a branch (dev override; bypasses release mode)"
      echo "  --repo <url>         Git repo URL"
      echo "  --skip-setup         Skip the interactive setup wizard"
      echo "  --gateway-token <t>  Gateway token (for non-interactive installs)"
      echo "  --gateway-url <url>  Gateway URL (for remote/non-interactive installs)"
      echo "  --access-mode <m>    Setup access mode: local|network|custom|tailscale-ip|tailscale-serve"
      echo "  --dry-run            Simulate the install without changing anything"
      echo "  --help               Show this help"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -n "$VERSION" && "$BRANCH_EXPLICIT" == "true" ]]; then
  fail "Use either --version or --branch, not both"
  exit 1
fi

normalize_access_mode() {
  case "$1" in
    "") echo "" ;;
    tailscale) echo "tailscale-ip" ;;
    local|network|custom|tailscale-ip|tailscale-serve) echo "$1" ;;
    *)
      fail "Invalid --access-mode: $1"
      echo "  Supported values: local, network, custom, tailscale-ip, tailscale-serve"
      exit 1
      ;;
  esac
}

normalize_gateway_url() {
  local url="$1"

  if command -v node &>/dev/null; then
    node -e 'const input=process.argv[1];try{const u=new URL(input);if(!["http:","https:"].includes(u.protocol))throw new Error("protocol");if(u.search||u.hash)throw new Error("query-or-fragment");process.stdout.write(u.toString().replace(/\/+$/,""));}catch{process.exit(1)}' "$url" 2>/dev/null || return 1
  else
    [[ "$url" =~ ^https?://[^[:space:]?#]+$ ]] || return 1
    printf '%s' "${url%/}"
  fi
}

ACCESS_MODE=$(normalize_access_mode "$ACCESS_MODE")

if [[ -n "$GATEWAY_URL_OVERRIDE" ]]; then
  normalized_gateway_url=$(normalize_gateway_url "$GATEWAY_URL_OVERRIDE" || true)
  if [[ -z "$normalized_gateway_url" ]]; then
    fail "Invalid --gateway-url: $GATEWAY_URL_OVERRIDE"
    echo "  Expected an absolute http:// or https:// URL without query or fragment"
    exit 1
  fi
  GATEWAY_URL_OVERRIDE="$normalized_gateway_url"
fi

# ── Detect interactive mode ───────────────────────────────────────────
# When piped via curl | bash, stdin is the pipe — but /dev/tty still
# provides access to the controlling terminal for interactive prompts.
# Only treat it as interactive when that controlling terminal is real.
INTERACTIVE=false
if [[ -t 0 ]]; then
  INTERACTIVE=true
elif { tty -s < /dev/tty; } 2>/dev/null; then
  INTERACTIVE=true
fi

# ── Banner ────────────────────────────────────────────────────────────
echo ""
echo -e "  ${ORANGE}██████   █████ ██████████ ███████████   █████   █████ ██████████${NC}"
echo -e "  ${ORANGE}░░██████ ░░███ ░░███░░░░░█░░███░░░░░███ ░░███   ░░███ ░░███░░░░░█${NC}"
echo -e "  ${ORANGE} ░███░███ ░███  ░███  █ ░  ░███    ░███  ░███    ░███  ░███  █ ░${NC}"
echo -e "  ${ORANGE} ░███░░███░███  ░██████    ░██████████   ░███    ░███  ░██████${NC}"
echo -e "  ${ORANGE} ░███ ░░██████  ░███░░█    ░███░░░░░███  ░░███   ███   ░███░░█${NC}"
echo -e "  ${ORANGE} ░███  ░░█████  ░███ ░   █ ░███    ░███   ░░░█████░    ░███ ░   █${NC}"
echo -e "  ${ORANGE} █████  ░░█████ ██████████ █████   █████    ░░███      ██████████${NC}"
echo -e "  ${ORANGE}░░░░░    ░░░░░ ░░░░░░░░░░ ░░░░░   ░░░░░      ░░░      ░░░░░░░░░░${NC}"
echo ""
echo -e "  ${DIM}  Web interface for OpenClaw${NC}"
echo ""
if [[ "$DRY_RUN" == "true" ]]; then
  echo -e "  ${YELLOW}${BOLD}  ⊘  DRY RUN — nothing will be modified${NC}"
  echo ""
fi
echo -e "  ${DIM}│${NC}"

# ── Check: OpenClaw installed ─────────────────────────────────────────
check_openclaw() {
  if command -v openclaw &>/dev/null; then
    local ver
    ver=$(openclaw --version 2>/dev/null | head -1 || echo "unknown")
    ok "OpenClaw found: ${ver}"
    return 0
  fi

  # Check common paths
  local candidates=(
    "${HOME}/.nvm/versions/node/"*/bin/openclaw
    /opt/homebrew/bin/openclaw
    /usr/local/bin/openclaw
    /usr/bin/openclaw
    "${HOME}/.volta/bin/openclaw"
    "${HOME}/.fnm/aliases/default/bin/openclaw"
  )
  for c in "${candidates[@]}"; do
    if [[ -x "$c" ]]; then
      ok "OpenClaw found: ${c}"
      export PATH="$(dirname "$c"):$PATH"
      return 0
    fi
  done

  fail "OpenClaw not found"
  echo ""
  hint "Install OpenClaw:"
  cmd "npm install -g openclaw"
  echo ""
  echo -e "  ${RAIL}  ${DIM}Docs: https://github.com/openclaw/openclaw${NC}"
  echo ""
  exit 1
}

# ── Check: Node.js ────────────────────────────────────────────────────
check_node() {
  if ! command -v node &>/dev/null; then
    fail "Node.js not found — version ${NODE_MIN}+ is required"
    echo ""
    hint "Install Node.js via nvm (recommended):"
    cmd "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
    cmd "source ~/.bashrc"
    cmd "nvm install ${NODE_MIN}"
    echo ""
    if $IS_MAC; then
      echo -e "  ${RAIL}  ${DIM}Or via Homebrew: brew install node@${NODE_MIN}${NC}"
    elif $IS_DEBIAN; then
      echo -e "  ${RAIL}  ${DIM}Or via apt: https://deb.nodesource.com${NC}"
    fi
    echo ""
    exit 1
  fi

  local node_ver
  node_ver=$(node -v | sed 's/^v//')
  local node_major
  node_major=$(echo "$node_ver" | cut -d. -f1)

  if [[ "$node_major" -ge "$NODE_MIN" ]]; then
    ok "Node.js v${node_ver} (≥${NODE_MIN} required)"
  else
    fail "Node.js v${node_ver} — version ${NODE_MIN}+ is required"
    echo ""
    # Detect how Node was installed and suggest the right upgrade
    local node_path
    node_path=$(which node 2>/dev/null || echo "")
    if [[ "$node_path" == *".nvm/"* ]]; then
      hint "Upgrade via nvm:"
      cmd "nvm install ${NODE_MIN}"
      cmd "nvm use ${NODE_MIN}"
    elif [[ "$node_path" == *"homebrew"* || "$node_path" == *"Cellar"* ]]; then
      hint "Upgrade via Homebrew:"
      cmd "brew install node@${NODE_MIN}"
    elif $IS_DEBIAN; then
      hint "Upgrade via nvm (recommended):"
      cmd "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
      cmd "nvm install ${NODE_MIN}"
    else
      hint "Upgrade Node.js:"
      cmd "nvm install ${NODE_MIN}"
    fi
    echo ""
    exit 1
  fi
}

check_npm() {
  if command -v npm &>/dev/null; then
    ok "npm $(npm -v 2>/dev/null)"
  else
    fail "npm not found — it ships with Node.js"
    echo ""
    hint "Reinstall Node.js to get npm:"
    cmd "nvm install ${NODE_MIN}"
    echo ""
    echo -e "  ${RAIL}  ${DIM}If using a system package, npm may be separate: sudo apt install npm${NC}"
    echo ""
    exit 1
  fi
}

check_git() {
  if command -v git &>/dev/null; then
    ok "git $(git --version 2>/dev/null | awk '{print $3}')"
  else
    fail "git not found — required to clone the repo"
    echo ""
    if $IS_MAC; then
      hint "Install git:"
      cmd "xcode-select --install"
      echo -e "  ${RAIL}  ${DIM}Or: brew install git${NC}"
    elif $IS_DEBIAN; then
      hint "Install git:"
      cmd "sudo apt install git"
    elif $IS_FEDORA; then
      hint "Install git:"
      cmd "sudo dnf install git"
    else
      hint "Install git:"
      cmd "sudo apt install git"
      echo -e "  ${RAIL}  ${DIM}Or use your system's package manager${NC}"
    fi
    echo ""
    exit 1
  fi
}

# ── Check: Build tools (needed for node-pty native compilation) ───────
check_build_tools() {
  if command -v make &>/dev/null && command -v g++ &>/dev/null; then
    ok "Build tools available (make, g++)"
    return 0
  fi

  warn "Build tools (make, g++) not found — required for native modules"

  # Auto-install on Debian/Ubuntu
  if command -v apt-get &>/dev/null; then
    if [[ "$DRY_RUN" == "true" ]]; then
      if [[ $EUID -eq 0 ]]; then
        dry "Would install build-essential via apt"
      else
        dry "Would require manual install: sudo apt install build-essential"
      fi
      return 0
    fi
    if [[ $EUID -eq 0 ]]; then
      run_with_dots "Installing build tools" bash -c "DEBIAN_FRONTEND=noninteractive apt-get update -qq &>/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq build-essential &>/dev/null" || true
      if command -v make &>/dev/null && command -v g++ &>/dev/null; then
        ok "Build tools installed"
        return 0
      else
        fail "Failed to install build-essential"
      fi
    else
      warn "Build tools can be auto-installed only when running as root"
      echo ""
      hint "Install build tools:"
      cmd "sudo apt install build-essential"
      echo ""
      exit 1
    fi
  fi

  # Auto-install on macOS via Xcode Command Line Tools
  if [[ "$(uname -s)" == "Darwin" ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
      dry "Would install Xcode Command Line Tools"
      return 0
    fi
    info "Installing Xcode Command Line Tools (this may take a few minutes)..."
    xcode-select --install 2>/dev/null || true
    # Wait for the install to complete — xcode-select --install is async (opens GUI dialog)
    printf "  ${RAIL}  ${CYAN}→${NC} Waiting for Xcode CLT "
    until xcode-select -p &>/dev/null; do
      printf "."
      sleep 5
    done
    echo ""
    if command -v make &>/dev/null; then
      ok "Xcode Command Line Tools installed"
      return 0
    else
      fail "Xcode CLT install did not provide build tools"
    fi
  fi

  # Can't auto-install — tell the user
  echo ""
  echo -e "  Install build tools manually:"
  echo -e "    ${CYAN}Debian/Ubuntu:${NC}  sudo apt install build-essential"
  echo -e "    ${CYAN}Fedora/RHEL:${NC}    sudo dnf groupinstall 'Development Tools'"
  echo -e "    ${CYAN}macOS:${NC}          xcode-select --install"
  echo ""
  exit 1
}

# ── Check: Gateway reachable ──────────────────────────────────────────
check_gateway() {
  local gw_url="${GATEWAY_URL_OVERRIDE:-http://127.0.0.1:18789}"

  # Try to read from openclaw.json when no explicit gateway URL was provided
  local config_file="${HOME}/.openclaw/openclaw.json"
  if [[ -z "$GATEWAY_URL_OVERRIDE" && -f "$config_file" ]]; then
    local port
    port=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$config_file','utf8'));console.log(c.gateway?.port??18789)}catch{console.log(18789)}" 2>/dev/null || echo "18789")
    gw_url="http://127.0.0.1:${port}"
  fi

  if curl -sf "${gw_url}/health" &>/dev/null || curl -sf "${gw_url}/" &>/dev/null; then
    ok "OpenClaw gateway reachable at ${gw_url}"
  else
    warn "Gateway not reachable at ${gw_url} — start it with: openclaw gateway start"
  fi

  # Verify auth token exists (needed for .env generation and service connectivity)
  local gw_token="${GATEWAY_TOKEN:-}"
  if [[ -z "$gw_token" ]]; then
    gw_token=$(detect_gateway_token)
  fi
  if [[ -n "$gw_token" ]]; then
    ok "Gateway auth token present"
  else
    warn "No gateway auth token found — run: ${CYAN}openclaw onboard --install-daemon${NC}"
  fi
}

# ── [1/5] Prerequisites ───────────────────────────────────────────────
stage "Prerequisites"

check_node
check_npm
check_git
check_build_tools
check_openclaw
check_gateway

# ── [2/5] Clone or update ────────────────────────────────────────────
stage "Download"

TARGET_REF=""
TARGET_REF_KIND=""
if [[ -n "$VERSION" ]]; then
  if ! TARGET_REF=$(normalize_version_tag "$VERSION"); then
    fail "Invalid --version: ${VERSION} (expected vX.Y.Z)"
    exit 1
  fi
  TARGET_REF_KIND="version"
elif [[ "$BRANCH_EXPLICIT" == "true" ]]; then
  TARGET_REF="$BRANCH"
  TARGET_REF_KIND="branch"
else
  TARGET_REF=$(fetch_latest_release_tag || true)
  if [[ -n "$TARGET_REF" ]]; then
    TARGET_REF_KIND="release"
  else
    TARGET_REF="$BRANCH"
    TARGET_REF_KIND="branch-fallback"
    warn "Could not resolve latest GitHub release — falling back to branch ${BRANCH}"
  fi
fi

if [[ "$TARGET_REF_KIND" == "release" || "$TARGET_REF_KIND" == "version" ]]; then
  info "Using ref ${TARGET_REF} (${TARGET_REF_KIND})"
else
  info "Using ref ${TARGET_REF} (${TARGET_REF_KIND})"
fi

if [[ "$DRY_RUN" == "true" ]]; then
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    dry "Would update existing installation in ${INSTALL_DIR}"
    dry "Would warn before overwriting local repo changes"
    dry "Would checkout ${TARGET_REF}"
  else
    dry "Would clone ${REPO}"
    dry "Would checkout ${TARGET_REF}"
    dry "Would install to ${INSTALL_DIR}"
  fi
else
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    if repo_has_local_changes "$INSTALL_DIR"; then
      warn "Existing installation has local repo changes"
      info "Updating will discard tracked edits in ${INSTALL_DIR}"
      if [[ "$INTERACTIVE" == "true" ]]; then
        printf "  ${RAIL}  ${YELLOW}?${NC} Continue and overwrite local changes? (y/N) "
        if read -r answer < /dev/tty 2>/dev/null; then
          if [[ "$(echo "$answer" | tr "[:upper:]" "[:lower:]")" != "y" ]]; then
            fail "Aborted to avoid overwriting local changes"
            exit 1
          fi
        else
          fail "Cannot confirm destructive update safely"
          exit 1
        fi
      else
        fail "Refusing to overwrite a dirty install in non-interactive mode"
        info "Commit, stash, or back up ${INSTALL_DIR}, then rerun the installer"
        exit 1
      fi
    fi

    cd "$INSTALL_DIR"

    if [[ "$TARGET_REF_KIND" == "branch" || "$TARGET_REF_KIND" == "branch-fallback" ]]; then
      run_with_dots "Fetching ${TARGET_REF}" git fetch origin "$TARGET_REF" -q
      run_with_dots "Checking out ${TARGET_REF}" git checkout --force "$TARGET_REF" -q
      run_with_dots "Resetting to origin/${TARGET_REF}" git reset --hard "origin/${TARGET_REF}" -q
    else
      run_with_dots "Fetching tags" git fetch --tags origin -q
      run_with_dots "Checking out ${TARGET_REF}" git checkout --force "$TARGET_REF" -q
    fi

    ok "Updated to ${TARGET_REF}"
  else
    if [[ "$TARGET_REF_KIND" == "branch" || "$TARGET_REF_KIND" == "branch-fallback" ]]; then
      run_with_dots "Cloning Nerve" git clone --branch "$TARGET_REF" --depth 1 -q "$REPO" "$INSTALL_DIR"
    else
      run_with_dots "Cloning Nerve" git clone --depth 1 -q "$REPO" "$INSTALL_DIR"
      cd "$INSTALL_DIR"
      run_with_dots "Fetching tags" git fetch --tags origin -q
      run_with_dots "Checking out ${TARGET_REF}" git checkout --force "$TARGET_REF" -q
    fi
    ok "Cloned to ${INSTALL_DIR}"
  fi

  cd "$INSTALL_DIR"
fi

# ── [3/5] Install & Build ────────────────────────────────────────────
stage "Install & Build"

if [[ "$DRY_RUN" == "true" ]]; then
  dry "Would run: npm ci"
  dry "Would run: npm run build"
else
  npm_log=$(mktemp /tmp/nerve-npm-install-XXXXXX)

  if run_with_dots "Installing dependencies" bash -c "npm ci --loglevel=error > '$npm_log' 2>&1"; then
    ok "Dependencies installed"

    # Back up existing build outputs for rollback on failure
    BUILD_BACKUP=""
    if [[ -d dist || -d server-dist ]]; then
      BUILD_BACKUP=$(mktemp -d /tmp/nerve-build-backup-XXXXXX)
      TEMP_FILES+=("$BUILD_BACKUP")
      [[ -d dist ]] && cp -a dist "$BUILD_BACKUP/dist"
      [[ -d server-dist ]] && cp -a server-dist "$BUILD_BACKUP/server-dist"
    fi
  else
    fail "npm ci failed"
    echo ""
    # Show the last meaningful lines
    echo -e "  ${RAIL}  ${DIM}── Last 10 lines ──${NC}"
    tail -10 "$npm_log" | while IFS= read -r line; do
      echo -e "  ${RAIL}  ${DIM}${line}${NC}"
    done
    echo -e "  ${RAIL}  ${DIM}── Full log: ${npm_log} ──${NC}"
    echo ""
    # Detect common failure patterns and suggest fixes
    if grep -qi 'EACCES\|permission denied' "$npm_log"; then
      hint "Permissions issue — try installing Node via nvm instead of system packages:"
      cmd "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
      cmd "nvm install ${NODE_MIN}"
      echo -e "  ${RAIL}  ${DIM}nvm installs to your home directory — no sudo needed${NC}"
    elif grep -qi 'node-gyp\|gyp ERR\|make.*Error\|g++.*not found\|cc.*not found' "$npm_log"; then
      hint "Native module compilation failed — install build tools:"
      if $IS_MAC; then
        cmd "xcode-select --install"
      elif $IS_DEBIAN; then
        cmd "sudo apt install build-essential"
      elif $IS_FEDORA; then
        cmd "sudo dnf groupinstall 'Development Tools'"
      else
        cmd "sudo apt install build-essential"
      fi
    elif grep -qi 'ERESOLVE\|peer dep\|could not resolve' "$npm_log"; then
      hint "Dependency conflict — try with a clean slate:"
      cmd "rm -rf node_modules package-lock.json"
      cmd "npm install"
    else
      hint "Troubleshooting:"
      echo -e "  ${RAIL}  ${DIM}1. Check the full log: cat ${npm_log}${NC}"
      echo -e "  ${RAIL}  ${DIM}2. Ensure Node ${NODE_MIN}+ and build tools are installed${NC}"
      echo -e "  ${RAIL}  ${DIM}3. Try: rm -rf node_modules && npm install${NC}"
    fi
    echo ""
    exit 1
  fi

  build_log=$(mktemp /tmp/nerve-build-XXXXXX)

  if run_with_dots "Building project" bash -c "npm run build > '$build_log' 2>&1"; then
    ok "Client and server built"
  else
    fail "Build failed"
    # Rollback to previous build output if available
    if [[ -n "${BUILD_BACKUP:-}" ]]; then
      rm -rf dist server-dist 2>/dev/null
      [[ -d "$BUILD_BACKUP/dist" ]] && cp -a "$BUILD_BACKUP/dist" dist
      [[ -d "$BUILD_BACKUP/server-dist" ]] && cp -a "$BUILD_BACKUP/server-dist" server-dist
      warn "Restored previous build output"
    fi
    echo ""
    echo -e "  ${RAIL}  ${DIM}── Last 10 lines ──${NC}"
    tail -10 "$build_log" | while IFS= read -r line; do
      echo -e "  ${RAIL}  ${DIM}${line}${NC}"
    done
    echo -e "  ${RAIL}  ${DIM}── Full log: ${build_log} ──${NC}"
    echo ""
    hint "Troubleshooting:"
    echo -e "  ${RAIL}  ${DIM}1. Check the full log: cat ${build_log}${NC}"
    echo -e "  ${RAIL}  ${DIM}2. Try rebuilding: npm run build${NC}"
    echo ""
    exit 1
  fi

  # Clean up temp logs on success
  rm -f "$npm_log" "$build_log" 2>/dev/null

  # ── Download speech model (for local voice input) ──────────────────
  # Keep installer bootstrap in sync with UI/server default (multilingual base).
  WHISPER_MODEL_DIR="${HOME}/.nerve/models"
  WHISPER_MODEL_KEY="base"
  if [[ -f .env ]]; then
    EXISTING_WHISPER_MODEL=$(grep -E '^WHISPER_MODEL=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' || true)
    if [[ -n "$EXISTING_WHISPER_MODEL" ]]; then
      WHISPER_MODEL_KEY="$EXISTING_WHISPER_MODEL"
    fi
  fi

  # Normalize .env value: trim whitespace, strip inline comments and wrapping quotes.
  WHISPER_MODEL_KEY=$(printf '%s' "$WHISPER_MODEL_KEY" | sed -E 's/[[:space:]]+#.*$//; s/^[[:space:]]+//; s/[[:space:]]+$//')
  if [[ "$WHISPER_MODEL_KEY" =~ ^\".*\"$ || "$WHISPER_MODEL_KEY" =~ ^\'.*\'$ ]]; then
    WHISPER_MODEL_KEY="${WHISPER_MODEL_KEY:1:${#WHISPER_MODEL_KEY}-2}"
  fi
  WHISPER_MODEL_KEY=$(printf '%s' "$WHISPER_MODEL_KEY" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' | tr '[:upper:]' '[:lower:]')

  WHISPER_MODEL_SIZE="75MB"
  case "$WHISPER_MODEL_KEY" in
    tiny.en)  WHISPER_MODEL_FILE="ggml-tiny.en.bin" ; WHISPER_MODEL_SIZE="75MB" ;;
    base.en)  WHISPER_MODEL_FILE="ggml-base.en.bin" ; WHISPER_MODEL_SIZE="142MB" ;;
    small.en) WHISPER_MODEL_FILE="ggml-small.en.bin"; WHISPER_MODEL_SIZE="466MB" ;;
    tiny)     WHISPER_MODEL_FILE="ggml-tiny.bin"    ; WHISPER_MODEL_SIZE="75MB" ;;
    base)     WHISPER_MODEL_FILE="ggml-base.bin"    ; WHISPER_MODEL_SIZE="142MB" ;;
    small)    WHISPER_MODEL_FILE="ggml-small.bin"   ; WHISPER_MODEL_SIZE="466MB" ;;
    *)
      warn "Unknown WHISPER_MODEL='${WHISPER_MODEL_KEY}' in .env — defaulting to base"
      WHISPER_MODEL_KEY="base"
      WHISPER_MODEL_FILE="ggml-base.bin"
      WHISPER_MODEL_SIZE="142MB"
      ;;
  esac

  WHISPER_MODEL_PATH="${WHISPER_MODEL_DIR}/${WHISPER_MODEL_FILE}"
  WHISPER_MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODEL_FILE}"

  if [[ -f "$WHISPER_MODEL_PATH" ]]; then
    ok "Speech model already downloaded (${WHISPER_MODEL_KEY})"
  else
    mkdir -p "$WHISPER_MODEL_DIR"
    if run_with_dots "Downloading speech model ${WHISPER_MODEL_KEY} (${WHISPER_MODEL_SIZE})" bash -c "curl -fsSL -o '$WHISPER_MODEL_PATH' '$WHISPER_MODEL_URL' 2>/dev/null"; then
      ok "Speech model ready (${WHISPER_MODEL_KEY})"
    else
      warn "Speech model download failed — local STT may fail unless STT_PROVIDER=openai with OPENAI_API_KEY"
      rm -f "$WHISPER_MODEL_PATH" 2>/dev/null
    fi
  fi

  # ── Check for ffmpeg (needed for voice input) ──────────────────────
  if ! command -v ffmpeg &>/dev/null; then
    if $IS_MAC; then
      warn "ffmpeg not found — needed for voice input"
      hint "Install with:"
      cmd "brew install ffmpeg"
    elif $IS_DEBIAN; then
      if run_with_dots "Installing ffmpeg" bash -c "sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ffmpeg &>/dev/null"; then
        ok "ffmpeg installed"
      else
        warn "ffmpeg install failed — voice input may not work"
      fi
    elif $IS_FEDORA; then
      if run_with_dots "Installing ffmpeg" bash -c "sudo dnf install -y -q ffmpeg &>/dev/null"; then
        ok "ffmpeg installed"
      else
        warn "ffmpeg install failed — voice input may not work"
      fi
    fi
  fi
fi

# ── Auto-generate .env from OpenClaw gateway config ───────────────────
generate_env_from_gateway() {
  # Already have an .env? Don't overwrite.
  if [[ -f .env ]]; then
    ok "Existing .env found — keeping current configuration"
    return 0
  fi

  local gw_token="${GATEWAY_TOKEN:-}"
  local gw_url="${GATEWAY_URL_OVERRIDE:-}"
  local gw_port="18789"
  local config_file="${HOME}/.openclaw/openclaw.json"

  # Read token from systemd/config if no --gateway-token was passed
  if [[ -z "$gw_token" ]]; then
    gw_token=$(detect_gateway_token)
  fi
  if [[ -z "$gw_url" && -f "$config_file" ]]; then
    gw_port=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$config_file','utf8'));console.log(c.gateway?.port??18789)}catch{console.log(18789)}" 2>/dev/null || echo "18789")
    gw_url="http://127.0.0.1:${gw_port}"
  fi
  if [[ -z "$gw_url" ]]; then
    gw_url="http://127.0.0.1:${gw_port}"
  fi

  if [[ -n "$gw_token" ]]; then
    local nerve_port=3080
    if ! check_port "$nerve_port"; then
      if [[ "$INTERACTIVE" != "true" ]]; then
        fail "Port ${nerve_port} is already in use. Set a different PORT in .env or free the port."
        exit 1
      else
        warn "Port ${nerve_port} is already in use"
        while true; do
          printf "  ${RAIL}  ${CYAN}→${NC} Enter an available port: "
          if ! read -r nerve_port < /dev/tty 2>/dev/null; then
            fail "Cannot read from terminal"
            exit 1
          fi
          if [[ ! "$nerve_port" =~ ^[0-9]+$ ]] || (( nerve_port < 1 || nerve_port > 65535 )); then
            warn "Invalid port number"
            continue
          fi
          if check_port "$nerve_port"; then
            break
          fi
          warn "Port ${nerve_port} is also in use"
        done
      fi
    fi
    cat > .env <<ENVEOF
GATEWAY_URL=${gw_url}
GATEWAY_TOKEN=${gw_token}
PORT=${nerve_port}
ENVEOF
    ok "Generated .env from OpenClaw gateway config"
  else
    warn "Cannot auto-generate .env — no gateway token found"
    warn "Run: ${CYAN}npm run setup${NC} to configure manually"
    ENV_MISSING=true
  fi
}

# ── [4/5] Configure ──────────────────────────────────────────────────
stage "Configure"

if [[ "$DRY_RUN" == "true" ]]; then
  if [[ "$SKIP_SETUP" == "true" ]]; then
    dry "Would skip setup wizard (--skip-setup)"
  elif [[ -n "$ACCESS_MODE" ]]; then
    dry "Would run non-interactive setup wizard (--defaults --access-mode ${ACCESS_MODE})"
  else
    dry "Would launch interactive setup wizard"
    dry "Would prompt for: gateway token, port, TTS config"
  fi
  if [[ -n "$GATEWAY_URL_OVERRIDE" ]]; then
    dry "Would write GATEWAY_URL=${GATEWAY_URL_OVERRIDE}"
  fi
else
  if [[ "$SKIP_SETUP" == "true" ]]; then
    if [[ -f .env ]]; then
      ok "Skipping setup (--skip-setup flag, .env exists)"
    else
      info "Skipping wizard — generating .env from gateway config..."
      generate_env_from_gateway
    fi
  else
    if [[ -f .env ]]; then
      if [[ "$INTERACTIVE" == "true" && -z "$ACCESS_MODE" ]]; then
        ok "Existing .env found"
        printf "  ${RAIL}  ${YELLOW}?${NC} Run setup wizard anyway? (y/N) "
        if read -r answer < /dev/tty 2>/dev/null; then
          if [[ "$(echo "$answer" | tr "[:upper:]" "[:lower:]")" == "y" ]]; then
            echo ""
            NERVE_INSTALLER=1 npm run setup < /dev/tty 2>/dev/null || {
              warn "Setup wizard failed (no TTY?) — run ${CYAN}npm run setup${NC} manually"
            }
          else
            ok "Keeping existing configuration"
          fi
        else
          warn "Cannot read input — run ${CYAN}npm run setup${NC} manually to reconfigure"
        fi
      else
        ok "Existing .env found — keeping current configuration"
      fi
    elif [[ -n "$ACCESS_MODE" ]]; then
      info "Explicit access mode requested — running non-interactive setup wizard..."
      NERVE_INSTALLER=1 npm run setup -- --defaults --access-mode "$ACCESS_MODE" || {
        fail "Setup failed for --access-mode ${ACCESS_MODE}"
        exit 1
      }
    elif [[ "$INTERACTIVE" == "true" ]]; then
      NERVE_INSTALLER=1 npm run setup < /dev/tty 2>/dev/null || {
        warn "Setup wizard failed — attempting auto-config from gateway..."
        generate_env_from_gateway
      }
    else
      info "Non-interactive mode — generating .env from gateway config..."
      generate_env_from_gateway
    fi
  fi
fi

# ── [5/5] Systemd service ────────────────────────────────────────────
stage "Service"

setup_systemd() {
  local service_file="$SYSTEMD_UNIT_FILE"
  local node_bin
  node_bin=$(which node)
  local working_dir="$INSTALL_DIR"

  local node_dir
  node_dir=$(dirname "${node_bin}")

  # Run as the installing user (who has openclaw config)
  local install_user="${SUDO_USER:-${USER}}"
  local install_home="${HOME}"
  
  # If running via sudo, get the real user's home (no eval — safe from injection)
  if [[ -n "${SUDO_USER:-}" ]]; then
    if command -v getent &>/dev/null; then
      install_home=$(getent passwd "${SUDO_USER}" | cut -d: -f6)
    elif command -v dscl &>/dev/null; then
      install_home=$(dscl . -read "/Users/${SUDO_USER}" NFSHomeDirectory 2>/dev/null | awk '{print $2}')
    else
      install_home=$(awk -F: -v user="${SUDO_USER}" '$1 == user {print $6}' /etc/passwd)
    fi
    # Fallback if all lookups returned empty
    if [[ -z "$install_home" ]]; then
      install_home="/home/${SUDO_USER}"
    fi
  fi
  
  # Fallback: Detect from openclaw binary location (handles root installs where openclaw is in /home/user)
  # Note: glob may match multiple users — picks first (alphabetical)
  if [[ "${install_user}" == "root" ]]; then
    local openclaw_bin
    openclaw_bin=$(command -v openclaw 2>/dev/null || echo "")
    if [[ -z "$openclaw_bin" ]]; then
      # Check common nvm locations
      for candidate in /home/*/.nvm/versions/node/*/bin/openclaw; do
        if [[ -x "$candidate" ]]; then
          openclaw_bin="$candidate"
          break
        fi
      done
    fi
    
    if [[ -n "$openclaw_bin" ]]; then
      # Extract user from path like /home/username/.nvm/...
      if [[ "$openclaw_bin" =~ ^/home/([^/]+)/ ]]; then
        local detected_user="${BASH_REMATCH[1]}"
        install_user="$detected_user"
        install_home="/home/$detected_user"
        info "Detected openclaw owner: ${detected_user}"
      fi
    fi
  fi

  local tmp_service
  tmp_service=$(mktemp /tmp/nerve.service.XXXXXX)
  TEMP_FILES+=("$tmp_service")

  cat > "$tmp_service" <<EOF
[Unit]
Description=Nerve - OpenClaw Web UI
After=network.target

[Service]
Type=simple
User=${install_user}
Group=${install_user}
WorkingDirectory=${working_dir}
ExecStart=${node_bin} server-dist/index.js
# .env is deliberately not loaded by systemd: the server loads it from
# WorkingDirectory with dotenv, as it does under launchd. systemd parses .env
# differently, and its values would win because dotenv never overrides them.
Environment=NODE_ENV=production
Environment=HOME=${install_home}
Environment=PATH=${node_dir}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  local unit_existed=false unit_installed=false
  if [[ -f "$service_file" ]]; then unit_existed=true; fi
  if can_run_as_root; then
    if [[ $EUID -ne 0 ]]; then
      info "Using sudo to install ${service_file} and (re)start nerve.service"
    fi
    if as_root install -m 0644 "$tmp_service" "$service_file"; then
      unit_installed=true
    else
      warn "Could not write ${service_file}"
    fi
  else
    warn "Could not get root access, so the systemd service was not installed"
  fi

  RESTART_CMD="${ROOT_PREFIX}systemctl restart nerve.service"
  if [[ "$unit_installed" == "true" ]]; then
    LOGS_HINT="${ROOT_PREFIX}journalctl -u nerve.service -n 50 --no-pager"
    if [[ -f "${working_dir}/.env" ]]; then
      if run_with_dots "Starting systemd service" as_root bash -c "systemctl daemon-reload && systemctl enable nerve.service &>/dev/null && systemctl restart nerve.service"; then
        ok "Systemd service installed and started"
        SERVICE_STARTED=true
      else
        warn "Systemd service failed to start"
        SERVICE_INCOMPLETE=true
        NOT_RUNNING_HEADLINE="The Nerve service failed to start."
        # The unit on disk may be newer than what systemd has loaded (the combined
        # command can fail at any step), so the retry reloads before it restarts.
        START_STEPS=("${ROOT_PREFIX}systemctl daemon-reload" "$RESTART_CMD")
      fi
    else
      if as_root bash -c "systemctl daemon-reload && systemctl enable nerve.service &>/dev/null"; then
        ok "Systemd service installed (not started yet: .env is missing)"
      else
        warn "Systemd service installed but could not be enabled"
      fi
      START_STEPS=("cd $(shell_quote "$working_dir") && npm run setup" "$RESTART_CMD")
    fi
  else
    # Keep the unit somewhere that survives a reboot so the commands below stay valid.
    local saved_unit="${HOME}/.nerve/nerve.service"
    mkdir -p "$(dirname "$saved_unit")"
    cp "$tmp_service" "$saved_unit"
    info "Saved the service unit to ${saved_unit}"
    SERVICE_INCOMPLETE=true
    if [[ "$unit_existed" == "true" ]]; then
      # The old unit, and a service it may still be running, were left untouched.
      NOT_RUNNING_HEADLINE="Nerve was updated, but nerve.service was not restarted."
    fi
    START_STEPS=()
    if [[ ! -f "${working_dir}/.env" ]]; then
      START_STEPS+=("cd $(shell_quote "$working_dir") && npm run setup")
    fi
    START_STEPS+=(
      "${ROOT_PREFIX}install -m 0644 $(shell_quote "$saved_unit") $(shell_quote "$service_file")"
      "${ROOT_PREFIX}systemctl daemon-reload"
      "${ROOT_PREFIX}systemctl enable nerve.service"
      "$RESTART_CMD"
    )
  fi
  info "Service user: ${install_user}"
}

setup_launchd() {
  local node_bin
  node_bin=$(which node)
  local working_dir="$INSTALL_DIR"
  local plist_dir="${HOME}/Library/LaunchAgents"
  local plist_file="${plist_dir}/com.nerve.server.plist"

  mkdir -p "$plist_dir"

  # Create a wrapper script that launches the built server from the install dir.
  # server/lib/config.ts loads .env at runtime, so the wrapper should not source it
  # directly (raw .env values are dotenv-compatible but not necessarily shell-safe).
  local start_script="${working_dir}/start.sh"
  # The plist sets PATH in EnvironmentVariables, but the wrapper also needs
  # to find node if run manually. Bake the current node path as a fallback.
  local node_dir_escaped
  node_dir_escaped=$(dirname "${node_bin}")
  cat > "$start_script" <<STARTEOF
#!/bin/bash
# Nerve start wrapper — .env is loaded by the Node server at runtime.
SCRIPT_DIR="\$(cd "\$(dirname "\$0")" && pwd)"
cd "\${SCRIPT_DIR}"
export PATH="${node_dir_escaped}:\${PATH}"
export NODE_ENV=production
exec node "\${SCRIPT_DIR}/server-dist/index.js"
STARTEOF
  chmod +x "$start_script"

  cat > "$plist_file" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.nerve.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>${start_script}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${working_dir}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(dirname "${node_bin}"):/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${working_dir}/nerve.log</string>
  <key>StandardErrorPath</key>
  <string>${working_dir}/nerve.log</string>
</dict>
</plist>
EOF

  # launchctl bootstrap (modern) with fallback to load (legacy)
  local uid
  uid=$(id -u)
  if launchctl bootstrap "gui/${uid}" "$plist_file" 2>/dev/null; then
    ok "launchd service installed and started"
    info "Nerve will start automatically on login"
    SERVICE_STARTED=true
  elif launchctl load "$plist_file" 2>/dev/null; then
    ok "launchd service installed and started (legacy loader)"
    info "Nerve will start automatically on login"
    SERVICE_STARTED=true
  else
    warn "launchd plist created at ${plist_file}, but it could not be loaded"
    SERVICE_INCOMPLETE=true
    START_STEPS=("launchctl load $(shell_quote "$plist_file")")
  fi
  if [[ "$SERVICE_STARTED" == "true" ]]; then
    LOGS_HINT="tail -n 50 $(shell_quote "${working_dir}/nerve.log")"
    RESTART_CMD="launchctl kickstart -k gui/${uid}/com.nerve.server"
  fi
  echo ""
  info "Manage:"
  echo "    launchctl stop com.nerve.server"
  echo "    launchctl start com.nerve.server"
  echo "    launchctl unload $(shell_quote "$plist_file")"
  echo ""
}

if [[ "$(uname -s)" == "Darwin" ]]; then
  # ── macOS: launchd service ──────────────────────────────────────────
  plist_check="${HOME}/Library/LaunchAgents/com.nerve.server.plist"
  if [[ "$DRY_RUN" == "true" ]]; then
    if [[ -f "$plist_check" ]]; then
      dry "launchd service already exists — would restart it"
    else
      dry "Would create launchd service (~/Library/LaunchAgents/com.nerve.server.plist)"
    fi
  else
    echo -e "${BOLD}  Service${NC}"
    echo ""
    if [[ -f "$plist_check" ]]; then
      info "Updating existing launchd service..."
      uid=$(id -u)
      launchctl bootout "gui/${uid}/com.nerve.server" 2>/dev/null || launchctl stop com.nerve.server 2>/dev/null || true
      setup_launchd
    elif [[ "$INTERACTIVE" == "true" ]]; then
      printf "  ${RAIL}  ${YELLOW}?${NC} Install as a launchd service (starts on login)? (Y/n) "
      if read -r answer < /dev/tty 2>/dev/null; then
        if [[ "$(echo "$answer" | tr "[:upper:]" "[:lower:]")" != "n" ]]; then
          setup_launchd
        else
          ok "Skipped the launchd service"
          START_STEPS=("cd $(shell_quote "$INSTALL_DIR") && npm start")
        fi
      else
        info "Cannot read input — installing launchd service by default"
        setup_launchd
      fi
    else
      info "Installing launchd service..."
      setup_launchd
    fi
    echo ""
  fi
elif systemd_running; then
  if [[ "$DRY_RUN" == "true" ]]; then
    if [[ -f "$SYSTEMD_UNIT_FILE" ]]; then
      dry "Service already exists — would restart it"
    else
      dry "Would prompt to install systemd service"
      dry "Would create ${SYSTEMD_UNIT_FILE}"
      dry "Would enable and start the service"
    fi
  else
    echo -e "${BOLD}  Systemd service${NC}"
    echo ""
    if [[ -f "$SYSTEMD_UNIT_FILE" ]]; then
      # No separate stop: setup_systemd restarts the unit in place, or leaves it
      # untouched when it lacks root, so the service is never left stopped.
      info "Updating existing systemd service..."
      setup_systemd
    elif [[ "$INTERACTIVE" == "true" ]]; then
      printf "  ${RAIL}  ${YELLOW}?${NC} Install as a systemd service? (Y/n) "
      if read -r answer < /dev/tty 2>/dev/null; then
        if [[ "$(echo "$answer" | tr "[:upper:]" "[:lower:]")" != "n" ]]; then
          setup_systemd
        else
          ok "Skipped the systemd service"
          START_STEPS=("cd $(shell_quote "$INSTALL_DIR") && npm start")
        fi
      else
        info "Cannot read input — installing systemd service by default"
        setup_systemd
      fi
    else
      info "Non-interactive mode: installing the systemd service"
      setup_systemd
    fi
    echo ""
  fi
elif [[ "$DRY_RUN" == "true" ]]; then
  dry "systemd is not running: would print how to start Nerve manually"
else
  warn "systemd is not running on this host, so Nerve was not installed as a service"
  START_STEPS=("cd $(shell_quote "$INSTALL_DIR") && npm start")
fi

if [[ "$SERVICE_STARTED" == "true" ]]; then
  health_url=$(nerve_health_url)
  if [[ -z "$health_url" ]]; then
    NOT_RUNNING_HEADLINE="PORT in .env ($(env_file_value PORT)) is not a usable port (use 1 to 65535)."
    warn "$NOT_RUNNING_HEADLINE"
    SERVICE_INCOMPLETE=true
    START_STEPS=("cd $(shell_quote "$INSTALL_DIR") && npm run setup" "$RESTART_CMD")
  elif run_with_dots "Waiting for Nerve to respond" wait_for_nerve "$health_url"; then
    ok "Nerve is responding at ${health_url}"
    NERVE_RUNNING=true
  else
    warn "Nerve did not respond at ${health_url}"
    SERVICE_INCOMPLETE=true
    NOT_RUNNING_HEADLINE="Nerve was started but did not respond at ${health_url}."
    START_STEPS=("$RESTART_CMD")
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────
echo -e "  ${RAIL}"
echo -e "  ${GREEN}●${NC} ${GREEN}${BOLD}Done${NC}"
echo ""

# Detect port from .env
local_port=$(nerve_port)
local_port="${local_port:-3080}"  # an unusable PORT is reported above; setup defaults to 3080

if [[ "$DRY_RUN" == "true" ]]; then
  echo -e "     ${YELLOW}${BOLD}⊘  Dry run complete — nothing was modified${NC}"
  echo ""
  echo -e "     ${DIM}Run without --dry-run to install for real.${NC}"
else
  # Use the actual IP if HOST is 0.0.0.0 (network mode)
  host_val=$(env_file_value HOST)
  if [[ "$host_val" == "0.0.0.0" ]]; then
    detected_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || echo "")
    local_url="http://${detected_ip:-localhost}:${local_port}"
  else
    local_url="http://localhost:${local_port}"
  fi

  if [[ "$NERVE_RUNNING" == "true" ]]; then
    url_len=${#local_url}
    # Box must fit both the header text and the URL, with breathing room
    header_len=29  # "Open Nerve in your browser:" + padding
    url_line_len=$((url_len + 4))  # "→ " + url + padding
    if [[ $header_len -gt $url_line_len ]]; then
      box_inner=$((header_len + 4))
    else
      box_inner=$((url_line_len + 4))
    fi

    echo ""
    echo -e "     ${GREEN}${BOLD}✅ Nerve installed!${NC}"
    echo ""
    echo -e "     ${ORANGE}╭$(printf '─%.0s' $(seq 1 $box_inner))╮${NC}"
    echo -e "     ${ORANGE}│${NC}$(printf ' %.0s' $(seq 1 $box_inner))${ORANGE}│${NC}"
    echo -e "     ${ORANGE}│${NC}  ${BOLD}Open Nerve in your browser:${NC}$(printf ' %.0s' $(seq 1 $((box_inner - 29))))${ORANGE}│${NC}"
    echo -e "     ${ORANGE}│${NC}  ${CYAN}${BOLD}→ ${local_url}${NC}$(printf ' %.0s' $(seq 1 $((box_inner - url_len - 4))))${ORANGE}│${NC}"
    echo -e "     ${ORANGE}│${NC}$(printf ' %.0s' $(seq 1 $box_inner))${ORANGE}│${NC}"
    echo -e "     ${ORANGE}╰$(printf '─%.0s' $(seq 1 $box_inner))╯${NC}"
    echo ""
    print_deployment_guides || true
    echo ""
    printf '     %bDirectory:  cd %s%b\n' "$DIM" "$(shell_quote "$INSTALL_DIR")" "$NC"
    if $IS_MAC; then
      echo -e "     ${DIM}Restart:   launchctl stop com.nerve.server && launchctl start com.nerve.server${NC}"
      printf '     %bLogs:      tail -f %s%b\n' "$DIM" "$(shell_quote "${INSTALL_DIR}/nerve.log")" "$NC"
    else
      echo -e "     ${DIM}Restart:   ${ROOT_PREFIX}systemctl restart nerve.service${NC}"
      echo -e "     ${DIM}Logs:      ${ROOT_PREFIX}journalctl -u nerve.service -f${NC}"
    fi
  else
    echo ""
    echo -e "     ${YELLOW}${BOLD}${NOT_RUNNING_HEADLINE}${NC}"
    if [[ -n "$LOGS_HINT" ]]; then
      echo ""
      echo "     Check the logs:"
      # printf, not echo -e: the commands may hold backslashes from shell_quote.
      printf '       %b%s%b\n' "$CYAN" "$LOGS_HINT" "$NC"
    fi
    if [[ ${#START_STEPS[@]} -gt 0 ]]; then
      echo ""
      echo "     Start it with:"
      for step in "${START_STEPS[@]}"; do
        printf '       %b%s%b\n' "$CYAN" "$step" "$NC"
      done
    fi
    echo ""
    echo -e "     Once it is running, open ${CYAN}${BOLD}${local_url}${NC}"
    echo ""
    print_deployment_guides || true
    echo ""
    printf '     %bDirectory:  cd %s%b\n' "$DIM" "$(shell_quote "$INSTALL_DIR")" "$NC"
  fi
fi
echo ""

# Exit code reflects actual readiness
if [[ "$DRY_RUN" == "true" ]]; then
  exit 0
fi

if [[ "$ENV_MISSING" == "true" ]] || [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  warn "Install complete but Nerve is not fully configured"
  printf '  %b  %b→%b Run: %s\n' "$RAIL" "$CYAN" "$NC" "cd $(shell_quote "$INSTALL_DIR") && npm run setup"
  exit 2  # partial success — installed but non-functional
fi
if [[ "$SERVICE_INCOMPLETE" == "true" ]]; then
  exit 2  # installed, but Nerve is not running: the steps printed above say why and what to run
fi
exit 0
