/**
 * Talking to agents from the brief: a message goes into a session with chat.send, and the
 * reply is followed on the gateway's event stream until its final or error. It never touches
 * ChatContext, so the Chat view keeps whatever session it shows.
 *
 * One store per brief, keyed by session key, so a session has at most one reply in flight
 * however many surfaces (the board's box, a card) point at it, and a reply survives its card
 * being remounted as a row when the item changes kind.
 *
 * The gateway's run id is the send's idempotency key (OpenClaw sets clientRunId from it), so
 * the run is known before the ack and frames that beat the ack are not lost. The ack's own run
 * id is accepted too. Frames are matched on session key and run id; heartbeats, channel
 * messages and other runs in the same session are ignored.
 *
 * A send into a session that is already running is steered into that run: the gateway acks
 * with status "ok" and finishes our run id at once with an empty final, and the answer comes
 * in the active run. Then the store follows whichever run of the session speaks next.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useGateway } from '@/contexts/GatewayContext';
import { sendChatMessage } from '@/features/chat/operations/sendMessage';
import {
  classifyStreamEvent,
  extractFinalMessage,
  extractStreamDelta,
} from '@/features/chat/operations/streamEventHandler';
import { extractChartMarkers } from '@/features/charts/extractCharts';
import { extractTTSMarkers } from '@/features/tts/useTTS';
import type { ChatEventPayload, GatewayEvent } from '@/types';

/** With no frame for the run in this long, the reply is given up as an error. */
export const REPLY_TIMEOUT_MS = 90_000;
export const TIMEOUT_MESSAGE = 'No word from the agent for 90 seconds.';
export const STOPPED_MESSAGE = 'The run was stopped.';

/** Where a reply was asked from: the board's own box, or an item's Reply. */
export type ReplyOrigin = 'board' | 'item';

export interface InlineReply {
  sessionKey: string;
  origin: ReplyOrigin;
  /** What the operator sent. */
  prompt: string;
  /** Working until the run's final or error. */
  status: 'working' | 'done' | 'error';
  /** The assistant text so far, markers stripped. */
  text: string;
  error: string | null;
  endedAt?: number;
}

type RpcFn = (method: string, params: Record<string, unknown>) => Promise<unknown>;
type SubscribeFn = (handler: (event: GatewayEvent) => void) => () => void;

interface Gateway {
  rpc: RpcFn;
  subscribe: SubscribeFn;
}

export interface InlineReplies {
  /** The latest reply for a session, until it is dismissed or replaced by the next send. */
  get: (sessionKey: string) => InlineReply | undefined;
  /** A reply is in flight for the session; a second send is refused. */
  isBusy: (sessionKey: string) => boolean;
  /** Sends `text` into the session. Resolves false when nothing was sent (empty or busy). */
  send: (sessionKey: string, text: string, origin: ReplyOrigin) => Promise<boolean>;
  /** Forgets the session's reply. A run still in flight goes on in the session. */
  dismiss: (sessionKey: string) => void;
  /** For useSyncExternalStore. */
  subscribe: (listener: () => void) => () => void;
  /** Points the store at the current gateway functions. */
  setGateway: (gateway: Gateway) => void;
  /** Stops following every run (the brief unmounted). */
  close: () => void;
}

interface Run {
  runIds: Set<string>;
  /** Accumulated raw text, markers included, for the next delta. */
  raw: string;
  /** The run whose text `raw` holds; a joined run starts its own text. */
  rawRunId: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** The ack's status, once it has come. */
  ackStatus?: string;
  /** Our run finished empty before the ack said whether the send was steered. */
  emptyFinal: boolean;
  /** The send was steered into the session's active run; follow any run of the session. */
  followAny: boolean;
}

function cleanText(text: string): string {
  return extractChartMarkers(extractTTSMarkers(text).cleaned).cleaned.trim();
}

