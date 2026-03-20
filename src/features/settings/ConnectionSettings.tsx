import { useState } from 'react';
import { RefreshCw, Eye, EyeOff, RotateCw } from 'lucide-react';
import { DEFAULT_GATEWAY_WS } from '@/lib/constants';

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

const STATUS_COLORS: Record<string, string> = {
  connected: 'bg-green',
  connecting: 'bg-orange animate-pulse',
  reconnecting: 'bg-orange animate-pulse',
  disconnected: 'bg-red',
};

const STATUS_LABELS: Record<string, string> = {
  connected: 'Connected',
  connecting: 'Connecting...',
  reconnecting: 'Reconnecting...',
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

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <span className="cockpit-kicker">
          <span className="text-primary">◆</span>
          Gateway
        </span>
      </div>

      {/* Status indicator */}
      <div className="cockpit-row">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_COLORS[connectionState]}`} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Gateway status</p>
            <p className="text-xs text-muted-foreground">{STATUS_LABELS[connectionState]}</p>
          </div>
        </div>
        <button
          onClick={onReconnect}
          disabled={connectionState === 'connecting' || connectionState === 'reconnecting'}
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

      {/* Auth Token */}
      <label className="cockpit-field">
        <span className="cockpit-field-label">Auth Token</span>
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
            className="cockpit-toolbar-button absolute right-2 top-1/2 min-h-8 -translate-y-1/2 px-2.5"
            title={showToken ? 'Hide token' : 'Show token'}
          >
            {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <span className="cockpit-field-hint">Leave blank for unsecured local development.</span>
      </label>
      {/* Gateway Service */}
      {onGatewayRestart && (
        <>
          <div className="cockpit-divider my-2" />
          <div className="cockpit-row">
            <div className="min-w-0 flex-1">
              <span className="cockpit-kicker text-[0.6rem]">
                <span className="text-primary">◆</span>
                Gateway Service
              </span>
              <p className="mt-2 text-sm font-medium text-foreground">Restart the local gateway</p>
              <p className="mt-1 text-xs text-muted-foreground">
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
              {gatewayRestarting ? 'Restarting...' : 'Restart'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
