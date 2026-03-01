# Research: Aramaki agent containers → MultiClaw container orchestration

_Date: 2026-03-01_

## Goal
Use proven patterns from the local `aramaki` project to improve how `openclaw-nerve` MultiClaw containers are configured, started, and interacted with.

## Sources reviewed
- `aramaki/README.md`
- `aramaki/app/models/agent.rb`
- `aramaki/spec/models/agent_spec.rb` (via grep references)

## Key findings from Aramaki

### 1) Container bootstrap should be deterministic and self-contained
Aramaki provisions per-agent runtime state before startup (`prepare_agent_home!`), including:
- explicit writable home/workspace directories
- explicit config generation (`.openclaw/openclaw.json`)
- explicit auth/config copying when needed

**Takeaway for MultiClaw:** avoid relying on ambient host config existing inside container.

### 2) Gateway config is explicit in generated config
Aramaki-generated OpenClaw config includes:
- `gateway.mode = local`
- `gateway.bind = loopback`
- `gateway.port = 18789`

**Takeaway for MultiClaw:** gateway startup should pass explicit mode/auth/bind/port flags (or write config), not rely on defaults.

### 3) Lifecycle management uses predictable start/stop semantics
Aramaki systemd unit consistently uses:
- cleanup before start (`docker rm -f`)
- explicit stop command
- restart policy

**Takeaway for MultiClaw:** startup script should have clear process ownership, shutdown behavior, and log prefixes (already mostly true).

### 4) Identity/user and filesystem consistency matter
Aramaki runs containers with fixed UID/GID and ensures ownership/readability of mounted paths.

**Takeaway for MultiClaw:** where we mount state in future, we should similarly enforce deterministic ownership and avoid startup races due to permissions.

## Problems observed in MultiClaw E2E before improvements
1. Build failed initially due missing build toolchain (python3/make/g++).
2. Runtime install failed due missing `git` for `npm install -g openclaw` dependency resolution.
3. Container exited because Nerve refused `HOST=0.0.0.0` without auth.
4. Gateway startup failed in several modes due implicit/fragile config assumptions (unconfigured mode/custom bind host mismatch).

## Improvements applied based on research

### A) Dockerfile hardened for deterministic build/runtime deps
- Build stage now installs: `python3 make g++` before `npm ci`.
- Runtime stage now installs: `ca-certificates bash git` before `npm install -g openclaw`.

### B) Startup script now uses explicit gateway runtime flags
`scripts/start-multiclaw.sh` default gateway launch now uses:
- `openclaw gateway run`
- `--allow-unconfigured`
- `--auth token`
- `--token $OPENCLAW_GATEWAY_TOKEN`
- `--bind lan`
- `--port $OPENCLAW_GATEWAY_PORT`

This follows Aramaki’s “explicit gateway config” principle.

### C) Token handling normalized
Startup script now:
- syncs `GATEWAY_TOKEN` and `OPENCLAW_GATEWAY_TOKEN`
- auto-generates token if absent

This ensures Nerve→Gateway and management APIs can work without missing-token startup failures.

### D) Container startup no longer fails by default on 0.0.0.0
For MultiClaw container mode, script defaults:
- `NERVE_ALLOW_INSECURE=true` (unless caller overrides)

This is a practical default for local Docker-instance orchestration; production callers should still prefer explicit auth.

## Next recommended hardening (not yet implemented)
1. Optionally generate/write minimal `~/.openclaw/openclaw.json` in container (like Aramaki) so behavior is predictable across OpenClaw CLI versions.
2. Add explicit readiness checks in startup script:
   - wait for gateway port to accept connections
   - fail fast if not ready in timeout window
3. Add non-default secure profile example for production:
   - `NERVE_AUTH=true`
   - `NERVE_SESSION_SECRET`
   - explicit auth password env.
4. Update proxy target logic to differentiate Nerve HTTP port vs Gateway WS port if needed by frontend routing model.

## E2E status impact
These changes address the concrete startup/build blockers discovered during testing and move MultiClaw closer to reproducible container orchestration behavior aligned with Aramaki patterns.
