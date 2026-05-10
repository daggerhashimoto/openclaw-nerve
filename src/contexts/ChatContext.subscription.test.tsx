/** Regression test: ChatContext should not subscribe to gateway chat events for rendering. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor, screen } from '@testing-library/react';
import { useEffect, type ReactElement, type ReactNode } from 'react';
import type { ImageAttachment, OutgoingUploadPayload } from '@/features/chat/types';
import type { useChatRuntime } from '@/features/chat/runtime/useChatRuntime';
import type { GranularAgentState, Session } from '@/types';

type RuntimeState = ReturnType<typeof useChatRuntime>;

describe('ChatContext subscription stability', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function setup(options: {
    agentStatus?: Record<string, GranularAgentState>;
    sessions?: Session[];
    runtimeState?: Partial<RuntimeState>;
  } = {}) {
    const subscribeMock = vi.fn(() => () => {});
    const rpcMock = vi.fn(async () => ({}));
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, sessionKey: 'main', cursor: '1', runId: 'run-1' }),
    }));
    const runtimeState = {
      ...makeRuntimeState(),
      ...options.runtimeState,
    };
    vi.stubGlobal('fetch', fetchMock);

    vi.doMock('@/features/chat/runtime/useChatRuntime', () => ({
      useChatRuntime: vi.fn(() => runtimeState),
    }));

    vi.doMock('./GatewayContext', () => ({
      useGateway: () => ({
        connectionState: 'disconnected',
        rpc: rpcMock,
        subscribe: subscribeMock,
      }),
    }));

    vi.doMock('./SessionContext', () => ({
      useSessionContext: () => ({
        currentSession: 'main',
        sessions: options.sessions ?? [],
        agentStatus: options.agentStatus ?? {},
      }),
    }));

    vi.doMock('./SettingsContext', () => ({
      useSettings: () => ({
        soundEnabled: false,
        speak: vi.fn(),
      }),
    }));

    const mod = await import('./ChatContext');
    return { ...mod, fetchMock, rpcMock, subscribeMock, runtimeState };
  }

  it('sends through runtime POST without registering a gateway chat subscription', async () => {
    const { ChatProvider, useChat, fetchMock, subscribeMock } = await setup();

    let send: ((text: string, images?: ImageAttachment[]) => Promise<void>) | null = null;

    function Consumer() {
      const chat = useChat();
      useEffect(() => {
        send = chat.handleSend;
      }, [chat]);
      return null;
    }

    render(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await waitFor(() => expect(send).not.toBeNull());
    expect(send).not.toBeNull();

    fetchMock.mockClear();
    await act(async () => {
      await send!('hello');
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat-runtime/sessions/main/messages',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it('sends image messages through the runtime POST with media metadata', async () => {
    const { ChatProvider, useChat, fetchMock, rpcMock, subscribeMock } = await setup();

    let send: ((
      text: string,
      images?: ImageAttachment[],
      uploadPayload?: OutgoingUploadPayload,
    ) => Promise<void>) | null = null;

    function Consumer() {
      const chat = useChat();
      useEffect(() => {
        send = chat.handleSend;
      }, [chat]);
      return null;
    }

    render(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await waitFor(() => expect(send).not.toBeNull());
    fetchMock.mockClear();
    rpcMock.mockClear();

    const image: ImageAttachment = {
      id: 'img-1',
      mimeType: 'image/png',
      content: 'base64-image',
      preview: 'data:image/png;base64,base64-image',
      name: 'image.png',
    };
    const uploadPayload: OutgoingUploadPayload = {
      descriptors: [
        {
          id: 'att-1',
          origin: 'upload',
          mode: 'inline',
          name: 'image.png',
          mimeType: 'image/png',
          sizeBytes: 100,
          inline: {
            encoding: 'base64',
            base64: 'base64-image',
            base64Bytes: 100,
            compressed: false,
          },
          policy: { forwardToSubagents: false },
        },
      ],
      manifest: {
        enabled: true,
        exposeInlineBase64ToAgent: false,
        allowSubagentForwarding: false,
      },
    };
    await act(async () => {
      await send!('look at this', [image], uploadPayload);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat-runtime/sessions/main/messages',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"images"'),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as {
      images?: unknown[];
      uploadPayload?: OutgoingUploadPayload;
    };
    expect(body.images).toEqual([
      {
        mimeType: 'image/png',
        content: 'base64-image',
        preview: 'data:image/png;base64,base64-image',
        name: 'image.png',
      },
    ]);
    expect(body.uploadPayload?.descriptors).toHaveLength(1);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it('does not keep the chat generating indicator stuck when gateway status is settled after the last runtime event', async () => {
    const { ChatProvider, useChat } = await setup({
      agentStatus: {
        main: { status: 'IDLE', since: 2_000 },
      },
      runtimeState: {
        isGenerating: true,
        processingStage: 'thinking',
        lastEventTimestamp: 1_000,
      },
    });

    renderRuntimeState(ChatProvider, useChat);

    expectRuntimeState('false', '');
  });

  it('keeps showing runtime generation when the runtime event is newer than a stale settled gateway status', async () => {
    const { ChatProvider, useChat } = await setup({
      agentStatus: {
        main: { status: 'IDLE', since: 1_000 },
      },
      runtimeState: {
        isGenerating: true,
        processingStage: 'thinking',
        lastEventTimestamp: 2_000,
      },
    });

    renderRuntimeState(ChatProvider, useChat);

    expectRuntimeState('true', 'thinking');
  });

  it('does not keep the chat generating indicator stuck after refresh when the session row is settled', async () => {
    const { ChatProvider, useChat } = await setup({
      sessions: [{
        sessionKey: 'main',
        state: 'idle',
        updatedAt: 2_000,
      }],
      runtimeState: {
        isGenerating: true,
        processingStage: 'thinking',
        lastEventTimestamp: 1_000,
      },
    });

    renderRuntimeState(ChatProvider, useChat);

    expectRuntimeState('false', '');
  });

  it('keeps showing runtime generation when the settled session row is older than the runtime event', async () => {
    const { ChatProvider, useChat } = await setup({
      sessions: [{
        sessionKey: 'main',
        state: 'idle',
        updatedAt: 1_000,
      }],
      runtimeState: {
        isGenerating: true,
        processingStage: 'thinking',
        lastEventTimestamp: 2_000,
      },
    });

    renderRuntimeState(ChatProvider, useChat);

    expectRuntimeState('true', 'thinking');
  });

  it('shows a local optimistic voice bubble while waiting for runtime replay', async () => {
    const { ChatProvider, useChat, fetchMock } = await setup();
    let resolveFetch: ((response: Response) => void) | null = null;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));

    let send: ((text: string) => Promise<void>) | null = null;

    function Consumer() {
      const chat = useChat();
      useEffect(() => {
        send = chat.handleSend;
      }, [chat]);
      return (
        <div data-testid="messages" data-generating={String(chat.isGenerating)}>
          {chat.messages.map((message) => (
            <div
              key={message.msgId}
              data-role={message.role}
              data-pending={String(Boolean(message.pending))}
              data-voice={String(Boolean(message.isVoice))}
            >
              {message.rawText}
            </div>
          ))}
        </div>
      );
    }

    render(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await waitFor(() => expect(send).not.toBeNull());

    await act(async () => {
      void send!('[voice] hello from voice');
      await Promise.resolve();
    });

    const messages = screen.getByTestId('messages');
    expect(messages.getAttribute('data-generating')).toBe('true');
    expect(screen.getByText('[voice] hello from voice')).toHaveAttribute('data-pending', 'true');
    expect(screen.getByText('[voice] hello from voice')).toHaveAttribute('data-voice', 'true');

    await act(async () => {
      resolveFetch!(new Response(JSON.stringify({ ok: true, sessionKey: 'main', cursor: '1', runId: 'run-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    });
  });

  it('does not duplicate the local voice bubble when runtime history catches up with the persisted voice message', async () => {
    const { ChatProvider, useChat, runtimeState } = await setup();
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'idem-voice-stable') });

    let send: ((text: string) => Promise<void>) | null = null;

    function Consumer() {
      const chat = useChat();
      useEffect(() => {
        send = chat.handleSend;
      }, [chat]);
      return (
        <div data-testid="messages">
          {chat.messages.map((message) => (
            <div key={message.msgId} data-role={message.role}>{message.rawText}</div>
          ))}
        </div>
      );
    }

    const view = render(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await waitFor(() => expect(send).not.toBeNull());

    await act(async () => {
      await send!('[voice] hello from voice');
    });

    expect(screen.getAllByText(/\[voice\] hello from voice/)).toHaveLength(1);

    runtimeState.messages = [{
      msgId: 'user:main:history-message',
      tempId: 'idem-voice-stable',
      role: 'user',
      html: '<p>[voice] hello from voice</p>',
      rawText: '[voice] hello from voice\n\n[system: User sent a voice message. Always include TTS.]',
      timestamp: new Date(Date.now() + 1000),
      isVoice: true,
    }];

    view.rerender(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    expect(screen.getAllByText(/\[voice\] hello from voice/)).toHaveLength(1);
  });

  it('matches optimistic voice sends to runtime history one-to-one when text repeats', async () => {
    const { ChatProvider, useChat, runtimeState } = await setup();
    const randomUUID = vi.fn()
      .mockReturnValueOnce('idem-repeat-1')
      .mockReturnValueOnce('idem-repeat-2');
    vi.stubGlobal('crypto', { randomUUID });

    let send: ((text: string) => Promise<void>) | null = null;

    function Consumer() {
      const chat = useChat();
      useEffect(() => {
        send = chat.handleSend;
      }, [chat]);
      return (
        <div data-testid="messages">
          {chat.messages.map((message) => (
            <div key={message.msgId} data-role={message.role}>{message.rawText}</div>
          ))}
        </div>
      );
    }

    const view = render(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await waitFor(() => expect(send).not.toBeNull());

    await act(async () => {
      await send!('[voice] repeat');
      await send!('[voice] repeat');
    });

    expect(screen.getAllByText('[voice] repeat')).toHaveLength(2);

    runtimeState.messages = [{
      msgId: 'user:main:history-message',
      tempId: 'idem-repeat-1',
      role: 'user',
      html: '<p>[voice] repeat</p>',
      rawText: '[voice] repeat',
      timestamp: new Date(Date.now() + 1000),
      isVoice: true,
    }];

    view.rerender(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    expect(screen.getAllByText('[voice] repeat')).toHaveLength(2);
  });

  it('keeps a new optimistic bubble when an older runtime message has the same text', async () => {
    const { ChatProvider, useChat, runtimeState } = await setup({
      runtimeState: {
        messages: [{
          msgId: 'user:main:older-repeat',
          role: 'user',
          html: '<p>[voice] repeat</p>',
          rawText: '[voice] repeat',
          timestamp: new Date(Date.now() - 1000),
          isVoice: true,
        }],
      },
    });

    let send: ((text: string) => Promise<void>) | null = null;

    function Consumer() {
      const chat = useChat();
      useEffect(() => {
        send = chat.handleSend;
      }, [chat]);
      return (
        <div data-testid="messages">
          {chat.messages.map((message) => (
            <div key={message.msgId} data-role={message.role}>{message.rawText}</div>
          ))}
        </div>
      );
    }

    render(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await waitFor(() => expect(send).not.toBeNull());

    vi.useFakeTimers();

    await act(async () => {
      await send!('[voice] repeat');
    });

    expect(screen.getAllByText('[voice] repeat')).toHaveLength(2);
    expect(runtimeState.reload).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(750);
    });

    expect(runtimeState.reload).toHaveBeenCalledTimes(1);
  });

  it('reconnects runtime replay after send when the stream has not observed the optimistic voice message', async () => {
    const { ChatProvider, useChat, runtimeState } = await setup();

    let send: ((text: string) => Promise<void>) | null = null;

    function Consumer() {
      const chat = useChat();
      useEffect(() => {
        send = chat.handleSend;
      }, [chat]);
      return null;
    }

    render(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await waitFor(() => expect(send).not.toBeNull());

    vi.useFakeTimers();

    await act(async () => {
      await send!('[voice] hello from voice');
    });

    expect(runtimeState.reload).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(750);
    });

    expect(runtimeState.reload).toHaveBeenCalledTimes(1);
  });
});

function renderRuntimeState(
  ChatProvider: (props: { children: ReactNode }) => ReactElement,
  useChat: () => { isGenerating: boolean; processingStage: string | null },
): void {
  function Consumer() {
    const chat = useChat();
    return (
      <div
        data-testid="runtime-state"
        data-generating={String(chat.isGenerating)}
        data-stage={chat.processingStage ?? ''}
      />
    );
  }

  render(
    <ChatProvider>
      <Consumer />
    </ChatProvider>,
  );
}

function expectRuntimeState(generating: string, stage: string): void {
  expect(screen.getByTestId('runtime-state').getAttribute('data-generating')).toBe(generating);
  expect(screen.getByTestId('runtime-state').getAttribute('data-stage')).toBe(stage);
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
