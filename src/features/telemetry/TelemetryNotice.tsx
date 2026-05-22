import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { buildTelemetryNoticeDismissKey } from './telemetryNoticeStorage';

interface TelemetryNoticeProps {
  visible: boolean;
  mode: 'off' | 'minimal' | 'detailed';
  publicDocUrl: string;
  noticeId?: string;
}

function readDismissed(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) === 'true';
  } catch {
    return false;
  }
}

export function TelemetryNotice({ visible, mode, publicDocUrl, noticeId }: TelemetryNoticeProps) {
  const dismissStorageKey = useMemo(() => buildTelemetryNoticeDismissKey(noticeId), [noticeId]);
  const [dismissed, setDismissed] = useState(() => readDismissed(dismissStorageKey));

  useEffect(() => {
    setDismissed(readDismissed(dismissStorageKey));
  }, [dismissStorageKey]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissStorageKey, 'true');
    } catch {
      // ignore storage failures
    }
  }, [dismissStorageKey]);

  if (!visible || dismissed) return null;

  return (
    <div className="fixed left-1/2 top-28 z-40 flex max-w-[min(calc(100vw-1.067rem),48rem)] -translate-x-1/2 items-start gap-3 rounded-2xl border border-orange/25 bg-card/94 px-4 py-3 text-xs text-foreground shadow-[0_20px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-orange/10 text-orange">
        <AlertTriangle size={16} aria-hidden="true" />
      </span>
      <div className="min-w-0 space-y-1 leading-5">
        <p className="font-medium">This fresh install is using {mode} telemetry.</p>
        <p>
          Minimal telemetry sends heartbeat snapshots and scrubbed server-side error reports.{' '}
          <a
            href={publicDocUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2"
          >
            Read the public telemetry docs
          </a>
          .
        </p>
        <p className="text-muted-foreground">
          To disable telemetry entirely, set <code>NERVE_TELEMETRY_MODE=off</code> in <code>.env</code> and restart Nerve.
        </p>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Dismiss telemetry notice"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
