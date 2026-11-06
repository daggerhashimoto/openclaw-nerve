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
        <DialogHeader className="gap-1 text-left">
          <DialogTitle className="text-[1rem]">Unsaved workspace edits</DialogTitle>
          <DialogDescription className="text-[0.867rem] leading-6">
            Save or discard the dirty files in this agent before switching to {targetText}.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="rounded-[3px] border border-destructive/40 px-3 py-2 text-[0.867rem] leading-6 text-destructive">
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
