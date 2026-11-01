/**
 * ConfigTab: view and edit workspace config files (SOUL.md, TOOLS.md, etc.)
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw, Pencil, Save, X, CheckCircle, AlertCircle } from 'lucide-react';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { Button } from '@/components/ui/button';
import { useWorkspaceFile } from '../hooks/useWorkspaceFile';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { createChatPathLinksTemplate, type ChatPathLinksSeedContext } from '@/features/chat/chatPathLinks';
import { Pane } from '@/components/ui/Pane';
import type { InlineSelectOption } from '@/components/ui/InlineSelect';
import { clearPersistedDraft, readPersistedDraft, writePersistedDraft } from '../persistedDrafts';
import {
  CONFIG_FILE_OPTIONS as FILE_OPTIONS,
  CONFIG_SELECT_MENU_CLASS,
  CONFIG_SELECT_TRIGGER_CLASS,
  configFileOptions,
  getInitialSelectedKey,
  rememberSelectedConfigFile,
} from './configFiles';

const NO_VIEW_OPTIONS: InlineSelectOption[] = [];

function getConfigDraftKind(fileKey: string): string {
  return `config-editor:${fileKey}`;
}

function getBrowserPlatformSeed(): ChatPathLinksSeedContext['platform'] {
  if (typeof navigator === 'undefined') return undefined;

  const rawPlatform = (navigator.platform || navigator.userAgent || '').toLowerCase();
  if (rawPlatform.includes('mac')) return 'macos';
  if (rawPlatform.includes('win')) return 'windows';
  if (rawPlatform.includes('linux') || rawPlatform.includes('x11')) return 'linux';
  return undefined;
}

async function createSeededChatPathLinksTemplate(agentId: string): Promise<string> {
  const seedContext: ChatPathLinksSeedContext = {};
  const platform = getBrowserPlatformSeed();
  if (platform) {
    seedContext.platform = platform;
  }

  try {
    const params = new URLSearchParams({ depth: '1', agentId });
    const response = await fetch(`/api/files/tree?${params.toString()}`);

    if (response.ok) {
      const data = await response.json() as { ok?: boolean; workspaceInfo?: { rootPath?: unknown } };
      if (data.ok && typeof data.workspaceInfo?.rootPath === 'string' && data.workspaceInfo.rootPath) {
        seedContext.workspaceRoot = data.workspaceInfo.rootPath;
      }
    }
  } catch {
    // ignore seed lookup failures and fall back to the base template
  }

  return createChatPathLinksTemplate(seedContext);
}

interface ConfigTabProps {
  agentId: string;
  cronWarning?: string | null;
  /** Extra entries at the end of the file picker that switch the panel to another view. */
  viewOptions?: InlineSelectOption[];
  /** Called with the chosen view option's value; unsaved edits are guarded first. */
  onViewChange?: (value: string) => void;
}

