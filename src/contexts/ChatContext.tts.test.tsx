import { act, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMsg } from '@/features/chat/types';
import type { useChatRuntime } from '@/features/chat/runtime/useChatRuntime';

type RuntimeState = ReturnType<typeof useChatRuntime>;

describe('ChatContext runtime TTS playback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('speaks the active runtime final message TTS marker once generation completes', async () => {
    const { ChatProvider, useChat, setRuntimeState, speakMock } = await setup();

    let send: ((text: string) => Promise<void>) | null = null;

    function Consumer() {
      const chat = useChat();
      useEffect(() => {
        send = chat.handleSend;
      }, [chat]);
      return null;
    }

    const { rerender } = render(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await waitFor(() => expect(send).not.toBeNull());

    await act(async () => {
      await send!('[voice] hello');
    });

    setRuntimeState({ isGenerating: true });
    rerender(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    const finalMessage: ChatMsg = {
      msgId: 'assistant:main:run-1:answer',
      role: 'assistant',
      html: '<p>Visible reply.</p>',
      rawText: 'Visible reply.',
      timestamp: new Date(Date.now() + 1000),
      ttsText: 'Spoken reply.',
    };
    setRuntimeState({ isGenerating: false, messages: [finalMessage] });
    rerender(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await waitFor(() => expect(speakMock).toHaveBeenCalledWith('Spoken reply.'));
    expect(speakMock).toHaveBeenCalledTimes(1);
  });

  it('matches runtime final message run IDs as exact tokens', async () => {
    const { ChatProvider, useChat, setRuntimeState, speakMock } = await setup();

    let send: ((text: string) => Promise<void>) | null = null;

    function Consumer() {
      const chat = useChat();
      useEffect(() => {
        send = chat.handleSend;
      }, [chat]);
      return null;
    }

    const { rerender } = render(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await waitFor(() => expect(send).not.toBeNull());

    await act(async () => {
      await send!('[voice] hello');
    });

    setRuntimeState({ isGenerating: true });
    rerender(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    const now = Date.now();
    const correctMessage: ChatMsg = {
      msgId: 'assistant:main:run-1:answer',
      role: 'assistant',
      html: '<p>Correct reply.</p>',
      rawText: 'Correct reply.',
      timestamp: new Date(now + 1000),
      ttsText: 'Correct spoken reply.',
    };
    const substringMessage: ChatMsg = {
      msgId: 'assistant:main:run-10:answer',
      role: 'assistant',
      html: '<p>Wrong reply.</p>',
      rawText: 'Wrong reply.',
      timestamp: new Date(now + 2000),
      ttsText: 'Wrong spoken reply.',
    };
    setRuntimeState({ isGenerating: false, messages: [correctMessage, substringMessage] });
    rerender(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await waitFor(() => expect(speakMock).toHaveBeenCalledWith('Correct spoken reply.'));
    expect(speakMock).not.toHaveBeenCalledWith('Wrong spoken reply.');
    expect(speakMock).toHaveBeenCalledTimes(1);
  });

  it('does not select an ambiguous timestamp fallback when chat.send returns no run ID', async () => {
    const { ChatProvider, useChat, setRuntimeState, speakMock } = await setup({
      runtimeAck: { ok: true, sessionKey: 'main', cursor: '1' },
    });

    let send: ((text: string) => Promise<void>) | null = null;

    function Consumer() {
      const chat = useChat();
      useEffect(() => {
        send = chat.handleSend;
      }, [chat]);
      return null;
    }

    const { rerender } = render(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await waitFor(() => expect(send).not.toBeNull());

    await act(async () => {
      await send!('[voice] hello');
    });

    setRuntimeState({ isGenerating: true });
    rerender(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    const now = Date.now();
    setRuntimeState({
      isGenerating: false,
      messages: [
        {
          msgId: 'assistant:main:older:answer',
          role: 'assistant',
          html: '<p>Older reply.</p>',
          rawText: 'Older reply.',
          timestamp: new Date(now + 1000),
          ttsText: 'Older spoken reply.',
        },
        {
          msgId: 'assistant:main:newer:answer',
          role: 'assistant',
          html: '<p>Newer reply.</p>',
          rawText: 'Newer reply.',
          timestamp: new Date(now + 2000),
          ttsText: 'Newer spoken reply.',
        },
      ],
    });
    rerender(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(speakMock).not.toHaveBeenCalled();
  });
});

async function setup(options: {
  runtimeAck?: { ok: true; sessionKey: string; cursor: string; runId?: string };
} = {}) {
  const speakMock = vi.fn();
  let runtimeState = makeRuntimeState();

  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => options.runtimeAck ?? { ok: true, sessionKey: 'main', cursor: '1', runId: 'run-1' },
  })));

  vi.doMock('@/features/chat/runtime/useChatRuntime', () => ({
    useChatRuntime: vi.fn(() => runtimeState),
  }));

  vi.doMock('@/features/voice/audio-feedback', () => ({
    playPing: vi.fn(),
  }));

  vi.doMock('./GatewayContext', () => ({
    useGateway: () => ({
      connectionState: 'disconnected',
      rpc: vi.fn(async () => ({})),
      subscribe: vi.fn(() => () => {}),
    }),
  }));

  vi.doMock('./SessionContext', () => ({
    useSessionContext: () => ({
      currentSession: 'main',
      sessions: [],
    }),
  }));

  vi.doMock('./SettingsContext', () => ({
    useSettings: () => ({
      soundEnabled: false,
      speak: speakMock,
    }),
  }));

  const mod = await import('./ChatContext');
  return {
    ...mod,
    speakMock,
    setRuntimeState(next: Partial<RuntimeState>) {
      runtimeState = { ...runtimeState, ...next };
    },
  };
}

function makeRuntimeState(): RuntimeState {
  return {
    messages: [],
    isGenerating: false,
    processingStage: null,
    lastEventTimestamp: 0,
    activityLog: [],
    currentToolDescription: null,
    stream: { html: '' },
    connected: true,
    error: null,
    cursor: '0',
    hasMore: false,
    loadMore: vi.fn(() => false),
    reload: vi.fn(),
    reset: vi.fn(),
    markUserMessageFailed: vi.fn(),
    clearUserMessageFailure: vi.fn(),
  };
}
