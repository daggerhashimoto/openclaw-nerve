/**
 * BackupsSettings — Backup configuration panel
 * Shows current backup configuration and explains how to change each setting.
 * Configuration is stored in .env — see docs/BACKUPS_FEATURE.md for details.
 */

import { useState, useEffect } from 'react';
import { HardDrive, Server, Database, Github, Calendar, RefreshCw, ExternalLink, AlertTriangle, Check, X, Shield } from 'lucide-react';

interface BackupEnvConfig {
  BACKUP_LOCAL_ENABLED: boolean;
  BACKUP_LOCAL_DIR: string;
  BACKUP_RETENTION_DAYS: number;
  BACKUP_LOCAL_SCHEDULE: string;
  BACKUP_NAS_ENABLED: boolean;
  BACKUP_NAS_HOST: string;
  BACKUP_NAS_USER: string;
  BACKUP_NAS_BACKUP_PATH: string;
  BACKUP_NAS_RETENTION_DAYS: number;
  BACKUP_GITHUB_ENABLED: boolean;
  BACKUP_GITHUB_REPO: string;
  BACKUP_GITHUB_BRANCH: string;
  BACKUP_GITHUB_PATH: string;
}

const DEFAULT_CONFIG: BackupEnvConfig = {
  BACKUP_LOCAL_ENABLED: true,
  BACKUP_LOCAL_DIR: '~/Backups',
  BACKUP_RETENTION_DAYS: 7,
  BACKUP_LOCAL_SCHEDULE: '0 1 * * *',
  BACKUP_NAS_ENABLED: false,
  BACKUP_NAS_HOST: '',
  BACKUP_NAS_USER: '',
  BACKUP_NAS_BACKUP_PATH: '',
  BACKUP_NAS_RETENTION_DAYS: 30,
  BACKUP_GITHUB_ENABLED: false,
  BACKUP_GITHUB_REPO: '',
  BACKUP_GITHUB_BRANCH: 'main',
  BACKUP_GITHUB_PATH: 'backups',
};

interface SettingRowProps {
  label: string;
  value: string;
  description?: string;
  isPath?: boolean;
}

function SettingRow({ label, value, description, isPath }: SettingRowProps) {
  return (
    <div className="flex flex-col gap-0.5 py-2 border-b border-border/30 last:border-0">
      <div className="flex items-center justify-between">
        <span className="text-[0.667rem] text-muted-foreground">{label}</span>
        <code className={`text-[0.6rem] font-mono bg-background/80 px-1.5 py-0.5 rounded text-foreground/80 ${isPath ? 'text-primary/70' : ''}`}>
          {value || <span className="text-muted-foreground/50">not set</span>}
        </code>
      </div>
      {description && (
        <span className="text-[0.6rem] text-muted-foreground/60">{description}</span>
      )}
    </div>
  );
}

