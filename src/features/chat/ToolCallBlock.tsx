import React, { useMemo, memo } from 'react';
import { ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Card, CardContent } from '@/components/ui/card';
import { sanitizeHtml } from '@/lib/sanitize';
import { decodeHtmlEntities } from '@/lib/formatting';
import { escapeRegex } from '@/lib/constants';
import { DiffView } from './DiffView';
import { FileContentView } from './FileContentView';
import { extractEditBlocks, extractWriteBlocks } from './edit-blocks';
import type { ChatMsg } from './types';

interface ToolCallBlockProps {
  msg: ChatMsg;
  index: number;
  isCollapsed: boolean;
  onToggleCollapse: (idx: number) => void;
  searchQuery?: string;
}

// Highlight search terms in text
function highlightText(text: string, query?: string): React.ReactNode {
  if (!query?.trim()) return text;
  
  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
  const parts = text.split(regex);
  
  // split() with a capture group alternates: non-match, match, non-match, ...
  // Odd indices are always the captured matches
  return parts.map((part, i) => 
    i % 2 === 1 ? (
      <mark key={i} className="search-highlight">{part}</mark>
    ) : part
  );
}

function ToolCallBlockInner({ msg, index, isCollapsed, onToggleCollapse, searchQuery }: ToolCallBlockProps) {
  const timeStr = msg.timestamp.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  // Use html (description from describeToolUse) for preview, fall back to rawText
  const htmlText = msg.html.replace(/<[^>]*>/g, '').trim();
  const toolPreview = decodeHtmlEntities(htmlText || (msg.rawText.slice(0, 80).replace(/\n/g, ' ') + (msg.rawText.length > 80 ? '…' : '')));
  // Tool message rawText contains the full tool call JSON, extract directly from it
  const editBlocks = useMemo(() => extractEditBlocks(msg.rawText), [msg.rawText]);
  const writeBlocks = useMemo(() => extractWriteBlocks(msg.rawText), [msg.rawText]);
  const sanitizedHtml = useMemo(() => sanitizeHtml(msg.html), [msg.html]);

  return (
    <div className="msg msg-tool relative max-w-full break-words mx-4 my-1.5">
      <Collapsible open={!isCollapsed} onOpenChange={() => onToggleCollapse(index)}>
        <Card className="overflow-hidden rounded-2xl border-border/50 bg-card/62 py-0 shadow-none">
          <CollapsibleTrigger className="flex w-full items-center gap-2 px-3.5 py-3 text-left transition-colors cursor-pointer hover:bg-primary/[0.04]">
            <ChevronRight size={14} className={`text-muted-foreground shrink-0 transition-transform duration-200 ${!isCollapsed ? 'rotate-90' : ''}`} />
            <span className="cockpit-badge shrink-0">Tool</span>
            <span className="flex-1 truncate text-[0.8rem] text-foreground/78">{highlightText(toolPreview, searchQuery)}</span>
            <span className="shrink-0 font-mono text-[0.667rem] text-muted-foreground">{timeStr}</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="border-t border-border/40 bg-background/42 px-3 py-3">
              {editBlocks.length > 0 ? (
                <div className="space-y-2">
                  {editBlocks.map((block, i) => (
                    <DiffView key={i} oldText={block.oldText} newText={block.newText} filePath={block.filePath} />
                  ))}
                </div>
              ) : writeBlocks.length > 0 ? (
                <div className="space-y-2">
                  {writeBlocks.map((block, i) => (
                    <FileContentView key={i} content={block.content} filePath={block.filePath} />
                  ))}
                </div>
              ) : (
                <div
                  className="msg-body whitespace-pre-wrap text-[0.8rem] font-mono opacity-85 max-h-[300px] overflow-y-auto"
                  dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                />
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}

/**
 * Memoized ToolCallBlock — skips re-render when content/state are unchanged.
 * Tool call blocks often contain expensive syntax-highlighted diffs,
 * so avoiding unnecessary re-renders is important for scroll performance.
 */
export const ToolCallBlock = memo(ToolCallBlockInner, (prev, next) => {
  if (prev.msg.rawText !== next.msg.rawText) return false;
  if (prev.msg.html !== next.msg.html) return false;
  if (prev.isCollapsed !== next.isCollapsed) return false;
  if (prev.searchQuery !== next.searchQuery) return false;
  return true;
});
