/**
 * useConnectionManager - Handles gateway connection lifecycle
 *
 * Extracted from App.tsx to separate connection concerns from layout.
 * Manages auto-connect on mount and reconnect logic.
 *
 * On first load, if no session config exists, fetches /api/connect-defaults
 * from the server to pre-fill (and auto-connect with) the configured gateway
 * URL and token. This bridges the server-side .env config to the browser.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useGateway, loadConfig, saveConfig } from '@/contexts/GatewayContext';
import { DEFAULT_GATEWAY_WS } from '@/lib/constants';

export interface ConnectionManagerState {
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  editableUrl: string;
  setEditableUrl: (url: string) => void;
  editableToken: string;
  setEditableToken: (token: string) => void;
  handleConnect: (url: string, token: string) => Promise<void>;
  handleReconnect: () => Promise<void>;
  serverSideAuth: boolean;
}

/** Create an AbortSignal that times out after `ms` milliseconds. */
function timeoutSignal(ms: number): AbortSignal {
  // AbortSignal.timeout() not supported in Safari <16.4
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/** Fetch gateway connection defaults from the Nerve server. */
async function fetchConnectDefaults(): Promise<{ wsUrl: string; token: string | null; authEnabled?: boolean; serverSideAuth?: boolean } | null> {
  try {
    const resp = await fetch('/api/connect-defaults', { signal: timeoutSignal(3000) });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export function useConnectionManager(): ConnectionManagerState {
  const { connectionState, connect, disconnect } = useGateway();

  const [dialogOpen, setDialogOpen] = useState(true);

  // Editable connection settings (local state for settings drawer)
  // Lazy initializers avoid re-parsing sessionStorage on every render
  const [editableUrl, setEditableUrl] = useState(() => loadConfig().url || DEFAULT_GATEWAY_WS);
  const [editableToken, setEditableToken] = useState(() => loadConfig().token || '');
  const [serverSideAuth, setServerSideAuth] = useState(false);
  const [officialUrl, setOfficialUrl] = useState<string | null>(null);

  // Track if we've attempted auto-connect to avoid re-running
  const autoConnectAttempted = useRef(false);

  /** Connect to the gateway, save config, and close the dialog. */
  const handleConnect = useCallback(async (url: string, token: string) => {
    saveConfig(url, token);
    await connect(url, token);
    setDialogOpen(false);
  }, [connect]);

  // Fetch server defaults (async, can't run in initializer)
  useEffect(() => {
    if (autoConnectAttempted.current) return;
    autoConnectAttempted.current = true;

    const saved = loadConfig();

    // Always fetch defaults once on mount to establish serverSideAuth and officialUrl
    fetchConnectDefaults().then((defaults) => {
      const isServerSideAuth = defaults?.serverSideAuth ?? false;
      setServerSideAuth(isServerSideAuth);

      const savedUrl = saved.url?.trim();
      const officialWsUrl = defaults?.wsUrl?.trim();

      if (officialWsUrl) {
        setOfficialUrl(officialWsUrl);
        // Only override editableUrl if it's currently empty
        if (!savedUrl) {
          setEditableUrl(officialWsUrl);
        }
      }

      // Only override editableToken if it's currently empty
      if (!saved.token && defaults?.token) {
        setEditableToken(defaults.token);
      }

      // Auto-connect if server-side auth is supported and:
      // 1. No URL is saved yet
      // 2. OR the saved URL is the official one and there is no saved token
      if (
        isServerSideAuth &&
        officialWsUrl &&
        (!savedUrl || (savedUrl === officialWsUrl && !saved.token))
      ) {
        handleConnect(officialWsUrl, '').catch(() => {
          // Auto-connect failed - user can manually connect via dialog
        });
      }
    });
  }, [handleConnect]);

  const handleReconnect = useCallback(async () => {
    // Don't reconnect if already connecting
    if (connectionState === 'connecting' || connectionState === 'reconnecting') {
      return;
    }

    const isOfficialUrl = editableUrl.trim() === officialUrl?.trim();
    if (editableUrl && (editableToken || (serverSideAuth && isOfficialUrl))) {
      // Force empty token if server side auth is active for this URL
      const token = serverSideAuth && isOfficialUrl ? '' : editableToken;
      if (token !== editableToken) {
        setEditableToken('');
      }

      // Save the new config first
      saveConfig(editableUrl, token);
      // Disconnect cleanly, then reconnect
      disconnect();
      // Small delay to ensure clean disconnect
      await new Promise(r => setTimeout(r, 100));
      try {
        await connect(editableUrl, token);
      } catch {
        // Connection failed - don't loop, just stay disconnected
      }
    } else {
      setDialogOpen(true);
    }
  }, [connect, disconnect, editableUrl, editableToken, connectionState, serverSideAuth, officialUrl]);

  return {
    dialogOpen,
    setDialogOpen,
    editableUrl,
    setEditableUrl,
    editableToken,
    setEditableToken,
    handleConnect,
    handleReconnect,
    serverSideAuth,
  };
}
