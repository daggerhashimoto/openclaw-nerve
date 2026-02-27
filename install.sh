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
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Cleanup trap ──────────────────────────────────────────────────────
TEMP_FILES=()
RWD_PIDS=()

cleanup() {
  # Kill any lingering run_with_dots background processes
  for pid in "${RWD_PIDS[@]}"; do
    kill -0 "$pid" 2>/dev/null && kill "$pid" 2>/dev/null || true
  done
  # Remove temp files and directories (stderr captures, build backups)
  for f in "${TEMP_FILES[@]}"; do
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
ENV_MISSING=false

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

  if [[ "$url" =~ ^https://github.com/([^/]+)/([^/]+)(\.git)?$ ]]; then
    path="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  elif [[ "$url" =~ ^git@github.com:([^/]+)/([^/]+)(\.git)?$ ]]; then
    path="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  elif [[ "$url" =~ ^ssh://git@github.com/([^/]+)/([^/]+)(\.git)?$ ]]; then
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
    --help|-h)
      echo "Nerve Installer"
      echo ""
      echo "Options:"
      echo "  --dir <path>       Install directory (default: ~/nerve)"
      echo "  --version <vX.Y.Z> Install a specific release version"
      echo "  --branch <name>    Install from a branch (dev override; bypasses release mode)"
      echo "  --repo <url>       Git repo URL"
      echo "  --skip-setup       Skip the interactive setup wizard"
      echo "  --gateway-token <t> Gateway token (for non-interactive installs)"
      echo "  --dry-run          Simulate the install without changing anything"
      echo "  --help             Show this help"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -n "$VERSION" && "$BRANCH_EXPLICIT" == "true" ]]; then
  fail "Use either --version or --branch, not both"
  exit 1
fi

# ── Detect interactive mode ───────────────────────────────────────────
# When piped via curl | bash, stdin is the pipe — but /dev/tty still
# provides access to the controlling terminal for interactive prompts.
# We check readable+writable (like OpenClaw's installer does).
INTERACTIVE=false
if [[ -t 0 ]]; then
  INTERACTIVE=true
elif [[ -r /dev/tty && -w /dev/tty ]]; then
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
      dry "Would install build-essential via apt"
      return 0
    fi
    run_with_dots "Installing build tools" bash -c "DEBIAN_FRONTEND=noninteractive apt-get update -qq &>/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq build-essential &>/dev/null"
    if command -v make &>/dev/null && command -v g++ &>/dev/null; then
      ok "Build tools installed"
      return 0
    else
      fail "Failed to install build-essential"
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
  local gw_url="http://127.0.0.1:18789"

  # Try to read from openclaw.json
  local config_file="${HOME}/.openclaw/openclaw.json"
  if [[ -f "$config_file" ]]; then
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
    dry "Would checkout ${TARGET_REF}"
  else
    dry "Would clone ${REPO}"
    dry "Would checkout ${TARGET_REF}"
    dry "Would install to ${INSTALL_DIR}"
  fi
else
  if [[ -d "$INSTALL_DIR/.git" ]]; then
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
  dry "Would run: npm run build:server"
