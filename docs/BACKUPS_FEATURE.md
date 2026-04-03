# Backups Feature — Architecture & Documentation

## Overview

The Backups feature provides visibility and management of all OpenClaw backup types. Configuration lives entirely in `Nerve/.env`, no values are hardcoded. Two backup targets are configured: Local CLI and NAS Offsite.

## Backup Types

### 1. Local Backup
**Purpose:** Creates a verified, restorable tar.gz archive of the entire OpenClaw workspace using the OpenClaw CLI.

**What it backs up:**
- `~/.openclaw/` — workspace, agents, memory, config
- All agent directories

**How it works:**
```
openclaw backup create --output "$BACKUP_LOCAL_DIR" --verify
```
- Creates: `YYYY-MM-DDTHH-MM-SS.ZZ-openclaw-backup.tar.gz`
- `--verify` flag runs integrity check on the archive
- Retention: 7 days rolling window

**Config env vars (Nerve .env):**
```
BACKUP_LOCAL_ENABLED=true
BACKUP_LOCAL_DIR=~/Backups
BACKUP_RETENTION_DAYS=7
BACKUP_LOCAL_SCHEDULE=0 1 * * *
```

**Crontab entry:**
```
0 1 * * * /home/najef/.openclaw/workspace/scripts/backup-openclaw-native.sh >> /home/najef/Backups/backup.log 2>&1
```

---

### 2. NAS Backup
**Purpose:** Off-site backup to a NAS device for disaster recovery using SMB/smbclient.

**What it backs up:**
- Same workspace archive as local backup
- Transferred via smbclient (no mount needed)

**Strategy — Full vs Incremental:**
- **Sunday:** Full backup (complete archive)
- **Mon-Sat:** Incremental backup (complete archive, naming reflects type)
- **Catch-up:** If a backup is missed, the next run ALWAYS does a full backup (not incremental), then resumes normal schedule
- Retention: 21 days on NAS

**Naming convention:**
```
full-YYYY-MM-DD.tar.gz     ← Full backup (Sunday or catch-up)
incr-YYYY-MM-DD.tar.gz     ← Incremental backup (Mon-Sat)
```

**How it works:**
```
smbclient "//$NAS_HOST/My Files" -U "$NAS_USER%$NAS_PASSWORD" \
  -c "cd \"$NAS_BACKUP_PATH\"; put backup.tar.gz"
```

**Config env vars (Nerve .env):**
```
BACKUP_NAS_ENABLED=true
BACKUP_NAS_HOST=192.168.2.3
BACKUP_NAS_USER=CoWorker.Neon
BACKUP_NAS_PASSWORD=<password>
BACKUP_NAS_BACKUP_PATH=Files Neon/backups/openclaw-full
BACKUP_NAS_RETENTION_DAYS=30
BACKUP_NAS_SCHEDULE=30 1 * * *
```

**Crontab entries:**
```
30 1 * * * /home/najef/.openclaw/workspace/scripts/backup-openclaw-to-nas.sh >> /home/najef/Backups/backup-nas.log 2>&1
00 * * * * /home/najef/.openclaw/workspace/scripts/backup-watchdog.sh >> /home/najef/Backups/backup-nas.log 2>&1
```

**Watchdog:** Runs hourly. If no backup exists for today past 03:00 CET, runs a FULL catch-up backup with `--force-full` flag, then resumes normal schedule.

---

### 3. GitHub Backup (Optional — not currently configured)
**Purpose:** Backs up workspace config to a GitHub repository.

---

## Integration Points

### API Routes (`server/routes/backups.ts`)
- `GET /api/backups` — Returns all backup sections with calendar, schedule, file lists
- `GET /api/backups/:name` — Downloads a specific backup archive
- `DELETE /api/backups/:name` — Deletes a specific backup archive

### Settings UI
- `src/features/settings/BackupsSettings.tsx` — reads/writes backup env vars
- Integrated into `SettingsDrawer`

### BackupsPanel UI (`src/features/backups/BackupsPanel.tsx`)
- Displays NAS Offsite and Local CLI tabs
- 14-day calendar per backup (green = backup exists that day)
- File list with Full/Incr type badges (NAS), size, date
- Header badge: "All Healthy" (green) if both backups ran today, "Issues Detected" (red) if either is missing
- Per-section badge: "Healthy" / "Unhealthy" based on 24h threshold

### Scripts
| Script | Purpose |
|---|---|
| `backup-openclaw-native.sh` | Local CLI backup via OpenClaw CLI |
| `backup-openclaw-to-nas.sh` | NAS backup via smbclient (supports `--force-full`) |
| `backup-watchdog.sh` | Hourly catch-up checker — triggers `--force-full` if backup missed |

---

## Configuration Flow

```
Nerve/.env (BACKUP_NAS_*, BACKUP_LOCAL_* vars)
    ↓
backup-openclaw-to-nas.sh (reads via grep)
    ↓
server/routes/backups.ts (GET /api/backups → BackupsPanel.tsx)
BackupsSettings.tsx (save → Nerve/.env)
```

---

## Retention Rules

| Backup Type | Retention | Config Var |
|---|---|---|
| Local | 7 days | `BACKUP_RETENTION_DAYS` |
| NAS | 21 days | hardcoded in script |

---

## Status Indicators

**Header badge (overall):**
- **All Healthy (green):** Both Local and NAS backups exist for today
- **Issues Detected (red):** One or both backups missing today

**Section badge (per backup):**
- **Healthy (green):** Backup exists and is less than 24 hours old
- **Unhealthy (red):** No backup found or older than 24 hours

**Calendar:**
- **Green cell:** Backup(s) exist on that day
- **Gray cell:** No backup on that day

---

## Dependencies

- `openclaw` CLI — used by `backup-openclaw-native.sh`
- `smbclient` — used by NAS backup script
- `crontab` — scheduling
