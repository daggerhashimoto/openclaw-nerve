#!/usr/bin/env bash
set -Eeuo pipefail

NERVE_PORT="${PORT:-3080}"
NERVE_HOST="${HOST:-0.0.0.0}"
GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-3181}"

export PORT="${NERVE_PORT}"
export HOST="${NERVE_HOST}"
export GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:${GATEWAY_PORT}}"

gateway_pid=""
nerve_pid=""

prefix_logs() {
  local name="$1"
  sed -u "s/^/[${name}] /"
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

  local -a cmd=("openclaw" "gateway" "start")
  local help_text=""
  help_text="$(openclaw gateway start --help 2>/dev/null || true)"

  if grep -Eq -- '(^|[[:space:]])--port([=[:space:]]|$)' <<<"${help_text}"; then
    cmd+=("--port" "${GATEWAY_PORT}")
  fi

  if grep -Eq -- '(^|[[:space:]])--(bind|host)([=[:space:]]|$)' <<<"${help_text}"; then
    if grep -Eq -- '(^|[[:space:]])--bind([=[:space:]]|$)' <<<"${help_text}"; then
      cmd+=("--bind" "0.0.0.0")
    else
      cmd+=("--host" "0.0.0.0")
    fi
  fi

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

start_gateway
start_nerve

set +e
wait -n
exit_code=$?
cleanup
exit "${exit_code}"
