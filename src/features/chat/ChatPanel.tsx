import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import type { ProcessingStage, ActivityLogEntry, ChatStreamState } from '@/contexts/ChatContext';
import { ToolCallBlock } from './ToolCallBlock';
import { MessageBubble } from './MessageBubble';
import { InputBar, type InputBarHandle } from './InputBar';
import { SearchBar } from './SearchBar';
import { useMessageSearch } from './useMessageSearch';
import { ActivityLog, ChatHeader, ProcessingIndicator, ScrollToBottomButton, StreamingMessage, ToolGroupBlock } from './components';
import { isMessageCollapsible } from './types';
import type { ChatMsg, ImageAttachment } from './types';

interface ChatPanelProps {
  messages: ChatMsg[];
  onSend: (text: string, attachments?: ImageAttachment[]) => void;
  onAbort: () => void;
  isGenerating: boolean;
  stream: ChatStreamState;
  processingStage?: ProcessingStage;
  lastEventTimestamp?: number;
  currentToolDescription?: string | null;
  activityLog?: ActivityLogEntry[];
  onWakeWordState?: (enabled: boolean, toggle: () => void) => void;
  onReset?: () => void;
  /** Externally controlled search open state */
  searchOpen?: boolean;
  /** Called when search should close */
  onSearchClose?: () => void;
  /** HTML id for skip-to-content link */
  id?: string;
  /** Agent display name */
  agentName?: string;
  /** Load more (older) messages — returns true if still more available */
  loadMore?: () => boolean;
  /** Whether there are older messages to load */
  hasMore?: boolean;
  /** Mobile file browser toggle handler */
  onToggleFileBrowser?: () => void;
  /** Whether the mobile file browser is currently collapsed. */
  isFileBrowserCollapsed?: boolean;
  /** Mobile top bar toggle handler. */
  onToggleMobileTopBar?: () => void;
  /** Whether the mobile top bar is currently hidden. */
  isMobileTopBarHidden?: boolean;
  /** Open or reveal a safe workspace path in the file explorer/editor. */
  onOpenWorkspacePath?: (path: string) => void | Promise<void>;
  /** Configured path prefixes that should render as clickable inline path links. */
  pathLinkPrefixes?: string[];
}

export interface ChatPanelHandle {
  focusInput: () => void;
}

