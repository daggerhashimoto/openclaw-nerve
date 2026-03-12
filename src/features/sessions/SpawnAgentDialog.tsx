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

function deriveAlias(id: string): string {
  return id.includes('/') ? id.split('/', 2)[1] : id;
}

interface SpawnAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSpawn: (opts: { task: string; label?: string; model: string; thinking: string }) => Promise<void>;
}

/** Dialog for spawning a new sub-agent session. */
export function SpawnAgentDialog({ open, onOpenChange, onSpawn }: SpawnAgentDialogProps) {
  const [task, setTask] = useState('');
  const [label, setLabel] = useState('');
  const [model, setModel] = useState<string>('');
  const [thinking, setThinking] = useState<string>('medium');
  const [spawning, setSpawning] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<ModelEntry[]>([]);

  // Fetch available models from gateway when dialog opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/gateway/models');
        if (!res.ok) return;
        const data = await res.json() as { models?: Array<{ id: string; label?: string; alias?: string }> };
        if (cancelled || !Array.isArray(data.models)) return;
        setFetchedModels(data.models.map(m => ({ id: m.id, alias: m.alias || m.label })));
      } catch { /* use fallback */ }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Set default model after fetching (prefer sonnet)
  useEffect(() => {
    if (fetchedModels.length > 0 && !model) {
      const sonnet = fetchedModels.find(m => m.id.includes('sonnet'));
      setModel(sonnet?.id || fetchedModels[0].id);
    }
  }, [fetchedModels, model]);

  const modelOptions = useMemo<InlineSelectOption[]>(() => {
    if (fetchedModels.length > 0) {
      return fetchedModels.map(m => ({
        value: m.id,
        label: m.alias || deriveAlias(m.id),
      }));
    }
    return FALLBACK_MODELS;
  }, [fetchedModels]);

  const defaultModelId = useMemo(() => {
    if (fetchedModels.length > 0) {
      const sonnet = fetchedModels.find(m => m.id.includes('sonnet'));
      return sonnet?.id || fetchedModels[0].id;
    }
    return FALLBACK_MODELS[1].value; // sonnet
  }, [fetchedModels]);

  const reset = useCallback(() => {
    setTask('');
    setLabel('');
    setModel(defaultModelId);
    setThinking('medium');
  }, [defaultModelId]);

  const [spawnError, setSpawnError] = useState('');

  const handleLaunch = useCallback(async () => {
    if (!task.trim()) return;
    setSpawning(true);
    setSpawnError('');
    try {
      await onSpawn({ task: task.trim(), label: label.trim() || undefined, model, thinking });
      reset();
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to spawn agent:', err);
      setSpawnError(err instanceof Error ? err.message : 'Failed to spawn agent');
    } finally {
      setSpawning(false);
    }
  }, [task, label, model, thinking, onSpawn, onOpenChange, reset]);

  const handleCancel = useCallback(() => {
    reset();
    onOpenChange(false);
  }, [onOpenChange, reset]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !spawning) handleCancel(); }}>
      <DialogContent className="max-w-xl overflow-visible">
        <DialogHeader>
          <div className="cockpit-kicker">
            <span className="text-primary">◆</span>
            Session Control
          </div>
          <DialogTitle className="text-[1.35rem] font-semibold tracking-[-0.03em] text-foreground">
            Launch subagent
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Give a focused task, choose the model, and let the new session run in parallel.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div>
            <label className="cockpit-field-label mb-2 block">Task / Prompt</label>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="What should this agent do?"
              rows={3}
              className="cockpit-textarea min-h-[132px]"
            />
          </div>
          <div>
            <label className="cockpit-field-label mb-2 block">Label (optional)</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. refactor-auth"
              className="cockpit-input cockpit-input-mono"
            />
          </div>
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
            <p className="cockpit-note animate-pulse">Waiting for the new session to come online...</p>
          )}
          {!spawning && !spawnError && (
            <p className="cockpit-note">Tip: ask the main agent to manage subagents when you want orchestration instead of manual spawning.</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={handleCancel} disabled={spawning} className="text-xs">
            Cancel
          </Button>
          <Button type="button" onClick={handleLaunch} disabled={spawning || !task.trim()} className="min-w-[118px] text-xs">
            {spawning ? (
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Spawning…
              </span>
            ) : 'Launch'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
