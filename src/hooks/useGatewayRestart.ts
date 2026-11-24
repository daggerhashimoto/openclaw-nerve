import { useState, useCallback, useRef, useEffect } from 'react';

interface GatewayRestartNotice {
  ok: boolean;
  message: string;
}

/**
 * Hook that manages gateway restart UI state: confirmation dialog,
 * in-progress indicator, and success/error notice with auto-dismiss.
 */
export function useGatewayRestart() {
  const [showGatewayRestartConfirm, setShowGatewayRestartConfirm] = useState(false);
  const [gatewayRestarting, setGatewayRestarting] = useState(false);
  const [gatewayRestartNotice, setGatewayRestartNotice] = useState<GatewayRestartNotice | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up any pending dismiss timer on unmount.
  useEffect(() => () => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
  }, []);

  const handleGatewayRestart = useCallback(() => setShowGatewayRestartConfirm(true), []);
  const cancelGatewayRestart = useCallback(() => setShowGatewayRestartConfirm(false), []);
  
  const confirmGatewayRestart = useCallback(async () => {
    setShowGatewayRestartConfirm(false);
    setGatewayRestarting(true);
    setGatewayRestartNotice(null);
    try {
      const response = await fetch('/api/gateway/restart', { method: 'POST', credentials: 'include' });
      const data = await response.json().catch(() => null) as { ok?: boolean; output?: string; error?: string } | null;
      const notice = {
        ok: Boolean(response.ok && data?.ok),
        message: response.ok && data?.ok ? 'Gateway restarted successfully' : (data?.output || data?.error || 'Gateway restart failed'),
      };
      setGatewayRestartNotice(notice);
      // Auto-dismiss success notices after 6s, keep error notices until user dismisses
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      if (notice.ok) {
        dismissTimerRef.current = setTimeout(() => setGatewayRestartNotice(null), 6000);
      }
    } catch (err) {
      setGatewayRestartNotice({ ok: false, message: err instanceof Error ? err.message : 'Gateway restart failed' });
    } finally {
      setGatewayRestarting(false);
    }
  }, []);

  const dismissNotice = useCallback(() => setGatewayRestartNotice(null), []);

  return {
    showGatewayRestartConfirm,
    gatewayRestarting,
    gatewayRestartNotice,
    handleGatewayRestart,
    cancelGatewayRestart,
    confirmGatewayRestart,
    dismissNotice,
  };
}
