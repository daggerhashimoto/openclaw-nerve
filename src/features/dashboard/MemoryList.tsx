/**
 * MemoryList — Memory panel with view, add, edit, and delete functionality.
 *
 * Displays memories from MEMORY.md and daily files, with actions to
 * add new memories, edit sections inline, and delete via the OpenClaw gateway.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Plus, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';
import { MemoryItem, AddMemoryDialog, ConfirmDeleteDialog, MemoryEditor, useMemories } from '@/features/memory';
import { MemorySkeletonGroup } from '@/components/skeletons';
import { clearPersistedDraft, readPersistedDraft, writePersistedDraft } from '@/features/workspace/persistedDrafts';
import type { Memory } from '@/types';

interface MemoryListProps {
  agentId: string;
  memories: Memory[];
  onRefresh: (signal?: AbortSignal) => void | Promise<void>;
  isLoading?: boolean;
  hideHeader?: boolean;
  /** Compact mode for mobile/topbar dropdown; uses kebab actions for rows. */
  compact?: boolean;
}

interface EditingMemoryState {
  title: string;
  date?: string;
}

const MEMORY_EDITOR_STATE_KIND = 'memory-editor:active';

/** Searchable, editable list of agent memories with add/delete support. */
export function MemoryList({ agentId, memories: initialMemories, onRefresh, isLoading: initialLoading, hideHeader, compact = false }: MemoryListProps) {
  // useMemories provides optimistic state that reflects pending operations
  const { memories, addMemory, deleteMemory, error, clearError, isLoading } = useMemories(initialMemories, agentId);
  
  // Dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [memoryToDelete, setMemoryToDelete] = useState<{ text: string; type: Memory['type']; date?: string } | null>(null);
  
  // Editor state
  const [editingMemory, setEditingMemory] = useState<EditingMemoryState | null>(() => (
    readPersistedDraft<EditingMemoryState>(MEMORY_EDITOR_STATE_KIND, agentId)
  ));
  
  // Collapse state — sections are collapsed by default
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const toggleSection = useCallback((sectionText: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionText)) next.delete(sectionText);
      else next.add(sectionText);
      return next;
    });
  }, []);

  // Count items per section for collapsed badge
  const sectionItemCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    let currentSection: string | null = null;
    for (const m of memories) {
      if (m.type === 'section') {
        currentSection = m.text;
        counts[currentSection] = 0;
      } else if (m.type === 'item' && currentSection) {
        counts[currentSection]++;
      }
    }
    return counts;
  }, [memories]);

  // Filter out items under collapsed sections
  const visibleMemories = useMemo(() => {
    const result: Memory[] = [];
    let currentSectionExpanded = true;
    for (const m of memories) {
      if (m.type === 'section') {
        currentSectionExpanded = expandedSections.has(m.text);
        result.push(m); // Always show section headers
      } else if (m.type === 'daily') {
        result.push(m); // Always show daily entries
      } else if (currentSectionExpanded) {
        // item type: only show if current section is expanded
        result.push(m);
      }
    }
    return result;
  }, [memories, expandedSections]);

  // Feedback states
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Cleanup feedback timer on unmount
  useEffect(() => () => clearTimeout(feedbackTimerRef.current), []);

  useEffect(() => {
    setEditingMemory(readPersistedDraft<EditingMemoryState>(MEMORY_EDITOR_STATE_KIND, agentId));
  }, [agentId]);

  useEffect(() => {
    if (editingMemory) {
      writePersistedDraft(MEMORY_EDITOR_STATE_KIND, agentId, editingMemory);
      return;
    }

    clearPersistedDraft(MEMORY_EDITOR_STATE_KIND, agentId);
  }, [agentId, editingMemory]);

  // Show feedback temporarily
  const showFeedback = useCallback((type: 'success' | 'error', message: string) => {
    clearTimeout(feedbackTimerRef.current);
    setFeedback({ type, message });
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 3000);
  }, []);

  // Extract section names for the add dialog dropdown
  const sectionNames = useMemo(() => {
    return memories
      .filter((m) => m.type === 'section')
      .map((m) => m.text);
  }, [memories]);

  // Handle add memory
  const handleAddMemory = useCallback(async (text: string, section: string): Promise<boolean> => {
    const success = await addMemory(text, section);
    if (success) {
      showFeedback('success', 'Memory stored successfully');
      onRefresh();
    } else {
      showFeedback('error', 'Failed to store memory');
    }
    return success;
  }, [addMemory, showFeedback, onRefresh]);

  // Get all items that will be deleted when deleting a section
  const getItemsToDelete = (sectionText: string, sectionType: Memory['type']): string[] => {
    if (sectionType !== 'section' && sectionType !== 'daily') {
      return [];
    }
    
    // Find the section index
    const sectionIndex = memories.findIndex(m => 
      m.text === sectionText && m.type === sectionType
    );
    
    if (sectionIndex === -1) return [];
    
    // Collect all items until the next section
    const items: string[] = [];
    for (let i = sectionIndex + 1; i < memories.length; i++) {
      const m = memories[i];
      if (m.type === 'section' || m.type === 'daily') {
        break; // Hit next section
      }
      items.push(m.text);
    }
    
    return items;
  };

  // Handle delete memory click - opens confirmation dialog
  const handleDeleteClick = useCallback((text: string, type: Memory['type'], date?: string) => {
    setMemoryToDelete({ text, type, date });
    setDeleteDialogOpen(true);
  }, []);

  // Handle confirmed delete
  const handleConfirmDelete = useCallback(async () => {
    if (!memoryToDelete) return;
    const success = await deleteMemory(memoryToDelete.text, memoryToDelete.type, memoryToDelete.date);
    if (success) {
      const msg = memoryToDelete.type === 'section' 
        ? 'Section deleted' 
        : memoryToDelete.type === 'daily'
          ? 'Daily entry deleted'
          : 'Memory deleted';
      showFeedback('success', msg);
      onRefresh();
    } else {
      showFeedback('error', 'Failed to delete memory');
    }
    setMemoryToDelete(null);
  }, [memoryToDelete, deleteMemory, showFeedback, onRefresh]);

  // Handle edit click - opens the editor
  const handleEditClick = useCallback((text: string, type: Memory['type'], date?: string) => {
    if (type === 'section' || type === 'daily') {
      setEditingMemory({ title: text, date });
    }
  }, []);

  // Handle editor save - close editor and refresh
  const handleEditorSave = useCallback(() => {
    setEditingMemory(null);
    showFeedback('success', 'Section updated');
    onRefresh();
  }, [showFeedback, onRefresh]);

  // Handle editor cancel - close editor
  const handleEditorCancel = useCallback(() => {
    setEditingMemory(null);
  }, []);

  const openAddDialog = useCallback(() => setAddDialogOpen(true), []);

  // If editing, show the editor instead of the list
  if (editingMemory) {
    return (
      <MemoryEditor
        agentId={agentId}
        title={editingMemory.title}
        date={editingMemory.date}
        onSave={handleEditorSave}
        onCancel={handleEditorCancel}
      />
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header — only when used standalone (not in workspace tabs) */}
      {!hideHeader && (
        <div className="panel-header border-l-[3px] border-l-purple">
          <span className="panel-label text-purple">
            <span className="panel-diamond">◆</span>
            MEMORY
          </span>
        </div>
      )}

      {/* Feedback toast */}
      <div aria-live="polite" aria-atomic="true">
        {feedback && (
          <div
            className={`px-3 py-1.5 text-[10px] flex items-center gap-1.5 border-b ${
              feedback.type === 'success'
                ? 'bg-green/10 text-green border-green/20'
                : 'bg-red/10 text-red border-red/20'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle size={10} />
            ) : (
              <AlertCircle size={10} />
            )}
            {feedback.message}
          </div>
        )}
      </div>

      {/* Error display */}
      {error && !feedback && (
        <div className="px-3 py-1.5 text-[10px] flex items-center gap-1.5 bg-red/10 text-red border-b border-red/20">
          <AlertCircle size={10} />
          {error}
          <button
            onClick={clearError}
            className="ml-auto text-red/60 hover:text-red focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0 rounded-sm"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* Memory list */}
      <div className="flex-1 overflow-y-auto">
        {initialLoading && !memories.length ? (
          <MemorySkeletonGroup count={6} />
        ) : !memories.length ? (
          <div className="text-muted-foreground px-3 py-4 text-[11px] text-center">
            <p>No memories yet</p>
            <button
              onClick={() => setAddDialogOpen(true)}
              className="mt-2 text-purple hover:underline bg-transparent border-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0 rounded-sm"
            >
              Add your first memory
            </button>
          </div>
        ) : (
          <>
          <div className="flex items-center border-b border-border/40">
            <button
              onClick={openAddDialog}
              className="group flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-foreground/[0.02] transition-colors cursor-pointer flex-1 bg-transparent border-0 text-left focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0"
              aria-label="Add new memory"
            >
              <span className="shrink-0 text-muted-foreground group-hover:text-purple transition-colors">
                <Plus size={12} />
              </span>
              <span className="text-muted-foreground group-hover:text-purple transition-colors">
                Add memory
              </span>
            </button>
            <button
              onClick={() => { clearError(); onRefresh(); }}
              disabled={isLoading}
              className="shrink-0 px-2 py-1.5 bg-transparent border-0 text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0"
              title="Refresh memories"
              aria-label="Refresh memories"
            >
              <RefreshCw size={10} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          {visibleMemories.map((m, i) => (
            <MemoryItem
              key={m.tempId || `${m.type}-${m.text.slice(0, 20)}-${i}`}
              memory={m}
              onDelete={handleDeleteClick}
              onEdit={handleEditClick}
              {...(m.type === 'section' ? {
                isExpanded: expandedSections.has(m.text),
                onToggleExpand: () => toggleSection(m.text),
                itemCount: sectionItemCounts[m.text] || 0,
              } : {})}
              compact={compact}
            />
          ))}
          </>
        )}
      </div>

      {/* Add Memory Dialog */}
      <AddMemoryDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onAdd={handleAddMemory}
        sections={sectionNames}
        isLoading={isLoading}
      />

      {/* Confirm Delete Dialog */}
      <ConfirmDeleteDialog
        agentId={agentId}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        memoryText={memoryToDelete?.text || ''}
        memoryType={memoryToDelete?.type}
        memoryDate={memoryToDelete?.date}
        itemsToDelete={memoryToDelete ? getItemsToDelete(memoryToDelete.text, memoryToDelete.type) : []}
        onConfirm={handleConfirmDelete}
        isLoading={isLoading}
      />
    </div>
  );
}
