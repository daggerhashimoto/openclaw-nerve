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
import { sendChatRuntimeMessage } from '@/features/chat/operations';
import { useChatRuntime } from '@/features/chat/runtime/useChatRuntime';
import type { ImageAttachment, ChatMsg, OutgoingUploadPayload } from '@/features/chat/types';
import type { FinalMessageData, RecoveryReason } from '@/features/chat/operations';
import { useChatTTS } from '@/hooks/useChatTTS';
import { getSessionKey, type ChatMessage, type GranularAgentState, type Session } from '@/types';
import { renderMarkdown, renderToolResults } from '@/utils/helpers';
import { encodeRuntimeIdPart } from '../../shared/chat-runtime-id';

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

interface ActiveTTSRequest {
  idempotencyKey: string;
  text: string;
  sentAt: number;
  runId?: string;
  voiceFallback: boolean;
}

interface OptimisticSend {
  idempotencyKey: string;
  text: string;
  sentAt: number;
  msg: ChatMsg;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { rpc } = useGateway();
  const { currentSession, sessions, agentStatus = {} } = useSessionContext();
  const { soundEnabled, speak } = useSettings();

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [pendingSendCount, setPendingSendCount] = useState(0);
  const [optimisticSends, setOptimisticSends] = useState<OptimisticSend[]>([]);

  const currentSessionRef = useRef(currentSession || '');
  const soundEnabledRef = useRef(soundEnabled);
  const speakRef = useRef(speak);
  const runtimeMessagesRef = useRef<ChatMsg[]>([]);
  const catchupTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const ttsExpiryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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

  useEffect(() => {
    runtimeMessagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (optimisticSends.length === 0 || messages.length === 0) return;
    const unmatched = optimisticSends.filter((send) =>
      !messages.some((message) => runtimeMessageHasOptimisticIdentity(message, send))
    );
    if (unmatched.length !== optimisticSends.length) {
      setOptimisticSends(unmatched);
    }
  }, [messages, optimisticSends]);

  useEffect(() => () => {
    for (const timer of catchupTimersRef.current) clearTimeout(timer);
    catchupTimersRef.current.clear();
    for (const timer of ttsExpiryTimersRef.current.values()) clearTimeout(timer);
    ttsExpiryTimersRef.current.clear();
  }, []);

  const ttsHook = useChatTTS({ soundEnabled: soundEnabledRef, speak: speakRef });
  const { handleFinalTTS, playCompletionPing, resetPlayedSounds, trackVoiceMessage } = ttsHook;
  const displayMessages = useMemo(
    () => mergeOptimisticMessages(messages, optimisticSends),
    [messages, optimisticSends],
  );

  const currentGatewayStatus = agentStatus[currentSession || ''];
  const currentSessionDetails = currentSession
    ? sessions.find((session) => getSessionKey(session) === currentSession)
    : undefined;
  const gatewaySettledAfterRuntime = isSettledGatewayStatusCurrent(
    currentGatewayStatus,
    lastEventTimestamp,
  ) || isSettledSessionCurrent(
    currentSessionDetails,
    lastEventTimestamp,
  );
  const effectiveRuntimeIsGenerating = runtimeIsGenerating && !gatewaySettledAfterRuntime;
  const isGenerating = effectiveRuntimeIsGenerating || pendingSendCount > 0;
  const processingStage = effectiveRuntimeIsGenerating
    ? runtimeProcessingStage
    : pendingSendCount > 0
      ? 'thinking'
      : null;

