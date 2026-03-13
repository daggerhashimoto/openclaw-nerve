import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { InlineSelect } from '@/components/ui/InlineSelect';
import type { InlineSelectOption } from '@/components/ui/InlineSelect';
import { useSessionContext, type SpawnSessionOpts } from '@/contexts/SessionContext';
import { getSessionKey } from '@/types';
import {
  getRootAgentSessionKey,
  getSessionDisplayLabel,
  getTopLevelAgentSessions,
} from './sessionKeys';

const FALLBACK_MODELS: InlineSelectOption[] = [
  { value: 'anthropic/claude-haiku-4-5', label: 'claude-haiku-4-5' },
  { value: 'anthropic/claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
  { value: 'anthropic/claude-opus-4-6', label: 'claude-opus-4-6' },
];
const THINKING_LEVELS: InlineSelectOption[] = [
  { value: 'off', label: 'off' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
];

type ModelEntry = { id: string; alias?: string };
type SpawnMode = 'root' | 'subagent' | null;

function deriveAlias(id: string): string {
  return id.includes('/') ? id.split('/', 2)[1] : id;
}

interface SpawnAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSpawn: (opts: SpawnSessionOpts) => Promise<void>;
}

/** Two-step session wizard for new top-level agents and subagents. */
export function SpawnAgentDialog({ open, onOpenChange, onSpawn }: SpawnAgentDialogProps) {
  const { sessions, currentSession, agentName: defaultAgentName } = useSessionContext();

  const [mode, setMode] = useState<SpawnMode>(null);
  const [task, setTask] = useState('');
  const [label, setLabel] = useState('');
  const [agentNameInput, setAgentNameInput] = useState('');
  const [parentRootKey, setParentRootKey] = useState('');
  const [model, setModel] = useState<string>('');
  const [thinking, setThinking] = useState<string>('medium');
  const [spawning, setSpawning] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<ModelEntry[]>([]);
  const [spawnError, setSpawnError] = useState('');

  const rootSessions = useMemo(
    () => getTopLevelAgentSessions(sessions),
    [sessions],
  );
  const hasRootAgents = rootSessions.length > 0;
  const currentRootKey = getRootAgentSessionKey(currentSession)
    || (rootSessions[0] ? getSessionKey(rootSessions[0]) : '');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/gateway/models');
        if (!res.ok) return;
        const data = await res.json() as { models?: Array<{ id: string; label?: string; alias?: string }> };
        if (cancelled || !Array.isArray(data.models)) return;
        setFetchedModels(data.models.map((entry) => ({ id: entry.id, alias: entry.alias || entry.label })));
      } catch {
        // Fallback list is good enough.
      }
    })();

    return () => { cancelled = true; };
  }, [open]);

  const modelOptions = useMemo<InlineSelectOption[]>(() => {
    if (fetchedModels.length > 0) {
      return fetchedModels.map((entry) => ({
        value: entry.id,
        label: entry.alias || deriveAlias(entry.id),
      }));
    }
    return FALLBACK_MODELS;
  }, [fetchedModels]);

  const defaultModelId = useMemo(() => {
    if (fetchedModels.length > 0) {
      const sonnet = fetchedModels.find((entry) => entry.id.includes('sonnet'));
      return sonnet?.id || fetchedModels[0].id;
    }
    return FALLBACK_MODELS[1].value;
  }, [fetchedModels]);

  useEffect(() => {
    if (!model) {
      setModel(defaultModelId);
    }
  }, [defaultModelId, model]);

  useEffect(() => {
    if (!open) return;
    if (parentRootKey && rootSessions.some((session) => getSessionKey(session) === parentRootKey)) {
      return;
    }
    setParentRootKey(currentRootKey);
  }, [open, parentRootKey, rootSessions, currentRootKey]);

  const rootOptions = useMemo<InlineSelectOption[]>(() => {
    return rootSessions.map((session) => ({
      value: getSessionKey(session),
      label: getSessionDisplayLabel(session, defaultAgentName),
    }));
  }, [defaultAgentName, rootSessions]);

  const reset = useCallback(() => {
    setMode(null);
    setTask('');
    setLabel('');
    setAgentNameInput('');
    setParentRootKey(currentRootKey);
    setModel(defaultModelId);
    setThinking('medium');
    setSpawnError('');
  }, [currentRootKey, defaultModelId]);

  const handleLaunch = useCallback(async () => {
    if (!mode || !task.trim()) return;
    if (mode === 'root' && !agentNameInput.trim()) return;
    if (mode === 'subagent' && !parentRootKey.trim()) return;

    setSpawning(true);
    setSpawnError('');
    try {
      if (mode === 'root') {
        await onSpawn({
          kind: 'root',
          agentName: agentNameInput.trim(),
          task: task.trim(),
          model,
          thinking,
        });
      } else {
        await onSpawn({
          kind: 'subagent',
          parentSessionKey: parentRootKey,
          task: task.trim(),
          label: label.trim() || undefined,
          model,
          thinking,
        });
      }
      reset();
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to create session:', err);
      setSpawnError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setSpawning(false);
    }
  }, [agentNameInput, label, mode, model, onOpenChange, onSpawn, parentRootKey, reset, task, thinking]);

  const handleCancel = useCallback(() => {
    if (spawning) return;
    reset();
    onOpenChange(false);
  }, [onOpenChange, reset, spawning]);

  const handleBack = useCallback(() => {
    if (spawning) return;
    setMode(null);
    setSpawnError('');
  }, [spawning]);

  const rootNamePreview = agentNameInput.trim() || 'New agent';
  const disableLaunch = spawning
    || !mode
    || !task.trim()
    || (mode === 'root' && !agentNameInput.trim())
    || (mode === 'subagent' && !parentRootKey.trim());

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) handleCancel(); }}>
      <DialogContent className="max-w-xl overflow-visible">
        {mode === null ? (
          <>
            <DialogHeader>
              <div className="cockpit-kicker">
                <span className="text-primary">◆</span>
                Session Control
              </div>
              <DialogTitle className="text-[1.35rem] font-semibold tracking-[-0.03em] text-foreground">
                Create session
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                Start a fresh top-level agent, or hand a focused job to an existing root.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode('root')}
                className="shell-chip flex min-h-[164px] flex-col items-start gap-3 rounded-[24px] border border-border/70 bg-background/40 p-5 text-left transition-transform hover:-translate-y-px hover:border-primary/60"
              >
                <span className="cockpit-badge" data-tone="success">Top-level</span>
                <div>
                  <div className="text-base font-semibold text-foreground">New agent</div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Create another root session with its own chat thread and its own subagent branch.
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!hasRootAgents) return;
                  setMode('subagent');
                }}
                disabled={!hasRootAgents}
                className="shell-chip flex min-h-[164px] flex-col items-start gap-3 rounded-[24px] border border-border/70 bg-background/40 p-5 text-left transition-transform hover:-translate-y-px hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:border-border/70"
              >
                <span className="cockpit-badge" data-tone="info">Attached</span>
                <div>
                  <div className="text-base font-semibold text-foreground">New subagent</div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {hasRootAgents
                      ? 'Pick a root agent first, then launch a focused child session beneath it.'
                      : 'Create a top-level agent first, then attach focused child sessions beneath it.'}
                  </p>
                </div>
              </button>
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={handleCancel} className="text-xs">
                Cancel
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={handleBack} disabled={spawning} className="h-9 px-3 text-xs">
                  Back
                </Button>
                <div className="cockpit-kicker">
                  <span className="text-primary">◆</span>
                  {mode === 'root' ? 'Top-level agent' : 'Subagent'}
                </div>
              </div>
              <DialogTitle className="text-[1.35rem] font-semibold tracking-[-0.03em] text-foreground">
                {mode === 'root' ? 'Configure new agent' : 'Configure subagent'}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {mode === 'root'
                  ? 'Name the new root agent, then give it the opening task and runtime defaults.'
                  : 'Choose which root should own the new child session, then set the task and runtime defaults.'}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              {mode === 'root' ? (
                <div>
                  <label className="cockpit-field-label mb-2 block">Agent name</label>
                  <input
                    type="text"
                    value={agentNameInput}
                    onChange={(e) => setAgentNameInput(e.target.value)}
                    placeholder="e.g. reviewer"
                    className="cockpit-input"
                  />
                  <p className="cockpit-note mt-2">
                    This becomes the root session label and the stable session branch for child agents.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="cockpit-field-label mb-2 block">Parent agent</label>
                  <InlineSelect
                    value={parentRootKey}
                    onChange={setParentRootKey}
                    options={rootOptions.length > 0 ? rootOptions : [{ value: '', label: 'No root agents available' }]}
                    ariaLabel="Select parent agent"
                    disabled={spawning || rootOptions.length === 0}
                    triggerClassName="min-h-11 w-full justify-between rounded-2xl border-border/80 bg-background/65 px-3 py-2 text-sm font-sans text-foreground"
                    menuClassName="rounded-2xl border-border/80 bg-card/98 p-1 shadow-[0_20px_48px_rgba(0,0,0,0.28)]"
                    inline
                  />
                  <p className="cockpit-note mt-2">
                    Subagents stay attached to the selected root and report back into that branch.
                  </p>
                </div>
              )}

              <div>
                <label className="cockpit-field-label mb-2 block">
                  {mode === 'root' ? `Opening task for ${rootNamePreview}` : 'Task / prompt'}
                </label>
                <textarea
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  placeholder={mode === 'root' ? 'What should this new agent start working on?' : 'What should this subagent do?'}
                  rows={3}
                  className="cockpit-textarea min-h-[132px]"
                />
              </div>

              {mode === 'subagent' && (
                <div>
                  <label className="cockpit-field-label mb-2 block">Label (optional)</label>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. audit-auth-flow"
                    className="cockpit-input cockpit-input-mono"
                  />
                </div>
              )}

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="cockpit-field-label mb-2 block">Model</label>
                  <InlineSelect
                    value={model}
                    onChange={setModel}
                    options={modelOptions}
                    ariaLabel="Select model"
                    disabled={spawning}
                    triggerClassName="min-h-11 w-full justify-between rounded-2xl border-border/80 bg-background/65 px-3 py-2 text-sm font-sans text-foreground"
                    menuClassName="rounded-2xl border-border/80 bg-card/98 p-1 shadow-[0_20px_48px_rgba(0,0,0,0.28)]"
                    inline
                  />
                </div>
                <div className="flex-1">
                  <label className="cockpit-field-label mb-2 block">Thinking</label>
                  <InlineSelect
                    value={thinking}
                    onChange={setThinking}
                    options={THINKING_LEVELS}
                    ariaLabel="Select thinking level"
                    disabled={spawning}
                    triggerClassName="min-h-11 w-full justify-between rounded-2xl border-border/80 bg-background/65 px-3 py-2 text-sm font-sans text-foreground"
                    menuClassName="rounded-2xl border-border/80 bg-card/98 p-1 shadow-[0_20px_48px_rgba(0,0,0,0.28)]"
                    inline
                  />
                </div>
              </div>

              {spawnError && (
                <p className="cockpit-note" data-tone="danger">{spawnError}</p>
              )}
              {spawning && (
                <p className="cockpit-note animate-pulse">
                  {mode === 'root' ? 'Bringing the new root agent online...' : 'Waiting for the new subagent to appear...'}
                </p>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={handleCancel} disabled={spawning} className="text-xs">
                Cancel
              </Button>
              <Button type="button" onClick={handleLaunch} disabled={disableLaunch} className="min-w-[132px] text-xs">
                {spawning ? (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                    Launching...
                  </span>
                ) : mode === 'root' ? 'Create agent' : 'Launch subagent'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
