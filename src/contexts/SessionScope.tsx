/**
 * SessionScope — Overrides the "current session" for a React subtree.
 *
 * Used by Deck Mode columns to give each column its own ChatProvider
 * with an independent currentSession, while sharing the global session list
 * and gateway connection.
 *
 * This is a thin wrapper: it reads the real SessionContext, swaps out
 * `currentSession` and `setCurrentSession` for the scoped ones, and
 * re-provides the context.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { useSessionContext, type SessionContextValue } from './SessionContext';

// We re-use the same context object so all downstream consumers
// (ChatContext, ChatPanel, etc.) work without changes.
// We just provide a different value from the parent.
//
// To do this, we need the original context — but SessionContext.tsx
// exports `useSessionContext` (the hook), not the raw context object.
// So we import it directly.
import { SessionContext } from './SessionContext';

interface SessionScopeProps {
  /** The session key this subtree should treat as "current" */
  sessionKey: string;
  children: ReactNode;
}

export function SessionScope({ sessionKey, children }: SessionScopeProps) {
  // Read the real parent context to preserve sessions list, gateway state, etc.
  const parentValue = useSessionContext();

  // Create an overridden value where currentSession is fixed to this scope's key
  // and setCurrentSession is a no-op (the scope is static for its lifetime)
  const scopedValue: SessionContextValue = {
    ...parentValue,
    currentSession: sessionKey,
    setCurrentSession: () => {
      // no-op: deck columns don't change their session
    },
  };

  return (
    <SessionContext.Provider value={scopedValue}>
      {children}
    </SessionContext.Provider>
  );
}