  const wasRuntimeGeneratingRef = useRef(false);
  const activeTTSRequestsRef = useRef<Map<string, ActiveTTSRequest>>(new Map());
  useEffect(() => {
    const clearTTSExpiryTimer = (idempotencyKey: string) => {
      const timer = ttsExpiryTimersRef.current.get(idempotencyKey);
      if (!timer) return;
      clearTimeout(timer);
      ttsExpiryTimersRef.current.delete(idempotencyKey);
    };
    const scheduleStaleTTSCleanup = (request: ActiveTTSRequest) => {
      if (ttsExpiryTimersRef.current.has(request.idempotencyKey)) return;
      const timer = setTimeout(() => {
        ttsExpiryTimersRef.current.delete(request.idempotencyKey);
        activeTTSRequestsRef.current.delete(request.idempotencyKey);
      }, TTS_STALE_REQUEST_TTL_MS);
      ttsExpiryTimersRef.current.set(request.idempotencyKey, timer);
    };

    if (!runtimeIsGenerating && (wasRuntimeGeneratingRef.current || activeTTSRequestsRef.current.size > 0)) {
      const activeTTSRequests = [...activeTTSRequestsRef.current.values()]
        .sort((a, b) => a.sentAt - b.sentAt);
      if (activeTTSRequests.length > 0) {
        let playedAudio = false;
        let sawFinalMessage = false;
        for (const activeTTSRequest of activeTTSRequests) {
          const finalMessageData = finalMessageDataFromRuntimeMessages(messages, activeTTSRequest);
          if (finalMessageData) {
            sawFinalMessage = true;
            clearTTSExpiryTimer(activeTTSRequest.idempotencyKey);
            playedAudio = handleFinalTTS(finalMessageData, true, {
              voiceFallback: activeTTSRequest.voiceFallback,
              completionPing: false,
            }) || playedAudio;
            activeTTSRequestsRef.current.delete(activeTTSRequest.idempotencyKey);
          } else {
            scheduleStaleTTSCleanup(activeTTSRequest);
          }
        }
        if (sawFinalMessage && !playedAudio) {
          playCompletionPing();
        }
      } else if (wasRuntimeGeneratingRef.current) {
        playCompletionPing();
      }
    }
    wasRuntimeGeneratingRef.current = runtimeIsGenerating;
  }, [handleFinalTTS, messages, runtimeIsGenerating, playCompletionPing]);