function errorOf(payload: ChatEventPayload): string {
  return payload.errorMessage?.trim() || payload.error?.trim() || payload.stopReason?.trim() || 'The run failed.';
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `attention-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The store itself, without React. */
export function createInlineReplies(initialGateway: Gateway): InlineReplies {
  let gateway = initialGateway;
  const replies = new Map<string, InlineReply>();
  const runs = new Map<string, Run>();
  const listeners = new Set<() => void>();
  let unsubscribeGateway: (() => void) | null = null;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const update = (sessionKey: string, patch: Partial<InlineReply>) => {
    const current = replies.get(sessionKey);
    if (!current) return;
    replies.set(sessionKey, { ...current, ...patch });
    notify();
  };

  const stopIfIdle = () => {
    if (runs.size > 0 || !unsubscribeGateway) return;
    unsubscribeGateway();
    unsubscribeGateway = null;
  };

  const settle = (sessionKey: string, patch: Partial<InlineReply>) => {
    const run = runs.get(sessionKey);
    if (run?.timer) clearTimeout(run.timer);
    runs.delete(sessionKey);
    stopIfIdle();
    update(sessionKey, { ...patch, endedAt: Date.now() });
  };

  const arm = (sessionKey: string, run: Run) => {
    if (run.timer) clearTimeout(run.timer);
    run.timer = setTimeout(() => {
      if (runs.get(sessionKey) === run) settle(sessionKey, { status: 'error', error: TIMEOUT_MESSAGE });
    }, REPLY_TIMEOUT_MS);
  };

  const onEvent = (event: GatewayEvent) => {
    const classified = classifyStreamEvent(event);
    if (!classified?.sessionKey || !classified.runId) return;
    const { sessionKey, runId } = classified;
    const run = runs.get(sessionKey);
    if (!run) return;
    const own = run.runIds.has(runId);
    if (!own && !run.followAny) return;

    // Any frame of the run (a tool call, a lifecycle phase) shows it is alive.
    arm(sessionKey, run);
    const payload = classified.chatPayload;
    if (!payload) return;

    switch (classified.type) {
      case 'chat_delta': {
        const delta = extractStreamDelta(payload, run.rawRunId === runId ? run.raw : '');
        if (!delta) return;
        run.raw = delta.text;
        run.rawRunId = runId;
        update(sessionKey, { text: delta.cleaned.trim() });
        return;
      }
      case 'chat_final': {
        const final = extractFinalMessage(payload);
        const text = (final ? cleanText(final.text) : '') || replies.get(sessionKey)?.text || '';
        if (!text && own) {
          // Steered: the answer comes in the active run, not in ours.
          if (run.followAny) return;
          // Not known yet whether it was steered; the ack decides.
          if (run.ackStatus === undefined) {
            run.emptyFinal = true;
            return;
          }
        }
        settle(sessionKey, { status: 'done', text });
        return;
      }
      case 'chat_error':
        settle(sessionKey, { status: 'error', error: errorOf(payload) });
        return;
      case 'chat_aborted':
        settle(sessionKey, { status: 'error', error: STOPPED_MESSAGE });
        return;
      default:
        return;
    }
  };

  const send = async (sessionKey: string, text: string, origin: ReplyOrigin): Promise<boolean> => {
    const prompt = text.trim();
    if (!sessionKey || !prompt || runs.has(sessionKey)) return false;

    const idempotencyKey = newIdempotencyKey();
    const run: Run = {
      runIds: new Set([idempotencyKey]),
      raw: '',
      rawRunId: null,
      timer: null,
      emptyFinal: false,
      followAny: false,
    };
    runs.set(sessionKey, run);
    replies.set(sessionKey, { sessionKey, origin, prompt, status: 'working', text: '', error: null });
    notify();
    if (!unsubscribeGateway) unsubscribeGateway = gateway.subscribe(onEvent);
    arm(sessionKey, run);

    try {
      const ack = await sendChatMessage({ rpc: gateway.rpc, sessionKey, text: prompt, idempotencyKey });
      if (ack.runId) run.runIds.add(ack.runId);
      run.ackStatus = ack.status ?? 'unknown';
      if (ack.status === 'ok') run.followAny = true;
      else if (run.emptyFinal && runs.get(sessionKey) === run) settle(sessionKey, { status: 'done', text: '' });
    } catch (err) {
      if (runs.get(sessionKey) === run) {
        const message = err instanceof Error ? err.message : String(err);
        settle(sessionKey, { status: 'error', error: `Could not send: ${message}` });
      }
    }
    return true;
  };

  const dismiss = (sessionKey: string) => {
    const run = runs.get(sessionKey);
    if (run?.timer) clearTimeout(run.timer);
    runs.delete(sessionKey);
    stopIfIdle();
    if (replies.delete(sessionKey)) notify();
  };

  const close = () => {
    for (const run of runs.values()) if (run.timer) clearTimeout(run.timer);
    runs.clear();
    stopIfIdle();
  };

  return {
    get: (sessionKey) => replies.get(sessionKey),
    isBusy: (sessionKey) => runs.has(sessionKey),
    send,
    dismiss,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setGateway: (next) => { gateway = next; },
    close,
  };
}

/** One store for the brief, on the app's gateway connection. */
export function useInlineReplies(): InlineReplies {
  const { rpc, subscribe } = useGateway();
  const [store] = useState(() => createInlineReplies({ rpc, subscribe }));
  useEffect(() => {
    store.setGateway({ rpc, subscribe });
  }, [store, rpc, subscribe]);
  useEffect(() => () => store.close(), [store]);
  return store;
}

const noSubscribe = () => () => {};

/** The reply for one session from one origin, re-rendering only the surface that shows it. */
export function useInlineReply(
  store: InlineReplies | undefined,
  sessionKey: string | undefined,
  origin: ReplyOrigin,
): InlineReply | undefined {
  const reply = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    () => (store && sessionKey ? store.get(sessionKey) : undefined),
  );
  return reply?.origin === origin ? reply : undefined;
}

/** A reply to the session is in flight, from any origin. */
export function useReplyBusy(store: InlineReplies | undefined, sessionKey: string | undefined): boolean {
  return useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    () => Boolean(store && sessionKey && store.isBusy(sessionKey)),
  );
}
