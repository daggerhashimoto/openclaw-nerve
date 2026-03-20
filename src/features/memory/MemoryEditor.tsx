/**
 * MemoryEditor — Inline editor for memory section content.
 *
 * Displays a textarea with the section content and provides
 * save/cancel actions.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Save, X, Loader2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { clearPersistedDraft, encodeDraftPart, readPersistedDraft, writePersistedDraft } from '@/features/workspace/persistedDrafts';

interface MemoryEditorProps {
  agentId: string;
  title: string;
  date?: string; // For daily files
  onSave: () => void;
  onCancel: () => void;
}

interface MemoryEditorDraft {
  content: string;
  originalContent: string;
}

function getMemoryDraftKind(title: string, date?: string): string {
  const draftTitle = encodeDraftPart(title);
  const draftDate = date ? encodeDraftPart(date) : 'root';
  return `memory-editor:${draftDate}:${draftTitle}`;
}

/** Inline editor for modifying a memory entry's content. */
export function MemoryEditor({ agentId, title, date, onSave, onCancel }: MemoryEditorProps) {
  const draftKind = useMemo(() => getMemoryDraftKind(title, date), [title, date]);
  const initialDraft = useMemo(
    () => readPersistedDraft<MemoryEditorDraft>(draftKind, agentId),
    [draftKind, agentId],
  );
  const [content, setContent] = useState(() => initialDraft?.content ?? '');
  const [originalContent, setOriginalContent] = useState(() => initialDraft?.originalContent ?? '');
  const [isLoading, setIsLoading] = useState(() => initialDraft === null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestVersionRef = useRef(0);
  const activeEditorKeyRef = useRef('');

  const editorKey = useMemo(
    () => `${agentId}:${date ?? 'root'}:${title}`,
    [agentId, date, title],
  );

  const clearDraft = useCallback(() => {
    clearPersistedDraft(draftKind, agentId);
  }, [draftKind, agentId]);

  useEffect(() => {
    activeEditorKeyRef.current = editorKey;
  }, [editorKey]);

  // Load persisted draft immediately, otherwise fetch the latest section content.
  useEffect(() => {
    const storedDraft = readPersistedDraft<MemoryEditorDraft>(draftKind, agentId);
    setIsSaving(false);

    if (storedDraft) {
      setContent(storedDraft.content);
      setOriginalContent(storedDraft.originalContent);
      setIsLoading(false);
      setError(null);
      return;
    }

    const requestVersion = ++requestVersionRef.current;
    const controller = new AbortController();

    setContent('');
    setOriginalContent('');
    setIsLoading(true);
    setError(null);

    const fetchContent = async () => {
      try {
        const params = new URLSearchParams({ title, agentId });
        if (date) params.set('date', date);

        const res = await fetch(`/api/memories/section?${params.toString()}`, {
          signal: controller.signal,
        });
        const data = await res.json() as { ok: boolean; content?: string; error?: string };

        if (controller.signal.aborted || requestVersionRef.current !== requestVersion || activeEditorKeyRef.current !== editorKey) {
          return;
        }

        if (!data.ok) {
          setError(data.error || 'Failed to load section');
          return;
        }

        const nextContent = data.content || '';
        setContent(nextContent);
        setOriginalContent(nextContent);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        if (requestVersionRef.current !== requestVersion || activeEditorKeyRef.current !== editorKey) {
          return;
        }
        setError((err as Error).message);
      } finally {
        if (!controller.signal.aborted && requestVersionRef.current === requestVersion && activeEditorKeyRef.current === editorKey) {
          setIsLoading(false);
        }
      }
    };

    void fetchContent();

    return () => controller.abort();
  }, [agentId, title, date, draftKind, editorKey]);

  // Focus textarea after loading
  useEffect(() => {
    if (!isLoading && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isLoading]);

  const hasChanges = content !== originalContent;

  useEffect(() => {
    if (isLoading) return;

    if (hasChanges) {
      writePersistedDraft(draftKind, agentId, { content, originalContent });
      return;
    }

    clearDraft();
  }, [agentId, clearDraft, content, draftKind, hasChanges, isLoading, originalContent]);

  const handleSave = async () => {
    if (!hasChanges || isSaving) return;

    const requestVersion = ++requestVersionRef.current;
    const requestEditorKey = editorKey;

    setIsSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/memories/section', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, date, agentId }),
      });

      const data = await res.json() as { ok: boolean; error?: string };

      if (requestVersionRef.current !== requestVersion || activeEditorKeyRef.current !== requestEditorKey) {
        return;
      }

      if (!data.ok) {
        setError(data.error || 'Failed to save');
        return;
      }

      clearDraft();
      onSave();
    } catch (err) {
      if (requestVersionRef.current !== requestVersion || activeEditorKeyRef.current !== requestEditorKey) {
        return;
      }
      setError((err as Error).message);
    } finally {
      if (requestVersionRef.current === requestVersion && activeEditorKeyRef.current === requestEditorKey) {
        setIsSaving(false);
      }
    }
  };

  const handleCancel = () => {
    if (hasChanges) {
      const confirmed = window.confirm('Discard unsaved changes?');
      if (!confirmed) return;
      clearDraft();
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
          <span className="text-[0.6rem] text-yellow-500 uppercase tracking-wider">
            modified
          </span>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="px-3 py-1.5 text-[0.667rem] flex items-center gap-1.5 bg-red/10 text-red border-b border-red/20">
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
            className="flex-1 w-full bg-transparent text-[0.733rem] font-mono text-foreground px-3 py-2 resize-none focus:outline-none border-none placeholder:text-muted-foreground/50"
            placeholder="Enter section content..."
            disabled={isSaving}
            spellCheck={false}
            aria-label={`Edit ${date ? `${date} / ${title}` : title}`}
          />
        )}
      </div>

      {/* Footer with actions */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border/40 bg-card/30">
        <span className="text-[0.6rem] text-muted-foreground">
          {hasChanges ? 'Ctrl+S to save • Esc to cancel' : ''}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCancel}
            disabled={isSaving}
            className="h-6 px-2 text-[0.667rem] font-mono"
          >
            <X size={12} className="mr-1" />
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!hasChanges || isSaving || isLoading}
            className="h-6 px-2 text-[0.667rem] font-mono bg-purple hover:bg-purple/90 text-white"
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