export function BackupsSettings() {
  const [config, setConfig] = useState<BackupEnvConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const resp = await fetch('/api/backups/config');
      if (resp.ok) {
        const data = await resp.json();
        const { BACKUP_NAS_PASSWORD, ...rest } = data;
        setConfig({ ...DEFAULT_CONFIG, ...rest });
      }
    } catch { /* ignore */ }
    setLoading(false);
    setLastRefresh(new Date());
  };

  return (
    <div className="flex flex-col gap-6 px-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Shield size={14} className="text-primary" />
            Backup Configuration
          </h2>
          <p className="text-[0.667rem] text-muted-foreground mt-0.5">
            All backup settings are stored in <code className="text-[0.6rem] font-mono bg-background/80 px-1 rounded">.env</code>.
            Restart the server after changing settings.
          </p>
        </div>
        <button
          onClick={fetchConfig}
          className="shell-icon-button h-8 w-8 p-0"
          title="Refresh configuration"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Info Banner */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
        <div className="flex items-start gap-2">
          <AlertTriangle size={12} className="text-primary/70 shrink-0 mt-0.5" />
          <div className="text-[0.6rem] text-muted-foreground leading-relaxed">
            Backup scripts are located in <code className="font-mono bg-background/80 px-1 rounded">~/.openclaw/workspace/scripts/</code>.
            Edit <code className="font-mono bg-background/80 px-1 rounded">.env</code> to change paths and schedules.
            See <code className="font-mono bg-background/80 px-1 rounded">docs/BACKUPS_FEATURE.md</code> for full documentation.
          </div>
        </div>
      </div>

      {/* 1. Local Backup */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center shrink-0">
            <Server size={11} className="text-primary" />
          </div>
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-foreground">1. Local Backup</h3>
            {config.BACKUP_LOCAL_ENABLED ? (
              <span className="flex items-center gap-0.5 text-[0.6rem] text-green">
                <Check size={9} /> Enabled
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-[0.6rem] text-destructive">
                <X size={9} /> Disabled
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-0 pl-7">
          <SettingRow
            label="Schedule"
            value={config.BACKUP_LOCAL_SCHEDULE}
            description="Cron expression — runs at 01:00 CET daily by default"
          />
          <SettingRow
            label="Destination"
            value={config.BACKUP_LOCAL_DIR}
            isPath
            description="Local directory for backup archives"
          />
          <SettingRow
            label="Retention"
            value={`${config.BACKUP_RETENTION_DAYS} days`}
            description="Old backups are automatically deleted after this period"
          />
        </div>
      </div>

      {/* 2. NAS Backup */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center shrink-0">
            <HardDrive size={11} className="text-primary" />
          </div>
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-foreground">2. NAS Backup (Optional)</h3>
            {config.BACKUP_NAS_ENABLED ? (
              <span className="flex items-center gap-0.5 text-[0.6rem] text-green">
                <Check size={9} /> Enabled
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-[0.6rem] text-muted-foreground">
                <X size={9} /> Disabled
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-0 pl-7">
          <SettingRow
            label="NAS Host"
            value={config.BACKUP_NAS_HOST || 'not configured'}
            description="Hostname or IP address of your NAS"
          />
          <SettingRow
            label="NAS Path"
            value={config.BACKUP_NAS_PATH || 'not configured'}
            isPath
            description="Absolute path on the NAS where backups are stored"
          />
          <SettingRow
            label="NAS User"
            value={config.BACKUP_NAS_USER || 'not configured'}
            description="SSH username (key-based auth — no password needed)"
          />
          <SettingRow
            label="NAS Retention"
            value={`${config.BACKUP_NAS_RETENTION_DAYS} days`}
            description="Days to keep backups on NAS"
          />
        </div>
      </div>

      {/* 3. GitHub Backup */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center shrink-0">
            <Github size={11} className="text-primary" />
          </div>
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-foreground">3. GitHub Backup (Optional)</h3>
            {config.BACKUP_GITHUB_ENABLED ? (
              <span className="flex items-center gap-0.5 text-[0.6rem] text-green">
                <Check size={9} /> Enabled
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-[0.6rem] text-muted-foreground">
                <X size={9} /> Disabled
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-0 pl-7">
          <SettingRow
            label="Repository"
            value={config.BACKUP_GITHUB_REPO || 'not configured'}
            description="GitHub repo in format: owner/repo-name"
          />
          <SettingRow
            label="Branch"
            value={config.BACKUP_GITHUB_BRANCH}
            description="Target branch for backup commits"
          />
          <SettingRow
            label="Path"
            value={config.BACKUP_GITHUB_PATH}
            isPath
            description="Path within the repo for backup files"
          />
        </div>
      </div>

      {/* Last refreshed */}
      <div className="text-[0.6rem] text-muted-foreground/50 text-right">
        Config loaded from .env · {lastRefresh.toLocaleTimeString()}
      </div>
    </div>
  );
}