else
  npm_log=$(mktemp /tmp/nerve-npm-install-XXXXXX)

  run_with_dots "Installing dependencies" bash -c "npm ci --loglevel=error > '$npm_log' 2>&1"
  if [[ $RWD_EXIT -eq 0 ]]; then
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

  run_with_dots "Building client" bash -c "npm run build > '$build_log' 2>&1"
  if [[ $RWD_EXIT -eq 0 ]]; then
    ok "Client built"
  else
    fail "Client build failed"
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

  run_with_dots "Building server" bash -c "npm run build:server >> '$build_log' 2>&1"
  if [[ $RWD_EXIT -eq 0 ]]; then
    ok "Server built"
  else
    fail "Server build failed"
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
    echo -e "  ${RAIL}  ${DIM}2. Try rebuilding: npm run build:server${NC}"
    echo ""
    exit 1
  fi

  # Clean up temp logs on success
  rm -f "$npm_log" "$build_log" 2>/dev/null

  # ── Download speech model (for local voice input) ──────────────────
  WHISPER_MODEL_DIR="${HOME}/.nerve/models"
  WHISPER_MODEL_FILE="ggml-tiny.en.bin"
  WHISPER_MODEL_PATH="${WHISPER_MODEL_DIR}/${WHISPER_MODEL_FILE}"
  WHISPER_MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODEL_FILE}"

  if [[ -f "$WHISPER_MODEL_PATH" ]]; then
    ok "Speech model already downloaded"
  else
    mkdir -p "$WHISPER_MODEL_DIR"
    run_with_dots "Downloading speech model (75MB)" bash -c "curl -fsSL -o '$WHISPER_MODEL_PATH' '$WHISPER_MODEL_URL' 2>/dev/null"
    if [[ $RWD_EXIT -eq 0 ]]; then
      ok "Speech model ready"
    else
      warn "Speech model download failed — voice input will use OpenAI API (requires OPENAI_API_KEY)"
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
      run_with_dots "Installing ffmpeg" bash -c "sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ffmpeg &>/dev/null"
      if [[ $RWD_EXIT -eq 0 ]]; then
        ok "ffmpeg installed"
      else
        warn "ffmpeg install failed — voice input may not work"
      fi
    elif $IS_FEDORA; then
      run_with_dots "Installing ffmpeg" bash -c "sudo dnf install -y -q ffmpeg &>/dev/null"
      if [[ $RWD_EXIT -eq 0 ]]; then
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
  local gw_port="18789"
  local config_file="${HOME}/.openclaw/openclaw.json"

  # Read token from systemd/config if no --gateway-token was passed
  if [[ -z "$gw_token" ]]; then
    gw_token=$(detect_gateway_token)
  fi
  if [[ -f "$config_file" ]]; then
    gw_port=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$config_file','utf8'));console.log(c.gateway?.port??18789)}catch{console.log(18789)}" 2>/dev/null || echo "18789")
  fi

  if [[ -n "$gw_token" ]]; then
    local nerve_port=3080
    if ! check_port "$nerve_port"; then
      if [[ "$NON_INTERACTIVE" == "true" ]]; then
        fail "Port ${nerve_port} is already in use. Set a different PORT in .env or free the port."
      else
        warn "Port ${nerve_port} is already in use"
        while true; do
          printf "  ${RAIL}  ${CYAN}→${NC} Enter an available port: "
          read -r nerve_port < /dev/tty || fail "Cannot read from terminal"
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
GATEWAY_URL=http://127.0.0.1:${gw_port}
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
  else
    dry "Would launch interactive setup wizard"
    dry "Would prompt for: gateway token, port, TTS config"
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
    if [[ "$INTERACTIVE" == "true" ]]; then
      if [[ -f .env ]]; then
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
        NERVE_INSTALLER=1 npm run setup < /dev/tty 2>/dev/null || {
          warn "Setup wizard failed — attempting auto-config from gateway..."
          generate_env_from_gateway
        }
      fi
    else
      if [[ -f .env ]]; then
        ok "Existing .env found — keeping current configuration"
      else
        info "Non-interactive mode — generating .env from gateway config..."
        generate_env_from_gateway
      fi
    fi
  fi
fi

# ── [5/5] Systemd service ────────────────────────────────────────────
stage "Service"

setup_systemd() {
  local service_file="/etc/systemd/system/nerve.service"
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
EnvironmentFile=${working_dir}/.env
Environment=NODE_ENV=production
Environment=HOME=${install_home}
Environment=PATH=${node_dir}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  if [[ $EUID -eq 0 ]]; then
    mv "$tmp_service" "$service_file"
    if [[ -f "${working_dir}/.env" ]]; then
      run_with_dots "Systemd service" bash -c "systemctl daemon-reload && systemctl enable nerve.service &>/dev/null && systemctl start nerve.service"
      if [[ $RWD_EXIT -eq 0 ]]; then
        ok "Systemd service installed and started"
      else
        warn "Systemd service install failed — try: sudo systemctl start nerve.service"
      fi
    else
      systemctl daemon-reload
      systemctl enable nerve.service &>/dev/null
      ok "Systemd service installed (not started — run ${CYAN}npm run setup${NC} first, then ${CYAN}systemctl start nerve.service${NC})"
    fi
  else
    echo ""
    info "To install as a systemd service (requires sudo):"
    echo ""
    echo "    sudo mv ${tmp_service} ${service_file}"
    echo "    sudo systemctl daemon-reload"
    echo "    sudo systemctl enable nerve.service"
    echo "    sudo systemctl start nerve.service"
    echo ""
    info "Service will run as: ${install_user}"
    echo ""
  fi
}

