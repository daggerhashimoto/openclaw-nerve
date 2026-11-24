import { useRef, useEffect, useLayoutEffect, useState, useCallback, forwardRef, useImperativeHandle, type ReactNode } from 'react';
import type { ProcessingStage, ActivityLogEntry, ChatStreamState } from '@/contexts/ChatContext';
import { ToolCallBlock } from './ToolCallBlock';
import { MessageBubble } from './MessageBubble';
import { dayKey, dayLabel, extractMemories } from './utils';

/** A hairline across the transcript with a word on it: a day, or the way to older messages */
function TranscriptDivider({ label }: { label: string }) {
  return (
    <div className="nerve-divider" role="separator" aria-label={label}>
      <span>{label}</span>
    </div>
  );
}
import { LiveHorizon } from './LiveHorizon';
import { InputBar, type InputBarHandle } from './InputBar';
import { SearchBar } from './SearchBar';
import { useMessageSearch } from './useMessageSearch';
import { ActivityLog, ChatHeader, ProcessingIndicator, ScrollToBottomButton, StreamingMessage, ToolGroupBlock, toolStackClass } from './components';
import { isMessageCollapsible } from './types';
import type { ChatMsg, ImageAttachment, OutgoingUploadPayload } from './types';
import type { BeadLinkTarget } from '@/features/beads';

interface ChatPanelProps {
  messages: ChatMsg[];
  onSend: (text: string, attachments?: ImageAttachment[], uploadPayload?: OutgoingUploadPayload) => void | Promise<void>;
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
  /** Who speaks for the agent: the name on its replies and the header nameplate. */
  agentName?: string;
  /** The open session's own name when it is not the agent's (a channel peer or room, a cron job). */
  sessionName?: string;
  /** Identity hue of the agent family; tints idle panes in the header and transcript. */
  agentHue?: string;
  /** Load more (older) messages: returns true if still more available */
  loadMore?: () => boolean;
  /** Whether there are older messages to load */
  hasMore?: boolean;
  /** True once this room's history has been fetched; an empty room says so only then */
  historyLoaded?: boolean;
  /** Performance mode freezes cosmetic live visuals such as the horizon. */
  performanceMode?: boolean;
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
  /** Configured shorthand aliases that should normalize to canonical workspace paths. */
  pathLinkAliases?: Record<string, string>;
  /** Open a dedicated bead viewer tab. */
  onOpenBeadId?: (target: BeadLinkTarget) => void | Promise<void>;
  /** Whether to show the compact Commands launcher inside the composer. */
  showCommandPaletteButton?: boolean;
  /** Open the command palette from the compact composer launcher. */
  onOpenCommandPalette?: () => void;
}

export interface ChatPanelHandle {
  focusInput: () => void;
  addWorkspacePath: (path: string, kind: 'file' | 'directory', agentId?: string) => Promise<void>;
}

/** Thinking, tool calls, system lines and notification strips start folded; replies start open. */
function isCollapsedByDefault(msg: ChatMsg): boolean {
  return Boolean(msg.isThinking) || Boolean(msg.isSystemNotification) || isMessageCollapsible(msg);
}

/** How long the search waits for a match's highlight to render (a lazy body) before it stops watching. */
const SEARCH_MARK_WAIT_MS = 2000;

/** The key a row's open or folded state is kept under. */
function collapseKeyOf(msg: ChatMsg | undefined, index: number): string | number {
  return msg?.msgId || msg?.tempId || index;
}

/** Whether a turn's referenced memories hold the search query. */
function memoriesHold(msg: ChatMsg, query: string): boolean {
  if (msg.role !== 'user' || !query.trim()) return false;
  const { memories } = extractMemories(msg.rawText);
  return Boolean(memories && memories.toLowerCase().includes(query.toLowerCase()));
}

