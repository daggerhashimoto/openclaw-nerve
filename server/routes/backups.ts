/**
 * GET /api/backups — List available backups + status + calendar
 * GET /api/backups/:name — Download a specific backup archive
 * DELETE /api/backups/:name — Delete a specific backup archive
 * GET /api/backups/status — Read/write backup run status JSON
 */

import { Hono } from 'hono';
import { statSync, createReadStream, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { readdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const app = new Hono();

const HOME = process.env.HOME || '/home/najef';
const STATUS_FILE = join(HOME, 'Backups', 'backup-status.json');

// ── Config ──────────────────────────────────────────────────────────────────

function env(key: string, fallback = ''): string {
  return process.env[key] || fallback;
}

function getBackupDirs(): { name: string; path: string }[] {
  const localDir = env('BACKUP_LOCAL_DIR', '~/Backups').replace('~', HOME);
  return [
    { name: 'Local Backups', path: localDir },
  ];
}

// ── Backup Entry ───────────────────────────────────────────────────────────

interface BackupEntry {
  name: string;
  path: string;
  size: number;
  sizeFormatted: string;
  modified: string;
  type: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

function formatBytes(bytes: number): string {
  return formatSize(bytes);
}

function scanDir(name: string, dirPath: string): BackupEntry[] {
  const entries: BackupEntry[] = [];
  try {
    const files = readdirSync(dirPath, { withFileTypes: true });
    for (const file of files) {
      // Skip nas-sync subdirectory — those are NAS cache files, not local backups
      if (file.name === 'nas-sync') continue;
      if (file.isFile() && (file.name.endsWith('.tar.gz') || file.name.endsWith('.gz') || file.name.endsWith('.zip'))) {
        try {
          const fullPath = join(dirPath, file.name);
          const st = statSync(fullPath);
          entries.push({
            name: file.name,
            path: fullPath,
            size: st.size,
            sizeFormatted: formatSize(st.size),
            modified: st.mtime.toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).replace(' ', 'T'),
            type: name,
          });
        } catch { /* skip unreadable */ }
      } else if (file.isDirectory() && !file.name.startsWith('.')) {
        entries.push(...scanDir(name, join(dirPath, file.name)));
      }
    }
  } catch { /* dir doesn't exist */ }
  return entries;
}

// ── NAS listing ───────────────────────────────────────────────────────────────

interface NasEntry {
  name: string;
  size: number;
  sizeFormatted: string;
  modified: string;
  type: 'full' | 'incremental';
  dayOfWeek: string;
}

function getDayOfWeek(dateStr: string): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const date = new Date(dateStr + 'T12:00:00');
  return days[date.getDay()];
}

function getNasBackups(): NasEntry[] {
  const entries: NasEntry[] = [];

  // Always scan local NAS cache if it exists
  const cacheDir = join(HOME, 'Backups', 'nas-sync');
  try {
    const files = readdirSync(cacheDir);
    for (const file of files) {
      if (file.endsWith('.tar.gz') || file.endsWith('.gz')) {
        const fullPath = join(cacheDir, file);
        const st = statSync(fullPath);
        const isFull = file.startsWith('full-');
        const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})/);
        const dateStr = dateMatch ? dateMatch[1] : st.mtime.toISOString().slice(0, 10);
        entries.push({
          name: file,
          size: st.size,
          sizeFormatted: formatSize(st.size),
          modified: st.mtime.toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).replace(' ', 'T'),
          type: isFull ? 'full' : 'incremental',
          dayOfWeek: getDayOfWeek(dateStr),
        });
      }
    }
  } catch { /* cache dir doesn't exist or empty */ }

  // If NAS is enabled, also try SSH listing for remote files
  const enabled = env('BACKUP_NAS_ENABLED') === 'true';
  if (enabled) {
    const host = env('BACKUP_NAS_HOST');
    const user = env('BACKUP_NAS_USER');
    const remotePath = env('BACKUP_NAS_BACKUP_PATH');
    if (host && user && remotePath) {
      try {
        const sshCmd = `ssh -o BatchMode=yes -o StrictHostKeyChecking=no ${user}@${host} "ls -la --time-style=long-iso '${remotePath}'" 2>/dev/null`;
        const output = execSync(sshCmd, { encoding: 'utf8', timeout: 15000 });
        const lines = output.split('\n');
        for (const line of lines) {
          const match = line.match(/^[^-\s][^ ]+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(.+)$/);
          if (match) {
            const [, sizeStr, date, time, name] = match;
            const size = parseInt(sizeStr, 10);
            if (name.endsWith('.tar.gz') || name.endsWith('.gz') || name.endsWith('.zip')) {
              const isFull = name.startsWith('full-');
              entries.push({
                name: name.trim(),
                size,
                sizeFormatted: formatSize(size),
                modified: `${date}T${time}:00`,
                type: isFull ? 'full' : 'incremental',
                dayOfWeek: getDayOfWeek(date),
              });
            }
          }
        }
      } catch { /* SSH failed — local cache is still valid */ }
    }
  }

  entries.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  return entries;
}

// ── Calendar computation ─────────────────────────────────────────────────────

interface CalendarDay {
  date: string;  // YYYY-MM-DD
  local: 'success' | 'failed' | 'missed' | 'none';
  nas: 'success' | 'failed' | 'missed' | 'none';
}

