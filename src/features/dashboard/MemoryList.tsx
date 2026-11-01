/**
 * MemoryList — Memory panel with view, add, edit, and delete functionality.
 *
 * Displays memories from MEMORY.md and daily files, with actions to
 * add new memories, edit sections inline, and delete via the OpenClaw gateway.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Plus, RefreshCw, AlertCircle, CheckCircle, ChevronRight, X } from 'lucide-react';
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
  /** True when the workspace lives in a remote sandbox. */
  remoteWorkspace?: boolean;
  /** Compact mode for mobile/topbar dropdown; uses kebab actions for rows. */
  compact?: boolean;
}

/**
 * An item has no editor of its own: editing it opens the section that holds it,
 * which is the nearest section above it in the list. Items with no section
 * (none in practice) get no edit action.
 */
function editParentSectionOf(
  list: Memory[],
  index: number,
  openEditor: (text: string, type: Memory['type'], date?: string) => void,
): (() => void) | undefined {
  for (let j = index - 1; j >= 0; j--) {
    if (list[j].type === 'section') {
      const title = list[j].text;
      return () => openEditor(title, 'section');
    }
  }
  return undefined;
}

interface EditingMemoryState {
  title: string;
  date?: string;
}

const MEMORY_EDITOR_STATE_KIND = 'memory-editor:active';

/** Searchable, editable list of agent memories with add/delete support. */
export function MemoryList({ agentId, memories: initialMemories, onRefresh, isLoading: initialLoading, hideHeader, remoteWorkspace = false, compact = false }: MemoryListProps) {
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
  
  // Collapse state — sections are collapsed by default; the dated notes group starts open
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [dailyExpanded, setDailyExpanded] = useState(true);

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

  // MEMORY.md sections and items first, then the dated notes under one collapsible group
  const listMemories = useMemo(() => visibleMemories.filter((m) => m.type !== 'daily'), [visibleMemories]);
  const dailyMemories = useMemo(() => visibleMemories.filter((m) => m.type === 'daily'), [visibleMemories]);

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
        <div className="panel-header">
          <span className="panel-label">Memory</span>
        </div>
      )}

      {/* Feedback toast */}
      <div aria-live="polite" aria-atomic="true">
        {feedback && (
          <div
            className={`min-h-[var(--row-unit)] px-3 py-1 text-[0.8rem] flex items-center gap-2 border-b border-border ${
              feedback.type === 'success' ? 'text-foreground' : 'text-destructive'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle size={14} className="text-muted-foreground" aria-hidden="true" />
            ) : (
              <AlertCircle size={14} aria-hidden="true" />
            )}
            {feedback.message}
          </div>
        )}
      </div>

      {/* Error display */}
      {error && !feedback && (
        <div className="min-h-[var(--row-unit)] px-3 py-1 text-[0.8rem] flex items-center gap-2 text-destructive border-b border-border">
          <AlertCircle size={14} aria-hidden="true" />
          {error}
          <button
            onClick={clearError}
            className="shell-icon-button ml-auto text-muted-foreground"
            aria-label="Dismiss error"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Remote workspace notice */}
      {remoteWorkspace ? (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-muted-foreground text-[0.8rem] text-center max-w-[260px]">
            <p className="font-medium text-foreground mb-1">Sandboxed workspace</p>
            <p>Memory management is not available when the workspace lives inside an OpenClaw sandbox. View and edit memories directly on the gateway host.</p>
          </div>
        </div>
      ) : (
      /* Memory list */
      <div className="flex-1 overflow-y-auto">
        {initialLoading && !memories.length ? (
          <MemorySkeletonGroup count={6} />
        ) : !memories.length ? (
          <div className="text-muted-foreground px-3 py-4 text-[0.8rem] text-center">
            <p>No memories yet</p>
            <button
              onClick={() => setAddDialogOpen(true)}
              className="mt-2 text-foreground underline decoration-pane-edge underline-offset-4 hover:decoration-operator bg-transparent border-0 cursor-pointer rounded-[2px]"
            >
              Add your first memory
            </button>
          </div>
        ) : (
          <>
          <div className="flex items-center border-b border-border">
            <button
              onClick={openAddDialog}
              className="group flex items-center gap-2 min-h-[var(--row-unit)] px-3 text-[0.867rem] text-muted-foreground hover:bg-raised hover:text-foreground transition-colors duration-[120ms] cursor-pointer flex-1 bg-transparent border-0 text-left"
              aria-label="Add new memory"
            >
              <Plus size={14} className="shrink-0" aria-hidden="true" />
              <span>Add memory</span>
            </button>
            <button
              onClick={() => { clearError(); onRefresh(); }}
              disabled={isLoading}
              className="shell-icon-button shrink-0 disabled:opacity-50"
              title="Refresh memories"
              aria-label="Refresh memories"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} aria-hidden="true" />
            </button>
          </div>
          {listMemories.map((m, i) => (
            <MemoryItem
              key={m.tempId || `${m.type}-${m.text.slice(0, 20)}-${i}`}
              memory={m}
              onDelete={handleDeleteClick}
              onEdit={m.type === 'item' ? editParentSectionOf(listMemories, i, handleEditClick) : handleEditClick}
              {...(m.type === 'section' ? {
                isExpanded: expandedSections.has(m.text),
                onToggleExpand: () => toggleSection(m.text),
                itemCount: sectionItemCounts[m.text] || 0,
              } : {})}
              compact={compact}
            />
          ))}
          {dailyMemories.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setDailyExpanded((open) => !open)}
                aria-expanded={dailyExpanded}
                className="flex min-h-[var(--row-unit)] w-full cursor-pointer items-center gap-2 border-0 bg-transparent pl-3 pr-[4.667rem] text-left text-[0.867rem] transition-colors duration-[120ms] hover:bg-raised"
              >
                <ChevronRight
                  size={14}
                  aria-hidden="true"
                  className={`shrink-0 text-muted-foreground ${dailyExpanded ? 'rotate-90' : ''}`}
                />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">Daily notes</span>
                <span className="shrink-0 font-mono text-[0.8rem] text-muted-foreground tabular">{dailyMemories.length}</span>
              </button>
              {dailyExpanded && dailyMemories.map((m, i) => (
                <MemoryItem
                  key={m.tempId || `daily-${m.date ?? ''}-${m.text.slice(0, 20)}-${i}`}
                  memory={m}
                  onDelete={handleDeleteClick}
                  onEdit={handleEditClick}
                  compact={compact}
                />
              ))}
            </>
          )}
          </>
        )}
      </div>
      )}

      {!remoteWorkspace && (<>
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
      </>)}
    </div>
  );
}
