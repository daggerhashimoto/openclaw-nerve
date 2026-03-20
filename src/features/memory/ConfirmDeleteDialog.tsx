/**
 * ConfirmDeleteDialog — Confirmation dialog for deleting a memory.
 *
 * Shows the memory text and requires explicit confirmation before deletion.
 * For sections/daily entries, fetches and displays the full markdown content.
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Loader2 } from 'lucide-react';

interface ConfirmDeleteDialogProps {
  agentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memoryText: string;
  memoryType?: 'section' | 'item' | 'daily';
  memoryDate?: string;
  itemsToDelete?: string[];
  onConfirm: () => Promise<void>;
  isLoading?: boolean;
}

/** Confirmation dialog shown before deleting a memory entry. */
export function ConfirmDeleteDialog({
  agentId,
  open,
  onOpenChange,
  memoryText,
  memoryType,
  memoryDate,
  itemsToDelete = [],
  onConfirm,
  isLoading,
}: ConfirmDeleteDialogProps) {
  const isSection = memoryType === 'section';
  const isDaily = memoryType === 'daily';
  const hasItems = itemsToDelete.length > 0;
  
  // State for fetched markdown content
  const [markdownContent, setMarkdownContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);

  // Fetch section content when dialog opens for section/daily
  useEffect(() => {
    if (!open || (!isSection && !isDaily) || !memoryText) {
      setMarkdownContent(null);
      return;
    }

    const fetchContent = async () => {
      setContentLoading(true);
      try {
        const params = new URLSearchParams({ title: memoryText, agentId });
        if (memoryDate) {
          params.set('date', memoryDate);
        }
        
        const res = await fetch(`/api/memories/section?${params.toString()}`);
        const data = await res.json();
        
        if (data.ok && data.content) {
          setMarkdownContent(data.content);
        } else {
          setMarkdownContent(null);
        }
      } catch {
        setMarkdownContent(null);
      } finally {
        setContentLoading(false);
      }
    };

    fetchContent();
  }, [agentId, open, isSection, isDaily, memoryText, memoryDate]);

  const handleConfirm = async () => {
    await onConfirm();
    onOpenChange(false);
  };

  const handleCancel = () => {
    if (!isLoading) {
      onOpenChange(false);
    }
  };

  // Truncate long memory text for display
  const displayText = memoryText.length > 100 
    ? memoryText.slice(0, 100) + '...' 
    : memoryText;

  return (
    <Dialog open={open} onOpenChange={handleCancel}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="cockpit-kicker text-destructive">
            <AlertTriangle size={14} />
            Destructive Action
          </div>
          <DialogTitle className="flex items-center gap-2 text-[1.3rem] font-semibold tracking-[-0.03em] text-foreground">
            <AlertTriangle size={18} className="text-destructive" />
            {isSection ? 'Delete Section' : isDaily ? 'Delete Daily Entry' : 'Delete Memory'}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {isSection || isDaily
              ? 'This will delete the entire section and all content underneath it.'
              : 'This action cannot be undone. The memory will be permanently removed.'}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-3">
          <div className="cockpit-note" data-tone="danger">
            <p className="mb-1 text-[0.733rem] font-semibold uppercase tracking-[0.16em] text-destructive/80">
              {isSection
                ? 'Section to delete:'
                : isDaily
                ? memoryDate
                  ? `Daily entry (${memoryDate}):`
                  : 'Daily entry to delete:'
                : 'Memory to delete:'}
            </p>
            <p className="text-sm text-foreground">
              {isSection ? `§ ${displayText}` : isDaily ? `📅 ${displayText}` : displayText}
            </p>
          </div>
          
          {/* Show markdown content for sections/daily entries */}
          {(isSection || isDaily) && (
            <div className="max-h-60 overflow-y-auto rounded-2xl border border-destructive/20 bg-destructive/6 px-3 py-3">
              <p className="sticky top-0 mb-2 bg-destructive/6 pb-1 text-[0.667rem] font-semibold uppercase tracking-[0.18em] text-destructive/80">
                Content to be deleted:
              </p>
              
              {contentLoading ? (
                <div className="flex items-center gap-2 py-2 text-[0.733rem] text-muted-foreground">
                  <Loader2 size={12} className="animate-spin" />
                  Loading content...
                </div>
              ) : markdownContent ? (
                <pre className="whitespace-pre-wrap break-words font-mono text-[0.733rem] text-muted-foreground">
                  {markdownContent}
                </pre>
              ) : hasItems ? (
                <ul className="space-y-1">
                  {itemsToDelete.map((item, i) => (
                    <li key={i} className="flex items-start gap-1.5 font-mono text-[0.733rem] text-muted-foreground">
                      <span className="shrink-0 text-destructive/60">›</span>
                      <span className="break-words">{item.length > 80 ? item.slice(0, 80) + '...' : item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[0.733rem] text-muted-foreground italic">
                  No content found
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={isLoading}
            className="text-xs"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isLoading}
            variant="destructive"
            className="text-xs"
          >
            {isLoading ? 'Deleting...' : (isSection ? 'Delete Section' : isDaily ? 'Delete Entry' : 'Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
