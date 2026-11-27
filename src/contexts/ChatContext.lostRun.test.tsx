/**
 * A run whose end and final were lost with a dropped connection.
 *
 * The gateway broadcasts a run's lifecycle end and final once; a client that
 * is offline at that moment never gets them. On reconnect the recovery read
 * reports whether the session still has a run going (`sessionInfo.hasActiveRun`
 * on OpenClaw 2026.9+), which is the only word the client gets that it is over.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import type { GatewayEvent } from '@/types';
import type { useChat as UseChat } from './ChatContext';

type ChatApi = ReturnType<typeof UseChat>;
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

const SESSION = 'agent:main:main';
const RUN = 'run-1';
const NOW = 1_700_000_015_000;

const earlier = { role: 'user', content: 'Earlier', timestamp: NOW - 60_000, __openclaw: { id: 'e1' } };
const prompt = { role: 'user', content: 'What is the weather', timestamp: NOW + 100, __openclaw: { id: 'e2' } };
const reply = {
  role: 'assistant',
  content: [{ type: 'text', text: 'It is sunny and warm today.' }],
  timestamp: NOW + 2_000,
  __openclaw: { id: 'e3', runId: RUN },
};

describe('ChatContext when a run ends while disconnected', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup() {
    let handler: ((msg: GatewayEvent) => void) | null = null;
    const gateway = { connectionState: 'connected' as ConnectionState };
    const history: unknown[] = [earlier, prompt];
    const state: { sessionInfo?: { hasActiveRun: boolean }; hold: boolean } = { hold: false };
    const held: Array<() => void> = [];
    const rpcMock = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'chat.history') {
        const answer = { messages: [...history], ...(state.sessionInfo ? { sessionInfo: { ...state.sessionInfo } } : {}) };
        // Hold only the reconnect recovery read (it asks for 120 rows).
        if (state.hold && params?.limit === 120) return new Promise((resolve) => held.push(() => resolve(answer)));
        return answer;
      }
      if (method === 'sessions.messages.subscribe') return { subscribed: true, key: SESSION };
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
      useSessionContext: () => ({ currentSession: SESSION, sessions: [] }),
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
    const setConnection = (next: ConnectionState) => {
      gateway.connectionState = next;
      view.rerender(tree());
    };
    const chatFrame = (payload: Record<string, unknown>) => ({ runId: RUN, sessionKey: SESSION, ...payload });

    /** A run streaming on screen when the connection drops; it finishes while offline. */
    const streamThenDrop = async () => {
      emit('chat', chatFrame({ state: 'status', seq: 1, phase: 'preparing_workspace' }));
      emit('chat', chatFrame({ state: 'delta', seq: 2, deltaText: 'It is sunny', message: { role: 'assistant', content: [{ type: 'text', text: 'It is sunny' }], timestamp: NOW + 1_500 } }));
      await waitFor(() => expect(chat!.stream.html).toContain('It is sunny'));
      setConnection('reconnecting');
      history.push(reply);
    };

    return { getChat: () => chat!, state, held, emit, chatFrame, setConnection, streamThenDrop };
  }

  it('takes the run down once the recovery read reports none going', async () => {
    const { getChat, state, setConnection, streamThenDrop } = await setup();
    await streamThenDrop();

    state.sessionInfo = { hasActiveRun: false };
    setConnection('connected');

    await waitFor(() => expect(getChat().isGenerating).toBe(false));
    expect(getChat().stream.html).toBe('');
    expect(getChat().messages.map((m) => m.rawText)).toEqual(['Earlier', 'What is the weather', 'It is sunny and warm today.']);
  });

  it('keeps the run when the gateway reports it still going', async () => {
    const { getChat, state, held, setConnection, streamThenDrop } = await setup();
    await streamThenDrop();

    state.sessionInfo = { hasActiveRun: true };
    state.hold = true;
    setConnection('connected');
    await waitFor(() => expect(held).toHaveLength(1));

    // The recovery read itself answers (the reconnect's full load does not settle runs).
    await act(async () => {
      held[0]();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await waitFor(() => expect(getChat().stream.isRecovering).toBeFalsy());
    expect(getChat().isGenerating).toBe(true);
  });

  // How a newer run can first show itself while the read is out.
  const newerRunFrames: Array<[string, string, Record<string, unknown>]> = [
    ['a lifecycle start', 'agent', { stream: 'lifecycle', data: { phase: 'start' } }],
    ['an agent state alone', 'agent', { state: 'thinking' }],
    ['a status frame', 'chat', { state: 'status', seq: 1, phase: 'preparing_workspace' }],
    ['a first delta', 'chat', { state: 'delta', seq: 1, deltaText: 'New', message: { role: 'assistant', content: [{ type: 'text', text: 'New' }], timestamp: NOW + 3_000 } }],
  ];

  it.each(newerRunFrames)('does not let an older read take down a run that began after it with %s', async (_label, event, frame) => {
    const { getChat, state, held, emit, setConnection, streamThenDrop } = await setup();
    await streamThenDrop();

    // The recovery read goes out and the gateway answers it as the first run
    // stood over; before the answer arrives, a newer run shows on screen.
    state.sessionInfo = { hasActiveRun: false };
    state.hold = true;
    setConnection('connected');
    await waitFor(() => expect(held).toHaveLength(1));
    emit(event, { runId: 'run-2', sessionKey: SESSION, ...frame });

    await act(async () => {
      held[0]();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await waitFor(() => expect(getChat().stream.isRecovering).toBeFalsy());
    expect(getChat().isGenerating).toBe(true);
  });
});
