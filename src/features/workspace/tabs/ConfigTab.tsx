/**
 * ConfigTab — View and edit workspace config files (SOUL.md, TOOLS.md, etc.)
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw, Pencil, Save, X, CheckCircle, AlertCircle } from 'lucide-react';
import { InlineSelect } from '@/components/ui/InlineSelect';
import { useWorkspaceFile } from '../hooks/useWorkspaceFile';
import { ConfirmDialog } from '@/components/ConfirmDialog';

const FILE_OPTIONS = [
  { key: 'soul', label: 'SOUL.md' },
  { key: 'tools', label: 'TOOLS.md' },
  { key: 'identity', label: 'IDENTITY.md' },
  { key: 'user', label: 'USER.md' },
  { key: 'agents', label: 'AGENTS.md' },
  { key: 'heartbeat', label: 'HEARTBEAT.md' },
];

/** Workspace tab displaying an editable agent config file (YAML/TOML). */
export function ConfigTab() {
  const [selectedKey, setSelectedKey] = useState('soul');
  const { content, isLoading, error, exists, load, save } = useWorkspaceFile();
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [pendingSwitchKey, setPendingSwitchKey] = useState<string | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Clean up feedback timer on unmount
  useEffect(() => () => clearTimeout(feedbackTimer.current), []);

  // Load file when key changes. Reset editing by keying on selectedKey.
  const loadFile = useCallback(() => {
    load(selectedKey);
  }, [selectedKey, load]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

  const showFeedback = useCallback((type: 'success' | 'error', message: string) => {
    clearTimeout(feedbackTimer.current);
    setFeedback({ type, message });
    feedbackTimer.current = setTimeout(() => setFeedback(null), 3000);
  }, []);

  const handleEdit = useCallback(() => {
    setEditContent(content || '');
    setEditing(true);
    // Focus textarea after render
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [content]);

  const handleSave = useCallback(async () => {
    const success = await save(selectedKey, editContent);
    if (success) {
      showFeedback('success', 'File saved');
      setEditing(false);
    } else {
      showFeedback('error', 'Failed to save');
    }
  }, [selectedKey, editContent, save, showFeedback]);

  const handleCancel = useCallback(() => {
    setEditing(false);
  }, []);

  const handleCreate = useCallback(async () => {
    const label = FILE_OPTIONS.find(f => f.key === selectedKey)?.label || selectedKey;
    const template = `# ${label}\n\n`;
    const success = await save(selectedKey, template);
    if (success) {
      showFeedback('success', 'File created');
    }
  }, [selectedKey, save, showFeedback]);

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
      <div className="flex items-center border-b border-border/40">
        <div className="flex-1 px-2 py-1">
          <InlineSelect
            value={selectedKey}
            onChange={(v) => {
              if (editing) {
                setPendingSwitchKey(v);
                return;
              }
              setSelectedKey(v);
              setEditing(false);
            }}
            options={FILE_OPTIONS.map(f => ({ value: f.key, label: f.label }))}
            ariaLabel="Select config file"
          />
        </div>
        <button
          onClick={() => load(selectedKey)}
          disabled={isLoading}
          className="shrink-0 px-2 py-1.5 bg-transparent border-0 text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0"
          title="Refresh"
          aria-label="Refresh file"
        >
          <RefreshCw size={10} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Feedback toast */}
      {feedback && (
        <div className={`px-3 py-1.5 text-[10px] flex items-center gap-1.5 border-b ${
          feedback.type === 'success'
            ? 'bg-green/10 text-green border-green/20'
            : 'bg-red/10 text-red border-red/20'
        }`}>
          {feedback.type === 'success' ? <CheckCircle size={10} /> : <AlertCircle size={10} />}
          {feedback.message}
        </div>
      )}

      {error && (
        <div className="px-3 py-2 text-[10px] text-red bg-red/10">{error}</div>
      )}

      <div className="flex-1 overflow-y-auto">
        {!exists && !isLoading && !error && (
          <div className="text-muted-foreground px-3 py-4 text-[11px] text-center">
            <p>File does not exist yet</p>
            <button
              onClick={handleCreate}
              className="mt-2 text-purple hover:underline bg-transparent border-0 cursor-pointer text-[11px] focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0 rounded-sm"
            >
              Create {FILE_OPTIONS.find(f => f.key === selectedKey)?.label}
            </button>
          </div>
        )}

        {exists && !editing && content !== null && (
          <div className="relative">
            <div className="absolute top-1 right-1 z-10">
              <button
                onClick={handleEdit}
                className="bg-transparent border border-border/60 text-muted-foreground w-6 h-6 cursor-pointer flex items-center justify-center hover:text-purple hover:border-purple transition-colors focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0"
                title="Edit"
                aria-label="Edit file"
              >
                <Pencil size={10} />
              </button>
            </div>
            <pre className="px-3 py-2 text-[11px] text-foreground whitespace-pre-wrap font-mono leading-relaxed">
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
              className="flex-1 w-full px-3 py-2 text-[11px] font-mono bg-background text-foreground border-0 resize-none outline-none focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0 focus-visible:ring-inset"
              spellCheck={false}
            />
            <div className="flex items-center gap-1 px-3 py-1.5 border-t border-border/40">
              <button
                onClick={handleSave}
                disabled={isLoading}
                className="bg-transparent border border-purple/60 text-purple text-[10px] px-2 py-1 cursor-pointer flex items-center gap-1 hover:bg-purple/10 transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0"
              >
                <Save size={10} /> Save
              </button>
              <button
                onClick={handleCancel}
                className="bg-transparent border border-border/60 text-muted-foreground text-[10px] px-2 py-1 cursor-pointer flex items-center gap-1 hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-purple/50 focus-visible:ring-offset-0"
              >
                <X size={10} /> Cancel
              </button>
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
