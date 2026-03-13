import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import NerveLogo from '@/components/NerveLogo';

interface ConnectDialogProps {
  open: boolean;
  onConnect: (url: string, token: string) => Promise<void>;
  error: string;
  defaultUrl: string;
  defaultToken?: string;
  serverSideAuth?: boolean;
}

/** Initial connection dialog for entering the gateway URL and token. */
export function ConnectDialog({ open, onConnect, error, defaultUrl, defaultToken = '', serverSideAuth }: ConnectDialogProps) {
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
    const isDefaultHost = url.trim() === defaultUrl.trim();
    if (!url.trim() || (!token.trim() && (!serverSideAuth || !isDefaultHost))) return;

    // Force empty token when in server-side auth mode for the default host.
    // This allows the proxy to perform injection and prevents stale/hidden local tokens
    // from overriding server-side credentials.
    const effectiveToken = (serverSideAuth && isDefaultHost) ? '' : token.trim();

    setConnecting(true);
    try {
      await onConnect(url.trim(), effectiveToken);
    } catch (err) {
      console.debug('[ConnectDialog] Connection failed:', err);
    }
    setConnecting(false);
  };
a
  return (
    <Dialog open={open}>
      <DialogContent className="bg-card border-border font-mono max-w-[380px] [&>button]:hidden" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-primary text-xs font-bold tracking-[2px] uppercase">
            // CONNECT TO GATEWAY
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3.5">
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground uppercase tracking-[1px]">
            WebSocket URL
            <Input
              value={url}
              onChange={e => setUrl(e.target.value)}
              spellCheck={false}
              className="bg-background border-border text-foreground font-mono text-[13px]"
            />
          </label>
          {(!serverSideAuth || url.trim() !== defaultUrl.trim()) && (
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground uppercase tracking-[1px]">
              Auth Token
      <DialogContent className="shell-panel max-w-[min(92vw,560px)] p-0 overflow-hidden [&>button]:hidden" showCloseButton={false}>
        <div className="border-b border-border/70 bg-gradient-to-r from-primary/12 via-transparent to-info/6 px-5 py-4 sm:px-6">
          <DialogHeader className="gap-3 text-left">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/20 bg-background/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <NerveLogo size={26} />
              </div>
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.3em] text-primary/80">Gateway Handshake</div>
                <DialogTitle className="mt-1 text-xl font-semibold tracking-[-0.03em] text-foreground">
                  Connect Nerve to your OpenClaw gateway
                </DialogTitle>
              </div>
            </div>
            <DialogDescription className="max-w-[42ch] text-sm leading-6 text-muted-foreground">
              Point Nerve at the gateway endpoint, provide your token, and the full cockpit comes online.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex flex-col gap-5 px-5 py-5 sm:px-6 sm:py-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="shell-panel rounded-2xl px-4 py-3">
              <div className="text-[10px] font-medium uppercase tracking-[0.24em] text-muted-foreground">Connection</div>
              <div className="mt-2 text-sm font-medium text-foreground">Secure local bridge</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Nerve talks to your gateway over WebSocket and keeps the session state in sync live.
              </p>
            </div>
            <div className="shell-panel rounded-2xl px-4 py-3">
              <div className="text-[10px] font-medium uppercase tracking-[0.24em] text-muted-foreground">Credentials</div>
              <div className="mt-2 text-sm font-medium text-foreground">Use the gateway token</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Paste the same token configured in OpenClaw. Nerve will reuse it for reconnects.
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
                className="bg-background border-border text-foreground font-mono text-[13px]"
              />
            </label>
          )}
          <Button
            onClick={handleConnect}
            disabled={connecting}
            className="bg-primary text-primary-foreground font-mono text-xs font-bold tracking-[1px] uppercase"
          >
            {connecting ? 'CONNECTING…' : 'CONNECT'}
          </Button>
          {error && <div className="text-destructive text-[11px]">{error}</div>}
                placeholder="Paste the token from your gateway config"
                className="font-mono text-base sm:text-[13px]"
              />
            </label>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