function getCalendar(): { days: CalendarDay[]; missedBackups: string[] } {
  const missed: string[] = [];
  const today = new Date();
  const days: CalendarDay[] = [];

  // Use local timezone (Europe/Amsterdam) for date comparisons
  const localToday = new Date(today.toLocaleString('en-GB', { timeZone: 'Europe/Amsterdam' }));

  const localBackups = scanDir('Local Backups', env('BACKUP_LOCAL_DIR', '~/Backups').replace('~', HOME));
  const nasBackups = getNasBackups();

  for (let i = 13; i >= 0; i--) {
    const d = new Date(localToday);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);

    const localOnDay = localBackups.filter(e => e.modified.slice(0, 10) === dateStr);
    const nasOnDay = nasBackups.filter(e => e.modified.slice(0, 10) === dateStr);

    const localStatus: CalendarDay['local'] = !env('BACKUP_LOCAL_ENABLED') ? 'none'
      : localOnDay.length > 0 ? 'success'
      : 'none';

    const nasStatus: CalendarDay['nas'] = nasOnDay.length > 0 ? 'success' : 'none';

    // Missed detection for today
    if (i === 0 && env('BACKUP_LOCAL_ENABLED')) {
      const schedule = env('BACKUP_LOCAL_SCHEDULE', '0 1 * * *');
      const parts = schedule.split(' ');
      const scheduleHour = parseInt(parts[1]);
      const scheduleMin = parseInt(parts[0]);
      const now = new Date();
      if (now.getHours() > scheduleHour || (now.getHours() === scheduleHour && now.getMinutes() > scheduleMin + 5)) {
        if (localStatus === 'none' && nasStatus === 'none') {
          missed.push(`Local backup missed — scheduled ${String(scheduleHour).padStart(2,'0')}:${String(scheduleMin).padStart(2,'0')} but no backup found`);
        } else if (localStatus === 'none') {
          missed.push(`Local backup missed — NAS backup ran but local backup not found`);
        }
      }
    }

    days.push({ date: dateStr, local: localStatus, nas: nasStatus });
  }

  return { days, missedBackups: missed };
}

// ── Crontab reading ─────────────────────────────────────────────────────────

interface CronEntry {
  time: string;
  frequency: string;
  script: string;
  purpose: string;
}

function getCrontab(): CronEntry[] {
  try {
    const output = execSync('crontab -l 2>/dev/null || true', { encoding: 'utf8' });
    const entries: CronEntry[] = [];
    if (output.includes('backup-openclaw-native')) entries.push({ time: '01:00 CET', frequency: 'Daily', script: 'backup-openclaw-native.sh', purpose: 'Local backup' });
    if (output.includes('backup-openclaw-to-nas')) entries.push({ time: '01:30 CET', frequency: 'Daily', script: 'backup-openclaw-to-nas.sh', purpose: 'NAS backup' });
    return entries;
  } catch { return []; }
}

// ── Routes ─────────────────────────────────────────────────────────────────

app.get('/', async (c) => {
  const dirs = getBackupDirs();
  const allEntries: BackupEntry[] = [];
  for (const dir of dirs) {
    allEntries.push(...scanDir(dir.name, dir.path));
  }
  allEntries.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  const nasEntries = getNasBackups();
  nasEntries.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  const localEntries = allEntries.filter(e => e.type === 'Local Backups');

  const localSize = localEntries.reduce((sum, e) => sum + e.size, 0);
  const nasSize = nasEntries.reduce((sum, e) => sum + e.size, 0);

  const { days, missedBackups } = getCalendar();

  return c.json({
    local: {
      backupDir: env('BACKUP_LOCAL_DIR', '~/Backups'),
      backups: localEntries,
      totalSpace: formatBytes(localSize),
      count: localEntries.length,
      lastBackup: localEntries[0]?.modified || null,
      type: 'Local',
      purpose: 'Local verified backups',
    },
    nas: {
      backupDir: '~/Backups/nas-sync',
      backups: nasEntries.map(e => ({
        name: e.name,
        size: e.size,
        sizeFormatted: e.sizeFormatted,
        modified: e.modified,
        path: '',
        type: 'NAS Backups',
        backupType: e.type,
        dayOfWeek: e.dayOfWeek,
      })),
      totalSpace: formatBytes(nasSize),
      count: nasEntries.length,
      lastBackup: nasEntries[0]?.modified || null,
      type: 'NAS',
      purpose: 'NAS offsite backup',
    },
    calendar: days,
    missedBackups,
    schedule: getCrontab(),
    backupCount: localEntries.length + nasEntries.length,
    totalSpace: formatBytes(localSize + nasSize),
    hasBackups: localEntries.length > 0 || nasEntries.length > 0,
  });
});

app.get('/status', async (c) => {
  try {
    if (existsSync(STATUS_FILE)) {
      return c.json(JSON.parse(readFileSync(STATUS_FILE, 'utf8')));
    }
  } catch { /* ignore */ }
  return c.json({ local: { runs: [], lastRun: null, lastStatus: null }, nas: { runs: [], lastRun: null, lastStatus: null } });
});

app.get('/:name', async (c) => {
  const name = c.req.param('name');
  const dirs = getBackupDirs();
  for (const dir of dirs) {
    const entries = scanDir(dir.name, dir.path);
    const entry = entries.find(e => e.name === name);
    if (entry) {
      const fileName = basename(entry.path);
      c.header('Content-Disposition', `attachment; filename="${fileName}"`);
      c.header('Content-Type', 'application/gzip');
      return c.body(createReadStream(entry.path));
    }
  }
  return c.json({ error: 'Backup not found' }, 404);
});

app.delete('/:name', async (c) => {
  const name = c.req.param('name');
  const dirs = getBackupDirs();
  for (const dir of dirs) {
    const entries = scanDir(dir.name, dir.path);
    const entry = entries.find(e => e.name === name);
    if (entry) {
      try { rmSync(entry.path, { force: true }); } catch { /* ignore */ }
      return c.json({ success: true, deleted: name });
    }
  }
  return c.json({ error: 'Backup not found' }, 404);
});

export default app;
