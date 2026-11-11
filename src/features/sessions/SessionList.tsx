import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import type { Session } from '@/types';
import { getSessionKey } from '@/types';
import type { SpawnSessionOpts } from '@/contexts/SessionContext';
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

interface SessionListProps {
  sessions: Session[];
  currentSession: string;
  busyState: Record<string, boolean>;
  agentStatus?: Record<string, GranularAgentState>;
  unreadSessions?: Record<string, boolean>;
  onSelect: (key: string) => void;
  onRefresh: () => void;
  onDelete?: (sessionKey: string) => Promise<void>;
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

/** Sidebar list of agent sessions with tree structure and context menus. */
export function SessionList({ sessions, currentSession, busyState, agentStatus, unreadSessions, onSelect, onRefresh, onDelete, onSpawn, onRename, onAbort, isLoading, agentName = 'Agent', compact = false }: SessionListProps) {
  const [deleteTarget, setDeleteTarget] = useState<{ key: string; label: string; descendantCount: number; isRootAgent: boolean } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [spawnOpen, setSpawnOpen] = useState(false);
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
  const tree = useMemo(() => buildAgentSidebarTree(sessions), [sessions]);
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
              isRenaming={renamingKey === sessionKey}
              renameValue={renameValue}
              renameInputRef={renameInputRef}
              granularStatus={agentStatus?.[sessionKey]}
              hue={hueForNode(node)}
              agentId={getRootAgentId(sessionKey)}
              onPickColor={setAgentHue}
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
