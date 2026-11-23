# Updating Nerve

Nerve ships a built-in updater. One command pulls the latest published release from GitHub, rebuilds, restarts the service, and checks that the new version is serving. If the update, build, service restart or health check fails after the snapshot, it tries to roll back to the previous version.

When a newer release exists, the status bar shows an **Update** button (checked hourly). It opens a dialog with the command below for your install directory.

## Prerequisites

- The install is a git checkout whose `origin` is an HTTPS URL (the installer creates one).
- `git`, Node.js 22 or later, and `npm` are on `PATH`.
- You have write permission in the install directory.
- The updater is built. `npm run update` runs `bin-dist/bin/nerve-update.js`, which `npm run build` creates.

Check the remote, and fix it if it is not HTTPS:

```bash
git remote -v
git remote set-url origin https://github.com/<owner>/<repo>.git
```

## Quick start

```bash
cd ~/nerve
npm run update -- --yes
```

The updater:

1. Takes the update lock.
2. Runs preflight checks: `git`, `node` and `npm` exist, Node is 22 or later, the directory is a git repository, `origin` is HTTPS, and the directory is writable.
3. Resolves the target version: the latest published GitHub release, or the latest semver tag if the release lookup fails. `--version` pins a version instead.
4. Asks for confirmation (skipped with `--yes`).
5. Snapshots the current state for rollback.
6. Runs `git fetch --tags origin`, then `git checkout --force <tag>`, which leaves the checkout on a detached HEAD at the tag.
7. Runs `npm install`, `npm run build` and `npm run build:server`.
8. Restarts the systemd or launchd service.
9. Polls `/health` and `/api/version` until the new version is serving.

`git checkout --force` runs without a dirty check, so uncommitted edits to tracked files are discarded. Your `.env` is untracked and is never modified.

If the resolved version equals the version in `package.json`, the updater exits with "Already up to date" (exit code 1). Pinning an older version with `--version` is allowed and acts as a downgrade.

## Command line

| Flag | Description |
|------|-------------|
| `--version <vX.Y.Z>` | Pin to a specific version instead of the latest. The leading `v` is optional, and the tag must exist on `origin`. |
| `--yes`, `-y` | Skip the confirmation prompt. Use it when nobody can answer a prompt. |
| `--dry-run` | Resolve the target version and print what would happen, without changing anything. |
| `--verbose`, `-v` | Extra logging (git commands, service detection, health URLs). |
| `--rollback` | Restore the last snapshot. |
| `--no-restart` | Skip the service restart and the health checks. |
| `--help`, `-h` | Show help. |

`--rollback` ignores `--dry-run`, `--no-restart` and `--yes`. It does not ask for confirmation and restarts the service if it finds one.

