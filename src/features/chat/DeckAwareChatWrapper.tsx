import { useState, useCallback, useMemo, type ReactNode } from 'react';
import { useDeck } from '@/contexts/DeckContext';
import { useSessionContext } from '@/contexts/SessionContext';
import { SessionScope } from '@/contexts/SessionScope';
import { ChatProvider, useChat } from '@/contexts/ChatContext';
import { ChatPanel } from '@/features/chat/ChatPanel';
import { DeckLayout } from './DeckLayout';
import { AddColumnDialog } from './AddColumnDialog';
import { getSessionKey } from '@/types';
import { getSessionDisplayLabel } from '@/features/sessions/sessionKeys';
import type { DeckColumn } from '@/contexts/DeckContext';

/**
 * DeckAwareChatWrapper — Switches between single ChatPanel and
 * multi-column DeckLayout based on DeckContext layoutMode.
 *
 * In single mode, renders the provided singleChat node (the existing ChatPanel).
 * In deck mode, renders a DeckLayout where each column gets its own
 * SessionScope + ChatProvider, so all columns are fully independent chat sessions.
 */
export function DeckAwareChatWrapper({
  singleChat,
  currentSessionKey,
}: {
  singleChat: ReactNode;
  currentSessionKey: string;
}) {
  const { layoutMode, columns, ensureColumn } = useDeck();
  const { sessions } = useSessionContext();
  const [addColumnOpen, setAddColumnOpen] = useState(false);

  // When switching to deck mode, ensure at least one column exists
  useMemo(() => {
    if (layoutMode === 'deck' && columns.length === 0) {
      ensureColumn(currentSessionKey);
    }
  }, [layoutMode, columns.length, currentSessionKey, ensureColumn]);

  const getSessionLabel = useCallback(
    (key: string) => {
      const s = sessions.find(s => getSessionKey(s) === key);
      return s ? getSessionDisplayLabel(s, s.identityName) : key;
    },
    [sessions],
  );

  const getAgentName = useCallback(
    (key: string) => {
      const s = sessions.find(s => getSessionKey(s) === key);
      return s?.identityName;
    },
    [sessions],
  );

  // Every column (active and inactive) gets a full ChatPanel
  const renderColumn = useCallback(
    (column: DeckColumn) => {
      return (
        <SessionScope sessionKey={column.sessionKey}>
          <ChatProvider>
            <ScopedChatPanel agentName={getAgentName(column.sessionKey)} />
          </ChatProvider>
        </SessionScope>
      );
    },
    [getAgentName],
  );

  if (layoutMode === 'single') {
    return <>{singleChat}</>;
  }

  // Deck mode
  return (
    <>
      <DeckLayout
        renderActiveChat={renderColumn}
        renderInactivePreview={renderColumn}
        getSessionLabel={getSessionLabel}
        getAgentName={getAgentName}
        onAddColumn={() => setAddColumnOpen(true)}
      />
      <AddColumnDialog
        open={addColumnOpen}
        onClose={() => setAddColumnOpen(false)}
      />
    </>
  );
}

/**
 * ScopedChatPanel — A ChatPanel that reads its chat state from
 * the scoped ChatProvider (via SessionScope).
 */
function ScopedChatPanel({ agentName }: { agentName?: string }) {
  const {
    messages,
    handleSend,
    handleAbort,
    isGenerating,
    stream,
    processingStage,
    lastEventTimestamp,
    currentToolDescription,
    activityLog,
    handleReset,
    loadMore,
    hasMore,
  } = useChat();

  return (
    <ChatPanel
      id="deck-chat"
      messages={messages}
      onSend={handleSend}
      onAbort={handleAbort}
      isGenerating={isGenerating}
      stream={stream}
      processingStage={processingStage}
      lastEventTimestamp={lastEventTimestamp}
      currentToolDescription={currentToolDescription}
      activityLog={activityLog}
      onReset={handleReset}
      searchOpen={false}
      onSearchClose={() => {}}
      agentName={agentName ?? 'Agent'}
      loadMore={loadMore}
      hasMore={hasMore}
    />
  );
}