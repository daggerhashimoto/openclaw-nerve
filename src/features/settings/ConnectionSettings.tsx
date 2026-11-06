import { useState } from 'react';
import { RefreshCw, Eye, EyeOff, RotateCw } from 'lucide-react';
import { DEFAULT_GATEWAY_WS } from '@/lib/constants';
import { Pane } from '@/components/ui/Pane';
import type { PaneState } from '@/lib/paneState';

interface ConnectionSettingsProps {
  url: string;
  token: string;
  onUrlChange: (url: string) => void;
  onTokenChange: (token: string) => void;
  onReconnect: () => void;
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  onGatewayRestart?: () => void;
  gatewayRestarting?: boolean;
}

/* The gateway's pane follows the status bar: quiet when connected, cantaloupe while it is
   trying (the operator may need to act), red when the link is down. */
const STATUS_PANES: Record<ConnectionSettingsProps['connectionState'], PaneState> = {
  connected: 'off',
  connecting: 'operator',
  reconnecting: 'operator',
  disconnected: 'error',
};

const STATUS_LABELS: Record<string, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  disconnected: 'Disconnected',
};

/** Settings section for gateway URL, auth token, reconnection, and gateway restart. */
export function ConnectionSettings({
  url,
  token,
  onUrlChange,
  onTokenChange,
  onReconnect,
  connectionState,
  onGatewayRestart,
  gatewayRestarting = false,
}: ConnectionSettingsProps) {
  const [showToken, setShowToken] = useState(false);
  const busy = connectionState === 'connecting' || connectionState === 'reconnecting';

  return (
    <div className="space-y-4">
      <h3 className="settings-heading">Gateway</h3>

      {/* Status row */}
      <div className="settings-row">
        <div className="flex min-w-0 items-center gap-3">
          <Pane state={STATUS_PANES[connectionState]} label={STATUS_LABELS[connectionState]} />
          <div className="min-w-0">
            <p className="text-[0.867rem] font-medium text-foreground">Gateway status</p>
            <p className="text-[0.8rem] text-muted-foreground">{STATUS_LABELS[connectionState]}</p>
          </div>
        </div>
        <button
          onClick={onReconnect}
          disabled={busy}
          className="cockpit-toolbar-button w-full justify-center sm:ml-auto sm:w-auto"
          title="Reconnect to gateway"
        >
          <RefreshCw size={14} className={connectionState === 'reconnecting' ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Reconnect</span>
        </button>
      </div>

      {/* Gateway URL */}
      <label className="cockpit-field">
        <span className="cockpit-field-label">Gateway URL</span>
        <input
          type="text"
          value={url}
          onChange={e => onUrlChange(e.target.value)}
          spellCheck={false}
          className="cockpit-input cockpit-input-mono"
          placeholder={DEFAULT_GATEWAY_WS}
        />
        <span className="cockpit-field-hint">Use the local gateway or paste a remote relay endpoint.</span>
      </label>

      {/* Auth token */}
      <label className="cockpit-field">
        <span className="cockpit-field-label">Auth token</span>
        <div className="relative">
          <input
            type={showToken ? 'text' : 'password'}
            value={token}
            onChange={e => onTokenChange(e.target.value)}
            spellCheck={false}
            className="cockpit-input cockpit-input-mono pr-12"
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowToken(!showToken)}
            className="shell-icon-button absolute right-1 top-1/2 -translate-y-1/2"
            title={showToken ? 'Hide token' : 'Show token'}
            aria-label={showToken ? 'Hide token' : 'Show token'}
          >
            {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <span className="cockpit-field-hint">Leave blank for unsecured local development.</span>
      </label>

      {/* Gateway service */}
      {onGatewayRestart && (
        <>
          <h3 className="settings-heading pt-2">Gateway service</h3>
          <div className="settings-row">
            <div className="min-w-0 flex-1">
              <p className="text-[0.867rem] font-medium text-foreground">Restart the local gateway</p>
              <p className="text-[0.8rem] text-muted-foreground">
                Useful when pairing, models, or background workers need a clean reload.
              </p>
            </div>
            <button
              type="button"
              onClick={onGatewayRestart}
              disabled={gatewayRestarting}
              className="cockpit-toolbar-button w-full justify-center sm:w-auto"
            >
              <RotateCw size={14} aria-hidden="true" className={gatewayRestarting ? 'animate-spin' : ''} />
              {gatewayRestarting ? 'Restarting' : 'Restart'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
