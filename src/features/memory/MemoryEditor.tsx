/**
 * MemoryEditor — Inline editor for memory section content.
 *
 * Displays a textarea with the section content and provides
 * save/cancel actions.
 */

import { useState, useEffect, useRef } from 'react';
import { Save, X, Loader2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MemoryEditorProps {
  agentId: string;
  title: string;
  date?: string; // For daily files
  onSave: () => void;
  onCancel: () => void;
}

/** Inline editor for modifying a memory entry's content. */
export function MemoryEditor({ agentId, title, date, onSave, onCancel }: MemoryEditorProps) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch the section content on mount
  useEffect(() => {
    const fetchContent = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ title, agentId });
        if (date) params.set('date', date);

        const res = await fetch(`/api/memories/section?${params.toString()}`);
        const data = await res.json();

        if (!data.ok) {
          setError(data.error || 'Failed to load section');
          return;
        }

        setContent(data.content || '');
        setOriginalContent(data.content || '');
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchContent();
  }, [agentId, title, date]);

  // Focus textarea after loading
  useEffect(() => {
    if (!isLoading && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isLoading]);

  const hasChanges = content !== originalContent;

  const handleSave = async () => {
    if (!hasChanges || isSaving) return;

    setIsSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/memories/section', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, date, agentId }),
      });

      const data = await res.json();

      if (!data.ok) {
        setError(data.error || 'Failed to save');
        return;
      }

      onSave();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (hasChanges) {
      // Simple confirm - could use ConfirmDialog component for consistency
      const confirmed = window.confirm('Discard unsaved changes?');
      if (!confirmed) return;
    }
    onCancel();
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Cmd/Ctrl + S to save
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
    // Escape to cancel
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header */}
      <div className="panel-header border-l-[3px] border-l-purple">
        <button
          onClick={handleCancel}
          className="text-muted-foreground hover:text-foreground transition-colors p-0.5 -ml-1"
          title="Back to list"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="panel-label text-purple truncate flex-1 ml-1">
          <span className="panel-diamond">◆</span>
          {date ? `${date} / ${title}` : title}
        </span>
        {hasChanges && (
          <span className="text-[9px] text-yellow-500 uppercase tracking-wider">
            modified
          </span>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="px-3 py-1.5 text-[10px] flex items-center gap-1.5 bg-red/10 text-red border-b border-red/20">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red/60 hover:text-red"
          >
            ×
          </button>
        </div>
      )}

      {/* Editor content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={16} className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 w-full bg-transparent text-[11px] font-mono text-foreground px-3 py-2 resize-none focus:outline-none border-none placeholder:text-muted-foreground/50"
            placeholder="Enter section content..."
            disabled={isSaving}
            spellCheck={false}
            aria-label={`Edit ${date ? `${date} / ${title}` : title}`}
          />
        )}
      </div>

      {/* Footer with actions */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border/40 bg-card/30">
        <span className="text-[9px] text-muted-foreground">
          {hasChanges ? 'Ctrl+S to save • Esc to cancel' : ''}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCancel}
            disabled={isSaving}
            className="h-6 px-2 text-[10px] font-mono"
          >
            <X size={12} className="mr-1" />
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!hasChanges || isSaving || isLoading}
            className="h-6 px-2 text-[10px] font-mono bg-purple hover:bg-purple/90 text-white"
          >
            {isSaving ? (
              <Loader2 size={12} className="mr-1 animate-spin" />
            ) : (
              <Save size={12} className="mr-1" />
            )}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
