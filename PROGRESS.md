# Multi-Claw Progress Log

_Last updated: 2026-03-01 09:07 UTC_

## Status at a glance
- Branch: `multi-claw`
- Overall status: **Milestone 1 + Milestone 2 foundation completed**

## Recovery/audit of prior work (what had been done before this check)
- Verified branch state and history to determine where work had stopped:
  - `multi-claw` existed.
  - It was still at the same base commit as `master` / `origin/master` (`12cc93a`) before today’s new commits.
  - No prior multi-claw implementation commits were present in git history/reflog.
- Conclusion: previous session had planning context but no persisted code changes.

## Completed in this session
- [x] Created/kept planning docs:
  - `GOALS.md`
  - `PROGRESS.md`
- [x] Implemented Milestone 1 via Codex and applied to this branch.
- [x] Implemented Milestone 2 backend foundation via Codex and applied to this branch.

### Milestone 1 implementation details
Commit: `c2aa9e2` — `feat(multiclaw): add docker image running openclaw gateway + nerve`

Files added/updated:
- `.dockerignore`
- `Dockerfile.multiclaw`
- `scripts/start-multiclaw.sh`
- `README.md` (Docker milestone instructions + env vars)

What this delivers:
- Multi-stage production Docker build for Nerve.
- Installs OpenClaw CLI in runtime image.
- Exposes ports:
  - `3080` (Nerve)
  - `3181` (OpenClaw gateway)
- Entrypoint script starts both services, prefixes logs, and handles signal-based shutdown.
- Supports overrides via env vars (e.g., gateway start/stop command overrides).

### Milestone 2 implementation details
Commit: `27eabaf` — `feat(multiclaw): add local instance discovery and token endpoints`

Files added/updated:
- `server/lib/docker-instances.ts`
- `server/routes/instances.ts`
- `server/routes/instances.test.ts`
- `server/app.ts` (route registration)
- `docs/API.md` (endpoint docs)

What this delivers:
- `GET /api/instances`:
  - Lists local Docker containers that look like OpenClaw instances.
  - Returns stable response schema: `source`, `updatedAt`, `instances`.
- `GET /api/instances/:id/token`:
  - Returns token lookup result for one instance.
  - Token extraction restricted to allowlisted keys only:
    - `OPENCLAW_GATEWAY_TOKEN`
    - `GATEWAY_TOKEN`
- Docker command execution safety:
  - timeout + bounded output buffer
  - normalized errors: `docker_unavailable`, `docker_permission_denied`, `docker_command_failed`

## Validation notes
- `bash -n scripts/start-multiclaw.sh` passed for Milestone 1.
- In Codex temp env, full lint/test was limited:
  - One run hit npm runtime error (`Exit handler never called`).
  - One run had missing `vitest` binary due absent deps.
- Host workspace validation (2026-03-01 09:08 UTC):
  - `npm run lint` ✅ (0 errors, 7 existing warnings unrelated to multi-claw changes)
  - `npm run test -- server/routes/instances.test.ts` ✅ (4/4 tests passed)
  - `npm run build` ✅
  - `npm run build:server` ✅

## Milestone 3 implementation details
Commit: `14e71b2` — `feat(multiclaw): add instance proxy scaffolding with routing guardrails`

Files added/updated:
- `server/routes/instances.ts`
- `server/lib/docker-instances.ts`
- `server/routes/instances.test.ts`
- `docs/API.md`

What this delivers:
- Proxy scaffold endpoints:
  - `ANY /api/instances/:id/proxy`
  - `ANY /api/instances/:id/proxy/*`
- Target resolution via local Docker inspect + published host port selection.
- Forwarding of method/query/body and a safe allowlisted request header subset.
- Safe response header passthrough subset.
- Guardrails for:
  - master-pinned paths (`/api/instances*`)
  - traversal/protocol-relative/absolute URL/protocol-smuggling/backslash malformed paths
- Clear proxy errors:
  - `instance_unavailable` (404)
  - `target_port_unavailable` (409)
  - docker errors mapped to 502/503.

Additional follow-up commit:
- `a7bdfc6` — `test(multiclaw): stabilize unsafe proxy path guardrail case`

## Validation notes
- `bash -n scripts/start-multiclaw.sh` passed for Milestone 1.
- Host workspace validation (2026-03-01 09:08–09:14 UTC):
  - `npm run lint` ✅ (0 errors, 7 existing warnings unrelated to multi-claw changes)
  - `npm run test -- server/routes/instances.test.ts` ✅ (10/10 tests passed)
  - `npm run build` ✅
  - `npm run build:server` ✅