/** Main chat panel with message list, infinite scroll, search, and input bar. */
export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(function ChatPanel({
  messages,
  onSend, onAbort, isGenerating, stream,
  processingStage,
  lastEventTimestamp = 0, currentToolDescription = null, activityLog = [],
  onWakeWordState, onReset, searchOpen, onSearchClose, id, agentName = 'Agent', sessionName, agentHue,
  loadMore, hasMore = false, historyLoaded = false, performanceMode = false, onToggleFileBrowser, isFileBrowserCollapsed = true,
  onToggleMobileTopBar, isMobileTopBarHidden = false,
  onOpenWorkspacePath,
  pathLinkPrefixes,
  pathLinkAliases,
  onOpenBeadId,
  showCommandPaletteButton = false,
  onOpenCommandPalette,
}, ref) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const inputBarRef = useRef<InputBarHandle>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  // The resize observer reads these between renders, so they are written where the panel
  // learns or sets them, not after the next render: whether the chat follows the
  // conversation, and the scroll position the panel last saw or set.
  const followingRef = useRef(true);
  const lastScrollTop = useRef(0);
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

  // Infinite scroll: load older messages when sentinel enters viewport
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
    focusInput: () => inputBarRef.current?.focus(),
    addWorkspacePath: async (path: string, kind: 'file' | 'directory', agentId?: string) => {
      await inputBarRef.current?.addWorkspacePath(path, kind, agentId);
    },
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

  // Search reveal (#412): the current match's row opens while it is the current match,
  // with its referenced memories when they hold the query (a tool group opens its own
  // matching entries). Nothing is written to `collapsed`, so moving to another match or
  // ending the search folds back what search opened, and what the operator opened or
  // folded by hand stays as they left it. Toggling a revealed row hands it to the operator.
  const matchIndex = search.currentMatch?.messageIndex;
  const matchMsg = matchIndex !== undefined ? messages[matchIndex] : undefined;
  const matchKey = matchIndex !== undefined ? collapseKeyOf(matchMsg, matchIndex) : null;
  const revealToken = matchKey !== null ? JSON.stringify([search.query, search.currentMatchIndex, matchKey]) : null;
  const [handedOver, setHandedOver] = useState<{ token: string | null; keys: Array<string | number> }>({ token: null, keys: [] });
  // A new current match starts with nothing handed over
  if (handedOver.token !== revealToken) setHandedOver({ token: revealToken, keys: [] });
  const revealed = new Set<string | number>();
  if (matchKey !== null && matchMsg) {
    revealed.add(matchKey);
    if (memoriesHold(matchMsg, search.query)) revealed.add(`mem-${matchKey}`);
  }
  if (handedOver.token === revealToken) handedOver.keys.forEach((key) => revealed.delete(key));
  // Row components skip re-renders on new callbacks, so the toggles read the reveal from here
  const revealedRef = useRef(revealed);
  useLayoutEffect(() => { revealedRef.current = revealed; });
  const handOver = (key: string | number) => setHandedOver((prev) => ({ token: prev.token, keys: [...prev.keys, key] }));

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
        if (!el) return;
        el.scrollTop = el.scrollHeight;
        lastScrollTop.current = el.scrollTop;
      });
    }
  }, [autoScroll]);

  useEffect(scrollToBottom, [messages, stream.html, scrollToBottom]);

  // Content that grows after it rendered (a lazy chart, an image that loads, an embed)
  // changes no message, so follow it here while the chat follows the conversation.
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!followingRef.current) return;
      el.scrollTop = el.scrollHeight;
      lastScrollTop.current = el.scrollTop;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // NOTE: Cmd+F and Escape are now handled globally in App.tsx via useKeyboardShortcuts

  // Scroll to the current match when it changes (its row is already open, see the search reveal)
  useEffect(() => {
    if (revealToken === null || matchIndex === undefined) return;
    const row = messageRefs.current.get(matchIndex);
    if (!row || !scrollRef.current) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    followingRef.current = false;
    setAutoScroll(false);
    // Then the marked text itself, once: it can sit in a result or memories box that
    // scrolls on its own, and a body drawn by the lazy markdown renderer shows only its
    // fallback until the chunk loads. Watch the row until the mark appears, for a while.
    // (The observer and frame callbacks run after this effect returns, so `frame` and `giveUp` are set by then.)
    const scrollToMark = () => {
      const mark = row.querySelector('mark.search-highlight');
      if (!mark) return;
      stop();
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    const observer = new MutationObserver(scrollToMark);
    const stop = () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(giveUp);
    };
    observer.observe(row, { childList: true, subtree: true });
    const frame = requestAnimationFrame(scrollToMark);
    const giveUp = setTimeout(stop, SEARCH_MARK_WAIT_MS);
    return stop;
  }, [revealToken, matchIndex]);

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
    // Only a move up leaves the bottom. Content growing under the view moves the bottom
    // away without moving the view, and must not read as the operator scrolling up.
    const movedUp = el.scrollTop < lastScrollTop.current;
    lastScrollTop.current = el.scrollTop;
    if (isAtBottom) {
      followingRef.current = true;
      setAutoScroll(true);
      setUnreadCount(0);
    } else if (movedUp) {
      followingRef.current = false;
      setAutoScroll(false);
    }
  };

  const handleScrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      lastScrollTop.current = scrollRef.current.scrollTop;
      followingRef.current = true;
      setAutoScroll(true);
      setUnreadCount(0);
    }
  };

  const toggleCollapse = (idx: number) => {
    // Resolve to stable msgId so collapse state survives list reordering.
    const msg = messages[idx];
    const key = collapseKeyOf(msg, idx);
    if (revealedRef.current.has(key)) {
      // Open for search: the click folds it, and it is the operator's from now on
      handOver(key);
      setCollapsed(prev => ({ ...prev, [key]: true }));
      return;
    }
    // Flip what is on screen: a tool group or thinking block starts folded, so the first click opens it.
    setCollapsed(prev => ({ ...prev, [key]: !(prev[key] ?? (msg ? isCollapsedByDefault(msg) : false)) }));
  };

  const toggleMemory = (key: string) => {
    if (revealedRef.current.has(key)) {
      handOver(key);
      setCollapsed(prev => ({ ...prev, [key]: true }));
      return;
    }
    setCollapsed(prev => ({ ...prev, [key]: !(prev[key] ?? true) }));
  };

  // First message time for mission time calculation
  const firstMessageTime = messages.length > 0 ? messages[0].timestamp : null;

  const isToolMessage = (msg: ChatMsg) => msg.role === 'tool' || msg.role === 'toolResult';

  const renderMessage = (msg: ChatMsg, i: number) => {
    const collapseKey = collapseKeyOf(msg, i);
    const isCollapsed = revealed.has(collapseKey) ? false : (collapsed[collapseKey] ?? isCollapsedByDefault(msg));
    const memoryKey = `mem-${collapseKey}`;
    const isMemoryCollapsed = revealed.has(memoryKey) ? false : (collapsed[memoryKey] ?? true);
    const isCurrentMatch = search.currentMatch?.messageIndex === i;
    const stableKey = msg.msgId || msg.tempId || `${msg.role}-${msg.timestamp.getTime()}-${i}`;

    if (isToolMessage(msg)) {
      return (
        <div
          key={stableKey}
          ref={(el) => { if (el) messageRefs.current.set(i, el); }}
        >
          {msg.toolGroup ? (
            // Grouped tool bubble (multiple consecutive tool calls)
            <ToolGroupBlock
              msg={msg}
              index={i}
              isCollapsed={isCollapsed}
              onToggleCollapse={toggleCollapse}
              searchQuery={search.query}
              isCurrentMatch={isCurrentMatch}
            />
          ) : (
            // Single tool call
            <ToolCallBlock
              msg={msg}
              index={i}
              isCollapsed={isCollapsed}
              onToggleCollapse={toggleCollapse}
              searchQuery={search.query}
              isCurrentMatch={isCurrentMatch}
            />
          )}
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
          agentHue={agentHue}
          onOpenWorkspacePath={onOpenWorkspacePath}
          pathLinkPrefixes={pathLinkPrefixes}
          pathLinkAliases={pathLinkAliases}
          onOpenBeadId={onOpenBeadId}
        />
      </div>
    );
  };

  // Day dividers: only when the visible transcript spans more than one day, so a single
  // day's room carries no label at all. The first group gets its label too.
  const dayKeys = messages.map((m) => dayKey(m.timestamp));
  const spansDays = new Set(dayKeys).size > 1;
  const dividerBefore = (i: number): ReactNode | null => {
    if (!spansDays) return null;
    if (i > 0 && dayKeys[i] === dayKeys[i - 1]) return null;
    return <TranscriptDivider key={`day-${dayKeys[i]}-${i}`} label={dayLabel(messages[i].timestamp)} />;
  };

  // Consecutive tool messages share one bordered stack, rows split by 1px rules.
  const transcript: ReactNode[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const divider = dividerBefore(i);
    if (divider) transcript.push(divider);
    if (!isToolMessage(msg)) {
      transcript.push(renderMessage(msg, i));
      continue;
    }
    const runStart = i;
    const run: ReactNode[] = [];
    // A stack never crosses a day boundary: the next day's tools start a new stack after its divider.
    while (i < messages.length && isToolMessage(messages[i]) && (i === runStart || dayKeys[i] === dayKeys[i - 1])) {
      run.push(renderMessage(messages[i], i));
      i++;
    }
    i--;
    const first = messages[runStart];
    const runKey = `tools-${first.msgId || first.tempId || `${first.timestamp.getTime()}-${runStart}`}`;
    transcript.push(
      <div key={runKey} className={`my-1.5 ml-6 ${toolStackClass}`}>
        {run}
      </div>,
    );
  }

  return (
    <div id={id} className="nerve-room-plate isolate h-full flex flex-col min-w-0 relative">
      {/* The live horizon: a faint equalizer behind the composer while this session works */}
      <LiveHorizon active={isGenerating} performanceMode={performanceMode} />
      {/* Session header */}
      <ChatHeader
        onReset={onReset}
        onAbort={onAbort}
        isGenerating={isGenerating}
        agentName={agentName}
        sessionName={sessionName}
        agentHue={agentHue}
        processingStage={processingStage}
        currentToolDescription={currentToolDescription}
        elapsedMs={processingTime}
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
        className="nerve-room flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-6"
      >
        {/* The transcript takes the whole column; prose is capped only on very wide screens (--reading-measure) */}
        <div ref={contentRef} className="flex w-full flex-col gap-1 py-4">
          {/* Infinite scroll sentinel + "load more" indicator */}
          {hasMore && (
            <div ref={sentinelRef}>
              <TranscriptDivider label="Older messages" />
            </div>
          )}

          {/* The empty room: said only once history has been fetched, never while it loads */}
          {historyLoaded && messages.length === 0 && !isGenerating && (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 py-16 text-center select-none">
              <p className="text-[0.933rem] text-foreground">Nothing said here yet.</p>
              <p className="text-[0.867rem] text-muted-foreground">
                Your first message to {agentName || 'this agent'} opens the room.
              </p>
            </div>
          )}

          {transcript}

          {/* Processing indicator: visible while generating, persists during streaming */}
          {isGenerating && !stream.html && (
            <ProcessingIndicator
              stage={processingStage}
              elapsedMs={processingTime}
              lastEventTimestamp={lastEventTimestamp}
              currentToolDescription={currentToolDescription}
              activityLog={activityLog}
              isRecovering={Boolean(stream.isRecovering)}
              recoveryReason={stream.recoveryReason}
              agentName={agentName}
              agentHue={agentHue}
            />
          )}

          {/* Streaming message with condensed activity log */}
          {isGenerating && stream.html && (
            <>
              <StreamingMessage html={stream.html} elapsedMs={processingTime} agentName={agentName} agentHue={agentHue} />
              {activityLog.length > 0 && (
                <div className="pb-2 pt-1">
                  <ActivityLog entries={activityLog} />
                </div>
              )}
            </>
          )}
        </div>
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
        showCommandPaletteButton={showCommandPaletteButton}
        onOpenCommandPalette={onOpenCommandPalette}
      />

    </div>
  );
});

// Re-export types for backward compatibility
export type { ChatMsg, ImageAttachment } from './types';
