import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import type { Session } from '@/types';
import { getSessionKey } from '@/types';
import { SessionSkeletonGroup } from '@/components/skeletons';
import { buildSessionTree, flattenTree, getSessionType } from './sessionTree';
import { SessionNode } from './SessionNode';
import type { GranularAgentState } from '@/types';
import type { DiscoveredInstance } from '@/contexts/InstanceContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Plus, Square, Trash2 } from 'lucide-react';
import { SpawnAgentDialog } from './SpawnAgentDialog';
import { CreateInstanceDialog } from './CreateInstanceDialog';

interface SessionListProps {
  instances?: DiscoveredInstance[];
  instancesLoading?: boolean;
  activeInstanceId?: string | null;
  onSelectInstance?: (id: string | null) => void;
  onRefreshInstances?: () => Promise<void> | void;
  sessions: Session[];
  currentSession: string;
  busyState: Record<string, boolean>;
  agentStatus?: Record<string, GranularAgentState>;
  unreadSessions?: Record<string, boolean>;
  onSelect: (key: string) => void;
  onRefresh: () => void;
  onDelete?: (sessionKey: string) => Promise<void>;
  onSpawn?: (opts: { task: string; label?: string; model: string; thinking: string }) => Promise<void>;
  onRename?: (sessionKey: string, label: string) => Promise<void>;
  onAbort?: (sessionKey: string) => Promise<void>;
  isLoading?: boolean;
  agentName?: string;
  /** Render in compact dropdown mode (chat-first topbar panel). */
  compact?: boolean;
}