## Milestone 4 implementation details
Commit: `988f187` — `feat(multiclaw): add instances sidebar and frontend context routing`

Files added/updated:
- `src/contexts/InstanceContext.tsx`
- `src/lib/apiRouting.ts`
- `src/lib/apiRouting.test.ts`
- `src/features/auth/AuthGate.tsx`
- `src/App.tsx`
- `src/features/sessions/SessionList.tsx`
- `src/hooks/useServerEvents.ts`
- `docs/API.md`

What this delivers:
- New **Instances** section above **Agents** in right sidebar.
- **Master** always pinned as top selectable context.
- Instance discovery polling from `/api/instances` with refresh action.
- Active context selection (master or discovered instance).
- Frontend API routing layer:
  - rewrites a conservative allowlist of OpenClaw/Nerve API routes to `/api/instances/:id/proxy/...` when non-master selected
  - keeps `/api/instances*` and `/api/auth*` pinned to master
  - keeps unknown paths on master by default
- SSE `/api/events` now follows selected instance context through the same routing helper.
- Added routing unit tests for rewrite behavior.

Additional follow-up commit:
- `1f16919` — `fix(multiclaw): address lint and server type issues`
  - Added local eslint exception comment in `InstanceContext.tsx` for colocated hooks/provider exports.
  - Replaced `BodyInit` typing in server proxy handler with `ArrayBuffer` for server TS compatibility.

## Validation notes
- `bash -n scripts/start-multiclaw.sh` passed for Milestone 1.
- Host workspace validation (2026-03-01 09:36–09:38 UTC):
  - `npm run test -- src/lib/apiRouting.test.ts` ✅ (7/7 passed)
  - `npm run test -- server/routes/instances.test.ts` ✅ (10/10 passed)
  - `npm run lint` ✅ (0 errors, 7 existing warnings unrelated to multi-claw changes)
  - `npm run build` ✅
  - `npm run build:server` ✅

## Milestone 5 implementation + E2E details
Research notes file:
- `docs/research-aramaki-multiclaw.md`

Applied hardening (based on Aramaki container orchestration patterns):
- `Dockerfile.multiclaw`
  - build deps added: `python3 make g++`
  - runtime deps added: `git` (required by `npm install -g openclaw` path)
- `scripts/start-multiclaw.sh`
  - token normalization between `GATEWAY_TOKEN` and `OPENCLAW_GATEWAY_TOKEN`
  - auto-generate token when absent
  - default gateway bind mode variable: `OPENCLAW_GATEWAY_BIND_MODE` (default `lan`)
  - bootstrap minimal `~/.openclaw/openclaw.json` with explicit gateway mode/bind/port + controlUi allowed origins
  - default gateway launch switched to explicit foreground `openclaw gateway run --auth token --token ... --bind ... --port ...`
  - default `NERVE_ALLOW_INSECURE=true` for local multi-instance container tests (overrideable)
- `README.md`
  - updated multiclaw env-var guidance to match runtime behavior

E2E evidence (host + container):
1. Built image successfully:
   - `docker build -f Dockerfile.multiclaw -t multiclaw:e2e .` ✅
2. Started target instance:
   - `docker run -d --name multiclaw-target -p 13080:3080 -p 13181:3181 -e OPENCLAW_GATEWAY_TOKEN=multiclaw-e2e-token multiclaw:e2e` ✅
3. Master discovered target and extracted token:
   - `GET /api/instances` shows `multiclaw-target` in `running` state with published 3080/3181 ports ✅
   - `GET /api/instances/:id/token` returned `found=true`, token key `OPENCLAW_GATEWAY_TOKEN` ✅
4. Proxy path from master to target validated:
   - `GET /api/instances/:id/proxy/api/version` returned `200` with target Nerve version payload ✅

Current status:
- [x] End-to-end test with a real spawned container and proxy API call from master.
- [ ] Optional hardening pass for proxied WebSocket/session traffic if needed after deeper UI-driven context switching tests.

## Suggested next task
Milestone 6 (polish + deeper E2E):
1. Validate UI-driven context switching in browser (Instances panel) across sessions/memories/events.
2. Add explicit health/readiness checks in `start-multiclaw.sh` for gateway + Nerve before declaring startup success.
3. Add secure profile docs (`NERVE_AUTH=true` path) for non-local deployments.
