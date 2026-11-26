import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import type { Session } from '@/types';
import { getSessionKey } from '@/types';
import type { AgentWorkspaceInfo, RemoveAgentOpts, SpawnSessionOpts } from '@/contexts/SessionContext';
import { cn } from '@/lib/utils';
import { SessionSkeletonGroup } from '@/components/skeletons';
import { buildAgentSidebarTree, buildSessionTree, flattenTree, getSessionType, type TreeNode } from './sessionTree';
import { getSessionDisplayLabel, isTopLevelAgentSessionKey } from './sessionKeys';
import { SessionNode } from './SessionNode';
import { getRootAgentId } from './sessionKeys';
import { setAgentHue, shadeFor, useAgentHues } from '@/lib/agentColors';
import type { GranularAgentState } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Plus, RefreshCw } from 'lucide-react';
import { SpawnAgentDialog } from './SpawnAgentDialog';
import { isUndeletableSessionKey } from './sessionDeletion';
import { usePinnedSessions } from './pinnedSessions';

interface SessionListProps {
  sessions: Session[];
  currentSession: string;
  busyState: Record<string, boolean>;
  agentStatus?: Record<string, GranularAgentState>;
  unreadSessions?: Record<string, boolean>;
  onSelect: (key: string) => void;
  onRefresh: () => void;
  onDelete?: (sessionKey: string) => Promise<void>;
  /** Removes a top-level agent through agents.delete; offered on top-level agent rows when given. */
  onRemoveAgent?: (agentId: string, opts: RemoveAgentOpts) => Promise<void>;
  /** Looks up the agent's workspace for the remove dialog, which shows it and what Trash will do with it. */
  getAgentWorkspace?: (agentId: string) => Promise<AgentWorkspaceInfo | null>;
  onSpawn?: (opts: SpawnSessionOpts) => Promise<void | boolean>;
  onRename?: (sessionKey: string, label: string) => Promise<void>;
  onAbort?: (sessionKey: string) => Promise<void>;
  isLoading?: boolean;
  agentName?: string;
  /** Render in compact dropdown mode (chat-first topbar panel). */
  compact?: boolean;
}

/** Every node in row order, ignoring collapse: used to find every agent family present. */
function flattenAll(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      out.push(node);
      if (node.children.length > 0) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

function countDescendants(node: ReturnType<typeof buildSessionTree>[number]): number {
  return node.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}

function findNodeByKey(nodes: ReturnType<typeof buildSessionTree>, key: string): ReturnType<typeof buildSessionTree>[number] | null {
  const queue = [...nodes];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.key === key) return node;
    queue.push(...node.children);
  }
  return null;
}

/** Why the gateway refused a rename, in a few words for the line under the field. */
function describeRenameFailure(err: unknown): string {
  const message = (err instanceof Error ? err.message : String(err ?? '')).trim();
  if (/^label already in use\b/i.test(message)) return 'Name already in use';
  const reason = message.replace(/^invalid label:\s*/i, 'Name ');
  if (!reason) return 'Rename failed';
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}

type RemoveMode = 'keep' | 'trash';

/** The two ways an agent can leave OpenClaw, as agents.delete's deleteFiles flag offers them. */
const REMOVE_MODES: { value: RemoveMode; label: string }[] = [
  { value: 'keep', label: 'Keep files on disk' },
  { value: 'trash', label: 'Move files to Trash' },
];

/** Why the workspace stays, for each way it can overlap another agent's (AgentWorkspaceInfo). */
const OVERLAP_REASONS: Record<NonNullable<AgentWorkspaceInfo['overlap']>['relation'], (agentId: string) => string> = {
  inside: (agentId) => `it sits inside ${agentId}'s workspace`,
  contains: (agentId) => `${agentId}'s workspace sits inside it`,
  same: (agentId) => `${agentId} uses the same folder`,
};

/**
 * What a mode does with the agent's files. agents.delete never moves a workspace that overlaps
 * another agent's to the Trash, so the Trash hint says so when the lookup found one.
 */
function removeModeHint(mode: RemoveMode, workspace: AgentWorkspaceInfo | undefined): string {
  if (mode === 'keep') return 'Its workspace, memory and history stay where they are.';
  if (!workspace) return "Its sessions and state go to the system Trash, and its workspace too unless it overlaps another agent's workspace.";
  if (workspace.overlap) {
    const reason = OVERLAP_REASONS[workspace.overlap.relation](workspace.overlap.agentId);
    return `Its sessions and state go to the system Trash. Its workspace stays: ${reason}.`;
  }
  return 'Its workspace, sessions and state go to the system Trash.';
}

