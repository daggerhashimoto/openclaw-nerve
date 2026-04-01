import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { TreeNode } from './sessionTree';
import type { GranularAgentState } from '@/types';
import { fmtK } from '@/lib/formatting';
import { cn } from '@/lib/utils';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { PROGRESS_BAR_TRANSITION } from '@/lib/progress-colors';
import { getStatusBadgeText, getStatusBadgeClasses } from './statusUtils';
import { ChevronRight, ChevronDown, EllipsisVertical, PenLine, Timer, CornerDownRight } from 'lucide-react';
import { SessionInfoPanel } from './SessionInfoPanel';

// Pre-defined color configs to avoid object creation during render
const COLORS_CRITICAL = {
  bar: 'bg-red',
  glow: 'rgba(231, 76, 60, 0.3)',
  growGlow: 'rgba(231, 76, 60, 0.5)',
} as const;

const COLORS_WARNING = {
  bar: 'bg-orange',
  glow: 'rgba(232, 168, 56, 0.3)',
  growGlow: 'rgba(232, 168, 56, 0.5)',
} as const;

const COLORS_NORMAL = {
  bar: 'bg-green',
  glow: 'rgba(76, 175, 80, 0.3)',
  growGlow: 'rgba(76, 175, 80, 0.5)',
} as const;

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

