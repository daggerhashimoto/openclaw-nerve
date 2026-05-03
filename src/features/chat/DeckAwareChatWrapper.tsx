import { useState, useCallback, useMemo, type ReactNode } from 'react';
import { useDeck } from '@/contexts/DeckContext';
import { useSessionContext } from '@/contexts/SessionContext';
import { DeckLayout } from './DeckLayout';
import { AddColumnDialog } from './AddColumnDialog';
import { getSessionKey } from '@/types';
import { getSessionDisplayLabel } from '@/features/sessions/sessionKeys';

interface DeckAwareChatWrapperProps {
  /** The normal single-chat ChatPanel */
  singleChat: ReactNode;
  /** Current session key for auto-adding first column */
  currentSessionKey: string;
  /** Current session display name */
  currentSessionDisplayName: string;
}

/**
 * Switches between single ChatPanel and DeckLayout (multi-column)
 * based on the DeckContext layoutMode setting.
 */
export function DeckAwareChatWrapper({
  singleChat,
  currentSessionKey,
  currentSessionDisplayName,
}: DeckAwareChatWrapperProps) {
  const { layoutMode, addColumn, ensureColumn, columns } = useDeck();
  const { sessions, setCurrentSession } = useSessionContext();
  const [addColumnOpen, setAddColumnOpen] = useState(false);

  // When switching to deck mode, ensure at least one column exists
  const handleActivateDeck = useCallback(() => {
    if (columns.length === 0) {
      ensureColumn(currentSessionKey);
    }
  }, [columns.length, currentSessionKey, ensureColumn]);

  // If deck mode just activated, trigger column setup
  // (runs on next render after layoutMode change)
  if (layoutMode === 'deck' && columns.length === 0) {
    // Will be handled by the ensureColumn call from DeckLayout empty state
  }

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

  const renderActiveChat = useCallback(() => {
    return singleChat;
  }, [singleChat]);

  const renderInactivePreview = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (_column: { id: string; sessionKey: string; agentId?: string; width: number }) => {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4 text-muted-foreground">
          <span className="text-xs">Click to switch to this session</span>
        </div>
      );
    },
    [],
  );

  if (layoutMode === 'single') {
    return <>{singleChat}</>;
  }

  // Deck mode
  return (
    <>
      <DeckLayout
        renderActiveChat={renderActiveChat}
        renderInactivePreview={renderInactivePreview}
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