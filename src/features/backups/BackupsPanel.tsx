/**
 * BackupsPanel — Full-page backup dashboard
 * Each backup has its own 14-day history calendar + file list
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { HardDrive, RefreshCw, Clock, Trash2, Download, Shield, Server, AlertTriangle, Check, X, FolderOpen } from 'lucide-react';

interface BackupFile {
  name: string;
  path?: string;
  size: number;
  sizeFormatted: string;
  modified: string;
  type: string;
  backupType?: 'full' | 'incremental';
  dayOfWeek?: string;
}

interface BackupSection {
  backupDir: string;
  backups: BackupFile[];
  totalSpace: string;
  count: number;
  lastBackup: string | null;
  type: string;
  purpose: string;
}

interface BackupStatus {
  local: BackupSection;
  nas: BackupSection;
  missedBackups: string[];
  schedule: { time: string; frequency: string; script: string; purpose: string }[];
  backupCount: number;
  totalSpace: string;
  hasBackups: boolean;
}

type TabId = 'local' | 'nas';
type DayStatus = 'success' | 'missed' | 'none';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);
  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return formatDate(dateStr);
}

function shortDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function isToday(dateStr: string): boolean {
  return dateStr === new Date().toISOString().slice(0, 10);
}

function getDayOfWeekShort(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2);
}

// Build 14-day calendar from backups array
function buildCalendar(backups: BackupFile[]): { date: string; status: DayStatus; count: number }[] {
  const today = new Date();
  const calendar: { date: string; status: DayStatus; count: number }[] = [];

  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const onDay = backups.filter(b => b.modified.slice(0, 10) === dateStr);

    calendar.push({
      date: dateStr,
      status: onDay.length > 0 ? 'success' : 'none',
      count: onDay.length,
    });
  }

  return calendar;
}

function dayBgColor(status: DayStatus, isToday: boolean): string {
  if (isToday) {
    switch (status) {
      case 'success': return 'bg-green text-white ring-1 ring-green';
      case 'missed': return 'bg-yellow-500 text-black';
      case 'none': return 'bg-primary/30 text-primary border border-primary/40';
    }
  }
  switch (status) {
    case 'success': return 'bg-green text-white';
    case 'missed': return 'bg-yellow-500 text-black';
    case 'none': return 'bg-muted text-muted-foreground';
  }
}

function dayLabel(status: DayStatus, count: number): string {
  if (status === 'success') return count > 1 ? `${count}` : '✓';
  return '';
}

export function BackupsPanel() {
  const [data, setData] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('nas');
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const resp = await fetch('/api/backups');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      setData(json);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDownload = useCallback((entry: BackupFile) => {
    window.open(`/api/backups/${encodeURIComponent(entry.name)}`, '_blank');
  }, []);

  const handleDelete = useCallback(async (entry: BackupFile) => {
    if (!confirm(`Delete "${entry.name}"? This cannot be undone.`)) return;
    setDeleting(entry.name);
    try {
      const resp = await fetch(`/api/backups/${encodeURIComponent(entry.name)}`, { method: 'DELETE' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      fetchData();
    } catch (err) {
      alert(`Delete failed: ${err}`);
    } finally {
      setDeleting(null);
    }
  }, [fetchData]);

  const localSection = data?.local;
  const nasSection = data?.nas;
  const localHistory = useMemo(() => localSection ? localSection.backups.filter(b => new Date(b.modified) >= new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)) : [], [localSection]);
  const nasHistory = useMemo(() => nasSection ? nasSection.backups.filter(b => new Date(b.modified) >= new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)) : [], [nasSection]);
  const currentSection = activeTab === 'local' ? localSection : nasSection;
  const currentHistory = activeTab === 'local' ? localHistory : nasHistory;
  const currentCalendar = useMemo(() => buildCalendar(currentSection?.backups || []), [currentSection]);
  const successCount = currentCalendar.filter(d => d.status === 'success').length;

  const isOk = (section: BackupSection | undefined) => {
    if (!section?.lastBackup) return false;
    return new Date(section.lastBackup) > new Date(Date.now() - 24 * 60 * 60 * 1000);
  };

  // Overall health: both configured backups ran today (within 24h)
  const overallHealthy = useMemo(() => {
    if (!data) return true;
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const hasLocalToday = data.local.backups.some(b => b.modified.slice(0, 10) === todayStr);
    const hasNasToday = data.nas.backups.some(b => b.modified.slice(0, 10) === todayStr);
    return hasLocalToday && hasNasToday;
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="panel-header border-l-[3px] border-l-primary flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="panel-label text-primary">
            <span className="panel-diamond">◆</span>
            BACKUPS
          </span>
          {data && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[0.6rem] font-semibold ${
              overallHealthy ? 'bg-green/20 text-green' : 'bg-destructive/20 text-destructive'
            }`}>
              {overallHealthy ? '● All Healthy' : '● Issues Detected'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data?.schedule && data.schedule.length > 0 && (
            <span className="text-[0.6rem] text-muted-foreground mr-2 hidden md:inline">
              {data.schedule.map(e => `${e.time}`).join(' · ')}
            </span>
          )}
          <button onClick={fetchData} className="shell-icon-button h-8 w-8 p-0" aria-label="Refresh">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 text-destructive text-xs border-b border-border/40 flex items-center gap-2">
          <AlertTriangle size={12} />{error}
        </div>
      )}

      {/* Missed Backups Warning */}
      {data?.missedBackups && data.missedBackups.length > 0 && (
        <div className="mx-4 mt-3 mb-3 p-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={12} className="text-yellow-500 shrink-0" />
            <span className="text-[0.667rem] font-semibold text-yellow-500">Missed Backups</span>
          </div>
          {data.missedBackups.map((msg, i) => (
            <p key={i} className="text-[0.6rem] text-yellow-600 font-medium">{msg}</p>
          ))}
        </div>
      )}

      {/* Backup Tabs */}
      <div className="flex border-b border-border/40 shrink-0">
        <button
          onClick={() => setActiveTab('nas')}
          className={`flex-1 flex flex-col items-center gap-0.5 py-3 px-2 transition-colors border-b-2 ${
            activeTab === 'nas' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <HardDrive size={11} />
            <span className="text-[0.7rem] font-semibold">NAS Offsite</span>
            {isOk(nasSection) ? <Check size={9} className="text-green" /> : <X size={9} className="text-destructive" />}
          </div>
          <span className="text-[0.6rem] text-muted-foreground">
            {nasSection?.count || 0} files · {nasSection?.totalSpace || '0B'}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('local')}
          className={`flex-1 flex flex-col items-center gap-0.5 py-3 px-2 transition-colors border-b-2 ${
            activeTab === 'local' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <Server size={11} />
            <span className="text-[0.7rem] font-semibold">Local CLI</span>
            {isOk(localSection) ? <Check size={9} className="text-green" /> : <X size={9} className="text-destructive" />}
          </div>
          <span className="text-[0.6rem] text-muted-foreground">
            {localSection?.count || 0} files · {localSection?.totalSpace || '0B'}
          </span>
        </button>
      </div>

      {/* Section Info + 14-day Calendar */}
      {currentSection && (
        <div className="px-4 py-3 border-b border-border/40 bg-primary/5 shrink-0">
          {/* Info bar + Healthy/Unhealthy badge */}
          <div className="flex items-center gap-3 text-[0.6rem] text-muted-foreground mb-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[0.6rem] font-semibold ${
              isOk(currentSection) ? 'bg-green/20 text-green' : 'bg-destructive/20 text-destructive'
            }`}>
              {isOk(currentSection) ? '● Healthy' : '● Unhealthy'}
            </span>
            <span>Last: <span className="text-foreground font-medium">{formatRelative(currentSection.lastBackup)}</span></span>
            <span>Last: <span className="text-foreground font-medium">{formatRelative(currentSection.lastBackup)}</span></span>
            <span>·</span>
            <span>{currentSection.purpose}</span>
            <span>·</span>
            <span className="text-primary/60 hidden md:inline">{currentSection.backupDir}</span>
            {activeTab === 'nas' && (
              <>
                <span className="ml-auto flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-green"></span>
                  <span className="text-[0.55rem]">Full (Sun)</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-blue-500"></span>
                  <span className="text-[0.55rem]">Incr (Mon-Sat)</span>
                </span>
              </>
            )}
          </div>

          {/* 14-Day Calendar for selected backup */}
          <div className="flex items-center gap-0.5">
            {currentCalendar.map((day) => (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-px min-w-0">
                <div
                  className={`w-full h-5 rounded flex items-center justify-center text-[0.6rem] font-bold ${dayBgColor(day.status, isToday(day.date))}`}
                  title={`${day.date}${day.status === 'success' ? ` — ${day.count} backup${day.count > 1 ? 's' : ''}` : ' — no backup'}`}
                >
                  {dayLabel(day.status, day.count)}
                </div>
                <span className="text-[0.45rem] text-muted-foreground leading-none">
                  {isToday(day.date) ? 'T' : getDayOfWeekShort(day.date)}
                </span>
              </div>
            ))}
          </div>

          {/* Calendar legend */}
          <div className="flex items-center gap-3 mt-1 text-[0.55rem] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-green/80 flex items-center justify-center text-white text-[0.5rem] font-bold">✓</span>
              Success
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-primary/20 border border-primary/30 flex items-center justify-center text-primary text-[0.5rem]">T</span>
              Today
            </span>
            <span className="ml-auto text-[0.55rem]">
              {successCount}/{currentCalendar.length} days backed up
            </span>
          </div>
        </div>
      )}

      {/* File List */}
      <div className="flex-1 overflow-y-auto">
        {currentHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
            <FolderOpen size={24} className="opacity-30" />
            <p className="text-xs">No backups in last 14 days</p>
          </div>
        ) : (
          <div className="py-1">
            {currentHistory.map((entry) => (
              <div
                key={entry.name}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-background/50 transition-colors group"
              >
                <div className="shrink-0 w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                  <HardDrive size={12} className="text-primary/70" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-xs font-medium truncate text-foreground" title={entry.name}>
                      {entry.name}
                    </p>
                    {activeTab === 'nas' && 'backupType' in entry && entry.backupType && (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[0.55rem] font-medium ${
                        entry.backupType === 'full' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'
                      }`}>
                        {entry.backupType === 'full' ? 'Full' : 'Incr'}
                      </span>
                    )}
                    {activeTab === 'nas' && 'dayOfWeek' in entry && entry.dayOfWeek && (
                      <span className="text-[0.55rem] text-muted-foreground">{entry.dayOfWeek}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[0.6rem] text-muted-foreground mt-0.5">
                    <span className="flex items-center gap-0.5">
                      <Clock size={9} />
                      {formatRelative(entry.modified)}
                    </span>
                    <span>·</span>
                    <span>{entry.sizeFormatted}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleDownload(entry)}
                    className="shell-icon-button h-7 w-7 p-0"
                    title="Download"
                  >
                    <Download size={11} />
                  </button>
                  <button
                    onClick={() => handleDelete(entry)}
                    disabled={deleting === entry.name}
                    className="shell-icon-button h-7 w-7 p-0 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    title="Delete"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 px-4 py-2 border-t border-border/40 text-[0.6rem] text-muted-foreground flex items-center gap-2">
        <Shield size={9} />
        {data?.hasBackups
          ? `${data.backupCount} backups · ${data.totalSpace} total`
          : 'No backups found — scheduled backups run automatically'}
      </div>
    </div>
  );
}
