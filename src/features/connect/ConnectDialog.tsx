import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import NerveLogo from '@/components/NerveLogo';
import { areGatewayUrlsEquivalent } from '@/lib/gatewayUrls';

interface ConnectDialogProps {
  open: boolean;
  onConnect: (url: string, token: string) => Promise<void>;
  error: string;
  defaultUrl: string;
  defaultToken?: string;
  officialUrl?: string | null;
  serverSideAuth?: boolean;
}

/** Initial connection dialog for entering the gateway URL and token. */
export function ConnectDialog({
  open,
  onConnect,
  error,
  defaultUrl,
  defaultToken = '',
  officialUrl,
  serverSideAuth,
}: ConnectDialogProps) {
  const [url, setUrl] = useState(defaultUrl);
  const [token, setToken] = useState(defaultToken);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when dialog opens
      setUrl(defaultUrl);
      setToken(prev => prev || defaultToken);
    }
  }, [defaultUrl, defaultToken, open]);

  const handleConnect = async () => {
    const isOfficialUrl = areGatewayUrlsEquivalent(url, officialUrl);
    if (!url.trim() || (!token.trim() && (!serverSideAuth || !isOfficialUrl))) return;

    // Force empty token only for the official server-managed URL.
    // This allows the proxy to perform injection and prevents stale/hidden local tokens
    // from overriding server-side credentials.
    const effectiveUrl = (isOfficialUrl && officialUrl) ? officialUrl.trim() : url.trim();
    const effectiveToken = (serverSideAuth && isOfficialUrl) ? '' : token.trim();

    setConnecting(true);
    try {
      await onConnect(effectiveUrl, effectiveToken);
    } catch (err) {
      console.debug('[ConnectDialog] Connection failed:', err);
    }
    setConnecting(false);
  };

  return (
    <Dialog open={open}>
      <DialogContent
        className="shell-panel inset-x-2 top-2 bottom-2 left-2 right-2 flex w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden p-0 [&>button]:hidden sm:top-[50%] sm:bottom-auto sm:left-[50%] sm:right-auto sm:w-full sm:max-w-[min(92vw,560px)] sm:-translate-x-1/2 sm:-translate-y-1/2"
        showCloseButton={false}
      >
        <div className="shrink-0 border-b border-border/70 bg-gradient-to-r from-primary/12 via-transparent to-info/6 px-4 py-4 sm:px-6">
          <DialogHeader className="gap-3 text-left">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/20 bg-background/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <NerveLogo size={26} />
              </div>
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.3em] text-primary/80">Gateway Handshake</div>
                <DialogTitle className="mt-1 text-lg font-semibold tracking-[-0.03em] text-foreground sm:text-xl">
                  Connect Nerve to your OpenClaw gateway
                </DialogTitle>
              </div>
            </div>
            <DialogDescription className="max-w-[42ch] text-sm leading-6 text-muted-foreground">
              Point Nerve at the gateway endpoint, provide your token when needed, and bring the cockpit online.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:gap-5 sm:px-6 sm:py-6">
          <div className="hidden gap-4 sm:grid sm:grid-cols-2">
            <div className="shell-panel rounded-2xl px-4 py-3">
              <div className="text-[10px] font-medium uppercase tracking-[0.24em] text-muted-foreground">Connection</div>
              <div className="mt-2 text-sm font-medium text-foreground">Secure local bridge</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Nerve talks to your gateway over WebSocket and keeps the session state in sync live.
              </p>
            </div>
            <div className="shell-panel rounded-2xl px-4 py-3">
              <div className="text-[10px] font-medium uppercase tracking-[0.24em] text-muted-foreground">Credentials</div>
              <div className="mt-2 text-sm font-medium text-foreground">Use server auth when available</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                The token field disappears for the official gateway URL when the server can inject credentials safely.
              </p>
            </div>
          </div>

          <div className="grid gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                WebSocket endpoint
              </span>
              <Input
                value={url}
                onChange={e => setUrl(e.target.value)}
                spellCheck={false}
                placeholder="ws://127.0.0.1:18789"
                className="font-mono text-base sm:text-[13px]"
              />
            </label>
            {(!serverSideAuth || !officialUrl || !areGatewayUrlsEquivalent(url, officialUrl)) && (
              <label className="flex flex-col gap-2">
                <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  Gateway token
                </span>
                <Input
                  type="password"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleConnect()}
                  spellCheck={false}
                  placeholder="Paste the token from your gateway config"
                  className="font-mono text-base sm:text-[13px]"
                />
              </label>
            )}
          </div>

          <div className="mt-auto flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-[34ch] text-xs leading-5 text-muted-foreground">
              Keep Nerve bound to localhost unless you explicitly want remote access.
            </p>
            <Button
              onClick={handleConnect}
              disabled={connecting}
              size="lg"
              className="w-full text-[11px] uppercase tracking-[0.22em] sm:w-auto sm:min-w-[220px]"
            >
              {connecting ? 'Connecting…' : 'Connect to Gateway'}
            </Button>
          </div>

          {error && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
