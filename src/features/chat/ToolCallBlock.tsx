import React, { lazy, Suspense, useMemo, memo } from 'react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { sanitizeHtml } from '@/lib/sanitize';
import { decodeHtmlEntities } from '@/lib/formatting';
import { escapeRegex } from '@/lib/constants';
import { extractEditBlocks, extractWriteBlocks } from './edit-blocks';
import { ToolRowContent, toolRowButtonClass, toolRowClass } from './components/ToolRow';
import type { ChatMsg } from './types';

const DiffView = lazy(() => import('./DiffView').then((module) => ({ default: module.DiffView })));
const FileContentView = lazy(() =>
  import('./FileContentView').then((module) => ({ default: module.FileContentView })),
);

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
    <div className="msg msg-tool relative max-w-full break-words">
      <Collapsible open={!isCollapsed} onOpenChange={() => onToggleCollapse(index)}>
        <CollapsibleTrigger className={cn(toolRowClass, toolRowButtonClass)}>
          <ToolRowContent
            state="off"
            text={toolPreview}
            meta={timeStr}
            expandable
            expanded={!isCollapsed}
            renderText={(text) => highlightText(text, searchQuery)}
          />
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
            ) : writeBlocks.length > 0 ? (
              <Suspense fallback={<div className="text-[0.8rem] text-muted-foreground">Loading file preview</div>}>
                <div className="space-y-2">
                  {writeBlocks.map((block, i) => (
                    <FileContentView key={i} content={block.content} filePath={block.filePath} />
                  ))}
                </div>
              </Suspense>
            ) : (
              <div
                className="max-h-[300px] overflow-y-auto whitespace-pre-wrap break-words text-muted-foreground [overflow-wrap:anywhere] [&_code]:font-mono [&_p]:m-0"
                dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
              />
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/**
 * Memoized ToolCallBlock: skips re-render when content/state are unchanged.
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
