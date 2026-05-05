/** Regression test: ChatContext should not subscribe to gateway chat events for rendering. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import type { ImageAttachment } from '@/features/chat/types';

describe('ChatContext subscription stability', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function setup() {
    const subscribeMock = vi.fn(() => () => {});
    const rpcMock = vi.fn(async () => ({}));
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, sessionKey: 'main', cursor: '1', runId: 'run-1' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

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
        sessions: [],
      }),
    }));

    vi.doMock('./SettingsContext', () => ({
      useSettings: () => ({
        soundEnabled: false,
        speak: vi.fn(),
      }),
    }));

    const mod = await import('./ChatContext');
    return { ...mod, fetchMock, rpcMock, subscribeMock };
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

  it('uses gateway send fallback for image messages without runtime POST duplication', async () => {
    const { ChatProvider, useChat, fetchMock, rpcMock, subscribeMock } = await setup();

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
    fetchMock.mockClear();
    rpcMock.mockClear();

    const image: ImageAttachment = {
      id: 'img-1',
      mimeType: 'image/png',
      content: 'base64-image',
      preview: 'data:image/png;base64,base64-image',
      name: 'image.png',
    };
    await act(async () => {
      await send!('look at this', [image]);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith('chat.send', expect.objectContaining({
      sessionKey: 'main',
      message: 'look at this',
      deliver: false,
      attachments: [{ mimeType: 'image/png', content: 'base64-image' }],
    }));
    expect(subscribeMock).not.toHaveBeenCalled();
  });
});
