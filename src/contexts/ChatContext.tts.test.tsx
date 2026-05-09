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
});

async function setup() {
  const speakMock = vi.fn();
  let runtimeState = makeRuntimeState();

  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, sessionKey: 'main', cursor: '1', runId: 'run-1' }),
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
