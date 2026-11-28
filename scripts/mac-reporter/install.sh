#!/usr/bin/env bash
#
# Install the Nerve work reporter on a Mac.
#
#   curl -fsSL http://<nerve-host>:3080/install/mac-reporter.sh \
#     | NERVE_REPORTER_TOKEN=<token> bash -s -- --server http://<nerve-host>:3080
#
# Re-running is safe: files are replaced, the Claude Code hook is added once,
# and the launch agent is reloaded. Nothing outside ~/.nerve/reporter,
# ~/.claude/settings.json and ~/Library/LaunchAgents is touched.
#
# Flags:
#   --server <url>          Nerve base URL (required)
#   --token <token>         reporter token (or NERVE_REPORTER_TOKEN, or --token-file)
#   --token-file <path>     read the token from a file instead
#   --workstream name=path  repeatable; maps a repo path to a workstream name
#   --no-hooks              do not touch ~/.claude/settings.json
#   --no-agent              do not install the macOS launch agent
#   --uninstall             remove the reporter, its hook entry and launch agent
#   --keep-queue            with --uninstall, keep unsent reports

set -euo pipefail

ROOT="${NERVE_REPORTER_HOME:-$HOME/.nerve/reporter}"
BIN="$ROOT/bin/nerve-report.mjs"
SETTINGS="$HOME/.claude/settings.json"
PLIST="$HOME/Library/LaunchAgents/com.nerve.reporter.plist"
LABEL="com.nerve.reporter"

SERVER="${NERVE_REPORTER_SERVER:-}"
TOKEN="${NERVE_REPORTER_TOKEN:-}"
TOKEN_FILE=""
WORKSTREAMS=()
DO_UNINSTALL=0
NO_HOOKS=0
NO_AGENT=0
KEEP_QUEUE=0

usage() {
  cat <<'USAGE'
Install the Nerve work reporter on a Mac.

  curl -fsSL http://<nerve-host>:3080/install/mac-reporter.sh \
    | NERVE_REPORTER_TOKEN=<token> bash -s -- --server http://<nerve-host>:3080

  --server <url>          Nerve base URL (required)
  --token <token>         reporter token (or NERVE_REPORTER_TOKEN, or --token-file)
  --token-file <path>     read the token from a file instead
  --workstream name=path  repeatable; maps a repo path to a workstream name
  --no-hooks              do not touch ~/.claude/settings.json
  --no-agent              do not install the macOS launch agent
  --uninstall             remove the reporter, its hook entry and launch agent
  --keep-queue            with --uninstall, keep unsent reports
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER="${2:-}"; shift 2 ;;
    --token) TOKEN="${2:-}"; shift 2 ;;
    --token-file) TOKEN_FILE="${2:-}"; shift 2 ;;
    --workstream) WORKSTREAMS+=("${2:-}"); shift 2 ;;
    --no-hooks) NO_HOOKS=1; shift ;;
    --no-agent) NO_AGENT=1; shift ;;
    --uninstall) DO_UNINSTALL=1; shift ;;
    --keep-queue) KEEP_QUEUE=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "install: unknown argument $1" >&2; exit 1 ;;
  esac
done

say() { printf '  %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }

remove_claude_hook() {
  [ -f "$SETTINGS" ] || return 0
  command -v python3 >/dev/null 2>&1 || { warn "python3 missing; remove the nerve-report hook from $SETTINGS yourself"; return 0; }
  SETTINGS="$SETTINGS" python3 - <<'PY'
import json, os, tempfile

path = os.environ["SETTINGS"]
try:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
except Exception as error:
    print(f"  ! could not read {path}: {error}")
    raise SystemExit(0)

hooks = data.get("hooks")
if not isinstance(hooks, dict):
    raise SystemExit(0)
changed = False
for event, groups in list(hooks.items()):
    if not isinstance(groups, list):
        continue
    kept_groups = []
    for group in groups:
        commands = group.get("hooks") if isinstance(group, dict) else None
        if not isinstance(commands, list):
            kept_groups.append(group)
            continue
        kept = [c for c in commands if "nerve-report" not in str(c.get("command", ""))]
        if len(kept) != len(commands):
            changed = True
            if kept:
                group["hooks"] = kept
                kept_groups.append(group)
        else:
            kept_groups.append(group)
    if changed:
        if kept_groups:
            hooks[event] = kept_groups
        else:
            hooks.pop(event, None)

if changed:
    directory = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".settings.", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")
    os.replace(tmp, path)
    print(f"  removed nerve-report hook from {path}")
else:
    print("  no nerve-report hook to remove")
PY
}

remove_launch_agent() {
  if [ -f "$PLIST" ]; then
    launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    say "removed launch agent"
  fi
}

uninstall() {
  echo "Uninstalling the Nerve reporter"
  remove_launch_agent
  remove_claude_hook

  if [ -d "$ROOT" ]; then
    if [ "$KEEP_QUEUE" = "1" ]; then
      find "$ROOT" -mindepth 1 -maxdepth 1 ! -name queue ! -name logs -exec rm -rf {} +
      say "kept $ROOT/queue and $ROOT/logs"
    else
      QUEUED=$(find "$ROOT/queue" -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
      rm -rf "$ROOT"
      say "removed $ROOT ($QUEUED unsent report(s) dropped)"
    fi
  fi
  echo "Done. Nothing else was changed."
}

if [ "$DO_UNINSTALL" = "1" ]; then
  uninstall
  exit 0
fi

# ── Preflight ────────────────────────────────────────────────────────

if [ -z "$SERVER" ]; then
  echo "install: --server is required (for example http://100.76.99.21:3080)" >&2
  exit 1
fi
case "$SERVER" in
  http://*|https://*) ;;
  *) echo "install: --server must start with http:// or https://" >&2; exit 1 ;;
esac
SERVER="${SERVER%/}"

if [ -n "$TOKEN_FILE" ]; then
  [ -r "$TOKEN_FILE" ] || { echo "install: cannot read $TOKEN_FILE" >&2; exit 1; }
  TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
fi
if [ -z "$TOKEN" ]; then
  echo "install: a reporter token is required. Pass --token, --token-file, or NERVE_REPORTER_TOKEN." >&2
  echo "         Create one on the Nerve host with: openssl rand -hex 32" >&2
  exit 1
fi

command -v node >/dev/null 2>&1 || { echo "install: Node.js 18+ is required (https://nodejs.org)" >&2; exit 1; }
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) < 18 ? 1 : 0)'; then
  echo "install: Node.js 18+ is required; found $(node -v)" >&2
  exit 1