```bash
# Preview what an update would do
npm run update -- --dry-run

# Update to a specific version
npm run update -- --version v1.4.0 --yes

# Roll back to the state before the last update
npm run update -- --rollback

# Update without restarting (restart the service yourself)
npm run update -- --yes --no-restart
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success. Also returned for a dry run, a declined confirmation, and a finished `--rollback`. |
| 1 | Already up to date. Also returned for an unknown option, a missing `--version` value, and an uncaught fatal error. |
| 10 | Preflight failure: `git`, `node` or `npm` missing, Node below 22, not a git repository, `origin` not HTTPS, or no write permission. |
| 20 | Version resolution failure: `package.json` unreadable, no release or semver tags found, or `--version` invalid or not an existing tag. |
| 40 | Update or build failure: `git fetch`, `git checkout`, `npm install` or a build step failed (rollback attempted). Also returned for an unexpected error outside the tracked stages (no rollback). |
| 50 | The service restart command failed, or the service was not active after the restart (rollback attempted). |
| 60 | Health check failure: `/health` never returned 2xx, or `/api/version` never reported the target version (rollback attempted). |
| 70 | Rollback failure (needs manual intervention), or `--rollback` found no snapshot. |
| 80 | Lock acquisition failure: another update is running. |

When a rollback succeeds, the exit code is still the code of the failure that triggered it.

## How it works

### Snapshots

Before changing anything, the updater writes `~/.nerve/updater/last-good.json` with:

- the current git commit hash,
- the current version from `package.json`,
- a timestamp,
- a SHA-256 hash of `.env`.

If `.env` exists, a copy also goes to `~/.nerve/updater/snapshots/<timestamp>/.env` (mode `0600`). Each update overwrites `last-good.json`, so it always describes the state just before the most recent update attempt.

### Rollback

Rollback restores the snapshot commit, cleans `node_modules`, rebuilds, and restarts the service. It runs automatically when the git update, a build step, the service restart command, the service-active check after the restart, or the health check fails, or manually with `--rollback`.

1. `git checkout --force <snapshot-commit>` (local, no fetch).
2. Remove `node_modules`.
3. `npm install && npm run build && npm run build:server`.
4. Restart the service and check that it is active. Rollback does not re-run the `/health` and `/api/version` checks.

### Health checks

After the restart, the updater polls for up to 60 seconds:

- `GET /health` must return 2xx.
- `GET /api/version` must report the target version.

Each request times out after 5 seconds. Between attempts it waits 2, 4, then 8 seconds (8 seconds from then on). A version mismatch keeps retrying, because an old process may still be serving. If the deadline passes with the wrong version, the check fails and triggers a rollback.

The updater takes the host and port from its own environment first, then from `.env`, then the defaults (`127.0.0.1`, `3080`). A wildcard host (`0.0.0.0`, `::`) is probed on loopback.

### Locking

A PID-based lock file prevents concurrent updates. It is created with the `wx` flag (exclusive create) and removed on exit. If the PID in an existing lock is no longer running, the lock is treated as stale and replaced. `--rollback` takes the same lock.

### Service detection

The updater picks the first service manager that finds a match, checking systemd before launchd:

| Manager | Detection | Restart | Active check |
|---------|-----------|---------|--------------|
| systemd | The first line of `systemctl list-units --type=service --all` that mentions "nerve" (case-insensitive), whose first column is the unit. System units are searched before `--user` units. | `systemctl [--user] restart <unit>` | `systemctl [--user] is-active <unit>` returns `active` |
| launchd | macOS only. The first `launchctl list` entry containing "nerve" (for example `com.nerve.server`) | `launchctl kickstart -k gui/<uid>/<label>`, falling back to `launchctl stop` and `start` | The entry has a numeric PID |

After the restart the updater waits 2 seconds and checks again once before it gives up. Restart commands run as the user who started the updater, without `sudo`.

If no service manager is found, the updater skips the restart and the health check, prints `npm start` as the manual start command, and still exits 0. The new version is not running until you start it.

## State files

All state lives under `~/.nerve/updater/`, regardless of `NERVE_DATA_DIR`.

| Path | Purpose |
|------|---------|
| `last-good.json` | Snapshot taken before the most recent update |
| `last-run.json` | Result of the most recent update that succeeded or failed, with its stage, error and exit code on failure. Not written for "already up to date", dry runs, declined prompts or rollbacks. |
| `snapshots/<timestamp>/.env` | Backed-up `.env` files |
| `update.lock` | PID lock file |

## Upgrade notes

### 1.5.0, Kanban data path migration

On first start after upgrading to 1.5.0, Nerve automatically migrates legacy Kanban runtime data from:
- `server-dist/data/kanban`
- `server/data/kanban`

into the canonical runtime location:
- `${NERVE_DATA_DIR:-~/.nerve}/kanban`

What to do:
- Let the first post-upgrade start complete before judging the migration.
- Update backup scripts to follow `${NERVE_DATA_DIR:-~/.nerve}/kanban`.
- Do not keep writing to the old `server-dist` or `server` data paths after upgrade.

### 1.5.4, gateway protocol v4

From 1.5.4, Nerve connects to the OpenClaw gateway with connect protocol v4 only. A gateway that does not speak v4 cannot connect, so update OpenClaw before or together with Nerve.

## Troubleshooting

### "No published release or semver tags found" (exit 20)

The updater asks the GitHub Releases API for the latest release (10 second timeout), then falls back to the highest semver tag from `git ls-remote --tags origin`, then to local tags. If all three fail, it exits with code 20. The release lookup only works when `origin` is a GitHub URL. Setting `GITHUB_TOKEN` or `GH_TOKEN` avoids anonymous rate limits.

**Fix:** Verify the remote, the tags and release access:
```bash
git remote -v
git remote set-url origin https://github.com/<owner>/<repo>.git
git fetch --tags origin
curl -sSf https://api.github.com/repos/<owner>/<repo>/releases/latest | jq .tag_name
```

### "Another update is already running" (exit 80)

Another update is running, or a stale lock file is left behind. A lock whose PID is no longer alive is replaced automatically, so a persistent error usually means a live process holds it.

**Fix:** Check whether that process is alive:
```bash
cat ~/.nerve/updater/update.lock   # Shows the PID
ps -p <pid>                        # Check if it's alive
```

If the process is not an updater, remove the lock:
```bash
rm ~/.nerve/updater/update.lock
```

### Health check fails with a version mismatch (exit 60)

The service restarted, but `/api/version` kept reporting the old version until the 60 second deadline.

**Causes:**
- The old process kept serving, so the new one never took the port.
- The shell running the updater sets `PORT` or `HOST` to something other than what the service uses, so the updater is checking a different instance.

The updater then rolls back. If the rollback succeeds, the previous version is back on disk and the service has been restarted on it, so restarting again serves the previous version, not the update.

**Fix:** Check which version answers:
```bash
curl http://127.0.0.1:3080/api/version
```
Fix the cause above, then run the update again. If the run ended with exit 70 instead, the rollback failed too: restore by hand as in [Build failure after checkout](#build-failure-after-checkout-exit-40).

### The service restart command fails (exit 50 or 70)

The restart runs as your user, without `sudo`. If the command itself errors (for example your user may not restart a system-level unit), the updater fails with code 50 and rolls back: it restores and rebuilds the previous version, then restarts it with the same command. That restart usually fails the same way, so the run ends with exit 70. If the restart command failed without stopping anything, the service keeps running the version it ran before the update. A restart can also stop the service and then fail to start it, so check the service state (`systemctl status nerve.service`, or `launchctl print gui/$(id -u)/com.nerve.server` on macOS) rather than assuming it is up.

**Fix:** First check which version is checked out (`git -C ~/nerve describe --tags`). If the rollback failed at its checkout step, the tree is still on the new release and a retry stops at "Already up to date", so restore the previous checkout first as in [Build failure after checkout](#build-failure-after-checkout-exit-40). Then run the update with `--no-restart` and restart the service yourself:
```bash
npm run update -- --yes --no-restart
sudo systemctl restart nerve.service
curl http://127.0.0.1:3080/api/version
```
On macOS, use `launchctl kickstart -k gui/$(id -u)/com.nerve.server`.

`--rollback` uses the same unprivileged restart, so it can exit 70 for the same reason after restoring and rebuilding the previous version. Restart the service yourself after it.

### Build failure after checkout (exit 40)

`npm install` or a build step failed on the new version. The updater attempts an automatic rollback. If the rollback also fails (exit 70), restore manually:
```bash
cat ~/.nerve/updater/last-good.json           # Get the snapshot commit ("ref")
git checkout --force <ref>
npm install && npm run build && npm run build:server
sudo systemctl restart nerve.service          # Linux; macOS: launchctl kickstart -k gui/$(id -u)/com.nerve.server
```
