/**
 * ConfigTab — View and edit workspace config files (SOUL.md, TOOLS.md, etc.)
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw, Pencil, Save, X, CheckCircle, AlertCircle } from 'lucide-react';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { Button } from '@/components/ui/button';
import { useWorkspaceFile } from '../hooks/useWorkspaceFile';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { createChatPathLinksTemplate, type ChatPathLinksSeedContext } from '@/features/chat/chatPathLinks';
import { getWorkspaceStorageKey } from '../workspaceScope';
import { clearPersistedDraft, readPersistedDraft, writePersistedDraft } from '../persistedDrafts';

const FILE_OPTIONS = [
  { key: 'soul', label: 'SOUL.md' },
  { key: 'tools', label: 'TOOLS.md' },
  { key: 'identity', label: 'IDENTITY.md' },
  { key: 'user', label: 'USER.md' },
  { key: 'agents', label: 'AGENTS.md' },
  { key: 'heartbeat', label: 'HEARTBEAT.md' },
  { key: 'chatPathLinks', label: 'CHAT_PATH_LINKS.json' },
];

const DEFAULT_CONFIG_KEY = 'soul';

function getSelectedConfigStorageKey(agentId: string): string {
  return getWorkspaceStorageKey('config:selected-file', agentId);
}

function getInitialSelectedKey(agentId: string): string {
  try {
    const stored = localStorage.getItem(getSelectedConfigStorageKey(agentId));
    if (stored && FILE_OPTIONS.some(file => file.key === stored)) {
      return stored;
    }
  } catch {
    // ignore storage errors
  }

  return DEFAULT_CONFIG_KEY;
}

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
}

/** Workspace tab displaying an editable agent config file (YAML/TOML). */
export function ConfigTab({ agentId, cronWarning = null }: ConfigTabProps) {
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
    try {
      localStorage.setItem(getSelectedConfigStorageKey(agentId), selectedKey);
    } catch {
      // ignore storage errors
    }
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

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 border-b border-border/60 bg-gradient-to-r from-secondary/84 to-card/80 px-3 py-3">
        <div className="min-w-0 flex-1">
          <InlineSelect
            inline
            value={selectedKey}
            onChange={(value) => {
              if (editing) {
                setPendingSwitchKey(value);
                return;
              }
              setSelectedKey(value);
              setEditing(false);
            }}
            options={FILE_OPTIONS.map(file => ({ value: file.key, label: file.label }))}
            ariaLabel="Select config file"
            triggerClassName="min-h-10 w-full justify-between rounded-2xl border-border/80 bg-background/65 px-3 py-2 text-sm font-sans text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
            menuClassName="rounded-2xl border-border/80 bg-card/98 p-1 shadow-[0_20px_48px_rgba(0,0,0,0.28)]"
          />
        </div>
        <button
          onClick={() => load(selectedKey)}
          disabled={isLoading}
          className="shell-icon-button size-10 shrink-0 px-0 disabled:cursor-not-allowed disabled:opacity-50"
          title="Refresh"
          aria-label="Refresh file"
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Feedback toast */}
      {feedback && (
        <div className={`px-3 py-1.5 text-[0.667rem] flex items-center gap-1.5 border-b ${
          feedback.type === 'success'
            ? 'bg-green/10 text-green border-green/20'
            : 'bg-red/10 text-red border-red/20'
        }`}>
          {feedback.type === 'success' ? <CheckCircle size={10} /> : <AlertCircle size={10} />}
          {feedback.message}
        </div>
      )}

      {cronWarning && (
        <div className="px-3 py-2 text-[0.667rem] border-b border-orange/20 bg-orange/10 text-orange">
          {cronWarning}
        </div>
      )}

      {error && (
        <div className="px-3 py-2 text-[0.667rem] text-red bg-red/10">{error}</div>
      )}

      <div className="flex-1 overflow-y-auto">
        {!exists && !isLoading && !error && (
          <div className="text-muted-foreground px-3 py-4 text-[0.733rem] text-center">
            <p>File does not exist yet</p>
            <button
              onClick={handleCreate}
              className="mt-2 text-purple hover:underline bg-transparent border-0 cursor-pointer text-[0.733rem] focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0 rounded-sm"
            >
              Create {FILE_OPTIONS.find(file => file.key === selectedKey)?.label}
            </button>
          </div>
        )}

        {exists && !editing && content !== null && (
          <div className="relative">
            <div className="absolute top-2 right-2 z-10">
              <button
                onClick={handleEdit}
                className="shell-icon-button size-9 px-0"
                title="Edit"
                aria-label="Edit file"
              >
                <Pencil size={14} />
              </button>
            </div>
            <pre className="px-3 py-2 text-[0.733rem] text-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-mono leading-relaxed">
              {content}
            </pre>
          </div>
        )}

        {editing && (
          <div className="flex flex-col h-full">
            <textarea
              ref={textareaRef}
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              className="flex-1 w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] px-3 py-2 text-[0.733rem] font-mono bg-background text-foreground border-0 resize-none outline-none focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0 focus-visible:ring-inset"
              spellCheck={false}
              wrap="soft"
            />
            <div className="flex items-center gap-2 border-t border-border/60 bg-secondary/28 px-3 py-2">
              <Button
                onClick={handleSave}
                disabled={isLoading}
                size="sm"
                className="text-[0.733rem] uppercase tracking-[0.12em]"
              >
                <Save size={12} /> Save
              </Button>
              <Button
                onClick={handleCancel}
                variant="outline"
                size="sm"
                className="text-[0.733rem] uppercase tracking-[0.12em]"
              >
                <X size={12} /> Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingSwitchKey !== null}
        title="Unsaved Changes"
        message="You have unsaved changes. Discard and switch files?"
        confirmLabel="Discard"
        cancelLabel="Cancel"
        onConfirm={() => {
          clearDraft();
          if (pendingSwitchKey) {
            setSelectedKey(pendingSwitchKey);
            setEditing(false);
          }
          setPendingSwitchKey(null);
        }}
        onCancel={() => setPendingSwitchKey(null)}
        variant="danger"
      />
    </div>
  );
}
