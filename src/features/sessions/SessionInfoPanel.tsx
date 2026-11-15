import { memo, useState, useRef, useEffect, useCallback } from 'react';
import type { Session } from '@/types';
import { getSessionKey } from '@/types';
import { fmtK } from '@/lib/formatting';
import { cn } from '@/lib/utils';
import { Pane } from '@/components/ui/Pane';
import { paneStateFor, paneStateLabel } from '@/lib/paneState';
import { getSessionType } from './sessionTree';

/* ─── Helpers ────────────────────────────────────────────────────── */

function relativeTime(timestamp: number | string | undefined): string {
  if (!timestamp) return 'unknown';
  const ms =
    typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp;
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function tokenPct(used: number | undefined, max: number | undefined): number {
  if (!used || !max || max === 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

/* ─── Types ──────────────────────────────────────────────────────── */

interface SessionInfoPanelProps {
  session: Session;
  running?: boolean;
  children: React.ReactNode;
}

/* ─── Row sub-component ──────────────────────────────────────────── */

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  /** Measurements (token counts, times) set in mono with tabular figures. */
  mono?: boolean;
}) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-3">
      <span className="shrink-0 text-[0.8rem] text-muted-foreground">
        {label}
      </span>
      <span className={cn(
        'truncate text-right text-[0.8rem] text-foreground',
        mono && 'font-mono tabular',
      )}>
        {value}
      </span>
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────── */

/** Detail panel showing metadata for the selected session. */
export const SessionInfoPanel = memo(function SessionInfoPanel({
  session,
  running: runningProp,
  children,
}: SessionInfoPanelProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const handleEnter = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = setTimeout(() => setOpen(true), 500);
  }, []);

  const handleLeave = useCallback(() => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }, []);

  /* For cron/subagent sessions, resolve the actual model used */
  const [actualModel, setActualModel] = useState<string | null>(null);
  const sessionKey = getSessionKey(session);
  const sessionType = getSessionType(sessionKey);

  useEffect(() => {
    if (!open) return;
    if (sessionType === 'main') return;

    let cancelled = false;

    if (sessionType === 'cron') {
      // Cron parent: extract jobId from key, look up cron job for payload.model
      const jobIdMatch = sessionKey.match(/:cron:([^:]+)$/);
      if (jobIdMatch) {
        fetch('/api/crons')
          .then(r => r.json())
          .then((data: { ok: boolean; result?: { jobs?: Array<{ id: string; payload?: { model?: string } }>; details?: { jobs?: Array<{ id: string; payload?: { model?: string } }> } } }) => {
            if (cancelled || !data.ok) return;
            const jobs = data.result?.jobs || data.result?.details?.jobs || [];
            const job = jobs.find(j => j.id === jobIdMatch[1]);
            if (job?.payload?.model) setActualModel(job.payload.model);
          })
          .catch(() => { /* ignore */ });
      }
    } else {
      // Cron-run or subagent: read model from transcript
      const parts = sessionKey.split(':');
      const sessionId = parts[parts.length - 1];
      if (sessionId && /^[0-9a-f-]{36}$/.test(sessionId)) {
        fetch(`/api/sessions/${sessionId}/model`)
          .then(r => r.json())
          .then((data: { ok: boolean; model?: string | null; missing?: boolean }) => {
            if (cancelled || !data.ok) return;
            if (data.model != null) setActualModel(data.model);
          })
          .catch(() => { /* ignore */ });
      }
    }

    return () => { cancelled = true; };
  }, [open, sessionKey, sessionType]);

  /* Cleanup timers on unmount */
  useEffect(() => {
    return () => {
      if (openTimer.current) clearTimeout(openTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  /* Derived values */
  const model = actualModel ?? session.model ?? 'unknown';
  const thinking = session.thinking ?? session.thinkingLevel;
  const totalTok = session.totalTokens;
  const ctxTok = session.contextTokens ?? 200_000;
  const pct = tokenPct(totalTok, ctxTok);
  const running = runningProp ??
    (session.state === 'running' ||
    session.agentState === 'running' ||
    session.busy === true ||
    session.processing === true);
  const paneState = paneStateFor({ running });
  const status = paneStateLabel(paneState);
  const lastActive = session.updatedAt ?? session.lastActivity;

  return (
    <div
      className="relative flex-1 min-w-0"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {/* Trigger */}
      <div className="cursor-default min-w-0 overflow-hidden">
        {children}
      </div>

      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          className="pointer-events-none absolute left-0 top-full z-50 mt-1 w-60 rounded-[3px] border border-border bg-popover text-popover-foreground shadow-[0_12px_32px_rgba(0,0,0,0.32)]"
        >
          <div className="px-3 py-2">
            {/* Model */}
            <InfoRow label="Model" value={model} />

            {/* Thinking */}
            {thinking && <InfoRow label="Thinking" value={thinking} />}

            {/* Tokens with a 2px context track (real data, neutral) */}
            <div className="pb-1">
              <InfoRow
                label="Tokens"
                mono
                value={`${totalTok != null ? fmtK(totalTok) : 'n/a'} / ${fmtK(ctxTok)} (${pct}%)`}
              />
              <div className="h-[2px] w-full overflow-hidden rounded-[1px] bg-border" aria-hidden="true">
                <div className="h-full bg-muted-foreground" style={{ width: `${pct}%` }} />
              </div>
            </div>

            {/* Input / Output breakdown */}
            {(session.inputTokens != null ||
              session.outputTokens != null) && (
              <InfoRow
                label="In / out"
                mono
                value={`${session.inputTokens != null ? fmtK(session.inputTokens) : 'n/a'} / ${session.outputTokens != null ? fmtK(session.outputTokens) : 'n/a'}`}
              />
            )}

            {/* Last active */}
            <InfoRow label="Last active" value={relativeTime(lastActive)} />

            {/* Channel */}
            {session.channel && (
              <InfoRow label="Channel" value={session.channel} />
            )}

            {/* Status */}
            <div className="flex min-h-6 items-center justify-between gap-3">
              <span className="shrink-0 text-[0.8rem] text-muted-foreground">
                Status
              </span>
              <span
                className={cn(
                  'flex items-center gap-1.5 text-[0.8rem]',
                  running ? 'text-live-text' : 'text-muted-foreground',
                )}
              >
                <Pane state={paneState} size="sm" />
                {status}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
