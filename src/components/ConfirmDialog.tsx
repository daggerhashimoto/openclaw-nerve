import { useEffect, useCallback, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

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

  const confirmClass = variant === 'danger' 
    ? 'bg-red text-white hover:bg-red/90' 
    : 'bg-primary text-primary-foreground hover:opacity-90';

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50" role="presentation" onClick={onCancel} />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card border border-border p-6 z-50 min-w-[300px] max-w-md"
      >
        <div className="flex items-start gap-3 mb-4">
          {variant !== 'default' && <AlertTriangle className={variant === 'danger' ? 'text-red' : 'text-orange'} size={20} aria-hidden="true" />}
          <div>
            <h3 id="confirm-dialog-title" className="text-sm font-bold text-foreground mb-1">{title}</h3>
            <p id="confirm-dialog-message" className="text-xs text-muted-foreground">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button ref={cancelButtonRef} onClick={onCancel} className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border hover:border-muted-foreground">
            {cancelLabel}
          </button>
          <button onClick={onConfirm} className={`px-3 py-1.5 text-xs font-bold ${confirmClass}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