fi
command -v curl >/dev/null 2>&1 || { echo "install: curl is required" >&2; exit 1; }

echo "Installing the Nerve reporter"
say "server: $SERVER"
say "home:   $ROOT"

# ── Files ────────────────────────────────────────────────────────────

umask 077
mkdir -p "$ROOT/bin" "$ROOT/queue" "$ROOT/logs"
chmod 700 "$ROOT"

TMP="$ROOT/bin/.nerve-report.new"
curl -fsSL --max-time 30 "$SERVER/install/nerve-report.mjs" -o "$TMP" \
  || { echo "install: could not download the reporter from $SERVER/install/nerve-report.mjs" >&2; rm -f "$TMP"; exit 1; }
mv "$TMP" "$BIN"
chmod 755 "$BIN"
say "installed $BIN"

INIT_ARGS=(init --server "$SERVER" --token "$TOKEN")
if [ "${#WORKSTREAMS[@]}" -gt 0 ]; then
  for entry in "${WORKSTREAMS[@]}"; do
    INIT_ARGS+=(--workstream "$entry")
  done
fi
"$BIN" "${INIT_ARGS[@]}"
say "wrote config"

# ── Reachability ─────────────────────────────────────────────────────

if "$BIN" ping >/dev/null 2>&1; then
  say "server accepts the token"
else
  warn "the server did not confirm the token. Reports will queue until it does."
  warn "check that $SERVER is reachable over Tailscale and the token matches NERVE_REPORTER_TOKEN."
fi

# ── Claude Code hook ─────────────────────────────────────────────────

if [ "$NO_HOOKS" = "1" ]; then
  say "skipped Claude Code hook (--no-hooks)"
elif ! command -v python3 >/dev/null 2>&1; then
  warn "python3 not found; skipping the Claude Code hook"
  warn "add this under hooks.SessionEnd yourself: {\"hooks\":[{\"type\":\"command\",\"command\":\"$BIN hook claude\"}]}"
else
  mkdir -p "$(dirname "$SETTINGS")"
  HOOK_CMD="$BIN hook claude" SETTINGS="$SETTINGS" python3 - <<'PY'
import json, os, tempfile

path = os.environ["SETTINGS"]
command = os.environ["HOOK_CMD"]

data = {}
if os.path.exists(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception as error:
        raise SystemExit(f"  ! {path} is not valid JSON ({error}); not touching it")

if not isinstance(data, dict):
    raise SystemExit(f"  ! {path} does not hold a JSON object; not touching it")

hooks = data.setdefault("hooks", {})
if not isinstance(hooks, dict):
    raise SystemExit(f"  ! {path} has a non-object \"hooks\"; not touching it")

groups = hooks.setdefault("SessionEnd", [])
if not isinstance(groups, list):
    raise SystemExit(f"  ! {path} has a non-array hooks.SessionEnd; not touching it")

for group in groups:
    for existing in (group.get("hooks") or []) if isinstance(group, dict) else []:
        if "nerve-report" in str(existing.get("command", "")):
            print("  Claude Code hook already present")
            raise SystemExit(0)

groups.append({"hooks": [{"type": "command", "command": command}]})

directory = os.path.dirname(path) or "."
fd, tmp = tempfile.mkstemp(dir=directory, prefix=".settings.", suffix=".json")
with os.fdopen(fd, "w", encoding="utf-8") as handle:
    json.dump(data, handle, indent=2)
    handle.write("\n")
os.replace(tmp, path)
print(f"  added SessionEnd hook to {path}")
PY
fi

# ── Launch agent (macOS) ─────────────────────────────────────────────

if [ "$NO_AGENT" = "1" ]; then
  say "skipped launch agent (--no-agent)"
elif [ "$(uname -s)" = "Darwin" ]; then
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BIN</string>
    <string>flush</string>
  </array>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$ROOT/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$ROOT/logs/launchd.err.log</string>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
  if launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST" 2>/dev/null; then
    say "launch agent flushes the queue every 15 minutes"
  else
    warn "could not load the launch agent; run '$BIN flush' from a hook or cron instead"
  fi
else
  say "not macOS; no launch agent installed (queue flushes on the next report)"
fi

# ── Verify ───────────────────────────────────────────────────────────

echo
echo "Installed. Verify with:"
echo "  $BIN status"
echo "  $BIN report --summary 'Reporter test' --workstream test"
echo "  $BIN digest --since 1h"
echo
echo "The hook reports at the end of each Claude Code session. It sends repo metadata,"
echo "the session's last assistant summary and observed facts — never prompts or diffs."
echo "Uninstall: curl -fsSL $SERVER/install/mac-reporter.sh | bash -s -- --uninstall"