/** Sidebar list of agent sessions with tree structure and context menus. */
export function SessionList({ sessions, currentSession, busyState, agentStatus, unreadSessions, onSelect, onRefresh, onDelete, onRemoveAgent, getAgentWorkspace, onSpawn, onRename, onAbort, isLoading, agentName = 'Agent', compact = false }: SessionListProps) {
  const [deleteTarget, setDeleteTarget] = useState<{ key: string; label: string; descendantCount: number; isRootAgent: boolean; error?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ agentId: string; label: string; workspace?: AgentWorkspaceInfo; error?: string } | null>(null);
  const [removeMode, setRemoveMode] = useState<RemoveMode>('keep');
  const [removing, setRemoving] = useState(false);
  // Set at once on confirm, so a second click before the button re-renders disabled sends nothing.
  const removingRef = useRef(false);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  // The open edit: the name it opened with, the name the gateway last refused, and whether a save is in flight.
  // A ref, so a blur fired as the field closes or while a save runs cannot send the name again.
  const renameRef = useRef<{ key: string; original: string; refused: string | null; saving: boolean } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [expandedState, setExpandedState] = useState<Record<string, boolean>>({});
  const { pinnedKeys, togglePin } = usePinnedSessions();

  const handleDelete = useCallback(async () => {
    if (!deleteTarget || !onDelete) return;
    setDeleting(true);
    setDeleteTarget({ ...deleteTarget, error: undefined });
    try {
      await onDelete(deleteTarget.key);
      setDeleteTarget(null);
    } catch (err) {
      console.error('Failed to delete session:', err);
      // Keep the dialog open so the operator can see why nothing, or only part of the tree, was deleted.
      setDeleteTarget({ ...deleteTarget, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, onDelete]);

  const handleRemoveAgent = useCallback(async () => {
    if (!removeTarget || !onRemoveAgent || removingRef.current) return;
    removingRef.current = true;
    setRemoving(true);
    setRemoveTarget((target) => (target ? { ...target, error: undefined } : target));
    try {
      await onRemoveAgent(removeTarget.agentId, { deleteFiles: removeMode === 'trash' });
      setRemoveTarget(null);
    } catch (err) {
      console.error('Failed to remove agent:', err);
      // Keep the dialog open with the gateway's reason; nothing was removed.
      const error = err instanceof Error ? err.message : String(err);
      setRemoveTarget((target) => (target ? { ...target, error } : target));
    } finally {
      removingRef.current = false;
      setRemoving(false);
    }
  }, [removeTarget, removeMode, onRemoveAgent]);

  const startRename = useCallback((sessionKey: string, currentLabel: string) => {
    renameRef.current = { key: sessionKey, original: currentLabel.trim(), refused: null, saving: false };
    setRenamingKey(sessionKey);
    setRenameValue(currentLabel);
    setRenameError(null);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  }, []);

  const cancelRename = useCallback(() => {
    renameRef.current = null;
    setRenamingKey(null);
    setRenameError(null);
  }, []);

  const commitRename = useCallback(async () => {
    const edit = renameRef.current;
    if (!edit || edit.saving) return;
    const label = renameValue.trim();
    // An empty or unchanged name is not a rename: close without asking the gateway.
    if (!onRename || !label || label === edit.original) {
      cancelRename();
      return;
    }
    edit.saving = true;
    try {
      await onRename(edit.key, label);
      if (renameRef.current === edit) cancelRename();
    } catch (err) {
      if (renameRef.current !== edit) {
        console.error('Failed to rename session:', err);
        return;
      }
      // Keep the field open with what the operator typed, and say why.
      edit.refused = label;
      setRenameError(describeRenameFailure(err));
    } finally {
      edit.saving = false;
    }
  }, [renameValue, onRename, cancelRename]);

  const blurRename = useCallback(() => {
    const edit = renameRef.current;
    // Leaving a refused name as it was abandons the edit instead of sending it again.
    if (edit?.refused && edit.refused === renameValue.trim()) {
      cancelRename();
      return;
    }
    void commitRename();
  }, [renameValue, commitRename, cancelRename]);

  const handleRenameChange = useCallback((value: string) => {
    setRenameValue(value);
  }, []);

  const handleToggleExpand = useCallback((key: string) => {
    setExpandedState((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
  }, []);

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

  // Build tree and flatten for rendering; pinned rows lead their siblings
  const tree = useMemo(() => buildAgentSidebarTree(sessions, { pinnedKeys }), [sessions, pinnedKeys]);
  const flatNodes = useMemo(() => flattenTree(tree, expandedState), [tree, expandedState]);

  // One identity hue per agent family, assigned on first sight and remembered; children take lighter shades.
  const rootAgentIds = useMemo(() => {
    const ids: string[] = [];
    for (const node of flattenAll(tree)) {
      const id = getRootAgentId(node.key);
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }, [tree]);
  const { hueFor } = useAgentHues(rootAgentIds);
  const hueForNode = useCallback((node: TreeNode): string | undefined => {
    const id = getRootAgentId(node.key);
    return id ? shadeFor(hueFor(id), node.depth) : undefined;
  }, [hueFor]);
  const sessionCount = useMemo(
    () => tree.reduce((total, root) => total + 1 + countDescendants(root), 0),
    [tree],
  );

  const handleSetDeleteTarget = useCallback((key: string, label: string) => {
    const targetNode = findNodeByKey(tree, key);
    setDeleteTarget({
      key,
      label,
      descendantCount: targetNode ? countDescendants(targetNode) : 0,
      isRootAgent: isTopLevelAgentSessionKey(key),
    });
  }, [tree]);

  const handleSetRemoveTarget = useCallback((key: string, label: string) => {
    const agentId = getRootAgentId(key);
    if (!agentId) return;
    setRemoveMode('keep');
    setRemoveTarget({ agentId, label });
    if (!getAgentWorkspace) return;
    void getAgentWorkspace(agentId).then((workspace) => {
      if (!workspace) return;
      // The dialog may have closed, or opened for another agent, while the lookup ran.
      setRemoveTarget((target) => (target && target.agentId === agentId ? { ...target, workspace } : target));
    });
  }, [getAgentWorkspace]);

  // The gateway refuses to remove the only configured agent, so its row says why instead of offering it.
  const topLevelAgentCount = useMemo(
    () => sessions.filter((session) => isTopLevelAgentSessionKey(getSessionKey(session))).length,
    [sessions],
  );

  return (
    <div className={compact ? 'flex flex-col max-h-[65vh]' : 'h-full flex flex-col min-h-0'}>
      <div className="panel-header">
        <span className="panel-label">Agents</span>
        {sessionCount > 0 && (
          <span className="font-mono text-[0.8rem] tabular text-muted-foreground">{sessionCount}</span>
        )}
        <div className="ml-auto flex items-center">
          {onSpawn && (
            <button
              type="button"
              onClick={() => setSpawnOpen(true)}
              aria-label="Create session"
              title="Create session"
              className="shell-icon-button px-0"
            >
              <Plus size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh sessions"
            title="Refresh sessions"
            className="shell-icon-button px-0"
          >
            <RefreshCw size={14} aria-hidden="true" className={isLoading ? 'animate-spin' : undefined} />
          </button>
        </div>
      </div>
      <div className={compact ? 'overflow-y-auto' : 'flex-1 overflow-y-auto'}>
        {isLoading && flatNodes.length === 0 ? (
          <SessionSkeletonGroup count={4} />
        ) : flatNodes.length === 0 ? (
          <div className="flex min-h-[var(--row-unit)] items-center px-3 text-[0.8rem] text-muted-foreground">No active sessions</div>
        ) : flatNodes.map((node) => {
          const sessionKey = node.key;
          const sessionType = getSessionType(sessionKey);
          const isSubagent = sessionType === 'subagent';
          const isCron = sessionType === 'cron';
          const isCronRun = sessionType === 'cron-run';
          const isRootAgent = isTopLevelAgentSessionKey(sessionKey);
          const label = getSessionDisplayLabel(node.session, agentName);
          const isGrowing = growingSessions[sessionKey] ?? false;
          const running = busyState[sessionKey] || node.session.state === 'running' || node.session.agentState === 'running' || node.session.busy || node.session.processing || node.session.status === 'running' || node.session.status === 'busy' || (isGrowing && isSubagent);
          const isActive = sessionKey === currentSession;
          const currentTokens = node.session.totalTokens || 0;
          const prevTokens = prevTokensRef.current[sessionKey] || 0;
          const displayTokens = Math.max(currentTokens, prevTokens);
          const isExpanded = expandedState[sessionKey] ?? !isCron;
          // A top-level agent leaves through agents.delete; every other row keeps its session Delete.
          const isRemovableAgent = isRootAgent && Boolean(onRemoveAgent);
          const rowDelete = isRemovableAgent
            ? handleSetRemoveTarget
            : onDelete && !isUndeletableSessionKey(sessionKey) ? handleSetDeleteTarget : undefined;

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
              isRootAgent={isRootAgent}
              isSubagent={isSubagent}
              isCron={isCron}
              isCronRun={isCronRun}
              isUnread={unreadSessions?.[sessionKey] ?? false}
              isPinned={pinnedKeys.has(sessionKey)}
              isRenaming={renamingKey === sessionKey}
              renameValue={renameValue}
              renameError={renamingKey === sessionKey ? renameError : null}
              renameInputRef={renameInputRef}
              granularStatus={agentStatus?.[sessionKey]}
              hue={hueForNode(node)}
              agentId={getRootAgentId(sessionKey)}
              onPickColor={setAgentHue}
              onSelect={onSelect}
              onToggleExpand={handleToggleExpand}
              onDelete={rowDelete}
              deleteLabel={isRemovableAgent ? 'Remove agent' : undefined}
              deleteDisabledReason={isRemovableAgent && topLevelAgentCount <= 1 ? 'The only agent cannot be removed' : undefined}
              onStartRename={onRename ? startRename : undefined}
              onTogglePin={togglePin}
              onAbort={onAbort}
              onRenameChange={handleRenameChange}
              onRenameCommit={commitRename}
              onRenameBlur={blurRename}
              onRenameCancel={cancelRename}
              compact={compact}
            />
          );
        })}
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
              <AlertTriangle size={16} className="text-destructive" aria-hidden="true" />
              {deleteTarget?.descendantCount ? 'Delete session tree' : 'Delete session'}
            </DialogTitle>
            <DialogDescription className="text-[0.867rem] text-muted-foreground">
              {deleteTarget?.isRootAgent
                ? 'This will permanently delete this root session and any nested child sessions attached to it.'
                : deleteTarget?.descendantCount
                ? `This will permanently delete this session and ${deleteTarget.descendantCount} nested child session${deleteTarget.descendantCount === 1 ? '' : 's'}.`
                : 'This will permanently delete the session and archive its transcript.'}
            </DialogDescription>
            {deleteTarget?.error && (
              <p role="alert" className="text-[0.8rem] text-destructive break-words">{deleteTarget.error}</p>
            )}
          </DialogHeader>
          <div className="rounded-[3px] border border-border bg-background px-3 py-2">
            <p className="mb-0.5 text-[0.8rem] text-muted-foreground">Session</p>
            <p className="text-[0.867rem] text-foreground">{deleteTarget?.label}</p>
            <p className="mt-0.5 break-all font-mono text-[0.8rem] text-muted-foreground">{deleteTarget?.key}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove agent dialog: agents.delete, keeping the files or moving them to the Trash */}
      <Dialog open={!!removeTarget} onOpenChange={(open) => !open && !removing && setRemoveTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
              <AlertTriangle size={16} className="text-destructive" aria-hidden="true" />
              Remove agent
            </DialogTitle>
            <DialogDescription className="text-[0.867rem] text-muted-foreground">
              Remove {removeTarget?.label} from OpenClaw. Its cron jobs and sessions go with it.
            </DialogDescription>
            {removeTarget?.workspace && (
              <p className="break-all font-mono text-[0.8rem] text-muted-foreground">{removeTarget.workspace.path}</p>
            )}
            {removeTarget?.error && (
              <p role="alert" className="text-[0.8rem] text-destructive break-words">{removeTarget.error}</p>
            )}
          </DialogHeader>
          <fieldset className="m-0 min-w-0 border-0 p-0" disabled={removing}>
            <legend className="sr-only">What happens to its files</legend>
            {REMOVE_MODES.map((mode, index) => (
              <label
                key={mode.value}
                className={cn('flex cursor-pointer items-start gap-3 py-2.5', index > 0 && 'border-t border-border')}
              >
                <input
                  type="radio"
                  name="remove-agent-mode"
                  value={mode.value}
                  checked={removeMode === mode.value}
                  onChange={() => setRemoveMode(mode.value)}
                  className="mt-[3px] shrink-0 accent-primary"
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[0.867rem] font-semibold text-foreground">{mode.label}</span>
                  <span className="text-[0.8rem] text-muted-foreground">{removeModeHint(mode.value, removeTarget?.workspace)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRemoveTarget(null)}
              disabled={removing}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleRemoveAgent}
              disabled={removing}
            >
              {removing ? 'Removing...' : 'Remove agent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Session creation dialog */}
      {onSpawn && (
        <SpawnAgentDialog
          open={spawnOpen}
          onOpenChange={setSpawnOpen}
          onSpawn={onSpawn}
        />
      )}
    </div>
  );
}