/** Sidebar list of agent sessions with tree structure and context menus. */
export function SessionList({
  instances = [],
  instancesLoading = false,
  activeInstanceId = null,
  onSelectInstance,
  onRefreshInstances,
  sessions,
  currentSession,
  busyState,
  agentStatus,
  unreadSessions,
  onSelect,
  onRefresh,
  onDelete,
  onSpawn,
  onRename,
  onAbort,
  isLoading,
  agentName = 'Agent',
  compact = false,
}: SessionListProps) {
  const [deleteTarget, setDeleteTarget] = useState<{ key: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [createInstanceOpen, setCreateInstanceOpen] = useState(false);
  const [instanceMutatingId, setInstanceMutatingId] = useState<string | null>(null);
  const [instanceMutationError, setInstanceMutationError] = useState('');
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [expandedState, setExpandedState] = useState<Record<string, boolean>>({});

  const handleDelete = useCallback(async () => {
    if (!deleteTarget || !onDelete) return;
    setDeleting(true);
    try {
      await onDelete(deleteTarget.key);
    } catch (err) {
      console.error('Failed to delete session:', err);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, onDelete]);

  const startRename = useCallback((sessionKey: string, currentLabel: string) => {
    setRenamingKey(sessionKey);
    setRenameValue(currentLabel);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  }, []);

  const commitRename = useCallback(async () => {
    if (!renamingKey || !onRename) return;
    const trimmed = renameValue.trim();
    if (trimmed) {
      try { await onRename(renamingKey, trimmed); } catch (err) { console.error('Failed to rename session:', err); }
    }
    setRenamingKey(null);
  }, [renamingKey, renameValue, onRename]);

  const cancelRename = useCallback(() => {
    setRenamingKey(null);
  }, []);

  const handleRenameChange = useCallback((value: string) => {
    setRenameValue(value);
  }, []);

  const handleToggleExpand = useCallback((key: string) => {
    setExpandedState((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
  }, []);

  const handleSetDeleteTarget = useCallback((key: string, label: string) => {
    setDeleteTarget({ key, label });
  }, []);

  const handleInstanceCreated = useCallback(async (_instanceId: string) => {
    if (onRefreshInstances) await onRefreshInstances();
    // Keep operator on current context (usually master) until new instance is actually ready.
  }, [onRefreshInstances]);

  const stopInstance = useCallback(async (instance: DiscoveredInstance) => {
    if (!onRefreshInstances) return;
    setInstanceMutationError('');
    setInstanceMutatingId(instance.id);
    try {
      const response = await fetch(`/api/instances/${encodeURIComponent(instance.id)}/stop`, {
        method: 'POST',
      });
      const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message || 'Failed to stop instance.');
      }
      await onRefreshInstances();
    } catch (err) {
      setInstanceMutationError(err instanceof Error ? err.message : 'Failed to stop instance.');
    } finally {
      setInstanceMutatingId(null);
    }
  }, [onRefreshInstances]);

  const removeInstance = useCallback(async (instance: DiscoveredInstance) => {
    if (!onRefreshInstances) return;
    const confirmed = window.confirm(`Remove instance "${instance.name || instance.id}"? This also removes its managed local state.`);
    if (!confirmed) return;

    setInstanceMutationError('');
    setInstanceMutatingId(instance.id);
    try {
      const response = await fetch(`/api/instances/${encodeURIComponent(instance.id)}`, {
        method: 'DELETE',
      });
      const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message || 'Failed to remove instance.');
      }
      if (activeInstanceId === instance.id) {
        onSelectInstance?.(null);
      }
      await onRefreshInstances();
    } catch (err) {
      setInstanceMutationError(err instanceof Error ? err.message : 'Failed to remove instance.');
    } finally {
      setInstanceMutatingId(null);
    }
  }, [activeInstanceId, onRefreshInstances, onSelectInstance]);

  const prevPercentsRef = useRef<Record<string, number>>({});
  const prevTokensRef = useRef<Record<string, number>>({});

  // Calculate which sessions are growing (compare to previous render via ref)
  const growingSessions = useMemo(() => {
    const result: Record<string, boolean> = {};
    sessions.forEach(s => {
      const sessionKey = getSessionKey(s);
      const used = s.totalTokens || 0;
      const max = s.contextTokens || 200000;
      const pct = Math.min(100, Math.round((used / max) * 100));
      const prevPct = prevPercentsRef.current[sessionKey];
      result[sessionKey] = prevPct !== undefined && pct > prevPct;
    });
    return result;
  }, [sessions]);

  // Update refs AFTER render
  useEffect(() => {
    sessions.forEach(s => {
      const sessionKey = getSessionKey(s);
      const used = s.totalTokens || 0;
      const max = s.contextTokens || 200000;
      const pct = Math.min(100, Math.round((used / max) * 100));
      prevPercentsRef.current[sessionKey] = pct;
      if (used > 0) {
        prevTokensRef.current[sessionKey] = used;
      }
    });
  }, [sessions]);

  // Build tree and flatten for rendering
  const tree = useMemo(() => buildSessionTree(sessions), [sessions]);
  const flatNodes = useMemo(() => flattenTree(tree, expandedState), [tree, expandedState]);

  return (
    <div className={compact ? 'flex flex-col max-h-[65vh]' : 'h-full flex flex-col min-h-0'}>
      <div className="panel-header border-l-[3px] border-l-info">
        <span className="panel-label text-info">
          <span className="panel-diamond">◆</span>
          INSTANCES
        </span>
        {onRefreshInstances && (
          <div className="flex items-center gap-1 ml-auto">
            <button
              type="button"
              onClick={() => setCreateInstanceOpen(true)}
              aria-label="Add instance"
              title="Add instance"
              className="bg-transparent border border-border/60 text-muted-foreground text-sm w-7 h-7 cursor-pointer flex items-center justify-center hover:text-foreground hover:border-muted-foreground"
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              onClick={onRefreshInstances}
              aria-label="Refresh instances"
              title="Refresh instances"
              className="bg-transparent border border-border/60 text-muted-foreground text-sm w-7 h-7 cursor-pointer flex items-center justify-center hover:text-foreground hover:border-muted-foreground"
            >
              <span aria-hidden="true">↻</span>
            </button>
          </div>
        )}
      </div>
      <div className={compact ? 'overflow-y-auto border-b border-border/60' : 'max-h-44 overflow-y-auto border-b border-border/60'}>
        <button
          type="button"
          onClick={() => onSelectInstance?.(null)}
          className={`w-full text-left px-3 py-2 text-xs border-l-[2px] transition-colors ${
            activeInstanceId === null
              ? 'border-l-info bg-info/10 text-foreground'
              : 'border-l-transparent text-muted-foreground hover:text-foreground hover:bg-muted/20'
          }`}
        >
          <div className="font-mono">Master</div>
          <div className="text-[10px] uppercase tracking-wider opacity-70">local control plane</div>
        </button>
        {instancesLoading && instances.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">Discovering instances…</div>
        ) : instances.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">No instances discovered</div>
        ) : instances.map((instance) => {
          const status = instance.availability || instance.state || instance.status || 'unknown';
          const running = /running/i.test(status);
          const mutating = instanceMutatingId === instance.id;

          return (
            <div
              key={instance.id}
              className={`w-full px-2 py-1.5 text-xs border-l-[2px] transition-colors ${
                activeInstanceId === instance.id
                  ? 'border-l-info bg-info/10 text-foreground'
                  : 'border-l-transparent text-muted-foreground hover:text-foreground hover:bg-muted/20'
              }`}
              title={instance.id}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSelectInstance?.(instance.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="font-mono truncate">{instance.name || instance.id}</div>
                  <div className="text-[10px] uppercase tracking-wider opacity-70 truncate">{status}</div>
                </button>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void stopInstance(instance)}
                    disabled={mutating || !running || !onRefreshInstances}
                    title={running ? 'Stop instance' : 'Instance already stopped'}
                    className="bg-transparent border border-border/60 text-muted-foreground text-[10px] w-6 h-6 cursor-pointer flex items-center justify-center hover:text-foreground hover:border-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Square size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeInstance(instance)}
                    disabled={mutating || !onRefreshInstances}
                    title="Remove instance"
                    className="bg-transparent border border-border/60 text-muted-foreground text-[10px] w-6 h-6 cursor-pointer flex items-center justify-center hover:text-red hover:border-red disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {instanceMutationError && (
          <div className="px-3 py-2 text-[10px] text-red font-mono border-t border-border/40">{instanceMutationError}</div>
        )}
      </div>

      <div className="panel-header border-l-[3px] border-l-info">
        <span className="panel-label text-info">
          <span className="panel-diamond">◆</span>
          AGENTS
        </span>
        <div className="flex items-center gap-1 ml-auto">
          {onSpawn && (
            <button
              type="button"
              onClick={() => setSpawnOpen(true)}
              aria-label="Launch subagent"
              title="Launch subagent"
              className="bg-transparent border border-border/60 text-muted-foreground text-sm w-7 h-7 cursor-pointer flex items-center justify-center hover:text-foreground hover:border-muted-foreground"
            >
              <Plus size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh sessions"
            title="Refresh sessions"
            className="bg-transparent border border-border/60 text-muted-foreground text-sm w-7 h-7 cursor-pointer flex items-center justify-center hover:text-foreground hover:border-muted-foreground"
          >
            <span aria-hidden="true">↻</span>
          </button>
        </div>
      </div>
      <div className={compact ? 'overflow-y-auto' : 'flex-1 overflow-y-auto'}>
        {isLoading && !sessions.length ? (
          <SessionSkeletonGroup count={4} />
        ) : !sessions.length ? (
          <div className="text-muted-foreground px-3 py-2 text-[11px]">No active sessions</div>
        ) : flatNodes.map((node) => {
          const sessionKey = node.key;
          const sessionType = getSessionType(sessionKey);
          const isSubagent = sessionType === 'subagent';
          const isCron = sessionType === 'cron';
          const isCronRun = sessionType === 'cron-run';
          const label = node.session.label || (
            sessionKey === 'agent:main:main' ? `${agentName} (main)` :
            isCron ? `Cron ${sessionKey.split(':')[3]?.slice(0, 8) || ''}` :
            isCronRun ? `Run ${sessionKey.split(':').pop()?.slice(0, 8) || ''}` :
            sessionKey.split(':').pop()?.slice(0, 10) || sessionKey
          );
          const isGrowing = growingSessions[sessionKey] ?? false;
          const running = busyState[sessionKey] || node.session.state === 'running' || node.session.agentState === 'running' || node.session.busy || node.session.processing || node.session.status === 'running' || node.session.status === 'busy' || (isGrowing && sessionKey.includes('subagent'));
          const isActive = sessionKey === currentSession;
          const currentTokens = node.session.totalTokens || 0;
          const prevTokens = prevTokensRef.current[sessionKey] || 0;
          const displayTokens = Math.max(currentTokens, prevTokens);
          const isExpanded = expandedState[sessionKey] ?? !isCron;

          return (
            <SessionNode
              key={sessionKey}
              node={node}
              isActive={isActive}
              isGrowing={isGrowing}
              running={running}
              displayTokens={displayTokens}
              label={label}
              isExpanded={isExpanded}
              hasChildren={node.children.length > 0}
              isSubagent={isSubagent}
              isCron={isCron}
              isCronRun={isCronRun}
              isUnread={unreadSessions?.[sessionKey] ?? false}
              isRenaming={renamingKey === sessionKey}
              renameValue={renameValue}
              renameInputRef={renameInputRef}
              agentName={agentName}
              granularStatus={agentStatus?.[sessionKey]}
              onSelect={onSelect}
              onToggleExpand={handleToggleExpand}
              onDelete={onDelete ? handleSetDeleteTarget : undefined}
              onStartRename={onRename ? startRename : undefined}
              onAbort={onAbort}
              onRenameChange={handleRenameChange}
              onRenameCommit={commitRename}
              onRenameCancel={cancelRename}
              compact={compact}
            />
          );
        })}
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red font-mono text-sm tracking-wider uppercase flex items-center gap-2">
              <AlertTriangle size={16} />
              Delete Session
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs">
              This will permanently delete the session and archive its transcript.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="bg-background border border-border/60 px-3 py-2">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Session:</p>
              <p className="text-[12px] text-foreground font-mono">{deleteTarget?.label}</p>
              <p className="text-[10px] text-muted-foreground font-mono mt-1 break-all">{deleteTarget?.key}</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="font-mono text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="font-mono text-xs bg-red text-foreground hover:bg-red/90"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Spawn subagent dialog */}
      {onSpawn && (
        <SpawnAgentDialog
          open={spawnOpen}
          onOpenChange={setSpawnOpen}
          onSpawn={onSpawn}
        />
      )}
      <CreateInstanceDialog
        open={createInstanceOpen}
        onOpenChange={setCreateInstanceOpen}
        onCreated={handleInstanceCreated}
      />
    </div>
  );
}