  const handleSend = useCallback(async (
    text: string,
    images?: ImageAttachment[],
    uploadPayload?: OutgoingUploadPayload,
  ) => {
    const sessionKey = currentSessionRef.current;
    if (!sessionKey) return;

    const idempotencyKey = createIdempotencyKey();
    const sentAt = Date.now();
    const optimisticSend = createOptimisticSend({
      sessionKey,
      idempotencyKey,
      text,
      images,
      uploadPayload,
      sentAt,
    });
    clearUserMessageFailure(idempotencyKey);
    resetPlayedSounds();
    trackVoiceMessage(text);
    activeTTSRequestsRef.current.set(idempotencyKey, {
      idempotencyKey,
      text,
      sentAt,
      voiceFallback: text.startsWith('[voice] '),
    });
    setOptimisticSends((current) => [...current, optimisticSend]);
    setPendingSendCount((count) => count + 1);

    try {
      const ack = await sendChatRuntimeMessage({
        sessionKey,
        text,
        idempotencyKey,
        images,
        uploadPayload,
      });
      if (ack.runId) {
        const activeTTSRequest = activeTTSRequestsRef.current.get(idempotencyKey);
        if (activeTTSRequest) {
          activeTTSRequestsRef.current.set(idempotencyKey, { ...activeTTSRequest, runId: ack.runId });
        }
      }
      const catchupTimer = setTimeout(() => {
        catchupTimersRef.current.delete(catchupTimer);
        const runtimeHasSend = runtimeMessagesRef.current.some((message) =>
          runtimeMessageMatchesOptimisticSend(message, optimisticSend)
        );
        if (!runtimeHasSend) reload();
      }, 750);
      catchupTimersRef.current.add(catchupTimer);
    } catch (err) {
      activeTTSRequestsRef.current.delete(idempotencyKey);
      markUserMessageFailed(idempotencyKey);
      setOptimisticSends((current) => current.map((send) =>
        send.idempotencyKey === idempotencyKey
          ? { ...send, msg: { ...send.msg, pending: false, failed: true } }
          : send,
      ));
      reload();
      console.debug('[ChatContext] Send request failed:', err);
    } finally {
      setPendingSendCount((count) => Math.max(0, count - 1));
    }
  }, [
    clearUserMessageFailure,
    markUserMessageFailed,
    reload,
    resetPlayedSounds,
    trackVoiceMessage,
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
    messages: displayMessages,
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
    displayMessages,
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

function finalMessageDataFromRuntimeMessages(
  messages: ChatMsg[],
  activeRequest: { idempotencyKey: string; text: string; sentAt: number; runId?: string },
): FinalMessageData | null {
  const candidates = messages.filter(isRuntimeFinalAssistantMessage);
  const finalMessage = activeRequest.runId
    ? [...candidates].reverse().find((message) => runtimeMessageIdHasRunToken(message.msgId, activeRequest.runId!))
      ?? finalMessageAfterMatchingUserPrompt(messages, activeRequest)
      ?? singleTimestampFallbackCandidate(candidates, activeRequest.sentAt)
    : finalMessageAfterMatchingUserPrompt(messages, activeRequest)
      ?? singleTimestampFallbackCandidate(candidates, activeRequest.sentAt);
  if (!finalMessage) return null;

  const message: ChatMessage = {
    role: 'assistant',
    content: finalMessage.rawText,
    timestamp: finalMessage.timestamp.getTime(),
  };

  return {
    message,
    text: finalMessage.rawText,
    ttsText: finalMessage.ttsText ?? null,
    charts: finalMessage.charts ?? [],
  };
}

function isRuntimeFinalAssistantMessage(message: ChatMsg): boolean {
  if (message.role !== 'assistant') return false;
  if (message.isThinking || message.intermediate || message.streaming) return false;
  return true;
}

function finalMessageAfterMatchingUserPrompt(
  messages: ChatMsg[],
  activeRequest: Pick<ActiveTTSRequest, 'idempotencyKey' | 'text'>,
): ChatMsg | null {
  const userIndex = messages.findIndex((message) =>
    message.role === 'user' && userMessageMatchesActiveRequest(message, activeRequest)
  );
  if (userIndex === -1) return null;

  const candidates: ChatMsg[] = [];
  for (const message of messages.slice(userIndex + 1)) {
    if (message.role === 'user') break;
    if (isRuntimeFinalAssistantMessage(message)) candidates.push(message);
  }

  if (candidates.length === 0) return null;
  return [...candidates].reverse().find((message) => Boolean(message.ttsText)) ?? candidates[candidates.length - 1];
}

function userMessageMatchesActiveRequest(
  message: ChatMsg,
  activeRequest: Pick<ActiveTTSRequest, 'idempotencyKey' | 'text'>,
): boolean {
  if (message.tempId === activeRequest.idempotencyKey) return true;
  if (message.msgId?.endsWith(`:${encodeRuntimeIdPart(activeRequest.idempotencyKey)}`)) return true;

  const sentText = activeRequest.text.trim();
  const messageText = message.rawText.trim();
  if (!sentText || !messageText) return false;
  const sentTextWithoutVoicePrefix = stripVoicePrefix(sentText);
  return [sentText, sentTextWithoutVoicePrefix].some((candidate) =>
    Boolean(candidate) && (
      messageText === candidate ||
      messageText.startsWith(`${candidate}\n\n[system:`)
    )
  );
}

function stripVoicePrefix(text: string): string {
  return text.replace(/^\[voice\]\s*/, '').trim();
}

function runtimeMessageIdHasRunToken(msgId: string | undefined, runId: string): boolean {
  if (!msgId) return false;
  const encodedRunId = encodeRuntimeIdPart(runId);
  const parts = msgId.split(':');
  if (parts[0] !== 'assistant') return false;

  const lastPart = parts[parts.length - 1];
  if (lastPart === 'answer') {
    return parts[parts.length - 2] === encodedRunId;
  }

  if (parts[parts.length - 2] === 'segment') {
    return parts[parts.length - 3] === encodedRunId;
  }

  return false;
}

function singleTimestampFallbackCandidate(messages: ChatMsg[], sentAt: number): ChatMsg | null {
  const candidates = messages.filter((message) => {
    const timestamp = message.timestamp.getTime();
    return Number.isFinite(timestamp) && timestamp >= sentAt;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function createOptimisticSend(params: {
  sessionKey: string;
  idempotencyKey: string;
  text: string;
  images?: ImageAttachment[];
  uploadPayload?: OutgoingUploadPayload;
  sentAt: number;
}): OptimisticSend {
  const { sessionKey, idempotencyKey, text, images, uploadPayload, sentAt } = params;
  const msg: ChatMsg = {
    msgId: runtimeUserMessageId(sessionKey, idempotencyKey),
    role: 'user',
    html: renderToolResults(renderMarkdown(text)),
    rawText: text,
    timestamp: new Date(sentAt),
    pending: true,
    tempId: idempotencyKey,
    ...(text.startsWith('[voice] ') ? { isVoice: true } : {}),
    ...(images?.length ? {
      images: images.map((image) => ({
        mimeType: image.mimeType,
        content: image.content,
        preview: image.preview,
        name: image.name,
      })),
    } : {}),
    ...(uploadPayload?.descriptors.length ? { uploadAttachments: uploadPayload.descriptors } : {}),
  };

  return {
    idempotencyKey,
    text,
    sentAt,
    msg,
  };
}

let fallbackIdCounter = 0;

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackIdCounter += 1;
  return `ik-${Date.now()}-${fallbackIdCounter}`;
}

function mergeOptimisticMessages(runtimeMessages: ChatMsg[], optimisticSends: OptimisticSend[]): ChatMsg[] {
  if (optimisticSends.length === 0) return runtimeMessages;

  const merged = [...runtimeMessages];
  for (const send of unmatchedOptimisticSends(runtimeMessages, optimisticSends)) {

    const insertionIndex = merged.findIndex((message) => message.timestamp.getTime() > send.sentAt);
    if (insertionIndex === -1) {
      merged.push(send.msg);
    } else {
      merged.splice(insertionIndex, 0, send.msg);
    }
  }

  return merged;
}

function unmatchedOptimisticSends(runtimeMessages: ChatMsg[], optimisticSends: OptimisticSend[]): OptimisticSend[] {
  const matchedRuntimeIndexes = new Set<number>();

  return optimisticSends.filter((send) => {
    const matchedIndex = runtimeMessages.findIndex((message, index) =>
      !matchedRuntimeIndexes.has(index) && runtimeMessageMatchesOptimisticSend(message, send)
    );
    if (matchedIndex === -1) return true;
    matchedRuntimeIndexes.add(matchedIndex);
    return false;
  });
}

function runtimeMessageMatchesOptimisticSend(message: ChatMsg, send: OptimisticSend): boolean {
  if (message.role !== 'user') return false;
  return runtimeMessageHasOptimisticIdentity(message, send);
}

function runtimeMessageHasOptimisticIdentity(message: ChatMsg, send: OptimisticSend): boolean {
  return message.msgId === send.msg.msgId || message.tempId === send.idempotencyKey;
}

function runtimeUserMessageId(sessionKey: string, idempotencyKey: string): string {
  return `user:${sessionKey}:${encodeRuntimeIdPart(idempotencyKey)}`;
}

const TTS_STALE_REQUEST_TTL_MS = 5 * 60_000;

function isSettledGatewayStatusCurrent(
  status: GranularAgentState | undefined,
  runtimeUpdatedAt: number,
): boolean {
  if (!status) return false;
  if (status.status !== 'IDLE' && status.status !== 'DONE' && status.status !== 'ERROR') return false;
  return Number.isFinite(status.since) && status.since >= runtimeUpdatedAt;
}

const SETTLED_SESSION_STATES = new Set(['idle', 'done', 'error', 'final', 'aborted', 'completed', 'failed']);
const BUSY_SESSION_STATES = new Set(['running', 'thinking', 'tool_use', 'delta', 'started', 'streaming']);

function isSettledSessionCurrent(
  session: Session | undefined,
  runtimeUpdatedAt: number,
): boolean {
  if (!session) return false;
  if (session.busy || session.processing) return false;

  const state = normalizedSessionState(session);
  if (!state || BUSY_SESSION_STATES.has(state) || !SETTLED_SESSION_STATES.has(state)) return false;

  const updatedAt = sessionUpdatedAt(session);
  return Number.isFinite(updatedAt) && updatedAt >= runtimeUpdatedAt;
}

function normalizedSessionState(session: Session): string | undefined {
  const value = session.state ?? session.agentState ?? session.status;
  return typeof value === 'string' ? value.trim().toLowerCase() : undefined;
}

function sessionUpdatedAt(session: Session): number {
  if (typeof session.updatedAt === 'number') return session.updatedAt;
  if (typeof session.lastActivity === 'number') return session.lastActivity;
  if (typeof session.lastActivity === 'string') {
    const parsed = Date.parse(session.lastActivity);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook export is intentional
export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
