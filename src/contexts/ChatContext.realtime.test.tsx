/**
 * Regression tests for realtime chat against OpenClaw protocol v4 gateways.
 *
 * Frame shapes mirror what a 2026.9 gateway actually sends: `status` instead of
 * `started`, appends in `deltaText` with a snapshot only on the first frame,
 * run-level chat seq numbers shared with agent events, connection-level frame
 * seq numbers that cover every event, and a late second `final` that delivers
 * an interim reply after the run has already settled.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import type { GatewayEvent } from '@/types';
import type { useChat as UseChat } from './ChatContext';

type ChatApi = ReturnType<typeof UseChat>;

const SESSION = 'agent:main:main';
const RUN = 'run-1';
const NOW = 1_700_000_015_000; // middle of a 30s bucket, keeps message signatures stable

function textMessage(text: string, timestamp: number) {
  return { role: 'assistant', content: [{ type: 'text', text }], timestamp };
}

describe('ChatContext realtime handling (protocol v4)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup(history: unknown[] = []) {
    let handler: ((msg: GatewayEvent) => void) | null = null;
    const subscribeMock = vi.fn((h: (msg: GatewayEvent) => void) => {
      handler = h;
      return () => {};
    });
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.send') return { runId: RUN, status: 'started' };
      if (method === 'chat.history') return { messages: history };
      return {};
    });

    vi.doMock('./GatewayContext', () => ({
      useGateway: () => ({
        connectionState: 'disconnected',
        rpc: rpcMock,
        subscribe: subscribeMock,
      }),
    }));

    vi.doMock('./SessionContext', () => ({
      useSessionContext: () => ({
        currentSession: SESSION,
        sessions: [],
      }),
    }));

    vi.doMock('./SettingsContext', () => ({
      useSettings: () => ({
        soundEnabled: false,
        speak: vi.fn(),
      }),
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

    render(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await waitFor(() => expect(handler).not.toBeNull());

    const emit = (event: string, payload: Record<string, unknown>, seq?: number) => {
      act(() => {
        handler!({ type: 'event', event, payload, ...(seq !== undefined ? { seq } : {}) });
      });
    };
    const historyCalls = () => rpcMock.mock.calls.filter(([method]) => method === 'chat.history').length;

    return { emit, historyCalls, getChat: () => chat!, rpcMock };
  }

  const chat = (payload: Record<string, unknown>) => ({ sessionKey: SESSION, runId: RUN, ...payload });

  it('treats the first status frame as the start of the turn', async () => {
    const { emit, getChat } = await setup();

    emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }));

    await waitFor(() => expect(getChat().isGenerating).toBe(true));
  });

  it('streams the full text when later frames carry only deltaText', async () => {
    const { emit, getChat } = await setup();

    emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }));
    emit('chat', chat({ state: 'delta', seq: 33, deltaText: 'Fore', message: textMessage('Fore', NOW) }));
    emit('chat', chat({ state: 'delta', seq: 37, deltaText: 'sts absorb' }));
    emit('chat', chat({ state: 'delta', seq: 55, deltaText: ' carbon dioxide.' }));

    await waitFor(() => expect(getChat().stream.html).toContain('Forests absorb carbon dioxide.'));
  });

  it('does not recover history for normal frame and chat seq jumps', async () => {
    const { emit, historyCalls } = await setup();

    // Contiguous connection frames; chat seq jumps because agent events share the run counter.
    emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }), 7);
    emit('sessions.changed', { sessionKey: SESSION, reason: 'patch' }, 8);
    emit('agent', { sessionKey: SESSION, runId: RUN, seq: 6, stream: 'lifecycle', data: { phase: 'start' } }, 9);
    emit('tick', {}, 10);
    emit('chat', chat({ state: 'delta', seq: 33, deltaText: 'Fore', message: textMessage('Fore', NOW) }), 11);
    emit('session.message', { sessionKey: SESSION }, 12);
    emit('chat', chat({ state: 'delta', seq: 37, deltaText: 'sts' }), 13);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(historyCalls()).toBe(0);
  });

  it('still recovers history when connection frames are actually missing', async () => {
    const { emit, historyCalls } = await setup();

    emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }), 7);
    emit('chat', chat({ state: 'delta', seq: 2, deltaText: 'Hi', message: textMessage('Hi', NOW) }), 9);

    await waitFor(() => expect(historyCalls()).toBeGreaterThan(0));
  });

  it('refreshes history when a tool item finishes, including the message tool', async () => {
    const { emit, historyCalls } = await setup();

    emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }));
    emit('agent', {
      sessionKey: SESSION,
      runId: RUN,
      seq: 20,
      stream: 'item',
      data: { kind: 'tool', phase: 'end', name: 'message', toolCallId: 'tc-1', status: 'completed' },
    });

    await waitFor(() => expect(historyCalls()).toBeGreaterThan(0));
  });

  it('reconciles a late final for a settled run from history instead of appending it', async () => {
    const history = [
      { role: 'user', content: 'Write about clouds', timestamp: NOW },
      textMessage('Clouds form.', NOW + 3000),
      textMessage('Rain falls.', NOW + 6000),
    ];
    const { emit, getChat } = await setup(history);

    await act(async () => {
      await getChat().handleSend('Write about clouds');
    });

    emit('chat', chat({ state: 'status', seq: 1, phase: 'preparing_workspace' }));
    emit('chat', chat({ state: 'delta', seq: 33, deltaText: 'Rain falls.', message: textMessage('Rain falls.', NOW + 6000) }));
    emit('chat', chat({ state: 'final', seq: 75, stopReason: 'stop', message: textMessage('Rain falls.', NOW + 6000) }));

    await waitFor(() => {
      expect(getChat().messages.map((m) => m.rawText)).toEqual(['Write about clouds', 'Rain falls.']);
    });

    // Late delivery of the interim reply for the same, already finalized run.
    emit('chat', chat({ state: 'final', seq: 1, message: textMessage('Clouds form.', NOW + 6100) }));

    await waitFor(() => {
      expect(getChat().messages.map((m) => m.rawText)).toEqual([
        'Write about clouds',
        'Clouds form.',
        'Rain falls.',
      ]);
    });
  });
});