/** Single session node in the session tree with status badge and actions. */
export const SessionNode = memo(function SessionNode({
  node,
  isActive,
  isGrowing,
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
  const max = session.contextTokens || 200000;
  const pct = Math.min(100, Math.round((displayTokens / max) * 100));
  const colors = pct >= 80 ? COLORS_CRITICAL : pct >= 50 ? COLORS_WARNING : COLORS_NORMAL;
  const boxShadow = isGrowing
    ? `0 0 6px ${colors.growGlow}`
    : `0 0 4px ${colors.glow}`;

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

  // Compute badge text and classes from granular status or fall back to binary
  const badgeText = (isCron || isCronRun)
    ? (running ? 'RUNNING' : isCron ? 'CRON' : 'RUN')
    : granularStatus ? getStatusBadgeText(granularStatus) : (running ? 'WORKING' : 'IDLE');
  const badgeClasses = (isCron || isCronRun)
    ? (running ? 'bg-purple/20 text-purple' : 'bg-purple/10 text-purple/70')
    : granularStatus
      ? getStatusBadgeClasses(granularStatus)
      : (running ? 'bg-green/20 text-green' : 'bg-muted-foreground/20 text-muted-foreground');

  // Indentation: 14px per depth level
  const indent = depth * 14;

  return (
    <div
      className={cn(
        'group relative w-full flex items-center border-b border-border/40 text-xs hover:bg-secondary',
        isActive && 'border-l-[3px] border-l-primary bg-primary/5 shadow-[inset_0_0_12px_rgba(232,168,56,0.06)]',
        isUnread && !isActive && 'bg-green/5',
        isCronRun && !isActive && 'opacity-60'
      )}
    >
      {/* Tree connector: subtle left border for children */}
      {depth > 0 && (
        <div
          className="absolute top-0 bottom-0 border-l border-border/30"
          style={{ left: `${(depth - 1) * 14 + 10}px` }}
        />
      )}

      <button
        type="button"
        onClick={handleSelect}
        aria-current={isActive ? 'true' : undefined}
        className={cn(
          'flex-1 min-w-0 flex items-center gap-2 bg-transparent border-0 text-left cursor-pointer py-2',
          compact ? 'pr-1' : 'pr-3'
        )}
        style={{ paddingLeft: `${indent + 8}px` }}
      >
        {/* Collapse/expand chevron for nodes with children */}
        {hasChildren ? (
          <span
            role="button"
            tabIndex={0}
            onClick={handleToggle}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle(e as unknown as React.MouseEvent); } }}
            className="shrink-0 w-4 h-4 flex items-center justify-center bg-transparent border-0 cursor-pointer text-muted-foreground hover:text-foreground p-0"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        ) : (
          // Spacer to keep alignment when no chevron
          depth > 0 ? <span className="shrink-0 w-4" /> : null
        )}

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
            className="text-foreground text-[0.667rem] font-bold flex-1 min-w-0 bg-background border border-border/60 px-1 py-0 font-mono focus:outline-none focus:border-primary"
          />
        ) : (
          <SessionInfoPanel session={node.session} running={running}>
            <span className={cn(
              "text-[0.667rem] font-bold flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer",
              isCronRun ? "text-muted-foreground font-normal" : "text-foreground"
            )}>
              {isCron && <Timer size={11} className="text-purple mr-1 inline shrink-0" aria-label="Cron job" />}
              {isCronRun && <CornerDownRight size={10} className="text-purple/60 mr-1 inline shrink-0" aria-label="Cron run" />}
              {label}
            </span>
          </SessionInfoPanel>
        )}

        {/* Progress bar */}
        <div className="w-12 h-1.5 bg-background border border-border/60 overflow-hidden shrink-0">
          <div
            className={`h-full ${colors.bar}`}
            style={{
              width: `${pct}%`,
              boxShadow,
              transition: PROGRESS_BAR_TRANSITION,
            }}
          />
        </div>

        {/* Token count */}
        <AnimatedNumber
          value={displayTokens}
          format={fmtK}
          className="text-muted-foreground text-[0.6rem] w-14 text-right shrink-0"
          duration={700}
        />

        {/* Unread indicator + Status badge */}
        {isUnread && <span className="unread-dot" aria-label="Unread" />}
        <span
          className={`text-[0.6rem] font-bold tracking-[1px] uppercase px-1.5 py-0.5 rounded-sm shrink-0 ${badgeClasses}`}
        >
          {badgeText}
        </span>
      </button>

      {compact ? (
        hasActions && (
          <div ref={actionsRef} className="flex items-center gap-0.5 shrink-0 pr-1">
            {actionsOpen && (
              <>
                {hasAbortAction && (
                  <button
                    type="button"
                    onClick={handleAbortFromMenu}
                    title="Abort session"
                    className="bg-card border border-border/60 text-muted-foreground hover:text-red hover:border-red/40 cursor-pointer text-[0.667rem] w-5 h-5 flex items-center justify-center"
                  >
                    ⏹
                  </button>
                )}
                {hasRenameAction && (
                  <button
                    type="button"
                    onClick={handleRenameFromMenu}
                    title="Rename session"
                    className="bg-card border border-border/60 text-muted-foreground hover:text-foreground hover:border-muted-foreground cursor-pointer text-[0.667rem] w-5 h-5 flex items-center justify-center"
                  >
                    <PenLine size={10} />
                  </button>
                )}
                {hasDeleteAction && (
                  <button
                    type="button"
                    onClick={handleDeleteFromMenu}
                    title="Delete session"
                    className="bg-card border border-border/60 text-muted-foreground hover:text-red hover:border-red/40 cursor-pointer text-[0.667rem] w-5 h-5 flex items-center justify-center"
                  >
                    ✕
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
              className="bg-transparent border border-border/60 text-muted-foreground hover:text-foreground hover:border-muted-foreground cursor-pointer text-[0.667rem] w-6 h-6 flex items-center justify-center"
            >
              <EllipsisVertical size={12} />
            </button>
          </div>
        )
      ) : (
        /* Hover actions — abort is available for all running sessions */
        <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity z-10">
          {hasAbortAction && (
            <button
              type="button"
              onClick={handleAbortClick}
              title="Abort session"
              className="bg-card/90 border border-border/60 text-muted-foreground hover:text-red hover:border-red/40 cursor-pointer text-[0.667rem] w-5 h-5 flex items-center justify-center"
            >
              ⏹
            </button>
          )}
          {canRenameDelete && (
            <>
              {hasRenameAction && (
                <button
                  type="button"
                  onClick={handleRenameClick}
                  title="Rename session"
                  className="bg-card/90 border border-border/60 text-muted-foreground hover:text-foreground hover:border-muted-foreground cursor-pointer text-[0.667rem] w-5 h-5 flex items-center justify-center"
                >
                  <PenLine size={10} />
                </button>
              )}
              {hasDeleteAction && (
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  title="Delete session"
                  className="bg-card/90 border border-border/60 text-muted-foreground hover:text-red hover:border-red/40 cursor-pointer text-[0.667rem] w-5 h-5 flex items-center justify-center"
                >
                  ✕
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}, arePropsEqual);
