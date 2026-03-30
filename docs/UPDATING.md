# Updating Nerve

Nerve ships a built-in updater that pulls the latest published release from GitHub, rebuilds, restarts the service, and verifies health — all in one command.

## Prerequisites

Before using the updater, make sure this checkout has an HTTPS GitHub `origin`, for example:

```bash
git remote -v
```

`origin` should point to `https://github.com/<owner>/<repo>.git`. If it does not, fix it first:

```bash
git remote set-url origin https://github.com/<owner>/<repo>.git
```

## Quick start

```bash
npm run update -- --yes
```

This will:
1. Check prerequisites (git, Node.js, npm, and an HTTPS GitHub `origin` remote)
2. Resolve the latest published GitHub release (fallback: latest semver tag)
3. Snapshot the current state for rollback
4. `git fetch --tags && git checkout <tag>`
5. `npm install && npm run build && npm run build:server`
6. Restart the systemd/launchd service
7. Verify `/health` and `/api/version` match the target

## CLI flags

| Flag | Description |
|------|-------------|
| `--version <vX.Y.Z>` | Pin to a specific version instead of latest |
| `--yes`, `-y` | Skip the confirmation prompt |
| `--dry-run` | Show what would happen without making changes |
| `--verbose`, `-v` | Extra logging (git commands, service detection) |
| `--rollback` | Restore the last-known-good snapshot |
| `--no-restart` | Skip service restart and health checks |
| `--help`, `-h` | Show help |

## Examples

```bash
# Preview what an update would do
npm run update -- --dry-run

# Update to a specific version
npm run update -- --version v1.4.0 --yes

# Rollback to the previous version
npm run update -- --rollback

# Update without restarting (e.g. to restart manually)
npm run update -- --yes --no-restart
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Already up to date |
| 10 | Preflight failure (missing git/node/npm) |
| 20 | Version resolution failure (release/tag not found) |
| 40 | Build failure (npm install or build step) |
| 50 | Service restart failure |
| 60 | Health check failure (service unhealthy or version mismatch) |
| 70 | Rollback failure (critical — manual intervention needed) |
| 80 | Lock acquisition failure (another update is running) |

## How it works

### Update flow

```
lock → preflight → resolve → confirm → snapshot → git checkout
  → npm install + build → restart → health check → done
```

Each stage has a dedicated exit code. If any stage after snapshot fails, the updater attempts an automatic rollback.

### Snapshots

Before making changes, the updater saves:
- The current git ref (commit hash)
- The current version from `package.json`
- A SHA-256 hash of `.env`
- A timestamped backup of `.env`

Snapshots are stored in `~/.nerve/updater/`. The `.env` file is **never overwritten** during an update — only backed up.

### Rollback

Rollback restores the snapshot ref, cleans `node_modules`, rebuilds, and restarts the service. It runs automatically on build/restart/health failures, or manually via `--rollback`.

The rollback flow:
1. `git checkout --force <snapshot-ref>`
2. Remove `node_modules` (clean slate)
3. `npm install && npm run build && npm run build:server`
4. Restart and verify the service

### Health checks

After restart, the updater polls:
- `GET /health` — must return 2xx
- `GET /api/version` — must report the target version

Retries with exponential backoff (2s, 4s, 8s) up to a 60-second deadline. If the version doesn't match, the updater assumes the old process is still serving and triggers rollback.

### Locking

A PID-based lock file prevents concurrent updates. The lock is acquired with `wx` (exclusive create) and released on exit. If a lock is stale (the PID no longer exists), it's automatically cleaned up.

### Service detection

The updater auto-detects the service manager:
- **systemd** — `systemctl restart nerve`
- **launchd** — `launchctl kickstart -k`

If no service manager is found, the updater skips restart and prints manual start instructions.

## State files

| Path | Purpose |
|------|---------|
| `~/.nerve/updater/last-good.json` | Last-known-good snapshot |
| `~/.nerve/updater/last-run.json` | Result of the most recent update attempt |
| `~/.nerve/updater/snapshots/<timestamp>/.env` | Backed-up `.env` files |
| `~/.nerve/updater/nerve-update.lock` | PID lock file |

## Upgrade notes

### 1.5.0, Kanban data path migration

On first start after upgrading to 1.5.0, Nerve automatically migrates legacy Kanban runtime data from:
- `server-dist/data/kanban`
- `server/data/kanban`

into the canonical runtime location:
- `${NERVE_DATA_DIR:-~/.nerve}/kanban`

What to do:
- Let the first post-upgrade start complete before judging the migration
- Update backup scripts to follow `${NERVE_DATA_DIR:-~/.nerve}/kanban`
- Do not keep writing to the old `server-dist` or `server` data paths after upgrade

## Troubleshooting

### "Could not fetch release or semver tags"

The updater resolves versions from GitHub Releases first. If release lookup fails (network/rate limits), it falls back to semver tags. If both sources fail, it exits with code 20.

**Fix:** Verify remote/release access and tags:
```bash
git remote -v
git remote set-url origin https://github.com/<owner>/<repo>.git
git fetch --tags origin
curl -sSf https://api.github.com/repos/<owner>/<repo>/releases/latest | jq .tag_name
```

### "Lock acquisition failure" (exit 80)

Another update process is running, or a stale lock file exists.

**Fix:** Check if an update is actually running:
```bash
cat ~/.nerve/updater/nerve-update.lock   # Shows the PID
ps -p <pid>                               # Check if it's alive
```

If the process is gone, the lock is stale — delete it:
```bash
rm ~/.nerve/updater/nerve-update.lock
```

### Health check fails with version mismatch

The service restarted but `/api/version` reports the old version.

**Causes:**
- The old process didn't shut down cleanly (port still bound)
- systemd started the service before the build finished

**Fix:** Restart manually and check:
```bash
systemctl restart nerve
curl http://127.0.0.1:3080/api/version
```

### Build failure after checkout

`npm install` or `npm run build` failed on the new version.

**Fix:** The updater will attempt automatic rollback. If rollback also fails (exit 70), restore manually:
```bash
cat ~/.nerve/updater/last-good.json           # Get the snapshot ref
git checkout --force <ref>
npm install && npm run build && npm run build:server
systemctl restart nerve
```
