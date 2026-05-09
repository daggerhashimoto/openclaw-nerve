/** Regression test: ChatContext should not subscribe to gateway chat events for rendering. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import type { ImageAttachment, OutgoingUploadPayload } from '@/features/chat/types';

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
});
