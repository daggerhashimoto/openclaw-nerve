/**
 * Runs that Nerve did not start on the open session (#334).
 *
 * An OpenClaw gateway (2026.5 and 2026.9 alike) hides a run started from a
 * channel such as Telegram or Discord, or by a heartbeat, from the operator
 * broadcast: its chat and agent frames go only to connections that called
 * `sessions.messages.subscribe` for the session. Rows it commits to the
 * transcript arrive as `session.message` on the same subscription. The frames
 * below mirror what a 2026.9 gateway sends such a connection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import type { GatewayEvent } from '@/types';
import type { useChat as UseChat } from './ChatContext';

type ChatApi = ReturnType<typeof UseChat>;
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

const TELEGRAM = 'agent:main:telegram:direct:42';
const OTHER = 'agent:main:main';
const RUN = 'run-tg-1';
const NOW = 1_700_000_015_000; // middle of a 30s bucket, keeps message signatures stable

const earlier = { role: 'user', content: 'Earlier', timestamp: NOW - 60_000, __openclaw: { id: 'e1' } };
const inbound = { role: 'user', content: [{ type: 'text', text: 'Hi from Telegram' }], timestamp: NOW + 100, __openclaw: { id: 'u1', seq: 2 } };
const reply = {
  role: 'assistant',
  content: [{ type: 'text', text: 'Hello back' }],
  timestamp: NOW + 2_000,
  __openclaw: { id: 'a1', seq: 3, runId: RUN },
};

describe('ChatContext with runs started outside Nerve (#334)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup(history: unknown[]) {
    let handler: ((msg: GatewayEvent) => void) | null = null;
    const gateway = { connectionState: 'connected' as ConnectionState, currentSession: TELEGRAM };
    const rpcMock = vi.fn<(method: string, params?: Record<string, unknown>) => Promise<unknown>>(async (method) => {
      if (method === 'chat.history') return { messages: [...history] };
      if (method === 'chat.send') return { runId: RUN, status: 'started' };
      return {};
    });

    vi.doMock('./GatewayContext', () => ({
      useGateway: () => ({
        connectionState: gateway.connectionState,
        rpc: rpcMock,
        subscribe: (h: (msg: GatewayEvent) => void) => {
          handler = h;
          return () => {};
        },
      }),
    }));
    vi.doMock('./SessionContext', () => ({
      useSessionContext: () => ({ currentSession: gateway.currentSession, sessions: [] }),
    }));
    vi.doMock('./SettingsContext', () => ({
      useSettings: () => ({ soundEnabled: false, speak: vi.fn() }),
    }));

    const { ChatProvider, useChat } = await import('./ChatContext');
    let chat: ChatApi | null = null;
    function Consumer() {
      const value = useChat();
      useEffect(() => {
        chat = value;
      }, [value]);
      return null;
    }
    const tree = () => (
      <ChatProvider>
        <Consumer />
      </ChatProvider>
    );
    const view = render(tree());

    await waitFor(() => expect(handler).not.toBeNull());
    await waitFor(() => expect(chat?.historyLoaded).toBe(true));

    const emit = (event: string, payload: Record<string, unknown>) => {
      act(() => {
        handler!({ type: 'event', event, payload });
      });
    };
    const rerenderWith = (next: Partial<typeof gateway>) => {
      Object.assign(gateway, next);
      view.rerender(tree());
    };
    const calls = (method: string) => rpcMock.mock.calls.filter(([m]) => m === method);
    const settle = () => act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    return { emit, rerenderWith, calls, settle, getChat: () => chat! };
  }

  // Agent frames for a hidden run carry the session snapshot (buildSessionEventSnapshot).
  const agent = (stream: string, data: Record<string, unknown>) => ({
    runId: RUN,
    stream,
    data,
    sessionKey: TELEGRAM,
    agentId: 'main',
    isHeartbeat: false,
    session: { key: TELEGRAM, status: 'running', hasActiveRun: true },
  });
  const chat = (payload: Record<string, unknown>) => ({ runId: RUN, sessionKey: TELEGRAM, agentId: 'main', ...payload });
  const committed = (message: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    sessionKey: TELEGRAM,
    agentId: 'main',
    message,
    messageId: (message.__openclaw as { id: string }).id,
    messageSeq: (message.__openclaw as { seq: number }).seq,
    session: { key: TELEGRAM, status: 'running', hasActiveRun: true },
    ...extra,
  });

  it('subscribes to the open session so the gateway sends it runs from channels', async () => {
    const { calls, rerenderWith } = await setup([earlier]);

    await waitFor(() => expect(calls('sessions.messages.subscribe')).toEqual([['sessions.messages.subscribe', { key: TELEGRAM }]]));

    // Switching rooms moves the subscription.
    rerenderWith({ currentSession: OTHER });
    await waitFor(() => expect(calls('sessions.messages.unsubscribe')).toEqual([['sessions.messages.unsubscribe', { key: TELEGRAM }]]));
    await waitFor(() => expect(calls('sessions.messages.subscribe').at(-1)).toEqual(['sessions.messages.subscribe', { key: OTHER }]));

    // A new connection starts with no subscriptions, so it subscribes again.
    rerenderWith({ connectionState: 'reconnecting' });
    rerenderWith({ connectionState: 'connected' });
    await waitFor(() => expect(calls('sessions.messages.subscribe')).toHaveLength(3));
    expect(calls('sessions.messages.subscribe').at(-1)).toEqual(['sessions.messages.subscribe', { key: OTHER }]);
  });

  it('shows a channel run live: the inbound message, the indicator, the stream and the reply once', async () => {
    const history: unknown[] = [earlier];
    const { emit, getChat } = await setup(history);

    emit('agent', agent('lifecycle', { phase: 'start', startedAt: NOW }));
    await waitFor(() => expect(getChat().isGenerating).toBe(true));
    expect(getChat().processingStage).toBe('thinking');

    // The inbound Telegram message is committed; no chat event carries it.
    history.push(inbound);
    emit('session.message', committed(inbound));
    await waitFor(() => expect(getChat().messages.map((m) => m.rawText)).toEqual(['Earlier', 'Hi from Telegram']));
    expect(getChat().isGenerating).toBe(true);

    emit('agent', agent('tool', { phase: 'start', name: 'web_search', toolCallId: 'tc-1', args: { query: 'weather' } }));
    await waitFor(() => expect(getChat().processingStage).toBe('tool_use'));

    emit('chat', chat({ state: 'delta', seq: 7, deltaText: 'Hello', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }], timestamp: NOW + 1_500 } }));
    emit('chat', chat({ state: 'delta', seq: 8, deltaText: ' back' }));
    await waitFor(() => expect(getChat().stream.html).toContain('Hello back'));

    // The reply is committed before it is delivered to Telegram, then the run ends.
    history.push(reply);
    emit('session.message', committed(reply, { runId: RUN }));
    emit('agent', agent('lifecycle', { phase: 'end', startedAt: NOW, endedAt: NOW + 2_100 }));
    emit('chat', chat({ state: 'final', seq: 9, stopReason: 'stop', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello back' }], timestamp: NOW + 2_100 } }));

    await waitFor(() => expect(getChat().isGenerating).toBe(false));
    await waitFor(() => expect(getChat().messages.map((m) => m.rawText)).toEqual(['Earlier', 'Hi from Telegram', 'Hello back']));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    expect(getChat().messages.map((m) => m.rawText)).toEqual(['Earlier', 'Hi from Telegram', 'Hello back']);
  });

  it('brings in rows committed while no run is on screen', async () => {
    // For example a subagent coordination run, which the gateway never streams to anyone.
    const history: unknown[] = [earlier];
    const { emit, getChat, calls } = await setup(history);
    const loads = calls('chat.history').length;

    history.push(inbound, reply);
    emit('session.message', committed(inbound));
    emit('session.message', committed(reply, { runId: RUN }));

    await waitFor(() => expect(getChat().messages.map((m) => m.rawText)).toEqual(['Earlier', 'Hi from Telegram', 'Hello back']));
    // A burst of committed rows collapses into one history read.
    expect(calls('chat.history').length).toBe(loads + 1);
  });

  it('reconciles when the gateway reports a transcript change without the row', async () => {
    const history: unknown[] = [earlier];
    const { emit, getChat } = await setup(history);

    history.push(inbound);
    emit('sessions.changed', { sessionKey: TELEGRAM, agentId: 'main', phase: 'message', ts: NOW });

    await waitFor(() => expect(getChat().messages.map((m) => m.rawText)).toEqual(['Earlier', 'Hi from Telegram']));
  });

  it('leaves the rows of the run it is streaming to that run\'s final', async () => {
    const history: unknown[] = [earlier, inbound];
    const { emit, getChat, calls, settle } = await setup(history);

    emit('agent', agent('lifecycle', { phase: 'start', startedAt: NOW }));
    emit('chat', chat({ state: 'delta', seq: 7, deltaText: 'Hello back', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello back' }], timestamp: NOW + 1_500 } }));
    await waitFor(() => expect(getChat().stream.html).toContain('Hello back'));
    const loads = calls('chat.history').length;

    history.push(reply);
    emit('session.message', committed(reply, { runId: RUN }));
    await settle();

    expect(calls('chat.history').length).toBe(loads);
    expect(getChat().messages.map((m) => m.rawText)).toEqual(['Earlier', 'Hi from Telegram']);
  });

  it('shows a prompt sent from Nerve once when its committed row arrives mid-run', async () => {
    const history: unknown[] = [earlier];
    const { emit, getChat, calls } = await setup(history);

    await act(async () => {
      await getChat().handleSend('Hello');
    });
    const key = (calls('chat.send')[0][1] as { idempotencyKey: string }).idempotencyKey;
    emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }));

    // The gateway records the prompt under its send key and reports the row.
    const recorded = { role: 'user', content: 'Hello', timestamp: NOW + 300, idempotencyKey: `${key}:user`, __openclaw: { id: 'u2', seq: 2 } };
    history.push(recorded);
    const loads = calls('chat.history').length;
    emit('session.message', committed(recorded));
    await waitFor(() => expect(calls('chat.history').length).toBe(loads + 1));

    await waitFor(() => expect(getChat().messages.map((m) => [m.rawText, Boolean(m.tempId)])).toEqual([['Earlier', false], ['Hello', false]]));
    expect(getChat().isGenerating).toBe(true);
  });

  it('ignores committed rows of other sessions', async () => {
    const { emit, calls, settle } = await setup([earlier]);
    const loads = calls('chat.history').length;

    emit('session.message', { ...committed(inbound), sessionKey: OTHER });
    emit('sessions.changed', { sessionKey: OTHER, phase: 'message', ts: NOW });
    await settle();

    expect(calls('chat.history').length).toBe(loads);
  });
});