setup_launchd() {
  local node_bin
  node_bin=$(which node)
  local working_dir="$INSTALL_DIR"
  local plist_dir="${HOME}/Library/LaunchAgents"
  local plist_file="${plist_dir}/com.nerve.server.plist"

  mkdir -p "$plist_dir"

  # Create a wrapper script that sources .env at runtime (not baked at install time)
  # This way token/config changes in .env take effect on next service restart
  local start_script="${working_dir}/start.sh"
  # The plist sets PATH in EnvironmentVariables, but the wrapper also needs
  # to find node if run manually. Bake the current node path as a fallback.
  local node_dir_escaped
  node_dir_escaped=$(dirname "${node_bin}")
  cat > "$start_script" <<STARTEOF
#!/bin/bash
# Nerve start wrapper — sources .env at runtime so config changes
# take effect on restart without touching the plist
SCRIPT_DIR="\$(cd "\$(dirname "\$0")" && pwd)"
export PATH="${node_dir_escaped}:\${PATH}"
if [[ -f "\${SCRIPT_DIR}/.env" ]]; then
  set -a
  source "\${SCRIPT_DIR}/.env"
  set +a
fi
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
  elif launchctl load "$plist_file" 2>/dev/null; then
    ok "launchd service installed and started (legacy loader)"
    info "Nerve will start automatically on login"
  else
    ok "launchd plist created at ${plist_file}"
    info "Load it with: launchctl load ${plist_file}"
  fi
  echo ""
  info "Manage:"
  echo "    launchctl stop com.nerve.server"
  echo "    launchctl start com.nerve.server"
  echo "    launchctl unload ${plist_file}"
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
          ok "Skipped — start manually with: npm start"
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
elif command -v systemctl &>/dev/null; then
  if [[ "$DRY_RUN" == "true" ]]; then
    if [[ -f /etc/systemd/system/nerve.service ]]; then
      dry "Service already exists — would restart it"
    else
      dry "Would prompt to install systemd service"
      dry "Would create /etc/systemd/system/nerve.service"
      dry "Would enable and start the service"
    fi
  else
    echo -e "${BOLD}  Systemd service${NC}"
    echo ""
    if [[ -f /etc/systemd/system/nerve.service ]]; then
      info "Updating existing systemd service..."
      if [[ $EUID -eq 0 ]]; then
        systemctl stop nerve.service 2>/dev/null || true
      else
        sudo systemctl stop nerve.service 2>/dev/null || true
      fi
      setup_systemd
    elif [[ "$INTERACTIVE" == "true" ]]; then
      printf "  ${RAIL}  ${YELLOW}?${NC} Install as a systemd service? (Y/n) "
      if read -r answer < /dev/tty 2>/dev/null; then
        if [[ "$(echo "$answer" | tr "[:upper:]" "[:lower:]")" != "n" ]]; then
          setup_systemd
        else
          ok "Skipped — start manually with: npm start"
        fi
      else
        info "Cannot read input — installing systemd service by default"
        setup_systemd
      fi
    elif [[ $EUID -eq 0 ]]; then
      info "Non-interactive mode — installing systemd service automatically"
      setup_systemd
    else
      info "Non-interactive mode — generating systemd service file"
      setup_systemd
    fi
    echo ""
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────
echo -e "  ${RAIL}"
echo -e "  ${GREEN}●${NC} ${GREEN}${BOLD}Done${NC}"
echo ""

# Detect port from .env
local_port=3080
if [[ -f "${INSTALL_DIR}/.env" ]]; then
  port_val=$(grep -E "^PORT=" "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2 || true)
  [[ -n "$port_val" ]] && local_port="$port_val"
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo -e "     ${YELLOW}${BOLD}⊘  Dry run complete — nothing was modified${NC}"
  echo ""
  echo -e "     ${DIM}Run without --dry-run to install for real.${NC}"
else
  # Use the actual IP if HOST is 0.0.0.0 (network mode)
  host_val=$(grep -E "^HOST=" "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2 || true)
  if [[ "$host_val" == "0.0.0.0" ]]; then
    detected_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || echo "")
    local_url="http://${detected_ip:-localhost}:${local_port}"
  else
    local_url="http://localhost:${local_port}"
  fi
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
  echo -e "     ${DIM}Directory:  cd ${INSTALL_DIR}${NC}"
  if $IS_MAC; then
    echo -e "     ${DIM}Restart:   launchctl stop com.nerve.server && launchctl start com.nerve.server${NC}"
    echo -e "     ${DIM}Logs:      tail -f ${INSTALL_DIR}/nerve.log${NC}"
  elif command -v systemctl &>/dev/null; then
    echo -e "     ${DIM}Restart:   sudo systemctl restart nerve.service${NC}"
    echo -e "     ${DIM}Logs:      sudo journalctl -u nerve.service -f${NC}"
  else
    echo -e "     ${DIM}Start:     cd ${INSTALL_DIR} && npm start${NC}"
  fi
fi
echo ""

# Exit code reflects actual readiness
if [[ "$ENV_MISSING" == "true" ]] || [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  warn "Install complete but Nerve is not fully configured"
  info "Run: cd ${INSTALL_DIR} && npm run setup"
  exit 2  # partial success — installed but non-functional
fi
exit 0
