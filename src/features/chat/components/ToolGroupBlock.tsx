import { lazy, Suspense, useState, useMemo, memo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Pane } from '@/components/ui/Pane';
import { cn } from '@/lib/utils';
import { extractEditBlocks, extractWriteBlocks } from '../edit-blocks';
import type { ChatMsg, ToolGroupEntry } from '../types';
import { ToolRowContent, toolRowButtonClass, toolRowClass } from './ToolRow';

const DiffView = lazy(() => import('../DiffView').then((module) => ({ default: module.DiffView })));
const FileContentView = lazy(() =>
  import('../FileContentView').then((module) => ({ default: module.FileContentView })),
);

interface ToolGroupBlockProps {
  msg: ChatMsg;
  index: number;
  isCollapsed: boolean;
  onToggleCollapse: (idx: number) => void;
}

/** Entry rows sit one step in from the group row so the pane column reads as a tree. */
const entryIndentClass = 'pl-6';

/** A single expandable tool entry within the group */
function ToolEntryRow({ entry }: { entry: ToolGroupEntry }) {
  const editBlocks = useMemo(() => extractEditBlocks(entry.rawText), [entry.rawText]);
  const writeBlocks = useMemo(() => extractWriteBlocks(entry.rawText), [entry.rawText]);
  // A diff is the point of opening the group, so an edit entry starts open; file previews stay folded
  const [expanded, setExpanded] = useState(() => editBlocks.length > 0);
  const hasExpandableContent = editBlocks.length > 0 || writeBlocks.length > 0;

  // Only edit (diff view) and write (file view) entries are expandable
  if (!hasExpandableContent) {
    return (
      <div className={cn(toolRowClass, entryIndentClass)}>
        <ToolRowContent state="off" text={entry.preview} />
      </div>
    );
  }

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger className={cn(toolRowClass, toolRowButtonClass, entryIndentClass)}>
        <ToolRowContent state="off" text={entry.preview} expandable expanded={expanded} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border px-2.5 py-2 font-mono text-[0.8rem]">
          {editBlocks.length > 0 ? (
            <Suspense fallback={<div className="text-[0.8rem] text-muted-foreground">Loading diff</div>}>
              <div className="space-y-2">
                {editBlocks.map((block, i) => (
                  <DiffView key={i} oldText={block.oldText} newText={block.newText} filePath={block.filePath} />
                ))}
              </div>
            </Suspense>
          ) : (
            <Suspense fallback={<div className="text-[0.8rem] text-muted-foreground">Loading file preview</div>}>
              <div className="space-y-2">
                {writeBlocks.map((block, i) => (
                  <FileContentView key={i} content={block.content} filePath={block.filePath} />
                ))}
              </div>
            </Suspense>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolGroupBlockInner({ msg, index, isCollapsed, onToggleCollapse }: ToolGroupBlockProps) {
  const timeStr = msg.timestamp.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const entries = msg.toolGroup || [];
  const count = entries.length;
  const summary = entries.map((entry) => entry.preview).join(', ');

  return (
    <div className="msg msg-tool relative max-w-full break-words">
      <Collapsible open={!isCollapsed} onOpenChange={() => onToggleCollapse(index)}>
        <CollapsibleTrigger className={cn(toolRowClass, toolRowButtonClass)}>
          <Pane state="off" size="sm" />
          <span className="shrink-0 py-1.5 font-sans text-[0.867rem] text-foreground">
            Used {count} tool{count !== 1 ? 's' : ''}
          </span>
          <span className="min-w-0 flex-1 truncate py-1.5 text-muted-foreground">{isCollapsed ? summary : null}</span>
          <span className="shrink-0 tabular text-muted-foreground">{timeStr}</span>
          {isCollapsed
            ? <ChevronRight size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
            : <ChevronDown size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="divide-y divide-border border-t border-border">
            {entries.map((entry, i) => (
              <ToolEntryRow key={entry.preview + '-' + i} entry={entry} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/** Collapsible block displaying a group of consecutive tool calls. */
export const ToolGroupBlock = memo(ToolGroupBlockInner, (prev, next) => {
  if (prev.msg !== next.msg) return false;
  if (prev.isCollapsed !== next.isCollapsed) return false;
  return true;
});
