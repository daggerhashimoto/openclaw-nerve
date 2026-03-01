# Multi-Claw Goals (openclaw-nerve)

_Last updated: 2026-03-01 08:35 UTC_

## Final Goal
Add support in Nerve for managing and operating multiple OpenClaw instances from one master Nerve UI.

## Scope

1. **Containerized instance target**
   - Create a Dockerfile image that includes both OpenClaw and Nerve.
   - Expose both:
     - OpenClaw Gateway endpoint
     - Nerve endpoint

2. **Master Nerve backend capabilities**
   - List local Docker containers.
   - Identify OpenClaw containers and fetch their authentication token.
   - Reverse proxy OpenClaw + Nerve API/WS endpoints for selected instance.

3. **Nerve UI: Instances panel**
   - Add an **Instances** section above **Agents** (right sidebar).
   - Always show **Master** as the top entry.
   - Show discovered/routable local instances.
   - Allow context switching.

4. **Context-aware routing**
   - When switched to a non-master instance:
     - Proxy all normal frontend OpenClaw/Nerve requests to selected instance.
   - Keep instance-management requests pinned to master backend.

5. **End-to-end validation**
   - Run at least one target OpenClaw+Nerve Docker container from new image.
   - Verify master Nerve can:
     - authenticate to target instance,
     - list it in UI,
     - switch context,
     - proxy requests successfully.

## Non-goals (for initial implementation)
- Multi-host orchestration beyond local Docker daemon.
- HA/failover orchestration.
- Full RBAC across instances.

## Definition of done
- Docker image builds and runs with both services exposed.
- Master Nerve instance can discover + authenticate local target instances.
- Instances UI section is visible and functional.
- Context switch correctly routes traffic with master-only exceptions.
- Manual test evidence captured in PROGRESS.md.
