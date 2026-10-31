import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { TreeNode } from './sessionTree';
import type { GranularAgentState } from '@/types';
import { fmtK } from '@/lib/formatting';
import { cn } from '@/lib/utils';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { Pane } from '@/components/ui/Pane';
import { paneStateFor, paneStateLabel } from '@/lib/paneState';
import { getSessionPaneState, getStatusBadgeText } from './statusUtils';
import { ChevronRight, ChevronDown, EllipsisVertical, PenLine, Square, Trash2 } from 'lucide-react';
import { SessionInfoPanel } from './SessionInfoPanel';

const GHOST_ACTION = 'inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[3px] border-0 bg-transparent text-muted-foreground transition-colors duration-[120ms] hover:text-foreground';
const GHOST_DANGER = 'inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[3px] border-0 bg-transparent text-muted-foreground transition-colors duration-[120ms] hover:text-destructive';

interface SessionNodeProps {
  node: TreeNode;
  isActive: boolean;
  isGrowing: boolean;
  running: boolean;
  displayTokens: number;
  label: string;
  isExpanded: boolean;
  hasChildren: boolean;
  isRootAgent: boolean;
  isSubagent: boolean;
  isCron: boolean;
  isCronRun: boolean;
  isUnread: boolean;
  isRenaming: boolean;
  renameValue: string;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  granularStatus?: GranularAgentState;
  onSelect: (key: string) => void;
  onToggleExpand: (key: string) => void;
  onDelete?: (key: string, label: string) => void;
  onStartRename?: (key: string, label: string) => void;
  onAbort?: (key: string) => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  /** Compact mode for mobile/topbar dropdown; uses kebab actions instead of hover actions. */
  compact?: boolean;
}

function arePropsEqual(prev: SessionNodeProps, next: SessionNodeProps): boolean {
  return (
    prev.node.key === next.node.key &&
    prev.node.session === next.node.session &&
    prev.node.depth === next.node.depth &&
    prev.isActive === next.isActive &&
    prev.isGrowing === next.isGrowing &&
    prev.running === next.running &&
    prev.displayTokens === next.displayTokens &&
    prev.label === next.label &&
    prev.isExpanded === next.isExpanded &&
    prev.hasChildren === next.hasChildren &&
    prev.isRootAgent === next.isRootAgent &&
    prev.isSubagent === next.isSubagent &&
    prev.isCron === next.isCron &&
    prev.isCronRun === next.isCronRun &&
    prev.isUnread === next.isUnread &&
    prev.isRenaming === next.isRenaming &&
    prev.renameValue === next.renameValue &&
    prev.granularStatus === next.granularStatus &&
    prev.compact === next.compact
  );
}

