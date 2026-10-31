import { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeft, ArrowRight, Bot, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Pane } from '@/components/ui/Pane';
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

const INHERITED_THINKING_VALUE = 'thinkingDefault';

type ThinkingSelection = typeof INHERITED_THINKING_VALUE | 'off' | 'low' | 'medium' | 'high' | 'adaptive';

const THINKING_LEVELS: InlineSelectOption[] = [
  { value: INHERITED_THINKING_VALUE, label: 'Default' },
  { value: 'off', label: 'off' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'adaptive', label: 'adaptive' },
];
const AFTER_RUN_OPTIONS: InlineSelectOption[] = [
  { value: 'keep', label: 'Keep' },
  { value: 'delete', label: 'Delete' },
];
const INHERITED_MODEL_VALUE = 'primary';

// Flat choice plates: neutral hover, no lift, no glow
const CHOICE_CARD = 'flex min-h-[200px] flex-col gap-3 rounded-[3px] border border-border bg-card p-4 text-left transition-colors duration-[120ms] hover:bg-raised';
const CHOICE_ICON = 'flex size-8 shrink-0 items-center justify-center rounded-[3px] border border-border text-muted-foreground';
const CHOICE_POINTS = 'grid list-disc gap-x-4 gap-y-0.5 pl-4 text-[0.8rem] text-muted-foreground marker:text-pane-edge sm:grid-cols-2';
const SELECT_TRIGGER = 'w-full min-h-11 justify-between rounded-[3px] border-input bg-background px-2.5 py-1.5 font-sans text-[0.867rem] text-foreground sm:min-h-[2.133rem] sm:px-2.5 sm:py-0 sm:text-[0.867rem]';
const SELECT_MENU = 'p-1';

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
  const [thinking, setThinking] = useState<ThinkingSelection>(INHERITED_THINKING_VALUE);
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
    if (fetchedModels.length === 0) return [];
    return [
      { value: INHERITED_MODEL_VALUE, label: INHERITED_MODEL_VALUE },
      ...fetchedModels.map((entry) => ({
        value: entry.id,
        label: entry.alias || deriveAlias(entry.id),
      })),
    ];
  }, [fetchedModels]);

  const visibleModelOptions = useMemo<InlineSelectOption[]>(() => {
    if (modelOptions.length > 0) return modelOptions;
    return [{ value: '', label: 'No configured models' }];
  }, [modelOptions]);

  const defaultModelId = useMemo(
    () => (fetchedModels.length > 0 ? INHERITED_MODEL_VALUE : ''),
    [fetchedModels],
  );

  useEffect(() => {
    if (fetchedModels.length === 0) {
      if (model !== '') setModel('');
      return;
    }

    const hasValidSelection = model === INHERITED_MODEL_VALUE || fetchedModels.some((entry) => entry.id === model);
    if (!hasValidSelection) {
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
    setThinking(INHERITED_THINKING_VALUE);
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
    const spawnModel = model === INHERITED_MODEL_VALUE ? undefined : model;
    const spawnThinking = thinking === INHERITED_THINKING_VALUE ? undefined : thinking;
    try {
      const spawnResult = mode === 'root'
        ? await onSpawn({
            kind: 'root',
            agentName: agentNameInput.trim(),
            task: task.trim(),
            model: spawnModel,
            thinking: spawnThinking,
          })
        : await onSpawn({
            kind: 'subagent',
            parentSessionKey: parentRootKey,
            task: task.trim(),
            label: label.trim() || undefined,
            model: spawnModel,
            thinking: spawnThinking,
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
            ? 'max-h-[calc(100dvh-1.067rem)] overflow-y-auto overscroll-contain sm:max-h-[min(100dvh-4rem,54rem)] sm:overflow-visible sm:max-w-3xl'
            : 'max-h-[calc(100dvh-1.067rem)] overflow-y-auto overscroll-contain sm:max-h-[min(100dvh-4rem,48rem)] sm:overflow-visible sm:max-w-xl'
        }
      >
        {mode === null ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-[1.2rem] font-semibold text-foreground">
                Choose the kind of agent you want to start
              </DialogTitle>
              <DialogDescription className="max-w-[60ch] text-[0.867rem] leading-relaxed text-muted-foreground">
                Pick whether this is a new top-level agent with its own chat and subagents, or a focused subagent that plugs into an existing top-level agent.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode('root')}
                className={CHOICE_CARD}
              >
                <div className="flex items-center gap-3">
                  <span className={CHOICE_ICON}>
                    <Bot size={16} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[0.933rem] font-semibold text-foreground">New agent</div>
                    <div className="text-[0.8rem] text-muted-foreground">Top-level agent, independent</div>
                  </div>
                </div>

                <p className="text-[0.867rem] leading-relaxed text-muted-foreground">
                  Create another top-level agent with its own chat, its own subagents, and its own scheduled work.
                </p>

                <ul className={CHOICE_POINTS}>
                  <li>Own root conversation</li>
                  <li>Own subagents</li>
                  <li>Rename or delete later</li>
                  <li>Good for separate roles</li>
                </ul>

                <div className="mt-auto flex items-center justify-between border-t border-border pt-2.5 text-[0.867rem]">
                  <span className="text-muted-foreground">Start a new top-level agent</span>
                  <span className="flex items-center gap-1 font-medium text-foreground">
                    Continue
                    <ArrowRight size={14} aria-hidden="true" />
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!hasRootAgents) return;
                  setMode('subagent');
                }}
                disabled={!hasRootAgents}
                className={cn(CHOICE_CARD, 'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-card')}
              >
                <div className="flex items-center gap-3">
                  <span className={CHOICE_ICON}>
                    <GitBranch size={16} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[0.933rem] font-semibold text-foreground">New subagent</div>
                    <div className="text-[0.8rem] text-muted-foreground">Attached child, focused</div>
                  </div>
                </div>

                <p className="text-[0.867rem] leading-relaxed text-muted-foreground">
                  Spin up a focused subagent under an existing top-level agent so the result stays attached to that agent.
                </p>

                <ul className={CHOICE_POINTS}>
                  <li>Pick which root owns the work</li>
                  <li>Best for audits, one-off tasks, and parallel help</li>
                </ul>

                <div className="mt-auto flex items-center justify-between border-t border-border pt-2.5 text-[0.867rem]">
                  <span className="text-muted-foreground">
                    {hasRootAgents ? 'Attach work to an existing agent' : 'Needs a top-level agent first'}
                  </span>
                  <span className="flex items-center gap-1 font-medium text-foreground">
                    {hasRootAgents ? 'Continue' : 'Locked'}
                    <ArrowRight size={14} aria-hidden="true" />
                  </span>
                </div>

                {!hasRootAgents && (
                  <div className="cockpit-note">
                    Create a top-level agent first, then come back here to launch attached subagents.
                  </div>
                )}
              </button>
            </div>

            <DialogFooter className="items-center justify-between gap-3 sm:flex-row">
              <p className="text-[0.8rem] leading-relaxed text-muted-foreground">
                Top-level agents are full sessions. Subagents are short-lived specialists that stay under one of those agents.
              </p>
              <Button type="button" variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="xs" onClick={handleBack} disabled={spawning} className="text-[0.8rem]">
                  <ArrowLeft size={14} aria-hidden="true" />
                  Back
                </Button>
              </div>
              <DialogTitle className="text-[1.2rem] font-semibold text-foreground">
                {mode === 'root' ? 'Configure new agent' : 'Configure subagent'}
              </DialogTitle>
              <DialogDescription className="text-[0.867rem] text-muted-foreground">
                {mode === 'root'
                  ? 'Name the new top-level agent, then give it the opening task and runtime defaults.'
                  : 'Choose which top-level agent should own the new subagent, then set the task and runtime defaults.'}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              {mode === 'root' ? (
                <div>
                  <label className="cockpit-field-label mb-1.5 block">Agent name</label>
                  <input
                    type="text"
                    value={agentNameInput}
                    onChange={(e) => setAgentNameInput(e.target.value)}
                    placeholder="e.g. reviewer"
                    className="cockpit-input"
                  />
                  <p className="cockpit-field-hint mt-1.5">
                    This becomes the top-level session label and the stable agent identity for its subagents.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="cockpit-field-label mb-1.5 block">Parent agent</label>
                  <InlineSelect
                    value={parentRootKey}
                    onChange={setParentRootKey}
                    options={rootOptions.length > 0 ? rootOptions : [{ value: '', label: 'No root agents available' }]}
                    ariaLabel="Select parent agent"
                    disabled={spawning || rootOptions.length === 0}
                    triggerClassName={SELECT_TRIGGER}
                    menuClassName={SELECT_MENU}
                    inline
                  />
                  <p className="cockpit-field-hint mt-1.5">
                    Subagents stay attached to the selected top-level agent and report back into that session.
                  </p>
                </div>
              )}

              <div>
                <label className="cockpit-field-label mb-1.5 block">
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
                  <label className="cockpit-field-label mb-1.5 block">Label (optional)</label>
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
                  <label className="cockpit-field-label mb-1.5 block">After run</label>
                  <InlineSelect
                    value={cleanup}
                    onChange={(value) => setCleanup(value as SubagentCleanupMode)}
                    options={AFTER_RUN_OPTIONS}
                    ariaLabel="After run"
                    disabled={spawning}
                    triggerClassName={SELECT_TRIGGER}
                    menuClassName={SELECT_MENU}
                    inline
                  />
                  <p className="cockpit-field-hint mt-1.5">
                    Keep leaves the finished subagent visible. Delete removes it automatically after the run ends.
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="cockpit-field-label mb-1.5 block">Model</label>
                  <InlineSelect
                    value={model}
                    onChange={setModel}
                    options={visibleModelOptions}
                    ariaLabel="Select model"
                    disabled={spawning || modelOptions.length === 0}
                    triggerClassName={SELECT_TRIGGER}
                    menuClassName={SELECT_MENU}
                    inline
                  />
                </div>
                <div className="flex-1">
                  <label className="cockpit-field-label mb-1.5 block">Thinking</label>
                  <InlineSelect
                    value={thinking}
                    onChange={(value) => setThinking(value as ThinkingSelection)}
                    options={THINKING_LEVELS}
                    ariaLabel="Select thinking level"
                    disabled={spawning}
                    triggerClassName={SELECT_TRIGGER}
                    menuClassName={SELECT_MENU}
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
                <p className="cockpit-note flex items-center gap-2">
                  <Pane state="live" size="sm" />
                  {mode === 'root' ? 'Bringing the new root agent online...' : 'Waiting for the new subagent to appear...'}
                </p>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={handleCancel} disabled={spawning}>
                Cancel
              </Button>
              <Button type="button" onClick={handleLaunch} disabled={disableLaunch} className="min-w-[132px]">
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
