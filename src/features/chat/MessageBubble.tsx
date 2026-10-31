import { useState, useCallback, lazy, Suspense, memo } from 'react';
import { Check, ChevronDown, ChevronRight, Code, Copy, Mic } from 'lucide-react';
import { Pane } from '@/components/ui/Pane';
import type { PaneState } from '@/lib/paneState';
import { MemoriesSection } from './MemoriesSection';
import { ImageLightbox } from './ImageLightbox';
import { isMessageCollapsible } from './types';
import { decodeHtmlEntities } from '@/lib/formatting';
import type { ChatMsg } from './types';
import type { BeadLinkTarget } from '@/features/beads';

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

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
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
  /** Identity hue of the agent family; tints the assistant's pane while it is off. */
  agentHue?: string;
  onOpenWorkspacePath?: (path: string) => void | Promise<void>;
  pathLinkPrefixes?: string[];
  pathLinkAliases?: Record<string, string>;
  onOpenBeadId?: (target: BeadLinkTarget) => void | Promise<void>;
}

/** Accessible names for the assistant pane when it is lit. */
const ASSISTANT_PANE_LABEL: Partial<Record<PaneState, string>> = {
  live: 'Writing',
  error: 'Failed',
};

/** Shared header line geometry: one row unit, name, time, then quiet extras. */
const headerRowClass = 'flex min-h-[var(--row-unit)] min-w-0 items-center gap-2';

/** Expand/collapse toggle surface inside a header line. */
const headerToggleClass =
  'flex min-w-0 flex-1 cursor-pointer select-none items-center gap-2 rounded-sm';

const timeClass = 'shrink-0 font-mono text-[0.8rem] tabular text-muted-foreground';

