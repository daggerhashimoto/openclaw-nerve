#!/usr/bin/env bash
set -Eeuo pipefail

NERVE_PORT="${PORT:-3080}"
NERVE_HOST="${HOST:-0.0.0.0}"
GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-3181}"
GATEWAY_BIND_MODE="${OPENCLAW_GATEWAY_BIND_MODE:-lan}"

# In containerized multi-instance mode we default to insecure allowance unless caller
# explicitly enables auth. This avoids immediate startup refusal on 0.0.0.0.
export NERVE_ALLOW_INSECURE="${NERVE_ALLOW_INSECURE:-true}"

# Keep a single token source for gateway + Nerve-to-gateway calls.
if [[ -z "${OPENCLAW_GATEWAY_TOKEN:-}" && -n "${GATEWAY_TOKEN:-}" ]]; then
  export OPENCLAW_GATEWAY_TOKEN="${GATEWAY_TOKEN}"
fi
if [[ -z "${GATEWAY_TOKEN:-}" && -n "${OPENCLAW_GATEWAY_TOKEN:-}" ]]; then
  export GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN}"
fi
if [[ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]]; then
  export OPENCLAW_GATEWAY_TOKEN="$(tr -dc 'a-zA-Z0-9' </dev/urandom | head -c 32)"
  export GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN}"
fi

export PORT="${NERVE_PORT}"
export HOST="${NERVE_HOST}"
export GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:${GATEWAY_PORT}}"

gateway_pid=""
nerve_pid=""

prefix_logs() {
  local name="$1"
  sed -u "s/^/[${name}] /"
}

bootstrap_gateway_config() {
  local config_path="${HOME}/.openclaw/openclaw.json"
  mkdir -p "$(dirname "${config_path}")"

  MULTICLAW_CFG_PATH="${config_path}" \
  MULTICLAW_GATEWAY_PORT="${GATEWAY_PORT}" \
  MULTICLAW_NERVE_PORT="${NERVE_PORT}" \
  MULTICLAW_GATEWAY_BIND_MODE="${GATEWAY_BIND_MODE}" \
  node <<'NODE'
const fs = require('fs');
const path = process.env.MULTICLAW_CFG_PATH;
const gatewayPort = Number(process.env.MULTICLAW_GATEWAY_PORT || '3181');
const nervePort = Number(process.env.MULTICLAW_NERVE_PORT || '3080');
const bindMode = process.env.MULTICLAW_GATEWAY_BIND_MODE || 'lan';

let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(path, 'utf8'));
} catch {
  cfg = {};
}

cfg.gateway = cfg.gateway || {};
cfg.gateway.mode = 'local';
cfg.gateway.bind = bindMode;
cfg.gateway.port = gatewayPort;
cfg.gateway.controlUi = cfg.gateway.controlUi || {};

const desiredOrigins = [
  `http://127.0.0.1:${nervePort}`,
  `http://localhost:${nervePort}`,
  `http://0.0.0.0:${nervePort}`,
];

const current = Array.isArray(cfg.gateway.controlUi.allowedOrigins)
  ? cfg.gateway.controlUi.allowedOrigins.filter((x) => typeof x === 'string')
  : [];

cfg.gateway.controlUi.allowedOrigins = Array.from(new Set([...current, ...desiredOrigins]));

fs.writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
NODE
}

start_gateway() {
  if [[ -n "${OPENCLAW_GATEWAY_CMD:-}" ]]; then
    echo "[multiclaw] starting gateway with OPENCLAW_GATEWAY_CMD"
    (
      exec bash -lc "${OPENCLAW_GATEWAY_CMD}"
    ) > >(prefix_logs "gateway") 2>&1 &
    gateway_pid=$!
    return
  fi

  local -a cmd=(
    "openclaw" "gateway" "run"
    "--auth" "token"
    "--token" "${OPENCLAW_GATEWAY_TOKEN}"
    "--bind" "${GATEWAY_BIND_MODE}"
    "--port" "${GATEWAY_PORT}"
  )

  echo "[multiclaw] starting gateway: ${cmd[*]}"
  (
    exec "${cmd[@]}"
  ) > >(prefix_logs "gateway") 2>&1 &
  gateway_pid=$!
}

start_nerve() {
  echo "[multiclaw] starting nerve on ${HOST}:${PORT}"
  (
    exec node server-dist/index.js
  ) > >(prefix_logs "nerve") 2>&1 &
  nerve_pid=$!
}

cleanup() {
  trap - SIGINT SIGTERM
  echo "[multiclaw] shutting down..."

  if [[ -n "${nerve_pid}" ]]; then
    kill -TERM "${nerve_pid}" 2>/dev/null || true
  fi
  if [[ -n "${gateway_pid}" ]]; then
    kill -TERM "${gateway_pid}" 2>/dev/null || true
  fi

  if [[ -n "${OPENCLAW_GATEWAY_STOP_CMD:-}" ]]; then
    bash -lc "${OPENCLAW_GATEWAY_STOP_CMD}" >/dev/null 2>&1 || true
  else
    openclaw gateway stop >/dev/null 2>&1 || true
  fi

  wait || true
}

trap cleanup SIGINT SIGTERM

bootstrap_gateway_config
start_gateway
start_nerve

set +e
wait -n
exit_code=$?
cleanup
exit "${exit_code}"
