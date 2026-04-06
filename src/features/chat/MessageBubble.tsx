import { useState, useCallback, lazy, Suspense, memo } from 'react';
import { MemoriesSection } from './MemoriesSection';
import { ImageLightbox } from './ImageLightbox';
import { isMessageCollapsible } from './types';
import { decodeHtmlEntities } from '@/lib/formatting';
import { isStructuredMarkdown } from '@/lib/text/isStructuredMarkdown';
import type { ChatMsg } from './types';

// Lazy-load markdown renderer (includes highlight.js)
const MarkdownRenderer = lazy(() => import('@/features/markdown/MarkdownRenderer').then(m => ({ default: m.MarkdownRenderer })));
const InlineChart = lazy(() => import('@/features/charts/InlineChart'));

// Extract relevant-memories section from user messages
function extractMemories(rawText: string): { memories: string | null; content: string } {
  const match = rawText.match(/<relevant-memories>([\s\S]*?)<\/relevant-memories>\s*/);
  if (match) {
    const memories = match[1].trim();
    const content = rawText.replace(match[0], '').trim();
    return { memories, content };
  }
  return { memories: null, content: rawText };
}

function formatMissionTime(msgTime: Date, firstTime: Date | null): string {
  if (!firstTime) return '';
  const diff = Math.max(0, msgTime.getTime() - firstTime.getTime());
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600).toString().padStart(2, '0');
  const m = Math.floor((totalSec % 3600) / 60).toString().padStart(2, '0');
  const s = (totalSec % 60).toString().padStart(2, '0');
  return `T+${h}:${m}:${s}`;
}

interface MessageBubbleProps {
  msg: ChatMsg;
  index: number;
  isCollapsed: boolean;
  isMemoryCollapsed: boolean;
  memoryKey?: string;
  onToggleCollapse: (idx: number) => void;
  onToggleMemory: (key: string) => void;
  firstMessageTime?: Date | null;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  agentName?: string;
  onOpenWorkspacePath?: (path: string) => void | Promise<void>;
  pathLinkPrefixes?: string[];
}

const borderClass = (role: string) => {
  if (role === 'user') return 'border-l-primary';
  if (role === 'assistant') return 'border-l-green';
  return 'border-l-muted-foreground';
};

const bgClass = (role: string) => {
  if (role === 'user') return 'bg-message-user';
  if (role === 'assistant') return 'bg-message-assistant';
  if (role === 'system' || role === 'event') return 'bg-message-system';
  return '';
};

function RoleBadge({ role, agentName = 'Agent' }: { role: string; agentName?: string }) {
  if (role === 'user') {
    return <span className="cockpit-badge" data-tone="primary">Operator</span>;
  }
  if (role === 'assistant') {
    return <span className="cockpit-badge" data-tone="success">{agentName}</span>;
  }
  if (role === 'event') {
    return <span className="cockpit-badge" data-tone="warning">Event</span>;
  }
  return <span className="cockpit-badge">System</span>;
}