/** Matches a fenced code block marker in raw message text. */
const CODE_FENCE = /`{3}/;

function MessageBubbleInner({ msg, index, isCollapsed, isMemoryCollapsed, memoryKey, onToggleCollapse, onToggleMemory, searchQuery, isCurrentMatch, agentName, agentHue, onOpenWorkspacePath, pathLinkPrefixes, pathLinkAliases, onOpenBeadId }: MessageBubbleProps) {
  const isUser = msg.role === 'user';
  const isAssistant = msg.role === 'assistant';
  const isSystem = msg.role === 'system' || msg.role === 'event';
  const timeStr = msg.timestamp.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
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

  // System notification strip (subagent/cron completions): collapsible, not a full message
  if (msg.isSystemNotification) {
    const failed = Boolean(msg.systemLabel?.includes('failed') || msg.systemLabel?.includes('timed out'));
    return (
      <div className="group relative">
        <button
          type="button"
          onClick={() => setSysExpanded(!sysExpanded)}
          aria-expanded={sysExpanded}
          className={`${headerRowClass} w-full cursor-pointer rounded-sm border-0 bg-transparent text-left text-[0.8rem] text-muted-foreground transition-colors duration-[120ms] hover:text-foreground`}
        >
          <Pane state={failed ? 'error' : 'off'} size="sm" label={failed ? 'Failed' : undefined} />
          <span className="min-w-0 truncate font-medium">{msg.systemLabel || 'System notification'}</span>
          <span className={`ml-auto ${timeClass}`}>{timeStr}</span>
          {sysExpanded
            ? <ChevronDown size={14} className="shrink-0" aria-hidden="true" />
            : <ChevronRight size={14} className="shrink-0" aria-hidden="true" />}
        </button>
        {sysExpanded && (
          <div className="mb-2 max-h-[300px] overflow-y-auto rounded-[3px] border border-border bg-card px-3 py-2">
            <pre className="whitespace-pre-wrap font-mono text-[0.8rem] leading-relaxed text-muted-foreground">{msg.rawText}</pre>
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

  // Visual indicator for current search match: the operator's own find
  const matchClass = isCurrentMatch ? 'rounded-[3px] ring-1 ring-operator/60 ring-offset-4 ring-offset-background' : '';

  // Pending/failed state classes for optimistic updates
  const pendingClass = msg.pending ? 'msg-pending' : '';
  const failedClass = msg.failed ? 'msg-failed' : '';

  // Intermediate assistant messages: narration between tool calls, not the final answer
  const isIntermediate = msg.intermediate && isAssistant;

  const toggleOnKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleCollapse(index); }
  };

  // Thinking: a quiet, collapsible line; the trace opens beneath a 1px rule
  if (msg.isThinking) {
    return (
      <div className="group msg msg-assistant relative max-w-full break-words pl-6">
        <div
          role="button"
          tabIndex={0}
          aria-expanded={!isCollapsed}
          className={`${headerRowClass} cursor-pointer select-none rounded-sm text-[0.8rem] text-muted-foreground transition-colors duration-[120ms] hover:text-foreground`}
          onClick={() => onToggleCollapse(index)}
          onKeyDown={toggleOnKey}
        >
          {isCollapsed
            ? <ChevronRight size={14} className="shrink-0" aria-hidden="true" />
            : <ChevronDown size={14} className="shrink-0" aria-hidden="true" />}
          <span className="shrink-0 font-medium">Thinking</span>
          {msg.thinkingDurationMs ? (
            <span className="shrink-0 font-mono tabular">
              {msg.thinkingDurationMs >= 1000
                ? `${(msg.thinkingDurationMs / 1000).toFixed(1)}s`
                : `${msg.thinkingDurationMs}ms`}
            </span>
          ) : null}
          {isCollapsed && (
            <span className="min-w-0 flex-1 truncate italic">
              {msg.rawText.slice(0, 100)}{msg.rawText.length > 100 ? '…' : ''}
            </span>
          )}
          <span className={`ml-auto ${timeClass}`}>{timeStr}</span>
        </div>
        {!isCollapsed && (
          <div className="mb-1 ml-[7px] border-l border-border pb-1 pl-3 text-foreground msg-body-intermediate">
            <Suspense fallback={<span className="text-[0.8rem] text-muted-foreground">Loading</span>}>
              <MarkdownRenderer content={msg.rawText} searchQuery={searchQuery} onOpenWorkspacePath={onOpenWorkspacePath} pathLinkPrefixes={pathLinkPrefixes} pathLinkAliases={pathLinkAliases} onOpenBeadId={onOpenBeadId} />
            </Suspense>
          </div>
        )}
      </div>
    );
  }

  // Intermediate messages: muted, smaller, no chrome
  if (isIntermediate) {
    return (
      <div className="group msg msg-assistant relative max-w-full break-words pl-6">
        <div
          role="button"
          tabIndex={0}
          aria-expanded={!isCollapsed}
          className="flex min-h-[var(--row-unit)] cursor-pointer select-none items-start gap-2 rounded-sm py-[5px] text-[0.8rem] leading-[18px] text-muted-foreground transition-colors duration-[120ms] hover:text-foreground"
          onClick={() => onToggleCollapse(index)}
          onKeyDown={toggleOnKey}
        >
          {isCollapsed
            ? <ChevronRight size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            : <ChevronDown size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
          {isCollapsed ? (
            <span className="min-w-0 flex-1 truncate">
              {msg.rawText.split('\n').find(l => l.trim())?.slice(0, 100) || msg.rawText.slice(0, 100)}
              {msg.rawText.length > 100 ? '…' : ''}
            </span>
          ) : (
            <div className="min-w-0 flex-1 text-foreground msg-body-intermediate">
              <Suspense fallback={<span className="text-[0.8rem] text-muted-foreground">Loading</span>}>
                <MarkdownRenderer content={displayContent} searchQuery={searchQuery} suppressImages={isAssistant} onOpenWorkspacePath={onOpenWorkspacePath} pathLinkPrefixes={pathLinkPrefixes} pathLinkAliases={pathLinkAliases} onOpenBeadId={onOpenBeadId} />
              </Suspense>
            </div>
          )}
          <span className={timeClass}>{timeStr}</span>
        </div>
      </div>
    );
  }

  // Header line: pane, who, when. The operator is warm; the agent is lit while it writes.
  const paneState: PaneState | null = isUser
    ? 'operator'
    : isAssistant
      ? (msg.failed ? 'error' : msg.streaming ? 'live' : 'off')
      : null;
  const speaker = isUser
    ? 'You'
    : isAssistant
      ? (agentName || 'Agent')
      : msg.role === 'event' ? 'Event' : 'System';
  const speakerClass = isUser
    ? 'shrink-0 font-display font-semibold text-operator-text'
    : isAssistant
      ? 'min-w-0 truncate font-display font-semibold text-foreground'
      : 'shrink-0 font-medium';

  const images = msg.images && msg.images.length > 0 && !(isAssistant && msg.extractedImages && msg.extractedImages.length > 0) && (
    <div className="mb-2 flex flex-wrap gap-2">
      {msg.images.map((img, j) =>
        isAssistant ? (
          <ImageLightbox key={j} src={img.preview} alt={img.name || 'image'} thumbnailClassName="max-w-[200px] max-h-[150px] cursor-pointer rounded-[3px] border border-border object-contain transition-colors duration-[120ms] hover:border-pane-edge" />
        ) : (
          <img key={j} src={img.preview} alt={img.name || 'image'} className="max-w-[200px] max-h-[150px] rounded-[3px] border border-border object-contain" />
        )
      )}
    </div>
  );

  const body = displayContent && (
    <div className={`msg-body text-foreground ${isUser ? 'block w-full min-w-0 max-w-full text-left' : ''}`}>
      <Suspense fallback={<div className="text-[0.8rem] text-muted-foreground">Loading</div>}>
        <MarkdownRenderer content={displayContent} searchQuery={searchQuery} suppressImages={isAssistant} onOpenWorkspacePath={onOpenWorkspacePath} pathLinkPrefixes={pathLinkPrefixes} pathLinkAliases={pathLinkAliases} onOpenBeadId={onOpenBeadId} />
      </Suspense>
    </div>
  );

  const attachments = msg.uploadAttachments && msg.uploadAttachments.length > 0 && (
    <div className="mt-2 flex flex-col gap-1.5">
      {msg.uploadAttachments.map((attachment) => (
        <div key={attachment.id} className="rounded-[3px] border border-border bg-card px-2.5 py-1.5 text-[0.8rem] text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{attachment.name}</span>
            <span className="cockpit-badge">
              {attachment.mode === 'file_reference' ? 'Local file' : 'Inline'}
            </span>
            <span className="font-mono tabular">{formatBytes(attachment.sizeBytes)}</span>
            <span className="font-mono">{attachment.mimeType}</span>
          </div>
          {attachment.reference?.path && (
            <div className="mt-1 break-all font-mono text-[0.8rem] text-muted-foreground">{attachment.reference.path}</div>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className={`group msg msg-${msg.role} relative max-w-full break-words pb-1 pl-6 pt-2 ${isSystem ? 'text-muted-foreground' : ''} ${matchClass} ${pendingClass} ${failedClass}`}>
      {/* Header line: click to collapse/expand */}
      <div className={`${headerRowClass} ${isSystem ? 'text-[0.8rem]' : 'text-[0.867rem]'}`}>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={!isCollapsed}
          className={headerToggleClass}
          onClick={() => onToggleCollapse(index)}
          onKeyDown={toggleOnKey}
        >
          {/* The pane sits in the gutter so every message's text shares one left edge */}
          {paneState && (
            <Pane state={paneState} size="sm" className="absolute left-0 top-[1.1rem]" hue={isAssistant ? agentHue : undefined} label={isAssistant ? ASSISTANT_PANE_LABEL[paneState] : undefined} />
          )}
          <span className={`msg-speaker ${speakerClass}`}>{speaker}</span>
          <span className={timeClass}>{timeStr}</span>
          {isVoiceMessage && (
            <span className="inline-flex shrink-0 items-center gap-1 text-[0.8rem] text-muted-foreground">
              <Mic size={14} aria-hidden="true" />
              Voice
            </span>
          )}
          {msg.pending && <span className="shrink-0 text-[0.8rem] text-muted-foreground">Sending</span>}
          {msg.failed && <span className="shrink-0 text-[0.8rem] text-destructive">Not sent</span>}
          {isCollapsed && preview && (
            <span className="flex min-w-0 flex-1 items-center gap-1 text-[0.8rem] text-muted-foreground">
              {isSystem && msg.rawText && CODE_FENCE.test(msg.rawText) && (
                <Code size={14} className="shrink-0" aria-label="Contains code" />
              )}
              <span className="truncate">{preview}</span>
            </span>
          )}
          {isCollapsed && <ChevronRight size={14} className="ml-auto shrink-0 text-muted-foreground" aria-hidden="true" />}
        </div>
        {/* Copy: appears on hover or keyboard focus */}
        {!msg.streaming && !isCollapsed && (
          <button
            type="button"
            className="hidden h-6 shrink-0 items-center gap-1 rounded-[3px] px-1.5 text-[0.8rem] text-muted-foreground opacity-0 transition-[opacity,color,background-color] duration-[120ms] hover:bg-raised hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 sm:inline-flex"
            aria-label="Copy message to clipboard"
            onClick={handleCopy}
          >
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>

      {/* Collapsible memories section for user messages */}
      {isUser && memories && (
        <MemoriesSection
          memories={memories}
          isCollapsed={isMemoryCollapsed}
          onToggle={() => onToggleMemory(memoryCollapsedKey)}
        />
      )}

      {!isCollapsed && (
        isUser ? (
          <div className="msg-bubble plate-operator mt-1 w-fit max-w-[min(100%,var(--reading-measure))] rounded-[3px] bg-message-user px-3 py-2">
            {images}
            {body}
            {attachments}
          </div>
        ) : (
          <div className={`msg-content relative mt-0.5 ${isSystem ? 'text-[0.867rem]' : ''}`}>
            {images}
            {body}
            {msg.charts && msg.charts.length > 0 && (
              <div className="w-full">
                <Suspense fallback={<div className="text-[0.8rem] text-muted-foreground">Loading chart</div>}>
                  {msg.charts.map((chart, ci) => (
                    <InlineChart key={ci} chart={chart} />
                  ))}
                </Suspense>
              </div>
            )}
            {attachments}
            {msg.extractedImages && msg.extractedImages.length > 0 && (
              <div className="mt-2 flex flex-col gap-2">
                {msg.extractedImages.map((img, idx) => (
                  <ImageLightbox
                    key={idx}
                    src={img.url}
                    alt={img.alt || 'Agent image'}
                  />
                ))}
              </div>
            )}
          </div>
        )
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
  
  // Images and attachment metadata
  if (prev.msg.images?.length !== next.msg.images?.length) return false;
  if (prev.msg.extractedImages?.length !== next.msg.extractedImages?.length) return false;
  if ((prev.msg.uploadAttachments?.length || 0) !== (next.msg.uploadAttachments?.length || 0)) return false;
  if ((prev.msg.uploadAttachments || []).some((attachment, idx) => {
    const nextAttachment = next.msg.uploadAttachments?.[idx];
    return !nextAttachment
      || attachment.id !== nextAttachment.id
      || attachment.name !== nextAttachment.name
      || attachment.mode !== nextAttachment.mode
      || attachment.sizeBytes !== nextAttachment.sizeBytes
      || attachment.mimeType !== nextAttachment.mimeType
      || attachment.reference?.path !== nextAttachment.reference?.path;
  })) return false;
  
  // Agent name (rare change but must re-render when it does)
  if (prev.agentName !== next.agentName) return false;
  if (prev.agentHue !== next.agentHue) return false;
  if (prev.onOpenWorkspacePath !== next.onOpenWorkspacePath) return false;
  if (prev.pathLinkPrefixes !== next.pathLinkPrefixes) return false;
  if (prev.pathLinkAliases !== next.pathLinkAliases) return false;
  if (prev.onOpenBeadId !== next.onOpenBeadId) return false;
  
  // All relevant props are equal, skip re-render
  return true;
});