/** Single session row in the agents tree: a lit pane, the name, its meta, and hover actions. */
export const SessionNode = memo(function SessionNode({
  node,
  isActive,
  running,
  displayTokens,
  label,
  isExpanded,
  hasChildren,
  isRootAgent,
  isSubagent,
  isCron,
  isCronRun,
  isUnread,
  isRenaming,
  renameValue,
  renameInputRef,
  granularStatus,
  onSelect,
  onToggleExpand,
  onDelete,
  onStartRename,
  onAbort,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  compact = false,
}: SessionNodeProps) {
  const { session, key: sessionKey, depth } = node;

  const handleSelect = useCallback(() => onSelect(sessionKey), [onSelect, sessionKey]);
  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand(sessionKey);
  }, [onToggleExpand, sessionKey]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(sessionKey, label);
  }, [onDelete, sessionKey, label]);

  const handleRenameClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onStartRename?.(sessionKey, label);
  }, [onStartRename, sessionKey, label]);

  const handleAbortClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onAbort?.(sessionKey);
  }, [onAbort, sessionKey]);

  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  const canRenameDelete = isRootAgent || isSubagent || isCron || isCronRun;
  const hasAbortAction = Boolean(onAbort && running);
  const hasRenameAction = Boolean(canRenameDelete && onStartRename && !isRenaming);
  const hasDeleteAction = Boolean(canRenameDelete && onDelete);
  const hasActions = hasAbortAction || hasRenameAction || hasDeleteAction;

  useEffect(() => {
    if (!compact || !actionsOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (actionsRef.current?.contains(target)) return;
      setActionsOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [compact, actionsOpen]);

  const handleKebabToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setActionsOpen(prev => !prev);
  }, []);

  const handleAbortFromMenu = useCallback((e: React.MouseEvent) => {
    handleAbortClick(e);
    setActionsOpen(false);
  }, [handleAbortClick]);

  const handleRenameFromMenu = useCallback((e: React.MouseEvent) => {
    handleRenameClick(e);
    setActionsOpen(false);
  }, [handleRenameClick]);

  const handleDeleteFromMenu = useCallback((e: React.MouseEvent) => {
    handleDeleteClick(e);
    setActionsOpen(false);
  }, [handleDeleteClick]);

  // One pane per row. Granular status is authoritative for agent rows; cron rows follow the running flag.
  const paneState = (isCron || isCronRun)
    ? paneStateFor({ running, unread: isUnread })
    : getSessionPaneState({ running, unread: isUnread, granularStatus });
  const isLive = paneState === 'live';

  // Secondary meta: what the agent is doing while live, otherwise the kind of session or its model
  const kindLabel = isSubagent
    ? 'subagent'
    : isCron
      ? 'cron'
      : isCronRun
        ? 'cron run'
        : session.model?.split('/').pop();
  const metaText = isLive && granularStatus && !(isCron || isCronRun)
    ? getStatusBadgeText(granularStatus)
    : kindLabel;

  const stateText = paneState === 'operator'
    ? 'waiting on you'
    : paneState === 'error'
      ? 'error'
      : 'idle';

  // Indentation: 16px per depth level. The chevron gutter is always reserved so the panes line up.
  const indent = depth * 16;

  return (
    <div
      className={cn(
        'group relative flex w-full items-center text-[0.867rem] transition-colors duration-[120ms] hover:bg-raised',
        compact ? 'min-h-8' : 'min-h-[var(--row-unit)]',
        isActive && 'bg-raised',
      )}
    >
      {/* Tree guide: a 1px rule dropping from the parent's chevron */}
      {depth > 0 && (
        <span
          aria-hidden="true"
          className="absolute top-0 bottom-0 w-px bg-border"
          style={{ left: `${(depth - 1) * 16 + 11}px` }}
        />
      )}

      <button
        type="button"
        onClick={handleSelect}
        aria-current={isActive ? 'true' : undefined}
        className={cn(
          'flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch border-0 bg-transparent text-left',
          compact ? 'pr-1' : 'pr-2.5'
        )}
        style={{ paddingLeft: `${indent + 4}px` }}
      >
        {/* Collapse/expand chevron for nodes with children; an empty gutter otherwise */}
        {hasChildren ? (
          <span
            role="button"
            tabIndex={0}
            onClick={handleToggle}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle(e as unknown as React.MouseEvent); } }}
            className="-mr-0.5 flex size-3.5 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        ) : (
          <span aria-hidden="true" className="-mr-0.5 w-3.5 shrink-0" />
        )}

        <Pane state={paneState} label={isLive ? paneStateLabel(paneState) : undefined} />

        {/* Label (or rename input) */}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameCommit();
              if (e.key === 'Escape') onRenameCancel();
            }}
            onBlur={onRenameCommit}
            onClick={(e) => e.stopPropagation()}
            className="h-6 min-w-0 flex-1 rounded-[3px] border border-input bg-background px-1.5 text-[0.867rem] text-foreground focus:border-ring focus:outline-none"
          />
        ) : (
          <SessionInfoPanel session={node.session} running={running}>
            <span className="flex min-w-0 items-baseline gap-2">
              <span className={cn(
                'min-w-0 cursor-pointer truncate',
                isCronRun ? 'text-muted-foreground' : 'text-foreground',
                // Agents are named in the display face; their sessions stay in the reading face
                depth === 0 ? 'font-display font-semibold' : isActive && 'font-medium',
              )}>
                {label}
              </span>
              {metaText && (
                <span className={cn(
                  'text-[0.8rem] text-muted-foreground',
                  // A kind tag (cron, subagent, model) is short and stays whole; live tool text may truncate.
                  metaText === kindLabel ? 'shrink-0' : 'min-w-0 shrink-[3] truncate',
                )}>
                  {metaText}
                </span>
              )}
            </span>
          </SessionInfoPanel>
        )}

        {/* Right-aligned state: live work shows its token count, unread waits on you, otherwise idle */}
        {isLive ? (
          <AnimatedNumber
            value={displayTokens}
            format={fmtK}
            className="shrink-0 pl-1 text-right font-mono text-[0.8rem] tabular text-live-text"
            duration={700}
          />
        ) : (
          <span
            className={cn(
              'shrink-0 whitespace-nowrap pl-1 text-right text-[0.8rem]',
              paneState === 'operator' && 'text-operator-text',
              paneState === 'error' && 'text-destructive',
              paneState === 'off' && 'text-muted-foreground',
            )}
          >
            {stateText}
          </span>
        )}
      </button>

      {compact ? (
        hasActions && (
          <div ref={actionsRef} className="flex shrink-0 items-center gap-0.5 pr-1">
            {actionsOpen && (
              <>
                {hasAbortAction && (
                  <button
                    type="button"
                    onClick={handleAbortFromMenu}
                    title="Abort session"
                    className={GHOST_DANGER}
                  >
                    <Square size={14} aria-hidden="true" />
                  </button>
                )}
                {hasRenameAction && (
                  <button
                    type="button"
                    onClick={handleRenameFromMenu}
                    title="Rename session"
                    className={GHOST_ACTION}
                  >
                    <PenLine size={14} aria-hidden="true" />
                  </button>
                )}
                {hasDeleteAction && (
                  <button
                    type="button"
                    onClick={handleDeleteFromMenu}
                    title="Delete session"
                    className={GHOST_DANGER}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              onClick={handleKebabToggle}
              title="Session actions"
              aria-label="Session actions"
              aria-expanded={actionsOpen}
              className={cn(GHOST_ACTION, actionsOpen && 'bg-raised text-foreground')}
            >
              <EllipsisVertical size={14} aria-hidden="true" />
            </button>
          </div>
        )
      ) : (
        /* Hover and focus actions; abort is available for all running sessions */
        <div className="absolute top-1/2 right-1 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-[3px] bg-raised opacity-0 transition-opacity duration-[120ms] group-focus-within:opacity-100 group-hover:opacity-100">
          {hasAbortAction && (
            <button
              type="button"
              onClick={handleAbortClick}
              title="Abort session"
              className={GHOST_DANGER}
            >
              <Square size={14} aria-hidden="true" />
            </button>
          )}
          {canRenameDelete && (
            <>
              {hasRenameAction && (
                <button
                  type="button"
                  onClick={handleRenameClick}
                  title="Rename session"
                  className={GHOST_ACTION}
                >
                  <PenLine size={14} aria-hidden="true" />
                </button>
              )}
              {hasDeleteAction && (
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  title="Delete session"
                  className={GHOST_DANGER}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}, arePropsEqual);
