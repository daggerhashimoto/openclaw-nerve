/**
 * Cron Calendar Component
 *
 * Displays scheduled cron jobs on a calendar view.
 */

import { useState, useMemo } from 'react';
import { Calendar as CalendarIcon, Clock, Repeat } from 'lucide-react';

interface CronJob {
  name: string;
  agent: string;
  schedule: string;
  enabled: boolean;
  task: string;
}

interface CronCalendarProps {
  crons?: CronJob[];
}

/**
 * Parse cron expression and return next run times
 * Simplified parser for common patterns
 */
function parseCronExpression(expression: string): string {
  const parts = expression.split(' ');
  if (parts.length !== 5) return expression;

  const [minute, hour, day, month, weekday] = parts;

  // Common patterns
  if (minute === '0' && hour === '*' && day === '*' && month === '*') {
    return 'Every hour';
  }
  if (minute === '0' && hour.startsWith('*/') && day === '*') {
    return `Every ${hour.slice(2)} hours`;
  }
  if (minute === '0' && hour === '23' && day === '*') {
    return 'Daily at 11:00 PM';
  }
  if (minute === '0' && hour === '*' && weekday === '*') {
    return 'Hourly';
  }

  return expression;
}

export function CronCalendar({ crons = [] }: CronCalendarProps) {
  const [view, setView] = useState<'day' | 'week' | 'month'>('week');

  // Sample cron jobs (in production, fetch from API)
  const defaultCrons: CronJob[] = useMemo(() => [
    {
      name: 'Hourly Research Report',
      agent: 'ATLAS',
      schedule: '0 * * * *',
      enabled: true,
      task: 'Generate research report',
    },
    {
      name: 'Trend Scouting',
      agent: 'TRENDY',
      schedule: '0 */2 * * *',
      enabled: true,
      task: 'Scan trends',
    },
    {
      name: 'Content Drafting',
      agent: 'SCRIBE',
      schedule: '0 */3 * * *',
      enabled: true,
      task: 'Draft content',
    },
    {
      name: 'Health Check',
      agent: 'SENTINEL',
      schedule: '0 */2 * * *',
      enabled: true,
      task: 'Code health scan',
    },
    {
      name: 'Nightly Development',
      agent: 'CODEX',
      schedule: '0 23 * * *',
      enabled: true,
      task: 'Feature development',
    },
  ], []);

  const jobs = crons.length > 0 ? crons : defaultCrons;

  // Group jobs by frequency
  const hourlyJobs = jobs.filter(j => j.schedule.includes('* *'));
  const dailyJobs = jobs.filter(j => j.schedule === '0 23 * * *');
  const customJobs = jobs.filter(j => !j.schedule.includes('* *') && j.schedule !== '0 23 * * *');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-5 h-5 text-muted-foreground" />
          <h3 className="font-semibold">Cron Schedule</h3>
        </div>
        <div className="flex gap-2">
          {(['day', 'week', 'month'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 text-xs rounded-md ${
                view === v
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground'
              }`}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Current date */}
      <div className="text-sm text-muted-foreground">
        {new Date().toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        })}
      </div>

      {/* Schedule by frequency */}
      <div className="space-y-4">
        {/* Hourly Jobs */}
        {hourlyJobs.length > 0 && (
          <div className="border rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Repeat className="w-4 h-4" />
              Hourly
            </div>
            {hourlyJobs.map((job, idx) => (
              <div
                key={idx}
                className={`flex items-center justify-between p-2 rounded-md text-sm ${
                  job.enabled ? 'bg-secondary/50' : 'bg-secondary/20 opacity-60'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <div className="font-medium">{job.name}</div>
                    <div className="text-xs text-muted-foreground">{job.task}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono bg-background px-2 py-1 rounded">
                    {parseCronExpression(job.schedule)}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded ${
                    job.enabled ? 'bg-green-500/20 text-green-600' : 'bg-gray-500/20 text-gray-600'
                  }`}>
                    {job.agent}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Daily Jobs */}
        {dailyJobs.length > 0 && (
          <div className="border rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CalendarIcon className="w-4 h-4" />
              Daily
            </div>
            {dailyJobs.map((job, idx) => (
              <div
                key={idx}
                className={`flex items-center justify-between p-2 rounded-md text-sm ${
                  job.enabled ? 'bg-secondary/50' : 'bg-secondary/20 opacity-60'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <div className="font-medium">{job.name}</div>
                    <div className="text-xs text-muted-foreground">{job.task}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono bg-background px-2 py-1 rounded">
                    {parseCronExpression(job.schedule)}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded ${
                    job.enabled ? 'bg-green-500/20 text-green-600' : 'bg-gray-500/20 text-gray-600'
                  }`}>
                    {job.agent}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Custom Jobs */}
        {customJobs.length > 0 && (
          <div className="border rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Clock className="w-4 h-4" />
              Custom Schedule
            </div>
            {customJobs.map((job, idx) => (
              <div
                key={idx}
                className={`flex items-center justify-between p-2 rounded-md text-sm ${
                  job.enabled ? 'bg-secondary/50' : 'bg-secondary/20 opacity-60'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <div className="font-medium">{job.name}</div>
                    <div className="text-xs text-muted-foreground">{job.task}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono bg-background px-2 py-1 rounded">
                    {job.schedule}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded ${
                    job.enabled ? 'bg-green-500/20 text-green-600' : 'bg-gray-500/20 text-gray-600'
                  }`}>
                    {job.agent}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="text-xs text-muted-foreground text-center">
        {jobs.filter(j => j.enabled).length} of {jobs.length} cron jobs enabled
      </div>
    </div>
  );
}