function MessageBubbleInner({ msg, index, isCollapsed, isMemoryCollapsed, memoryKey, onToggleCollapse, onToggleMemory, firstMessageTime, searchQuery, isCurrentMatch, agentName, onOpenWorkspacePath, pathLinkPrefixes }: MessageBubbleProps) {
  const isUser = msg.role === 'user';
  const isAssistant = msg.role === 'assistant';
  const isSystem = msg.role === 'system' || msg.role === 'event';
  const timeStr = msg.timestamp.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const missionTime = formatMissionTime(msg.timestamp, firstMessageTime ?? null);
  const isCollapsible = isMessageCollapsible(msg);
  const [copied, setCopied] = useState(false);
  const [sysExpanded, setSysExpanded] = useState(false);

  // useCallback must be called unconditionally (before any early returns)
  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(msg.rawText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn('Clipboard copy failed', err);
    }
  }, [msg.rawText]);

  // System notification strip (subagent/cron completions) — collapsible, not a full bubble
  if (msg.isSystemNotification) {
    const statusIcon = msg.systemLabel?.includes('failed') || msg.systemLabel?.includes('timed out') ? '⚠' : '⚡';
    return (
      <div className="group relative border-b border-border/20">
        <button
          type="button"
          onClick={() => setSysExpanded(!sysExpanded)}
          aria-expanded={sysExpanded}
          className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-4 py-2 text-[0.733rem] text-muted-foreground transition-colors hover:bg-secondary/50"
        >
          <span className={`shrink-0 w-3 transition-transform ${sysExpanded ? 'rotate-90' : ''}`}>›</span>
          <span>{statusIcon}</span>
          <span className="truncate font-medium text-info">{msg.systemLabel || 'System notification'}</span>
          <span className="ml-auto shrink-0 font-mono text-[0.667rem] text-info/40">{timeStr}</span>
        </button>
        {sysExpanded && (
          <div className="max-h-[300px] overflow-y-auto border-t border-border/20 bg-secondary/30 px-8 py-3 text-[0.8rem] text-muted-foreground">
            <pre className="whitespace-pre-wrap font-mono text-[0.667rem] leading-relaxed">{msg.rawText}</pre>
          </div>
        )}
      </div>
    );
  }

  const { memories, content: cleanContent } = isUser ? extractMemories(msg.rawText) : { memories: null, content: msg.rawText };
  const rawForDisplay = isUser && memories ? cleanContent : msg.rawText;
  const isVoiceMessage = isUser && (msg.isVoice || rawForDisplay.includes('[voice] '));
  // Strip [voice] tag and timestamp prefix like [Wed 2026-02-18 17:35 GMT+1]
  const displayContent = (() => {
    let text = rawForDisplay;
    if (isUser) {
      text = text.replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+GMT[+-]\d+\]\s*/g, '');
      text = text.replace(/\[voice\]\s*/g, '');
    }
    return text;
  })();

  // Generate preview: first non-empty line, truncated, for system/event messages
  const systemPreview = isSystem && msg.rawText
    ? (() => {
        const firstLine = msg.rawText.split('\n').find(l => l.trim()) || msg.rawText;
        const clean = firstLine.replace(/^#+\s*/, '').replace(/```\w*/g, '').trim();
        return decodeHtmlEntities(clean.slice(0, 80) + (clean.length > 80 ? '…' : ''));
      })()
    : '';

  const preview = isCollapsible && msg.rawText
    ? decodeHtmlEntities(systemPreview || msg.rawText.slice(0, 60).replace(/\n/g, ' ') + (msg.rawText.length > 60 ? '…' : ''))
    : '';

  const memoryCollapsedKey = memoryKey ?? `mem-${msg.msgId || msg.tempId || index}`;

  // Visual indicator for current search match
  const matchClass = isCurrentMatch ? 'ring-2 ring-primary/60 ring-offset-1 ring-offset-background' : '';
  
  // Pending/failed state classes for optimistic updates
  const pendingClass = msg.pending ? 'msg-pending' : '';
  const failedClass = msg.failed ? 'msg-failed' : '';

  // Intermediate assistant messages: narration between tool calls, not the final answer
  const isIntermediate = msg.intermediate && isAssistant;

  // Thinking bubbles: collapsible, dimmed, with thinking icon
  if (msg.isThinking) {
    return (
      <div className="group msg msg-assistant relative max-w-full break-words mx-4 my-0.5">
        <div
          role="button"
          tabIndex={0}
          aria-expanded={!isCollapsed}
          className="flex items-start gap-2 rounded-2xl border border-primary/10 bg-primary/[0.03] px-3 py-2 transition-colors cursor-pointer select-none hover:border-primary/18 hover:bg-primary/[0.05]"
          onClick={() => onToggleCollapse(index)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleCollapse(index); } }}
        >
          <span className={`mt-0.5 w-3 shrink-0 text-[0.667rem] text-primary/60 transition-transform ${!isCollapsed ? 'rotate-90' : ''}`}>›</span>
          <span className="mt-0.5 shrink-0 text-[0.667rem] text-primary/60">💭</span>
          <span className="shrink-0 text-[0.733rem] font-medium text-primary/78">Thinking</span>
          {msg.thinkingDurationMs && (
            <span className="shrink-0 text-[0.667rem] tabular-nums text-primary/52">
              • {msg.thinkingDurationMs >= 1000
                ? `${(msg.thinkingDurationMs / 1000).toFixed(1)}s`
                : `${msg.thinkingDurationMs}ms`}
            </span>
          )}
          {isCollapsed && (
            <span className="min-w-0 flex-1 truncate text-[0.667rem] italic text-primary/44">
              {msg.rawText.slice(0, 100)}{msg.rawText.length > 100 ? '…' : ''}
            </span>
          )}
          <span className="mt-0.5 shrink-0 font-mono text-[0.667rem] tabular-nums text-primary/36">{timeStr}</span>
        </div>
        {!isCollapsed && (
          <div className="ml-3 border-l border-primary/12 px-3 pb-2 pt-1 text-[0.8rem] text-foreground/70 msg-body-intermediate">
            <Suspense fallback={<span className="text-muted-foreground text-xs">…</span>}>
              <MarkdownRenderer content={msg.rawText} searchQuery={searchQuery} onOpenWorkspacePath={onOpenWorkspacePath} pathLinkPrefixes={pathLinkPrefixes} />
            </Suspense>
          </div>
        )}
      </div>
    );
  }

  // Intermediate messages get a compact, de-emphasized render
  if (isIntermediate) {
    return (
      <div className="group msg msg-assistant relative max-w-full break-words mx-4 my-0.5">
        <div
          role="button"
          tabIndex={0}
          aria-expanded={!isCollapsed}
          className="flex items-start gap-2 cursor-pointer select-none hover:bg-foreground/[0.02] transition-colors py-1 px-2 rounded"
          onClick={() => onToggleCollapse(index)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleCollapse(index); } }}
        >
          <span className={`text-muted-foreground text-[0.667rem] shrink-0 w-3 mt-0.5 transition-transform ${!isCollapsed ? 'rotate-90' : ''}`}>›</span>
          <span className="text-muted-foreground/50 text-[0.667rem] shrink-0 mt-0.5">💬</span>
          {isCollapsed ? (
            <span className="text-muted-foreground/70 text-[0.733rem] truncate flex-1 min-w-0 italic">
              {msg.rawText.split('\n').find(l => l.trim())?.slice(0, 100) || msg.rawText.slice(0, 100)}
              {msg.rawText.length > 100 ? '…' : ''}
            </span>
          ) : (
            <div className="text-muted-foreground/70 text-[0.8rem] flex-1 min-w-0 msg-body-intermediate">
              <Suspense fallback={<span className="text-muted-foreground text-xs">…</span>}>
                <MarkdownRenderer content={displayContent} searchQuery={searchQuery} suppressImages={isAssistant} onOpenWorkspacePath={onOpenWorkspacePath} pathLinkPrefixes={pathLinkPrefixes} />
              </Suspense>
            </div>
          )}
          <span className="text-muted-foreground/40 text-[0.667rem] shrink-0 tabular-nums mt-0.5">{timeStr}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`group msg msg-${msg.role} relative max-w-full break-words ${isUser ? 'ml-auto w-fit max-w-full overflow-visible flex flex-col sm:max-w-[72ch]' : 'overflow-hidden'} ${bgClass(msg.role)} ${matchClass} ${pendingClass} ${failedClass}`}>
      {/* Collapsible memories section for user messages */}
      {isUser && memories && (
        <MemoriesSection
          memories={memories}
          isCollapsed={isMemoryCollapsed}
          onToggle={() => onToggleMemory(memoryCollapsedKey)}
        />
      )}
      {/* Message header — click to collapse/expand */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        className={`flex items-center py-1.5 gap-2 cursor-pointer select-none hover:bg-foreground/[0.02] transition-colors ${isUser ? 'px-3 sm:px-4 flex-row-reverse' : 'px-3 sm:px-4'}`}
        onClick={() => onToggleCollapse(index)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleCollapse(index); } }}
      >
        <span className={`text-muted-foreground text-xs shrink-0 w-3 transition-transform ${!isCollapsed ? 'rotate-90' : ''} ${isUser ? 'rotate-180' : ''} ${!isCollapsed && isUser ? '-rotate-90' : ''}`}>›</span>
        <RoleBadge role={msg.role} agentName={agentName} />
        {isCollapsed && preview && (
          <span className="text-muted-foreground text-[0.667rem] opacity-60 overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">
            {isSystem && msg.rawText && /```/.test(msg.rawText) && (
              <span className="text-orange/70 mr-1" title="Contains code">{'</>'}</span>
            )}
            {preview}
          </span>
        )}
        <span className={`text-muted-foreground text-[0.667rem] shrink-0 tabular-nums ${isUser ? 'mr-auto' : 'ml-auto'}`}>
          {timeStr}
          {missionTime && <span className="ml-1.5 opacity-60">· {missionTime}</span>}
        </span>
      </div>
      {!isCollapsed && (
        <div className={`relative pb-2 border-transparent ${isUser ? 'px-3 pr-5 mr-1.5 border-r-2 border-r-primary sm:px-4 sm:pr-10 sm:mr-4' : 'px-3 pl-7 ml-2 border-l-2 sm:px-4 sm:pl-10 sm:ml-4'} ${!isUser ? borderClass(msg.role) : ''}`}>
          {msg.images && msg.images.length > 0 && !(isAssistant && msg.extractedImages && msg.extractedImages.length > 0) && (
            <div className={`flex gap-2 flex-wrap mb-2 ${isUser ? 'justify-end' : ''}`}>
              {msg.images.map((img, j) => 
                isAssistant ? (
                  <ImageLightbox key={j} src={img.preview} alt={img.name || 'image'} thumbnailClassName="max-w-[200px] max-h-[150px] rounded border border-border/60 object-contain cursor-pointer hover:border-primary/60 transition-colors" />
                ) : (
                  <img key={j} src={img.preview} alt={img.name || 'image'} className="max-w-[200px] max-h-[150px] rounded border border-border/60 object-contain" />
                )
              )}
            </div>
          )}
          <div className={`msg-body text-foreground ${isUser ? 'block w-full min-w-0 max-w-full pr-1.5 text-left sm:pr-0' : ''} ${isAssistant ? (isStructuredMarkdown(msg.rawText) ? 'max-w-[1120px]' : 'max-w-[68ch]') : ''}`}>
            {isVoiceMessage && (
              <span className="cockpit-badge mr-2 inline-flex align-middle" data-tone="primary">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                Voice
              </span>
            )}
            {displayContent && (
              <Suspense fallback={<div className="text-muted-foreground text-xs">Loading…</div>}>
                <MarkdownRenderer content={displayContent} searchQuery={searchQuery} suppressImages={isAssistant} onOpenWorkspacePath={onOpenWorkspacePath} pathLinkPrefixes={pathLinkPrefixes} />
              </Suspense>
            )}
          </div>
          {msg.charts && msg.charts.length > 0 && (
            <div className="w-full max-w-[1120px]">
              <Suspense fallback={<div className="text-muted-foreground text-xs">Loading chart…</div>}>
                {msg.charts.map((chart, ci) => (
                  <InlineChart key={ci} chart={chart} />
                ))}
              </Suspense>
            </div>
          )}
          {msg.extractedImages && msg.extractedImages.length > 0 && (
            <div className="flex flex-col gap-2 mt-2">
              {msg.extractedImages.map((img, idx) => (
                <ImageLightbox
                  key={idx}
                  src={img.url}
                  alt={img.alt || 'Agent image'}
                />
              ))}
            </div>
          )}
          {/* Action buttons — visible on hover */}
          {!msg.streaming && (
            <div className="absolute top-0 right-3 hidden gap-1 opacity-0 transition-opacity group-hover:opacity-100 sm:right-4 sm:flex">
              {/* Copy button */}
              <button
                className="cockpit-toolbar-button min-h-7 px-2 text-[0.667rem]"
                aria-label="Copy message to clipboard"
                onClick={handleCopy}
              >
                {copied ? '✓' : 'COPY'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Memoized MessageBubble to prevent unnecessary re-renders.
 * 
 * Re-renders only when:
 * - Message content/state changes (tempId, pending, failed, streaming)
 * - Collapse state changes
 * - Search highlighting changes (query or current match status)
 * 
 * This is critical for chat performance as messages array can grow large,
 * and each keypress/scroll shouldn't re-render all messages.
 */
export const MessageBubble = memo(MessageBubbleInner, (prev, next) => {
  // Return true if props are equal (skip re-render)
  // Return false if props changed (do re-render)
  
  // Message identity and state
  if (prev.msg.tempId !== next.msg.tempId) return false;
  if (prev.msg.pending !== next.msg.pending) return false;
  if (prev.msg.failed !== next.msg.failed) return false;
  if (prev.msg.streaming !== next.msg.streaming) return false;
  
  // Collapse states
  if (prev.isCollapsed !== next.isCollapsed) return false;
  if (prev.isMemoryCollapsed !== next.isMemoryCollapsed) return false;
  
  // Search highlighting
  if (prev.searchQuery !== next.searchQuery) return false;
  if (prev.isCurrentMatch !== next.isCurrentMatch) return false;
  
  // Content changes (for streaming updates)
  if (prev.msg.rawText !== next.msg.rawText) return false;
  if (prev.msg.html !== next.msg.html) return false;
  
  // System notification fields
  if (prev.msg.isSystemNotification !== next.msg.isSystemNotification) return false;
  if (prev.msg.systemLabel !== next.msg.systemLabel) return false;
  
  // Thinking state
  if (prev.msg.isThinking !== next.msg.isThinking) return false;
  if (prev.msg.thinkingDurationMs !== next.msg.thinkingDurationMs) return false;
  
  // Charts
  if (prev.msg.charts?.length !== next.msg.charts?.length) return false;
  
  // Images
  if (prev.msg.images?.length !== next.msg.images?.length) return false;
  if (prev.msg.extractedImages?.length !== next.msg.extractedImages?.length) return false;
  
  // Agent name (rare change but must re-render when it does)
  if (prev.agentName !== next.agentName) return false;
  if (prev.onOpenWorkspacePath !== next.onOpenWorkspacePath) return false;
  if (prev.pathLinkPrefixes !== next.pathLinkPrefixes) return false;
  
  // All relevant props are equal, skip re-render
  return true;
});
