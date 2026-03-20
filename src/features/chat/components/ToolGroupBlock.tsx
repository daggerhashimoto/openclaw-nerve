import { useState, useMemo, memo } from 'react';
import { ChevronRight, Wrench } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Card, CardContent } from '@/components/ui/card';
import { DiffView } from '../DiffView';
import { FileContentView } from '../FileContentView';
import { extractEditBlocks, extractWriteBlocks } from '../edit-blocks';
import type { ChatMsg, ToolGroupEntry } from '../types';

interface ToolGroupBlockProps {
  msg: ChatMsg;
  index: number;
  isCollapsed: boolean;
  onToggleCollapse: (idx: number) => void;
}

/** A single expandable tool entry within the group */
function ToolEntryRow({ entry }: { entry: ToolGroupEntry }) {
  const [expanded, setExpanded] = useState(false);
  const editBlocks = useMemo(() => extractEditBlocks(entry.rawText), [entry.rawText]);
  const writeBlocks = useMemo(() => extractWriteBlocks(entry.rawText), [entry.rawText]);
  const hasExpandableContent = editBlocks.length > 0 || writeBlocks.length > 0;

  // Only edit (diff view) and write (file view) entries are expandable
  if (!hasExpandableContent) {
    return (
      <div className="flex items-center gap-2 rounded-xl px-2.5 py-2">
        <span className="w-3" /> {/* spacer matching chevron width */}
        <span className="text-green text-[0.667rem]">✓</span>
        <span className="flex-1 truncate text-[0.8rem] text-muted-foreground">
          {entry.preview}
        </span>
      </div>
    );
  }

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-primary/[0.04]">
        <ChevronRight
          size={12}
          className={`text-muted-foreground shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="text-green text-[0.667rem]">✓</span>
        <span className="flex-1 truncate text-[0.8rem] text-muted-foreground">
          {entry.preview}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-6 mr-2 mb-2 mt-1 border-l-2 border-border/40 pl-3">
          {editBlocks.length > 0 ? (
            <div className="space-y-2">
              {editBlocks.map((block, i) => (
                <DiffView key={i} oldText={block.oldText} newText={block.newText} filePath={block.filePath} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {writeBlocks.map((block, i) => (
                <FileContentView key={i} content={block.content} filePath={block.filePath} />
              ))}
            </div>
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

  return (
    <div className="msg msg-tool relative max-w-full break-words mx-4 my-1.5">
      <Collapsible open={!isCollapsed} onOpenChange={() => onToggleCollapse(index)}>
        <Card className="overflow-hidden rounded-2xl border-border/50 bg-card/62 py-0 shadow-none">
          <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 px-3.5 py-3 text-left transition-colors hover:bg-primary/[0.04]">
            <ChevronRight
              size={14}
              className={`text-muted-foreground shrink-0 transition-transform duration-200 ${!isCollapsed ? 'rotate-90' : ''}`}
            />
            <Wrench size={13} className="shrink-0 text-primary/75" />
            <span className="cockpit-badge shrink-0">Tools</span>
            <span className="flex-1 text-[0.8rem] text-muted-foreground">
              Used {count} tool{count !== 1 ? 's' : ''}
            </span>
            <span className="shrink-0 font-mono text-[0.667rem] text-muted-foreground">{timeStr}</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="border-t border-border/40 bg-background/42 px-2 py-2">
              {entries.map((entry, i) => (
                <ToolEntryRow key={entry.preview + '-' + i} entry={entry} />
              ))}
            </CardContent>
          </CollapsibleContent>
        </Card>
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
