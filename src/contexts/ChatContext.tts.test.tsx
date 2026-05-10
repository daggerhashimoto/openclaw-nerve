import { act, cleanup, render, waitFor } from '@testing-library/react';
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
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
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

  it('retains pending TTS requests when generation stops before the final message projects', async () => {
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

    setRuntimeState({ isGenerating: false, messages: [] });
    rerender(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(speakMock).not.toHaveBeenCalled();

    setRuntimeState({
      isGenerating: false,
      messages: [{
        msgId: 'assistant:main:run-1:answer',
        role: 'assistant',
        html: '<p>Delayed reply.</p>',
        rawText: 'Delayed reply.',
        timestamp: new Date(Date.now() + 1000),
        ttsText: 'Delayed spoken reply.',
      }],
    });
    rerender(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await waitFor(() => expect(speakMock).toHaveBeenCalledWith('Delayed spoken reply.'));
    expect(speakMock).toHaveBeenCalledTimes(1);
  });

  it('waits for delayed final messages after long-running voice turns before playing a fallback ping', async () => {
    const { ChatProvider, useChat, setRuntimeState, speakMock, playPingMock } = await setup({
      soundEnabled: true,
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T15:00:00.000Z'));

    await act(async () => {
      await send!('[voice] hello after a long run');
    });

    await act(async () => {
      setRuntimeState({ isGenerating: true });
      rerender(
        <ChatProvider>
          <Consumer />
        </ChatProvider>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });

    await act(async () => {
      setRuntimeState({ isGenerating: false, messages: [] });
      rerender(
        <ChatProvider>
          <Consumer />
        </ChatProvider>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(playPingMock).not.toHaveBeenCalled();

    await act(async () => {
      setRuntimeState({
        isGenerating: false,
        messages: [{
          msgId: 'assistant:main:run-1:answer',
          role: 'assistant',
          html: '<p>Delayed long reply.</p>',
          rawText: 'Delayed long reply.',
          timestamp: new Date(Date.now() + 1000),
          ttsText: 'Delayed long spoken reply.',
        }],
      });
      rerender(
        <ChatProvider>
          <Consumer />
        </ChatProvider>,
      );
      await Promise.resolve();
    });

    expect(speakMock).toHaveBeenCalledWith('Delayed long spoken reply.');
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(playPingMock).not.toHaveBeenCalled();
  });

  it('retains pending TTS requests when final projection arrives after the grace window', async () => {
    const { ChatProvider, useChat, setRuntimeState, speakMock, playPingMock } = await setup({
      soundEnabled: true,
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T15:30:00.000Z'));

    await act(async () => {
      await send!('[voice] late final projection');
    });

    await act(async () => {
      setRuntimeState({ isGenerating: true });
      rerender(
        <ChatProvider>
          <Consumer />
        </ChatProvider>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      setRuntimeState({ isGenerating: false, messages: [] });
      rerender(
        <ChatProvider>
          <Consumer />
        </ChatProvider>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(playPingMock).not.toHaveBeenCalled();
    expect(speakMock).not.toHaveBeenCalled();

    await act(async () => {
      setRuntimeState({
        isGenerating: false,
        messages: [{
          msgId: 'assistant:main:run-1:answer',
          role: 'assistant',
          html: '<p>Late final reply.</p>',
          rawText: 'Late final reply.',
          timestamp: new Date(Date.now() + 1000),
          ttsText: 'Late final spoken reply.',
        }],
      });
      rerender(
        <ChatProvider>
          <Consumer />
        </ChatProvider>,
      );
      await Promise.resolve();
    });

    expect(speakMock).toHaveBeenCalledWith('Late final spoken reply.');
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(playPingMock).not.toHaveBeenCalled();
  });

  it('speaks a single unambiguous persisted final message when live run id matching is unavailable', async () => {
    const { ChatProvider, useChat, setRuntimeState, speakMock } = await setup({
      runtimeAck: { ok: true, sessionKey: 'main', cursor: '1', runId: 'live-run-1' },
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
      await send!('[voice] hello from history');
    });

    setRuntimeState({ isGenerating: true });
    rerender(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    setRuntimeState({
      isGenerating: false,
      messages: [
        {
          msgId: 'assistant:main:history:message:assistant-1',
          role: 'assistant',
          html: '<p>Persisted reply.</p>',
          rawText: 'Persisted reply.',
          timestamp: new Date(Date.now() + 1000),
          ttsText: 'Persisted spoken reply.',
        },
      ],
    });
    rerender(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await waitFor(() => expect(speakMock).toHaveBeenCalledWith('Persisted spoken reply.'));
    expect(speakMock).toHaveBeenCalledTimes(1);
  });

  it('speaks the final message after the matching optimistic voice prompt when timestamp fallback is ambiguous', async () => {
    const { ChatProvider, useChat, setRuntimeState, speakMock, playPingMock, fetchMock } = await setup({
      runtimeAck: { ok: true, sessionKey: 'main', cursor: '1' },
      soundEnabled: true,
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
    const sentAt = Date.now();

    await act(async () => {
      await send!('[voice] hello from ambiguous history');
    });

    const requestBody = findRuntimeSendRequestBody(fetchMock);

    setRuntimeState({ isGenerating: true });
    rerender(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    setRuntimeState({
      isGenerating: false,
      messages: [
        {
          msgId: 'assistant:main:history:message:older',
          role: 'assistant',
          html: '<p>Older reply.</p>',
          rawText: 'Older reply.',
          timestamp: new Date(sentAt + 100),
        },
        {
          msgId: `user:main:${requestBody.idempotencyKey}`,
          role: 'user',
          html: '<p>[voice] hello from ambiguous history</p>',
          rawText: '[voice] hello from ambiguous history',
          timestamp: new Date(sentAt + 200),
          tempId: requestBody.idempotencyKey,
        },
        {
          msgId: 'assistant:main:history:message:active-final',
          role: 'assistant',
          html: '<p>Active reply.</p>',
          rawText: 'Active reply.',
          timestamp: new Date(sentAt + 300),
          ttsText: 'Active spoken reply.',
        },
      ],
    });
    rerender(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await waitFor(() => expect(speakMock).toHaveBeenCalledWith('Active spoken reply.'));
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(playPingMock).not.toHaveBeenCalled();
  });

  it('speaks the final message after a replayed voice prompt when idempotency metadata is missing', async () => {
    const { ChatProvider, useChat, setRuntimeState, speakMock, playPingMock } = await setup({
      runtimeAck: { ok: true, sessionKey: 'main', cursor: '1' },
      soundEnabled: true,
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
    const sentAt = Date.now();
    const voiceText = '[voice] replayed user prompt without metadata';

    await act(async () => {
      await send!(voiceText);
    });

    setRuntimeState({ isGenerating: true });
    rerender(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    setRuntimeState({
      isGenerating: false,
      messages: [
        {
          msgId: 'assistant:main:history:message:older',
          role: 'assistant',
          html: '<p>Older reply.</p>',
          rawText: 'Older reply.',
          timestamp: new Date(sentAt + 100),
        },
        {
          msgId: 'user:main:history:user:replayed',
          role: 'user',
          html: '<p>replayed user prompt without metadata</p>',
          rawText: 'replayed user prompt without metadata',
          timestamp: new Date(sentAt + 200),
        },
        {
          msgId: 'assistant:main:history:message:active-final',
          role: 'assistant',
          html: '<p>Replayed reply.</p>',
          rawText: 'Replayed reply.',
          timestamp: new Date(sentAt + 300),
          ttsText: 'Replayed spoken reply.',
        },
      ],
    });
    rerender(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await waitFor(() => expect(speakMock).toHaveBeenCalledWith('Replayed spoken reply.'));
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(playPingMock).not.toHaveBeenCalled();
  });

  it('matches runtime final message run IDs encoded in assistant message IDs', async () => {
    const { ChatProvider, useChat, setRuntimeState, speakMock } = await setup({
      runtimeAck: { ok: true, sessionKey: 'main', cursor: '1', runId: 'run:1' },
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

    setRuntimeState({
      isGenerating: false,
      messages: [
        {
          msgId: 'assistant:main:~cnVuOjE:answer',
          role: 'assistant',
          html: '<p>Encoded reply.</p>',
          rawText: 'Encoded reply.',
          timestamp: new Date(Date.now() + 1000),
          ttsText: 'Encoded spoken reply.',
        },
      ],
    });
    rerender(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await waitFor(() => expect(speakMock).toHaveBeenCalledWith('Encoded spoken reply.'));
    expect(speakMock).toHaveBeenCalledTimes(1);
  });

  it('matches runtime final message run IDs only from the assistant ID run segment', async () => {
    const { ChatProvider, useChat, setRuntimeState, speakMock } = await setup({
      runtimeAck: { ok: true, sessionKey: 'main', cursor: '1', runId: 'main' },
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
          msgId: 'assistant:main:main:answer',
          role: 'assistant',
          html: '<p>Correct reply.</p>',
          rawText: 'Correct reply.',
          timestamp: new Date(now + 1000),
          ttsText: 'Correct spoken reply.',
        },
        {
          msgId: 'assistant:main:run-other:answer',
          role: 'assistant',
          html: '<p>Wrong reply.</p>',
          rawText: 'Wrong reply.',
          timestamp: new Date(now + 2000),
          ttsText: 'Wrong spoken reply.',
        },
      ],
    });
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

  it('speaks final TTS for overlapping runtime sends', async () => {
    const { ChatProvider, useChat, setRuntimeState, speakMock } = await setup({
      runtimeAcks: [
        { ok: true, sessionKey: 'main', cursor: '1', runId: 'run-1' },
        { ok: true, sessionKey: 'main', cursor: '2', runId: 'run-2' },
      ],
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
      await send!('[voice] first');
      await send!('[voice] second');
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
          msgId: 'assistant:main:run-1:answer',
          role: 'assistant',
          html: '<p>First reply.</p>',
          rawText: 'First reply.',
          timestamp: new Date(now + 1000),
          ttsText: 'First spoken reply.',
        },
        {
          msgId: 'assistant:main:run-2:answer',
          role: 'assistant',
          html: '<p>Second reply.</p>',
          rawText: 'Second reply.',
          timestamp: new Date(now + 2000),
          ttsText: 'Second spoken reply.',
        },
      ],
    });
    rerender(
      <ChatProvider>
        <Consumer />
      </ChatProvider>,
    );

    await waitFor(() => expect(speakMock).toHaveBeenCalledWith('First spoken reply.'));
    expect(speakMock).toHaveBeenCalledWith('Second spoken reply.');
    expect(speakMock).toHaveBeenCalledTimes(2);
  });
});

async function setup(options: {
  runtimeAck?: { ok: true; sessionKey: string; cursor: string; runId?: string };
  runtimeAcks?: Array<{ ok: true; sessionKey: string; cursor: string; runId?: string }>;
  soundEnabled?: boolean;
} = {}) {
  const speakMock = vi.fn();
  const playPingMock = vi.fn();
  let runtimeState = makeRuntimeState();
  let runtimeAckIndex = 0;

  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => options.runtimeAcks?.[runtimeAckIndex++]
      ?? options.runtimeAck
      ?? { ok: true, sessionKey: 'main', cursor: '1', runId: 'run-1' },
  }));
  vi.stubGlobal('fetch', fetchMock);

  vi.doMock('@/features/chat/runtime/useChatRuntime', () => ({
    useChatRuntime: vi.fn(() => runtimeState),
  }));

  vi.doMock('@/features/voice/audio-feedback', () => ({
    playPing: playPingMock,
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
      soundEnabled: options.soundEnabled ?? false,
      speak: speakMock,
    }),
  }));

  const mod = await import('./ChatContext');
  return {
    ...mod,
    speakMock,
    playPingMock,
    fetchMock,
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

function findRuntimeSendRequestBody(fetchMock: ReturnType<typeof vi.fn>): { idempotencyKey: string } {
  const sendCall = fetchMock.mock.calls.find(([input, init]) => {
    const body = (init as RequestInit | undefined)?.body;
    return requestUrl(input).includes('/api/chat-runtime/sessions/')
      && typeof body === 'string'
      && body.includes('"idempotencyKey"');
  });

  expect(sendCall).toBeDefined();
  const body = (sendCall?.[1] as RequestInit | undefined)?.body;
  if (typeof body !== 'string') {
    throw new Error('Expected runtime chat send request body');
  }
  return JSON.parse(body) as { idempotencyKey: string };
}

function requestUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (input && typeof input === 'object' && 'url' in input) {
    const url = (input as { url?: unknown }).url;
    return typeof url === 'string' ? url : '';
  }
  return '';
}