/** Main chat panel with message list, infinite scroll, search, and input bar. */
export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(function ChatPanel({
  messages,
  onSend, onAbort, isGenerating, stream,
  processingStage,
  lastEventTimestamp = 0, currentToolDescription = null, activityLog = [],
  onWakeWordState, onReset, searchOpen, onSearchClose, id, agentName = 'Agent',
  loadMore, hasMore = false, onToggleFileBrowser, isFileBrowserCollapsed = true,
  onToggleMobileTopBar, isMobileTopBarHidden = false,
  onOpenWorkspacePath,
  pathLinkPrefixes,
}, ref) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const inputBarRef = useRef<InputBarHandle>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string | number, boolean>>({});
  const [unreadCount, setUnreadCount] = useState(0);
  const [processingTime, setProcessingTime] = useState(0);
  const processingStart = useRef<number | null>(null);
  const prevMessageCount = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isLoadingMore = useRef(false);
  const loadMoreRef = useRef(loadMore);
  const hasMoreRef = useRef(hasMore);

  // Keep refs in sync so the observer callback always sees current values
  useEffect(() => { loadMoreRef.current = loadMore; }, [loadMore]);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);

  // Infinite scroll — load older messages when sentinel enters viewport
  useEffect(() => {
    if (!loadMoreRef.current || !hasMoreRef.current) return;
    const sentinel = sentinelRef.current;
    const container = scrollRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || isLoadingMore.current || !loadMoreRef.current || !hasMoreRef.current) return;
        isLoadingMore.current = true;

        // Preserve scroll position: record distance from bottom before prepend
        const prevScrollHeight = container.scrollHeight;
        const prevScrollTop = container.scrollTop;

        loadMoreRef.current();

        // After React commits DOM updates, restore scroll position.
        // Double-rAF ensures we run after React's commit + browser layout.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const newScrollHeight = container.scrollHeight;
            const delta = newScrollHeight - prevScrollHeight;
            container.scrollTop = prevScrollTop + delta;
            isLoadingMore.current = false;
          });
        });
      },
      { root: container, rootMargin: '200px 0px 0px 0px', threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, hasMore]);

  // Expose focusInput to parent
  useImperativeHandle(ref, () => ({
    focusInput: () => inputBarRef.current?.focus()
  }), []);

  // Clean up stale messageRefs when messages change
  useEffect(() => {
    const validIndices = new Set(messages.map((_, i) => i));
    for (const key of messageRefs.current.keys()) {
      if (!validIndices.has(key)) messageRefs.current.delete(key);
    }
  }, [messages]);

  // Message search
  const search = useMessageSearch(messages);

  // Sync external search state with internal
  // We intentionally only react to searchOpen changes to avoid infinite loops
  useEffect(() => {
    if (searchOpen && !search.isActive) {
      search.open();
    } else if (!searchOpen && search.isActive) {
      search.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only sync on external searchOpen changes
  }, [searchOpen]);

  // Wrap close to also notify parent
  const handleSearchClose = useCallback(() => {
    search.close();
    onSearchClose?.();
  }, [search, onSearchClose]);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current && autoScroll) {
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [autoScroll]);

  useEffect(scrollToBottom, [messages, stream.html, scrollToBottom]);

  // NOTE: Cmd+F and Escape are now handled globally in App.tsx via useKeyboardShortcuts

  // Scroll to current match when it changes
  useEffect(() => {
    if (search.currentMatch) {
      const msgElement = messageRefs.current.get(search.currentMatch.messageIndex);
      if (msgElement && scrollRef.current) {
        // Expand the message if it's collapsed
        const msgIndex = search.currentMatch.messageIndex;
        const searchMsg = messages[msgIndex];
        const searchCollapseKey = searchMsg?.msgId || searchMsg?.tempId || msgIndex;
        if (collapsed[searchCollapseKey]) {
          setCollapsed(prev => ({ ...prev, [searchCollapseKey]: false }));
        }
        // Scroll to the message
        msgElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setAutoScroll(false);
      }
    }
  }, [search.currentMatch, search.currentMatchIndex, collapsed, messages]);

  // Track unread messages when scrolled up
  useEffect(() => {
    if (!autoScroll && messages.length > prevMessageCount.current) {
      setUnreadCount(prev => prev + (messages.length - prevMessageCount.current));
    }
    prevMessageCount.current = messages.length;
  }, [messages.length, autoScroll]);

  // Processing timer
  useEffect(() => {
    if (isGenerating) {
      processingStart.current = Date.now();
      const iv = setInterval(() => {
        if (processingStart.current) {
          setProcessingTime(Date.now() - processingStart.current);
        }
      }, 250);
      return () => clearInterval(iv);
    } else {
      processingStart.current = null;
      setProcessingTime(0);
    }
  }, [isGenerating]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(isAtBottom);
    if (isAtBottom) setUnreadCount(0);
  };

  const handleScrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setAutoScroll(true);
      setUnreadCount(0);
    }
  };

  const toggleCollapse = (idx: number) => {
    // Resolve to stable msgId so collapse state survives list reordering.
    const msg = messages[idx];
    const key = msg?.msgId || msg?.tempId || idx;
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleMemory = (key: string) => {
    setCollapsed(prev => ({ ...prev, [key]: !(prev[key] ?? true) }));
  };

  // First message time for mission time calculation
  const firstMessageTime = messages.length > 0 ? messages[0].timestamp : null;

  return (
    <div id={id} className="h-full flex flex-col border-r border-border min-w-0 relative">
      {/* COMMS Header */}
      <ChatHeader
        onReset={onReset}
        onAbort={onAbort}
        isGenerating={isGenerating}
        onToggleFileBrowser={onToggleFileBrowser}
        isFileBrowserCollapsed={isFileBrowserCollapsed}
        onToggleMobileTopBar={onToggleMobileTopBar}
        isMobileTopBarHidden={isMobileTopBarHidden}
      />

      {/* Search Bar */}
      {search.isActive && (
        <SearchBar
          query={search.query}
          onQueryChange={search.setQuery}
          matchCount={search.matchCount}
          currentMatchIndex={search.currentMatchIndex}
          onNext={search.nextMatch}
          onPrev={search.prevMatch}
          onClose={handleSearchClose}
        />
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-label="Chat messages"
        className="flex-1 overflow-y-auto overflow-x-hidden py-3 flex flex-col gap-1"
      >
        {/* Infinite scroll sentinel + "load more" indicator */}
        {hasMore && (
          <div ref={sentinelRef} className="flex items-center justify-center py-2 text-muted-foreground/60 text-[0.667rem] tracking-widest uppercase select-none">
            ↑ older messages
          </div>
        )}
        {messages.map((msg, i) => {
          const isTool = msg.role === 'tool' || msg.role === 'toolResult';
          const collapseKey = msg.msgId || msg.tempId || i;
          const isCollapsed = collapsed[collapseKey] ?? (msg.isThinking || isMessageCollapsible(msg));
          const memoryKey = `mem-${collapseKey}`;
          const isMemoryCollapsed = collapsed[memoryKey] ?? true;
          const isCurrentMatch = search.currentMatch?.messageIndex === i;
          const stableKey = msg.msgId || msg.tempId || `${msg.role}-${msg.timestamp.getTime()}-${i}`;

          if (isTool) {
            // Grouped tool bubble (multiple consecutive tool calls)
            if (msg.toolGroup) {
              return (
                <div
                  key={stableKey}
                  ref={(el) => { if (el) messageRefs.current.set(i, el); }}
                >
                  <ToolGroupBlock
                    msg={msg}
                    index={i}
                    isCollapsed={isCollapsed}
                    onToggleCollapse={toggleCollapse}
                  />
                </div>
              );
            }
            // Single tool call
            return (
              <div
                key={stableKey}
                ref={(el) => { if (el) messageRefs.current.set(i, el); }}
              >
                <ToolCallBlock
                  msg={msg}
                  index={i}
                  isCollapsed={isCollapsed}
                  onToggleCollapse={toggleCollapse}
                />
              </div>
            );
          }

          return (
            <div
              key={stableKey}
              ref={(el) => { if (el) messageRefs.current.set(i, el); }}
            >
              <MessageBubble
                msg={msg}
                index={i}
                isCollapsed={isCollapsed}
                isMemoryCollapsed={isMemoryCollapsed}
                memoryKey={memoryKey}
                onToggleCollapse={toggleCollapse}
                onToggleMemory={toggleMemory}
                firstMessageTime={firstMessageTime}
                searchQuery={search.query}
                isCurrentMatch={isCurrentMatch}
                agentName={agentName}
                onOpenWorkspacePath={onOpenWorkspacePath}
                pathLinkPrefixes={pathLinkPrefixes}
              />
            </div>
          );
        })}

        {/* Processing indicator — visible while generating, persists during streaming */}
        {isGenerating && !stream.html && (
          <ProcessingIndicator
            stage={processingStage}
            elapsedMs={processingTime}
            lastEventTimestamp={lastEventTimestamp}
            currentToolDescription={currentToolDescription}
            activityLog={activityLog}
            isRecovering={Boolean(stream.isRecovering)}
            recoveryReason={stream.recoveryReason}
          />
        )}

        {/* Streaming message with condensed activity log */}
        {isGenerating && stream.html && (
          <>
            <StreamingMessage html={stream.html} elapsedMs={processingTime} agentName={agentName} />
            {activityLog.length > 0 && (
              <div className="px-4 pb-2" style={{ paddingLeft: '2rem' }}>
                <ActivityLog entries={activityLog} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Scroll-to-bottom button */}
      {!autoScroll && (
        <ScrollToBottomButton onClick={handleScrollToBottom} unreadCount={unreadCount} />
      )}

      {/* Input area */}
      <InputBar
        ref={inputBarRef}
        onSend={onSend}
        isGenerating={isGenerating}
        onWakeWordState={onWakeWordState}
        agentName={agentName}
      />

    </div>
  );
});

// Re-export types for backward compatibility
export type { ChatMsg, ImageAttachment } from './types';
