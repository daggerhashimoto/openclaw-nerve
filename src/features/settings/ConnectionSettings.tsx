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
  connected: 'CONNECTED',
  connecting: 'CONNECTING...',
  reconnecting: 'RECONNECTING...',
  disconnected: 'DISCONNECTED',
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
      <h3 className="text-[10px] font-bold tracking-[1.5px] uppercase text-muted-foreground flex items-center gap-2">
        <span className="text-primary">◆</span>
        CONNECTION
      </h3>

      {/* Status indicator */}
      <div className="flex items-center gap-2 px-3 py-2 bg-background border border-border/60">
        <span className={`w-2 h-2 shrink-0 ${STATUS_COLORS[connectionState]}`} />
        <span className="text-[11px] font-mono tracking-wide">{STATUS_LABELS[connectionState]}</span>
        <button
          onClick={onReconnect}
          disabled={connectionState === 'connecting' || connectionState === 'reconnecting'}
          className="ml-auto p-1 text-muted-foreground hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed"
          title="Reconnect"
        >
          <RefreshCw size={12} className={connectionState === 'reconnecting' ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Gateway URL */}
      <label className="flex flex-col gap-1.5">
        <span className="text-[10px] text-muted-foreground uppercase tracking-[1px]">Gateway URL</span>
        <input
          type="text"
          value={url}
          onChange={e => onUrlChange(e.target.value)}
          spellCheck={false}
          className="bg-background border border-border/60 px-3 py-2 text-[12px] font-mono text-foreground focus:border-primary outline-none"
          placeholder={DEFAULT_GATEWAY_WS}
        />
      </label>

      {/* Auth Token */}
      <label className="flex flex-col gap-1.5">
        <span className="text-[10px] text-muted-foreground uppercase tracking-[1px]">Auth Token</span>
        <div className="relative">
          <input
            type={showToken ? 'text' : 'password'}
            value={token}
            onChange={e => onTokenChange(e.target.value)}
            spellCheck={false}
            className="w-full bg-background border border-border/60 px-3 py-2 pr-10 text-[12px] font-mono text-foreground focus:border-primary outline-none"
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowToken(!showToken)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-primary"
          >
            {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </label>
      {/* Gateway Service */}
      {onGatewayRestart && (
        <>
          <div className="border-t border-border/40 my-4" />
          <h3 className="text-[10px] font-bold tracking-[1.5px] uppercase text-muted-foreground flex items-center gap-2">
            <span className="text-primary">◆</span>
            GATEWAY SERVICE
          </h3>
          <button
            type="button"
            onClick={onGatewayRestart}
            disabled={gatewayRestarting}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-[11px] font-mono text-muted-foreground hover:text-orange-400 hover:bg-orange-400/10 border border-border hover:border-orange-400/30 rounded-sm transition-colors uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCw size={12} aria-hidden="true" className={gatewayRestarting ? 'animate-spin' : ''} />
            {gatewayRestarting ? 'Restarting…' : 'Restart Gateway'}
          </button>

        </>
      )}
    </div>
  );
}
