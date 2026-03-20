import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface WorkspaceSwitchDialogProps {
  open: boolean;
  targetLabel: string;
  pendingAction: 'save' | 'discard' | null;
  error: string | null;
  onSaveAndSwitch: () => void;
  onDiscardAndSwitch: () => void;
  onCancel: () => void;
}

export function WorkspaceSwitchDialog({
  open,
  targetLabel,
  pendingAction,
  error,
  onSaveAndSwitch,
  onDiscardAndSwitch,
  onCancel,
}: WorkspaceSwitchDialogProps) {
  const busy = pendingAction !== null;
  const targetText = targetLabel.trim() || 'the other agent';

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !busy) onCancel(); }}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader className="gap-3 text-left">
          <div className="flex items-start gap-3">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl border border-orange/30 bg-orange/10 text-orange">
              <AlertTriangle size={18} aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <DialogTitle>Unsaved workspace edits</DialogTitle>
              <DialogDescription className="leading-6">
                Save or discard the dirty files in this agent before switching to {targetText}.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {error && (
          <p role="alert" className="rounded-2xl border border-destructive/25 bg-destructive/8 px-3 py-2 text-sm leading-6 text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="secondary" onClick={onDiscardAndSwitch} disabled={busy}>
              {pendingAction === 'discard' ? 'Discarding...' : 'Discard and switch'}
            </Button>
            <Button type="button" onClick={onSaveAndSwitch} disabled={busy}>
              {pendingAction === 'save' ? 'Saving...' : 'Save and switch'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
