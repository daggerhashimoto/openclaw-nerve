import { useEffect, useCallback, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';

/** Props for {@link ConfirmDialog}. */
interface ConfirmDialogProps {
  /** Whether the dialog is visible. */
  open: boolean;
  /** Dialog heading text. */
  title: string;
  /** Descriptive body text shown below the title. */
  message: string;
  /** Label for the confirm button. @default "Confirm" */
  confirmLabel?: string;
  /** Label for the cancel button. @default "Cancel" */
  cancelLabel?: string;
  /** Called when the user confirms the action. */
  onConfirm: () => void;
  /** Called when the user cancels (button click, Escape, or backdrop click). */
  onCancel: () => void;
  /** Visual style — `danger` shows a red confirm button. @default "default" */
  variant?: 'danger' | 'warning' | 'default';
}

/**
 * Modal confirmation dialog with keyboard support (Enter to confirm, Escape to cancel)
 * and a focus-trapped overlay. Used for destructive or important actions in the Nerve UI.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'default',
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  const previousFocusRef = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  }, [onCancel]);

  const handleTabKey = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;

    const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement?.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement?.focus();
    }
  }, []);

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('keydown', handleTabKey);
      cancelButtonRef.current?.focus();
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.removeEventListener('keydown', handleTabKey);
        previousFocusRef.current?.focus();
      };
    }
  }, [open, handleKeyDown, handleTabKey]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-background/78 backdrop-blur-md" role="presentation" onClick={onCancel} />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="fixed top-1/2 left-1/2 z-50 min-w-[320px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border/75 bg-card/94 p-6 shadow-[0_36px_90px_rgba(0,0,0,0.42)] backdrop-blur-xl"
      >
        <div className="mb-5 flex items-start gap-3">
          {variant !== 'default' && (
            <span className={`inline-flex size-9 shrink-0 items-center justify-center rounded-xl border ${
              variant === 'danger'
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-orange/30 bg-orange/10 text-orange'
            }`}>
              <AlertTriangle size={18} aria-hidden="true" />
            </span>
          )}
          <div>
            <h3 id="confirm-dialog-title" className="text-base font-semibold text-foreground">{title}</h3>
            <p id="confirm-dialog-message" className="mt-1 text-sm leading-6 text-muted-foreground">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={buttonVariants({ variant: variant === 'danger' ? 'destructive' : 'default', size: 'sm' })}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