/** Workspace tab displaying an editable agent config file (YAML/TOML). */
export function ConfigTab({ agentId, cronWarning = null, viewOptions = NO_VIEW_OPTIONS, onViewChange }: ConfigTabProps) {
  const [selectedKey, setSelectedKey] = useState(() => getInitialSelectedKey(agentId));
  const { content, isLoading, error, exists, load, save } = useWorkspaceFile(agentId);
  const initialDraft = readPersistedDraft<string>(getConfigDraftKind(getInitialSelectedKey(agentId)), agentId);
  const [editing, setEditing] = useState(() => initialDraft !== null);
  const [editContent, setEditContent] = useState(() => initialDraft ?? '');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [pendingSwitchKey, setPendingSwitchKey] = useState<string | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const draftKind = getConfigDraftKind(selectedKey);
  const clearDraft = useCallback((fileKey = selectedKey) => {
    clearPersistedDraft(getConfigDraftKind(fileKey), agentId);
  }, [agentId, selectedKey]);

  // Clean up feedback timer on unmount
  useEffect(() => () => clearTimeout(feedbackTimer.current), []);

  useEffect(() => {
    setSelectedKey(getInitialSelectedKey(agentId));
  }, [agentId]);

  useEffect(() => {
    rememberSelectedConfigFile(agentId, selectedKey);
  }, [agentId, selectedKey]);

  useEffect(() => {
    const storedDraft = readPersistedDraft<string>(draftKind, agentId);
    if (storedDraft !== null) {
      setEditContent(storedDraft);
      setEditing(true);
      return;
    }

    setEditContent('');
    setEditing(false);
  }, [agentId, draftKind]);

  // Load file when key changes. Reset editing by keying on selectedKey.
  const loadFile = useCallback(() => {
    load(selectedKey);
  }, [selectedKey, load]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

  useEffect(() => {
    if (!editing) {
      clearDraft();
      return;
    }

    if (editContent === (content ?? '')) {
      clearDraft();
      return;
    }

    writePersistedDraft(draftKind, agentId, editContent);
  }, [agentId, clearDraft, content, draftKind, editContent, editing]);

  const showFeedback = useCallback((type: 'success' | 'error', message: string) => {
    clearTimeout(feedbackTimer.current);
    setFeedback({ type, message });
    feedbackTimer.current = setTimeout(() => setFeedback(null), 3000);
  }, []);

  const handleEdit = useCallback(() => {
    const storedDraft = readPersistedDraft<string>(draftKind, agentId);
    setEditContent(storedDraft ?? content ?? '');
    setEditing(true);
    // Focus textarea after render
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [agentId, content, draftKind]);

  const handleSave = useCallback(async () => {
    const result = await save(selectedKey, editContent);
    if (result === 'saved') {
      clearDraft();
      showFeedback('success', 'File saved');
      setEditing(false);
      return;
    }

    if (result === 'error') {
      showFeedback('error', 'Failed to save');
    }
  }, [clearDraft, selectedKey, editContent, save, showFeedback]);

  const handleCancel = useCallback(() => {
    clearDraft();
    setEditing(false);
  }, [clearDraft]);

  // The picker holds the workspace files and, when the panel offers it, the Skills view
  const applySelection = useCallback((value: string) => {
    if (viewOptions.some(option => option.value === value)) {
      onViewChange?.(value);
      return;
    }
    setSelectedKey(value);
    setEditing(false);
  }, [onViewChange, viewOptions]);

  const handleEditorKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      void handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  }, [handleCancel, handleSave]);

  const handleCreate = useCallback(async () => {
    const label = FILE_OPTIONS.find(f => f.key === selectedKey)?.label || selectedKey;
    const template = selectedKey === 'chatPathLinks'
      ? await createSeededChatPathLinksTemplate(agentId)
      : `# ${label}\n\n`;
    const result = await save(selectedKey, template);
    if (result === 'saved') {
      showFeedback('success', 'File created');
    }
  }, [agentId, selectedKey, save, showFeedback]);

  // Warn before unload when editing is active (issue #9)
  useEffect(() => {
    if (!editing) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [editing]);

  const selectedLabel = FILE_OPTIONS.find(file => file.key === selectedKey)?.label || selectedKey;
  const dirty = editing && editContent !== (content ?? '');

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex shrink-0 items-center gap-1 border-b border-border py-1 pl-2 pr-1">
        <div className="min-w-0 flex-1">
          <InlineSelect
            inline
            value={selectedKey}
            onChange={(value) => {
              if (value === selectedKey) return;
              if (editing) {
                setPendingSwitchKey(value);
                return;
              }
              applySelection(value);
            }}
            options={[...configFileOptions(), ...viewOptions]}
            ariaLabel="Select config file"
            triggerClassName={CONFIG_SELECT_TRIGGER_CLASS}
            menuClassName={CONFIG_SELECT_MENU_CLASS}
          />
        </div>
        {exists && !editing && content !== null && (
          <button
            onClick={handleEdit}
            className="shell-icon-button shrink-0"
            title="Edit"
            aria-label="Edit file"
          >
            <Pencil size={14} />
          </button>
        )}
        <button
          onClick={() => load(selectedKey)}
          disabled={isLoading}
          className="shell-icon-button shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
          title="Refresh"
          aria-label="Refresh file"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Feedback toast */}
      {feedback && (
        <div className={`flex min-h-[var(--row-unit)] items-center gap-1.5 border-b border-border px-3 text-[0.8rem] ${
          feedback.type === 'success'
            ? 'text-foreground'
            : 'bg-destructive/10 text-destructive'
        }`}>
          {feedback.type === 'success'
            ? <CheckCircle size={14} className="shrink-0 text-muted-foreground" />
            : <AlertCircle size={14} className="shrink-0" />}
          {feedback.message}
        </div>
      )}

      {cronWarning && (
        <div className="border-b border-border px-3 py-2 text-[0.8rem] leading-relaxed text-muted-foreground">
          {cronWarning}
        </div>
      )}

      {error && (
        <div className="border-b border-border bg-destructive/10 px-3 py-2 text-[0.8rem] text-destructive">{error}</div>
      )}

      <div className="flex-1 overflow-y-auto">
        {!exists && !isLoading && !error && (
          <div className="px-3 py-4 text-center text-[0.8rem] text-muted-foreground">
            <p>File does not exist yet</p>
            <button
              onClick={handleCreate}
              className="cockpit-toolbar-button mt-2 cursor-pointer"
            >
              Create {FILE_OPTIONS.find(file => file.key === selectedKey)?.label}
            </button>
          </div>
        )}

        {exists && !editing && content !== null && (
          <pre className="px-3 py-2 text-[0.867rem] text-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-mono leading-relaxed">
            {content}
          </pre>
        )}

        {editing && (
          /* The editor is an operator window: Plate ground that warms while the operator types,
             a pane in its status line, and the same footer as the memory editor */
          <div className="nerve-window-frame flex h-full flex-col">
            <div className="nerve-window flex min-h-0 flex-1 flex-col">
              <textarea
                ref={textareaRef}
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                onKeyDown={handleEditorKeyDown}
                className="w-full flex-1 resize-none whitespace-pre-wrap break-words border-0 bg-transparent px-3 py-2 font-mono text-[0.867rem] leading-relaxed text-foreground outline-none [overflow-wrap:anywhere]"
                spellCheck={false}
                wrap="soft"
                aria-label={`Edit ${selectedLabel}`}
              />
            </div>
            <div className="flex min-h-[var(--row-unit)] shrink-0 items-center justify-between gap-2 border-t border-border py-1 pl-3 pr-1.5">
              <span className="flex min-w-0 items-center gap-2 text-[0.8rem] text-muted-foreground">
                <Pane state="off" size="sm" className="nerve-window-pane" />
                <span className="truncate">{dirty ? 'Unsaved changes' : `Editing ${selectedLabel}`}</span>
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  onClick={handleCancel}
                  variant="outline"
                  size="sm"
                  title="Esc"
                  className="text-[0.8rem] sm:h-6 sm:px-2"
                >
                  <X size={14} /> Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={isLoading}
                  size="sm"
                  title="Ctrl+S"
                  className="text-[0.8rem] sm:h-6 sm:px-2"
                >
                  <Save size={14} /> Save
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingSwitchKey !== null}
        title="Unsaved changes"
        message="You have unsaved changes. Discard and switch files?"
        confirmLabel="Discard"
        cancelLabel="Cancel"
        onConfirm={() => {
          clearDraft();
          if (pendingSwitchKey) {
            applySelection(pendingSwitchKey);
          }
          setPendingSwitchKey(null);
        }}
        onCancel={() => setPendingSwitchKey(null)}
        variant="danger"
      />
    </div>
  );
}
