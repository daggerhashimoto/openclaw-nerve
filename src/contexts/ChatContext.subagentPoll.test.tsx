/**
 * The history poll of an active sub-agent session rebuilds the transcript from
 * history every few seconds; a prompt not sent yet must survive it, and must not
 * hide changes to the rows history gave.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useEffect } from 'react';
import type { useChat as UseChat } from './ChatContext';

type ChatApi = ReturnType<typeof UseChat>;

const SESSION = 'agent:main:subagent:research';
const NOW = 1_700_000_015_000;

describe('ChatContext sub-agent history poll', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const settle = () => act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });

  it('keeps a prompt that failed to send, and still shows a revised history row', async () => {
    const history: Array<Record<string, unknown>> = [
      { role: 'assistant', content: 'Working on the brief.', timestamp: NOW - 60_000, __openclaw: { id: 'e1' } },
    ];
    const rpcMock = vi.fn(async (method: string) => {
      if (method === 'chat.send') throw new Error('Disconnected');
      if (method === 'chat.history') return { messages: history };
      return {};
    });
    vi.doMock('./GatewayContext', () => ({
      useGateway: () => ({ connectionState: 'connected', rpc: rpcMock, subscribe: vi.fn(() => () => {}) }),
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
    render(<ChatProvider><Consumer /></ChatProvider>);
    await settle();
    expect(chat!.messages.map((m) => m.rawText)).toEqual(['Working on the brief.']);

    await act(async () => {
      await chat!.handleSend('Add the sources');
    });
    const rows = () => chat!.messages.filter((m) => m.role !== 'system').map((m) => [m.rawText, Boolean(m.failed)]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await settle();
    expect(rows()).toEqual([['Working on the brief.', false], ['Add the sources', true]]);

    // History revises its last row without adding one.
    history[0] = { ...history[0], content: 'Brief done.' };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await settle();
    expect(rows()).toEqual([['Brief done.', false], ['Add the sources', true]]);
  });
});
