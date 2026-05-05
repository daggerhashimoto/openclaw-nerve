/**
 * ChatContext - frontend integration for the server replay chat runtime.
 *
 * Rendering is sourced from /api/chat-runtime/stream snapshots and patches.
 * Gateway RPC remains only for controls that are not replay-runtime endpoints yet
 * and for the conservative attachment fallback send path.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useGateway } from './GatewayContext';
import { useSessionContext } from './SessionContext';
import { useSettings } from './SettingsContext';
import { sendChatMessage, sendChatRuntimeMessage } from '@/features/chat/operations';
import { useChatRuntime } from '@/features/chat/runtime/useChatRuntime';
import type { ImageAttachment, ChatMsg, OutgoingUploadPayload } from '@/features/chat/types';
import type { RecoveryReason } from '@/features/chat/operations';
import { useChatTTS } from '@/hooks/useChatTTS';

/** Processing stages for enhanced thinking indicator */
export type ProcessingStage = 'thinking' | 'tool_use' | 'streaming' | null;

/** A single entry in the activity log */
export interface ActivityLogEntry {
  id: string;
  toolName: string;
  description: string;
  startedAt: number;
  completedAt?: number;
  phase: 'running' | 'completed';
}

export interface ChatStreamState {
  html: string;
  runId?: string;
  isRecovering?: boolean;
  recoveryReason?: RecoveryReason | null;
}

interface ChatContextValue {
  messages: ChatMsg[];
  isGenerating: boolean;
  stream: ChatStreamState;
  processingStage: ProcessingStage;
  lastEventTimestamp: number;
  activityLog: ActivityLogEntry[];
  currentToolDescription: string | null;
  handleSend: (text: string, images?: ImageAttachment[], uploadPayload?: OutgoingUploadPayload) => Promise<void>;
  handleAbort: () => Promise<void>;
  handleReset: () => void;
  loadHistory: (session?: string) => Promise<void>;
  loadMore: () => boolean;
  hasMore: boolean;
  showResetConfirm: boolean;
  confirmReset: () => Promise<void>;
  cancelReset: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { rpc } = useGateway();
  const { currentSession } = useSessionContext();
  const { soundEnabled, speak } = useSettings();

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [pendingSendCount, setPendingSendCount] = useState(0);

  const currentSessionRef = useRef(currentSession || '');
  const soundEnabledRef = useRef(soundEnabled);
  const speakRef = useRef(speak);

  useEffect(() => {
    currentSessionRef.current = currentSession || '';
    soundEnabledRef.current = soundEnabled;
    speakRef.current = speak;
  }, [currentSession, soundEnabled, speak]);

  const runtime = useChatRuntime({
    sessionKey: currentSession || '',
    enabled: Boolean(currentSession),
  });

  const {
    messages,
    isGenerating: runtimeIsGenerating,
    stream,
    processingStage: runtimeProcessingStage,
    lastEventTimestamp,
    activityLog,
    currentToolDescription,
    loadMore,
    hasMore,
    reload,
    reset: resetRuntime,
    markUserMessageFailed,
    clearUserMessageFailure,
  } = runtime;

  const ttsHook = useChatTTS({ soundEnabled: soundEnabledRef, speak: speakRef });
  const { playCompletionPing } = ttsHook;

  const isGenerating = runtimeIsGenerating || pendingSendCount > 0;
  const processingStage = runtimeProcessingStage ?? (pendingSendCount > 0 ? 'thinking' : null);

  const wasRuntimeGeneratingRef = useRef(false);
  useEffect(() => {
    if (wasRuntimeGeneratingRef.current && !runtimeIsGenerating) {
      playCompletionPing();
    }
    wasRuntimeGeneratingRef.current = runtimeIsGenerating;
  }, [runtimeIsGenerating, playCompletionPing]);

  const handleSend = useCallback(async (
    text: string,
    images?: ImageAttachment[],
    uploadPayload?: OutgoingUploadPayload,
  ) => {
    const sessionKey = currentSessionRef.current;
    if (!sessionKey) return;

    const idempotencyKey = crypto.randomUUID ? crypto.randomUUID() : `ik-${Date.now()}`;
    clearUserMessageFailure(idempotencyKey);
    setPendingSendCount((count) => count + 1);

    try {
      if (images?.length || uploadPayload?.descriptors.length) {
        await sendChatMessage({
          rpc,
          sessionKey,
          text,
          images,
          uploadPayload,
          idempotencyKey,
        });
        reload();
        return;
      }

      await sendChatRuntimeMessage({
        sessionKey,
        text,
        idempotencyKey,
      });
    } catch (err) {
      markUserMessageFailed(idempotencyKey);
      reload();
      console.debug('[ChatContext] Send request failed:', err);
    } finally {
      setPendingSendCount((count) => Math.max(0, count - 1));
    }
  }, [
    clearUserMessageFailure,
    markUserMessageFailed,
    reload,
    rpc,
  ]);

  const handleAbort = useCallback(async () => {
    try {
      await rpc('chat.abort', { sessionKey: currentSessionRef.current });
    } catch (err) {
      console.debug('[ChatContext] Abort request failed:', err);
    } finally {
      reload();
    }
  }, [reload, rpc]);

  const handleReset = useCallback(() => {
    setShowResetConfirm(true);
  }, []);

  const confirmReset = useCallback(async () => {
    setShowResetConfirm(false);
    try {
      await rpc('sessions.reset', { key: currentSessionRef.current });
      resetRuntime();
    } catch (err) {
      console.debug('[ChatContext] Reset request failed:', err);
      reload();
    }
  }, [reload, resetRuntime, rpc]);

  const cancelReset = useCallback(() => {
    setShowResetConfirm(false);
  }, []);

  const loadHistory = useCallback(async (session?: string) => {
    if (session && session !== currentSessionRef.current) return;
    reload();
  }, [reload]);

  const value = useMemo<ChatContextValue>(() => ({
    messages,
    isGenerating,
    stream,
    processingStage,
    lastEventTimestamp,
    activityLog,
    currentToolDescription,
    handleSend,
    handleAbort,
    handleReset,
    loadHistory,
    loadMore,
    hasMore,
    showResetConfirm,
    confirmReset,
    cancelReset,
  }), [
    messages,
    isGenerating,
    stream,
    processingStage,
    lastEventTimestamp,
    activityLog,
    currentToolDescription,
    handleSend,
    handleAbort,
    handleReset,
    loadHistory,
    loadMore,
    hasMore,
    showResetConfirm,
    confirmReset,
    cancelReset,
  ]);

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook export is intentional
export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
