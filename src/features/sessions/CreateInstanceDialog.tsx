import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface CopyableConfiguration {
  key: string;
  isSet: boolean;
}

function classifyConfiguration(key: string): { section: string; label: string } {
  if (key.startsWith('AUTH_PROFILE:')) {
    return { section: 'Auth profiles', label: key.slice('AUTH_PROFILE:'.length) };
  }
  if (key.startsWith('OPENCLAW_JSON_ENTRY:skills.entries.')) {
    return { section: 'Skills', label: key.slice('OPENCLAW_JSON_ENTRY:skills.entries.'.length) };
  }
  if (key.startsWith('OPENCLAW_JSON_ENTRY:channels.')) {
    return { section: 'Channels', label: key.slice('OPENCLAW_JSON_ENTRY:channels.'.length) };
  }
  if (key === 'OPENCLAW_JSON_ENTRY:gateway.auth') {
    return { section: 'Gateway', label: 'auth' };
  }
  if (key.startsWith('OPENCLAW_JSON:')) {
    return { section: 'OpenClaw JSON', label: key.slice('OPENCLAW_JSON:'.length) };
  }
  if (key.startsWith('ENV:')) {
    return { section: 'Environment (.env)', label: key.slice('ENV:'.length) };
  }
  return { section: 'Other', label: key };
}

interface CreateInstanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (instanceId: string) => Promise<void> | void;
}

interface CreateInstanceResponse {
  instance?: { id: string };
  error?: { code?: string; message?: string };
}

const CONTAINER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;

/** Dialog for provisioning a new local docker-backed MultiClaw instance. */
export function CreateInstanceDialog({ open, onOpenChange, onCreated }: CreateInstanceDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'docker'>('docker');
  const [configurations, setConfigurations] = useState<CopyableConfiguration[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingConfigurations, setLoadingConfigurations] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setName('');
    setType('docker');
    setSelected(new Set());
    setError('');
  }, []);

  const loadConfigurations = useCallback(async () => {
    setLoadingConfigurations(true);
    setError('');
    try {
      const response = await fetch('/api/instances/credentials');
      const payload = (await response.json().catch(() => ({}))) as {
        configurations?: CopyableConfiguration[];
        credentials?: CopyableConfiguration[];
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message || 'Failed to load copyable configurations.');
      }
      const next = Array.isArray(payload.configurations)
        ? payload.configurations
        : (Array.isArray(payload.credentials) ? payload.credentials : []);
      setConfigurations(next);
      setSelected(new Set(next.filter((entry) => entry.isSet).map((entry) => entry.key)));
    } catch (err) {
      setConfigurations([]);
      setSelected(new Set());
      setError(err instanceof Error ? err.message : 'Failed to load copyable configurations.');
    } finally {
      setLoadingConfigurations(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadConfigurations();
  }, [open, loadConfigurations]);

  const validationMessage = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return 'Name is required.';
    if (trimmed.length > 63) return 'Name must be 63 characters or fewer.';
    if (!CONTAINER_NAME_RE.test(trimmed)) {
      return 'Use letters, numbers, dot, underscore, and dash only; start with alphanumeric.';
    }
    if (type !== 'docker') return 'Only docker type is currently supported.';
    return '';
  }, [name, type]);

  const toggleConfiguration = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const groupedConfigurations = useMemo(() => {
    const groups = new Map<string, CopyableConfiguration[]>();
    for (const entry of configurations) {
      const section = classifyConfiguration(entry.key).section;
      if (!groups.has(section)) groups.set(section, []);
      groups.get(section)?.push(entry);
    }
    return [...groups.entries()];
  }, [configurations]);

  const handleCancel = useCallback(() => {
    if (creating) return;
    reset();
    onOpenChange(false);
  }, [creating, onOpenChange, reset]);

  const handleSubmit = useCallback(async () => {
    const trimmedName = name.trim();
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setCreating(true);
    setError('');
    try {
      const response = await fetch('/api/instances', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          type,
          configurationKeys: [...selected],
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as CreateInstanceResponse;
      if (!response.ok) {
        throw new Error(payload.error?.message || `Create failed (${response.status}).`);
      }
      const createdId = payload.instance?.id;
      if (!createdId) {
        throw new Error('Instance was created but no id was returned.');
      }
      await onCreated(createdId);
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create instance.');
    } finally {
      setCreating(false);
    }
  }, [name, onCreated, onOpenChange, reset, selected, type, validationMessage]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleCancel(); }}>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="text-primary font-mono text-sm tracking-wider uppercase">
            Add Instance
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs">
            Start an extra local instance and choose which master configurations to copy.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. multiclaw-worker-1"
              disabled={creating}
              className="w-full bg-background border border-border/60 text-foreground text-xs font-mono px-2 py-1.5 focus:outline-none focus:border-primary placeholder:text-muted-foreground/50"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'docker')}
              disabled={creating}
              className="w-full bg-background border border-border/60 text-foreground text-xs font-mono px-2 py-1.5 focus:outline-none focus:border-primary"
            >
              <option value="docker">docker</option>
            </select>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Copy Configurations</div>
            <div className="max-h-40 overflow-y-auto border border-border/60 bg-background px-2 py-2">
              {loadingConfigurations ? (
                <div className="text-[11px] text-muted-foreground">Loading configurations…</div>
              ) : configurations.length === 0 ? (
                <div className="text-[11px] text-muted-foreground">No copyable configurations configured on master.</div>
              ) : groupedConfigurations.map(([section, entries]) => (
                <div key={section} className="mb-2">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{section}</div>
                  {entries.map((entry) => {
                    const meta = classifyConfiguration(entry.key);
                    return (
                      <label key={entry.key} className="flex items-center gap-2 text-[11px] text-foreground py-1 font-mono">
                        <input
                          type="checkbox"
                          checked={selected.has(entry.key)}
                          onChange={() => toggleConfiguration(entry.key)}
                          disabled={creating}
                          className="accent-primary"
                        />
                        <span className={entry.isSet ? 'text-foreground' : 'text-muted-foreground'}>{meta.label}</span>
                        {!entry.isSet && <span className="text-[10px] text-muted-foreground">(not set)</span>}
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          {validationMessage && !error && (
            <p className="text-[10px] text-red font-mono">{validationMessage}</p>
          )}
          {error && (
            <p className="text-[10px] text-red font-mono">{error}</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={handleCancel} disabled={creating} className="font-mono text-xs">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={creating || loadingConfigurations || !!validationMessage}
            className="font-mono text-xs bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {creating ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
