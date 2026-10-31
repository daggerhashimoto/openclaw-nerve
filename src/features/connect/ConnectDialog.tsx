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
        className="inset-x-2 top-2 bottom-2 left-2 right-2 flex w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-[3px] p-0 [&>button]:hidden sm:top-[50%] sm:bottom-auto sm:left-[50%] sm:right-auto sm:w-full sm:max-w-[min(92vw,560px)] sm:-translate-x-1/2 sm:-translate-y-1/2"
        showCloseButton={false}
      >
        <div className="shrink-0 border-b border-border px-4 py-4 sm:px-5">
          <DialogHeader className="gap-2 text-left">
            <div className="flex items-center gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center">
                <NerveLogo size={18} static />
              </span>
              <DialogTitle className="text-[1.133rem] font-semibold leading-snug text-foreground sm:text-[1.2rem]">
                Connect Nerve to your OpenClaw gateway
              </DialogTitle>
            </div>
            <DialogDescription className="max-w-[52ch] text-[0.867rem] leading-6 text-muted-foreground">
              Point Nerve at the gateway endpoint, provide your token when needed, and bring the cockpit online.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 pb-[max(1.067rem,env(safe-area-inset-bottom))] sm:gap-5 sm:px-5 sm:py-5">
          <div className="hidden divide-y divide-border border-b border-border pb-4 sm:block">
            <section className="pb-3">
              <h3 className="text-[0.867rem] font-semibold text-foreground">Secure local bridge</h3>
              <p className="mt-1 text-[0.8rem] leading-5 text-muted-foreground">
                Nerve talks to your gateway over WebSocket and keeps the session state in sync live.
              </p>
            </section>
            <section className="pt-3">
              <h3 className="text-[0.867rem] font-semibold text-foreground">Use server auth when available</h3>
              <p className="mt-1 text-[0.8rem] leading-5 text-muted-foreground">
                The token field disappears for the official gateway URL when the server can inject credentials safely.
              </p>
            </section>
          </div>

          <div className="grid gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[0.867rem] font-medium text-foreground">
                WebSocket endpoint
              </span>
              <Input
                value={url}
                onChange={e => setUrl(e.target.value)}
                spellCheck={false}
                placeholder="ws://127.0.0.1:18789"
                className="font-mono text-base sm:text-[0.867rem]"
              />
            </label>
            {(!serverSideAuth || !officialUrl || !areGatewayUrlsEquivalent(url, officialUrl)) && (
              <label className="flex flex-col gap-1.5">
                <span className="text-[0.867rem] font-medium text-foreground">
                  Gateway token
                </span>
                <Input
                  type="password"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleConnect()}
                  spellCheck={false}
                  placeholder="Paste the token from your gateway config"
                  className="font-mono text-base sm:text-[0.867rem]"
                />
              </label>
            )}
          </div>

          <div className="mt-auto flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-[34ch] text-[0.8rem] leading-5 text-muted-foreground">
              Keep Nerve bound to localhost unless you explicitly want remote access.
            </p>
            <Button
              onClick={handleConnect}
              disabled={connecting}
              size="lg"
              className="w-full text-[0.867rem] font-semibold sm:h-9 sm:w-auto sm:min-w-[180px]"
            >
              {connecting ? 'Connecting…' : 'Connect to gateway'}
            </Button>
          </div>

          {error && (
            <div className="rounded-[3px] border border-destructive/40 px-3 py-2 text-[0.867rem] text-destructive">
              {error}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
