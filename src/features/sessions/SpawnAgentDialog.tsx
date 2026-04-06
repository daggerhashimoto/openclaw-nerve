import { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowRight, Bot, GitBranch } from 'lucide-react';
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
import { useSessionContext, type SpawnSessionOpts, type SubagentCleanupMode } from '@/contexts/SessionContext';
import { getSessionKey } from '@/types';
import {
  getRootAgentSessionKey,
  getSessionDisplayLabel,
  getTopLevelAgentSessions,
} from './sessionKeys';

const THINKING_LEVELS: InlineSelectOption[] = [
  { value: 'off', label: 'off' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
];
const AFTER_RUN_OPTIONS: InlineSelectOption[] = [
  { value: 'keep', label: 'Keep' },
  { value: 'delete', label: 'Delete' },
];

type ModelEntry = { id: string; alias?: string };
type ModelCatalogResponse = {
  models?: Array<{ id: string; label?: string; alias?: string }>;
  error?: string | null;
};
type SpawnMode = 'root' | 'subagent' | null;

function deriveAlias(id: string): string {
  return id.includes('/') ? id.split('/', 2)[1] : id;
}

interface SpawnAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSpawn: (opts: SpawnSessionOpts) => Promise<void | boolean>;
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
  const [cleanup, setCleanup] = useState<SubagentCleanupMode>('keep');
  const [spawning, setSpawning] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<ModelEntry[]>([]);
  const [modelLoadError, setModelLoadError] = useState('');
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
    setFetchedModels([]);
    setModelLoadError('');

    (async () => {
      try {
        const res = await fetch('/api/gateway/models');
        if (!res.ok) {
          if (!cancelled) setModelLoadError('Could not load configured models');
          return;
        }
        const data = await res.json() as ModelCatalogResponse;
        if (cancelled) return;
        const models = Array.isArray(data.models)
          ? data.models.map((entry) => ({ id: entry.id, alias: entry.alias || entry.label }))
          : [];
        setFetchedModels(models);
        setModelLoadError(typeof data.error === 'string' ? data.error : '');
      } catch {
        if (!cancelled) setModelLoadError('Could not load configured models');
      }
    })();

    return () => { cancelled = true; };
  }, [open]);

  const modelOptions = useMemo<InlineSelectOption[]>(() => {
    return fetchedModels.map((entry) => ({
      value: entry.id,
      label: entry.alias || deriveAlias(entry.id),
    }));
  }, [fetchedModels]);

  const visibleModelOptions = useMemo<InlineSelectOption[]>(() => {
    if (modelOptions.length > 0) return modelOptions;
    return [{ value: '', label: 'No configured models' }];
  }, [modelOptions]);

  const defaultModelId = useMemo(() => fetchedModels[0]?.id || '', [fetchedModels]);

  useEffect(() => {
    if (fetchedModels.length === 0) {
      if (model !== '') setModel('');
      return;
    }

    if (!model || !fetchedModels.some((entry) => entry.id === model)) {
      setModel(defaultModelId);
    }
  }, [defaultModelId, fetchedModels, model]);

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
    setCleanup('keep');
    setModelLoadError('');
    setSpawnError('');
  }, [currentRootKey, defaultModelId]);

  const handleLaunch = useCallback(async () => {
    if (!mode || !task.trim() || !model.trim()) return;
    if (mode === 'root' && !agentNameInput.trim()) return;
    if (mode === 'subagent' && !parentRootKey.trim()) return;

    setSpawning(true);
    setSpawnError('');
    try {
      const spawnResult = mode === 'root'
        ? await onSpawn({
            kind: 'root',
            agentName: agentNameInput.trim(),
            task: task.trim(),
            model,
            thinking,
          })
        : await onSpawn({
            kind: 'subagent',
            parentSessionKey: parentRootKey,
            task: task.trim(),
            label: label.trim() || undefined,
            model,
            thinking,
            cleanup,
          });

      if (spawnResult !== false) {
        reset();
        onOpenChange(false);
      }
    } catch (err) {
      console.error('Failed to create session:', err);
      setSpawnError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setSpawning(false);
    }
  }, [agentNameInput, cleanup, label, mode, model, onOpenChange, onSpawn, parentRootKey, reset, task, thinking]);

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
    || !model.trim()
    || (mode === 'root' && !agentNameInput.trim())
    || (mode === 'subagent' && !parentRootKey.trim());

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) handleCancel(); }}>
      <DialogContent
        className={
          mode === null
            ? 'max-h-[calc(100dvh-1.067rem)] overflow-y-auto overscroll-contain sm:max-h-[min(100dvh-4rem,54rem)] sm:overflow-visible sm:max-w-4xl lg:max-w-[72rem]'
            : 'max-h-[calc(100dvh-1.067rem)] overflow-y-auto overscroll-contain sm:max-h-[min(100dvh-4rem,48rem)] sm:overflow-visible sm:max-w-xl'
        }
      >
        {mode === null ? (
          <>
            <DialogHeader>
              <div className="cockpit-surface overflow-hidden border-border/80 bg-secondary/34 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="cockpit-kicker">
                      <span className="text-primary">◆</span>
                      Session Control
                    </div>
                    <DialogTitle className="text-[1.45rem] font-semibold tracking-[-0.035em] text-foreground">
                      Choose the kind of agent you want to start
                    </DialogTitle>
                    <DialogDescription className="max-w-[42ch] text-sm leading-6 text-muted-foreground">
                      Pick whether this is a new top-level agent with its own chat and subagents, or a focused subagent that plugs into an existing top-level agent.
                    </DialogDescription>
                  </div>
                  <div className="hidden min-w-[170px] rounded-[20px] border border-border/70 bg-background/60 p-3 sm:block">
                    <div className="text-[0.667rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground/80">2-step flow</div>
                    <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                      <div className="flex items-center gap-2 text-foreground">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/18 text-[0.667rem] font-semibold text-primary">1</span>
                        Choose agent type
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted/70 text-[0.667rem] font-semibold text-muted-foreground">2</span>
                        Configure the runtime
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-[1.06fr_0.94fr]">
              <button
                type="button"
                onClick={() => setMode('root')}
                className="group relative overflow-hidden rounded-[26px] border border-border/80 bg-card/88 p-0 text-left transition-transform hover:-translate-y-px hover:border-primary/60"
              >
                <span className="pointer-events-none absolute -right-10 top-0 h-28 w-28 rounded-full bg-primary/10 blur-2xl transition-opacity group-hover:opacity-100" />
                <span className="pointer-events-none absolute left-0 top-0 h-full w-1.5 bg-primary/60" />
                <div className="relative flex min-h-[218px] flex-col gap-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-12 w-12 items-center justify-center rounded-[16px] border border-primary/25 bg-primary/12 text-primary">
                        <Bot size={20} />
                      </span>
                      <div className="space-y-1">
                        <span className="cockpit-badge" data-tone="success">Top-level agent</span>
                        <div className="text-base font-semibold tracking-[-0.02em] text-foreground">New agent</div>
                      </div>
                    </div>
                    <span className="text-[0.667rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground/80">Independent</span>
                  </div>

                  <div className="space-y-2">
                    <p className="max-w-[30ch] text-sm leading-6 text-muted-foreground">
                      Create another top-level agent with its own chat, its own subagents, and its own scheduled work.
                    </p>
                  </div>

                  <div className="grid gap-2 text-[0.8rem] text-muted-foreground sm:grid-cols-2">
                    <div className="rounded-[16px] border border-border/70 bg-background/46 px-3 py-2.5">
                      Own root conversation
                    </div>
                    <div className="rounded-[16px] border border-border/70 bg-background/46 px-3 py-2.5">
                      Own subagents
                    </div>
                    <div className="rounded-[16px] border border-border/70 bg-background/46 px-3 py-2.5">
                      Rename or delete later
                    </div>
                    <div className="rounded-[16px] border border-border/70 bg-background/46 px-3 py-2.5">
                      Good for separate roles
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between border-t border-border/70 pt-3 text-sm">
                    <span className="font-medium text-foreground">Start a new top-level agent</span>
                    <span className="flex items-center gap-1 text-primary transition-transform group-hover:translate-x-0.5">
                      Continue
                      <ArrowRight size={15} />
                    </span>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!hasRootAgents) return;
                  setMode('subagent');
                }}
                disabled={!hasRootAgents}
                className="group relative overflow-hidden rounded-[26px] border border-border/80 bg-card/84 p-0 text-left transition-transform hover:-translate-y-px hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:border-border/80"
              >
                <span className="pointer-events-none absolute -left-8 bottom-0 h-24 w-24 rounded-full bg-info/10 blur-2xl transition-opacity group-hover:opacity-100" />
                <span className="pointer-events-none absolute left-0 top-0 h-full w-1.5 bg-info/55" />
                <div className="relative flex min-h-[218px] flex-col gap-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-12 w-12 items-center justify-center rounded-[16px] border border-info/25 bg-info/12 text-info">
                        <GitBranch size={20} />
                      </span>
                      <div className="space-y-1">
                        <span className="cockpit-badge" data-tone="info">Attached child</span>
                        <div className="text-base font-semibold tracking-[-0.02em] text-foreground">New subagent</div>
                      </div>
                    </div>
                    <span className="text-[0.667rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground/80">Focused</span>
                  </div>

                  <div className="space-y-2">
                    <p className="max-w-[30ch] text-sm leading-6 text-muted-foreground">
                      Spin up a focused subagent under an existing top-level agent so the result stays attached to that agent.
                    </p>
                  </div>

                  <div className="grid gap-2 text-[0.8rem] text-muted-foreground">
                    <div className="rounded-[16px] border border-border/70 bg-background/46 px-3 py-2.5">
                      Pick which root owns the work
                    </div>
                    <div className="rounded-[16px] border border-border/70 bg-background/46 px-3 py-2.5">
                      Best for audits, one-off tasks, and parallel help
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between border-t border-border/70 pt-3 text-sm">
                    <span className="font-medium text-foreground">
                      {hasRootAgents ? 'Attach work to an existing agent' : 'Needs a top-level agent first'}
                    </span>
                    <span className="flex items-center gap-1 text-info transition-transform group-hover:translate-x-0.5">
                      {hasRootAgents ? 'Continue' : 'Locked'}
                      <ArrowRight size={15} />
                    </span>
                  </div>

                  {!hasRootAgents && (
                    <div className="rounded-[16px] border border-border/70 bg-background/58 px-3 py-2 text-[0.8rem] leading-5 text-muted-foreground">
                      Create a top-level agent first, then come back here to launch attached subagents.
                    </div>
                  )}
                </div>
              </button>
            </div>

            <DialogFooter className="items-center justify-between gap-3 sm:flex-row">
              <p className="text-[0.8rem] leading-5 text-muted-foreground">
                Top-level agents are full sessions. Subagents are short-lived specialists that stay under one of those agents.
              </p>
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
                  ? 'Name the new top-level agent, then give it the opening task and runtime defaults.'
                  : 'Choose which top-level agent should own the new subagent, then set the task and runtime defaults.'}
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
                    This becomes the top-level session label and the stable agent identity for its subagents.
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
                  <p className="cockpit-field-hint mt-2">
                    Subagents stay attached to the selected top-level agent and report back into that session.
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

              {mode === 'subagent' && (
                <div>
                  <label className="cockpit-field-label mb-2 block">After run</label>
                  <InlineSelect
                    value={cleanup}
                    onChange={(value) => setCleanup(value as SubagentCleanupMode)}
                    options={AFTER_RUN_OPTIONS}
                    ariaLabel="After run"
                    disabled={spawning}
                    triggerClassName="min-h-11 w-full justify-between rounded-2xl border-border/80 bg-background/65 px-3 py-2 text-sm font-sans text-foreground"
                    menuClassName="rounded-2xl border-border/80 bg-card/98 p-1 shadow-[0_20px_48px_rgba(0,0,0,0.28)]"
                    inline
                  />
                  <p className="cockpit-field-hint mt-2">
                    Keep leaves the finished subagent visible. Delete removes it automatically after the run ends.
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="cockpit-field-label mb-2 block">Model</label>
                  <InlineSelect
                    value={model}
                    onChange={setModel}
                    options={visibleModelOptions}
                    ariaLabel="Select model"
                    disabled={spawning || modelOptions.length === 0}
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

              {modelLoadError && (
                <p className="cockpit-note" data-tone="danger">{modelLoadError}</p>
              )}
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
