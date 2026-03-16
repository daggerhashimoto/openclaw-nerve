import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ConnectDialogProps {
  open: boolean;
  onConnect: (url: string, token: string) => Promise<void>;
  error: string;
  defaultUrl: string;
  defaultToken?: string;
}

/** Initial connection dialog for entering the gateway URL and token. */
export function ConnectDialog({ open, onConnect, error, defaultUrl, defaultToken = '' }: ConnectDialogProps) {
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
    if (!url.trim() || !token.trim()) return;
    setConnecting(true);
    try {
      await onConnect(url.trim(), token.trim());
    } catch (err) {
      console.debug('[ConnectDialog] Connection failed:', err);
    }
    setConnecting(false);
  };

  return (
    <Dialog open={open}>
      <DialogContent 
        className="bg-card border-border font-mono max-w-[min(380px,calc(100vw-2rem))] max-h-[90vh] overflow-y-auto [&>button]:hidden" 
        showCloseButton={false}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-primary text-xs font-bold tracking-[2px] uppercase">
            // CONNECT TO GATEWAY
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3.5 min-h-0 overflow-y-auto">
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground uppercase tracking-[1px]">
            WebSocket URL
            <Input
              value={url}
              onChange={e => setUrl(e.target.value)}
              spellCheck={false}
              className="bg-background border-border text-foreground font-mono text-[13px]"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground uppercase tracking-[1px]">
            Auth Token
            <Input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleConnect()}
              spellCheck={false}
              className="bg-background border-border text-foreground font-mono text-[13px]"
            />
          </label>
          <Button
            onClick={handleConnect}
            disabled={connecting}
            className="bg-primary text-primary-foreground font-mono text-xs font-bold tracking-[1px] uppercase shrink-0"
          >
            {connecting ? 'CONNECTING…' : 'CONNECT'}
          </Button>
          {error && <div className="text-destructive text-[11px]">{error}</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
