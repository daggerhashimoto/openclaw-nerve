import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Pane } from '@/components/ui/Pane';

interface VersionCheck {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  projectDir?: string | null;
}

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Shows an update badge next to the version in the status bar
 * when a newer version of Nerve is available. Clicking it opens
 * a modal with update instructions.
 */
export function UpdateBadge() {
  const [versionInfo, setVersionInfo] = useState<VersionCheck | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    const check = async () => {
      try {
        const res = await fetch('/api/version/check', { signal: ac.signal });
        if (!res.ok) return;
        const data: VersionCheck = await res.json();
        setVersionInfo(data);
      } catch {
        // Silently ignore: aborted or network error
      }
    };
    check();
    const iv = setInterval(check, CHECK_INTERVAL_MS);
    return () => { ac.abort(); clearInterval(iv); };
  }, []);

  if (!versionInfo?.updateAvailable || !versionInfo.latest || !versionInfo.projectDir) return null;

  const quotedProjectDir = shellQuote(versionInfo.projectDir);
  const updateCommand = `cd ${quotedProjectDir} && npm run update -- --yes`;
  const dryRunCommand = `cd ${quotedProjectDir} && npm run update -- --dry-run`;
  const pinVersionCommand = `cd ${quotedProjectDir} && npm run update -- --version v${versionInfo.latest} --yes`;
  const docsCommand = `cd ${quotedProjectDir} && cat docs/UPDATING.md`;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex h-5 cursor-pointer items-center gap-1.5 rounded-[3px] px-1.5 text-[0.8rem] text-foreground transition-colors duration-[120ms] hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        title={`Update available: v${versionInfo.latest}`}
        aria-label={`Update available: version ${versionInfo.latest}. Click for instructions.`}
      >
        <Pane state="operator" size="sm" />
        <span>Update</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Update available</DialogTitle>
            <DialogDescription>
              Nerve <span className="font-mono font-semibold text-foreground">v{versionInfo.latest}</span> is
              available. You're running <span className="font-mono text-muted-foreground">v{versionInfo.current}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <p className="mb-1 text-[0.8rem] text-muted-foreground">Project directory</p>
              <pre className="rounded-[3px] border border-border bg-background px-3 py-2 font-mono text-[0.8rem] text-muted-foreground select-all whitespace-pre-wrap break-all">
                {versionInfo.projectDir}
              </pre>
            </div>
            <div>
              <p className="mb-2 text-[0.867rem] text-muted-foreground">
                Copy and paste this into your OpenClaw session or terminal:
              </p>
              <pre className="rounded-[3px] border border-border bg-background px-3 py-2 font-mono text-[0.867rem] text-foreground select-all whitespace-pre-wrap break-all">
                {updateCommand}
              </pre>
            </div>
            <div className="space-y-1 text-[0.8rem] text-muted-foreground">
              <p>This will fetch the latest release, rebuild, restart, and verify health.</p>
              <p>If anything fails, Nerve automatically rolls back to your current version.</p>
            </div>
            <div>
              <p className="mb-1 text-[0.8rem] text-muted-foreground">Other options:</p>
              <pre className="rounded-[3px] border border-border bg-background px-3 py-2 font-mono text-[0.8rem] text-muted-foreground whitespace-pre-wrap">
{`# Preview first
${dryRunCommand}

# Pin to a specific version
${pinVersionCommand}

# See full docs
${docsCommand}`}
              </pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
