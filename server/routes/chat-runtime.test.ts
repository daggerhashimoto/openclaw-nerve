import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplayResult } from '../lib/chat-runtime/replay-buffer.js';
import type { TimelinePatch, TimelineSnapshot } from '../lib/chat-runtime/types.js';

type TimelineSubscriber = (patch: TimelinePatch) => void;

interface FakeRuntime {
  hydrateSession: ReturnType<typeof vi.fn>;
  replayAfter: ReturnType<typeof vi.fn>;
  snapshot: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  applyOptimisticUserMessage: ReturnType<typeof vi.fn>;
  bindRunIdToOptimisticUserMessage: ReturnType<typeof vi.fn>;
  failOptimisticUserMessage: ReturnType<typeof vi.fn>;
  emitPatch: (patch: TimelinePatch) => void;
}

let getChatRuntimeMock: ReturnType<typeof vi.fn>;
let gatewayRpcCallMock: ReturnType<typeof vi.fn>;

describe('chat runtime routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rejects missing or blank stream sessionKey with 400 JSON', async () => {
    const { app } = await buildRouteApp();

    for (const path of ['/api/chat-runtime/stream', '/api/chat-runtime/stream?sessionKey=%20%20']) {
      const res = await app.request(path);
      expect(res.status).toBe(400);
      const json = await res.json() as { ok: boolean; error: string };
      expect(json.ok).toBe(false);
      expect(json.error).toContain('sessionKey');
    }
  });

  it('sets stream headers and sends an initial connected event', async () => {
    const { app, runtime } = await buildRouteApp();
    const res = await app.request('/api/chat-runtime/stream?sessionKey=agent%3Amain%3Amain');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('Connection')).toBe('keep-alive');
    expect(res.headers.get('X-Accel-Buffering')).toBe('no');

    const reader = res.body!.getReader();
    try {
      const events = await readUntilEvent(reader, 'connected');
      expect(events).toContainEqual({
        event: 'connected',
        data: {
          type: 'connected',
          sessionKey: 'agent:main:main',
          ts: expect.any(Number),
        },
      });
      expect(runtime.hydrateSession).toHaveBeenCalledWith('agent:main:main');
      expect(runtime.replayAfter).toHaveBeenCalledWith('agent:main:main', null);
      expect(runtime.snapshot).not.toHaveBeenCalled();
    } finally {
      await reader.cancel();
    }
  });

  it('parses SSE events split across stream chunks', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: patch\ndata: {"sessionKey":"session-1",'));
        controller.enqueue(encoder.encode('"cursor":"1","ops":[],"createdAt":1}\n\n'));
      },
    });

    const events = await readUntilEvent(stream.getReader(), 'patch');

    expect(events).toContainEqual({
      event: 'patch',
      data: {
        sessionKey: 'session-1',
        cursor: '1',
        ops: [],
        createdAt: 1,
      },
    });
  });

  it('hydrates before replaying retained patches and subscribing', async () => {
    const replayedPatch = createPatch('session-1', '4');
    const runtime = createFakeRuntime({
      replayAfter: vi.fn((): ReplayResult => ({ kind: 'patches', patches: [replayedPatch] })),
    });
    const { app } = await buildRouteApp(runtime);
    const res = await app.request('/api/chat-runtime/stream?sessionKey=session-1&cursor=3');
    const reader = res.body!.getReader();

    try {
      const events = await readUntilEvent(reader, 'patch');
      expect(events).toContainEqual({ event: 'patch', data: replayedPatch });
      expect(runtime.replayAfter).toHaveBeenCalledWith('session-1', '3');
      await waitFor(() => expect(runtime.subscribe).toHaveBeenCalledWith('session-1', expect.any(Function)));

      const hydrateOrder = runtime.hydrateSession.mock.invocationCallOrder[0];
      const replayOrder = runtime.replayAfter.mock.invocationCallOrder[0];
      const subscribeOrder = runtime.subscribe.mock.invocationCallOrder[0];
      expect(hydrateOrder).toBeLessThan(replayOrder);
      expect(subscribeOrder).toBeLessThan(replayOrder);
    } finally {
      await reader.cancel();
    }
  });

  it('sends a cursor_expired snapshot when replay requires one', async () => {
    const snapshot = createSnapshot('session-2', '9', 'cursor_expired');
    const runtime = createFakeRuntime({
      replayAfter: vi.fn((): ReplayResult => ({ kind: 'snapshot_required' })),
      snapshot: vi.fn(() => snapshot),
    });
    const { app } = await buildRouteApp(runtime);
    const res = await app.request('/api/chat-runtime/stream?sessionKey=session-2&cursor=%20%20');
    const reader = res.body!.getReader();

    try {
      const events = await readUntilEvent(reader, 'snapshot');
      expect(events).toContainEqual({ event: 'snapshot', data: snapshot });
      expect(runtime.replayAfter).toHaveBeenCalledWith('session-2', null);
      expect(runtime.snapshot).toHaveBeenCalledWith('session-2', 'cursor_expired');
    } finally {
      await reader.cancel();
    }
  });

  it('queues live patches emitted in a microtask after replay lookup until replay is written', async () => {
    const runtime = createFakeRuntime();
    const replayedPatch = createPatch('session-race', '4');
    const livePatch = createPatch('session-race', '5');
    runtime.replayAfter.mockImplementation((): ReplayResult => {
      queueMicrotask(() => queueMicrotask(() => runtime.emitPatch(livePatch)));
      return { kind: 'patches', patches: [replayedPatch] };
    });
    const { app } = await buildRouteApp(runtime);
    const res = await app.request('/api/chat-runtime/stream?sessionKey=session-race&cursor=3');
    const reader = res.body!.getReader();

    try {
      const events = await readUntilEventCount(reader, 'patch', 2);
      expect(events.filter((event) => event.event === 'patch').map((event) => (event.data as TimelinePatch).cursor)).toEqual([
        '4',
        '5',
      ]);
    } finally {
      await reader.cancel();
    }
  });

  it('queues synchronously reentrant live patches emitted during replay lookup', async () => {
    const runtime = createFakeRuntime();
    const replayedPatch = createPatch('session-sync-race', '4');
    const livePatch = createPatch('session-sync-race', '5');
    runtime.replayAfter.mockImplementation((): ReplayResult => {
      runtime.emitPatch(livePatch);
      return { kind: 'patches', patches: [replayedPatch] };
    });
    const { app } = await buildRouteApp(runtime);
    const res = await app.request('/api/chat-runtime/stream?sessionKey=session-sync-race&cursor=3');
    const reader = res.body!.getReader();

    try {
      const events = await readUntilEventCount(reader, 'patch', 2);
      expect(events.filter((event) => event.event === 'patch').map((event) => (event.data as TimelinePatch).cursor)).toEqual([
        '4',
        '5',
      ]);
    } finally {
      await reader.cancel();
    }
  });

  it('queues live patches emitted around snapshot fallback until the snapshot is written', async () => {
    const runtime = createFakeRuntime();
    const snapshot = createSnapshot('session-snapshot-race', '9', 'cursor_expired');
    const livePatch = createPatch('session-snapshot-race', '10');
    runtime.replayAfter.mockReturnValue({ kind: 'snapshot_required' });
    runtime.snapshot.mockImplementation(() => {
      queueMicrotask(() => runtime.emitPatch(livePatch));
      return snapshot;
    });
    const { app } = await buildRouteApp(runtime);
    const res = await app.request('/api/chat-runtime/stream?sessionKey=session-snapshot-race&cursor=1');
    const reader = res.body!.getReader();

    try {
      const events = await readUntilEvent(reader, 'patch');
      expect(events.filter((event) => event.event === 'snapshot').map((event) => (event.data as TimelineSnapshot).cursor)).toEqual(['9']);
      expect(events.filter((event) => event.event === 'patch').map((event) => (event.data as TimelinePatch).cursor)).toEqual(['10']);
    } finally {
      await reader.cancel();
    }
  });

  it('queues synchronously reentrant live patches emitted during snapshot fallback', async () => {
    const runtime = createFakeRuntime();
    const snapshot = createSnapshot('session-sync-snapshot-race', '9', 'cursor_expired');
    const livePatch = createPatch('session-sync-snapshot-race', '10');
    runtime.replayAfter.mockReturnValue({ kind: 'snapshot_required' });
    runtime.snapshot.mockImplementation(() => {
      runtime.emitPatch(livePatch);
      return snapshot;
    });
    const { app } = await buildRouteApp(runtime);
    const res = await app.request('/api/chat-runtime/stream?sessionKey=session-sync-snapshot-race&cursor=1');
    const reader = res.body!.getReader();

    try {
      const events = await readUntilEvent(reader, 'patch');
      expect(events.filter((event) => event.event === 'snapshot').map((event) => (event.data as TimelineSnapshot).cursor)).toEqual(['9']);
      expect(events.filter((event) => event.event === 'patch').map((event) => (event.data as TimelinePatch).cursor)).toEqual(['10']);
    } finally {
      await reader.cancel();
    }
  });

  it('sends a structured SSE error when hydration fails', async () => {
    const runtime = createFakeRuntime({
      hydrateSession: vi.fn(async () => {
        throw new Error('history rpc failed');
      }),
    });
    const { app } = await buildRouteApp(runtime);
    const res = await app.request('/api/chat-runtime/stream?sessionKey=session-hydrate-fail&cursor=0');
    const reader = res.body!.getReader();

    try {
      const events = await readUntilEvent(reader, 'error');
      expect(events).toContainEqual({
        event: 'error',
        data: {
          type: 'error',
          sessionKey: 'session-hydrate-fail',
          error: 'history rpc failed',
          ts: expect.any(Number),
        },
      });
      expect(runtime.replayAfter).not.toHaveBeenCalled();
      expect(runtime.subscribe).not.toHaveBeenCalled();
    } finally {
      await reader.cancel();
    }
  });

  it('forwards live patches after subscription', async () => {
    const runtime = createFakeRuntime();
    const { app } = await buildRouteApp(runtime);
    const res = await app.request('/api/chat-runtime/stream?sessionKey=session-live&cursor=0');
    const reader = res.body!.getReader();

    try {
      await readUntilEvent(reader, 'connected');
      await waitFor(() => expect(runtime.subscribe).toHaveBeenCalled());

      const livePatch = createPatch('session-live', '12');
      runtime.emitPatch(livePatch);

      const events = await readUntilEvent(reader, 'patch');
      expect(events).toContainEqual({ event: 'patch', data: livePatch });
    } finally {
      await reader.cancel();
    }
  });

  it('unsubscribes when the stream is aborted', async () => {
    const unsubscribe = vi.fn();
    const runtime = createFakeRuntime({
      subscribe: vi.fn(() => unsubscribe),
    });
    const { app } = await buildRouteApp(runtime);
    const res = await app.request('/api/chat-runtime/stream?sessionKey=session-abort&cursor=0');
    const reader = res.body!.getReader();

    await readUntilEvent(reader, 'connected');
    await waitFor(() => expect(runtime.subscribe).toHaveBeenCalled());
    await reader.cancel();
    await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
  });

  it('sends ping keepalives every 30 seconds', async () => {
    vi.useFakeTimers();
    const { app } = await buildRouteApp();
    const res = await app.request('/api/chat-runtime/stream?sessionKey=session-ping&cursor=0');
    const reader = res.body!.getReader();

    try {
      await readUntilEvent(reader, 'connected');
      await vi.advanceTimersByTimeAsync(30_000);

      const events = await readUntilEvent(reader, 'ping');
      expect(events).toContainEqual({
        event: 'ping',
        data: { type: 'ping', ts: expect.any(Number) },
      });
    } finally {
      await reader.cancel();
    }
  });

  it('rejects invalid message bodies with 400 JSON', async () => {
    const { app } = await buildRouteApp();

    const invalidRequests: RequestInit[] = [
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' },
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: 'idem-1' }) },
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '   ', idempotencyKey: 'idem-blank' }) },
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'hello', idempotencyKey: '   ' }) },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'hello',
          idempotencyKey: 'idem-external-preview',
          images: [{
            mimeType: 'image/png',
            content: 'base64-image',
            preview: 'https://example.test/tracker.png',
          }],
        }),
      },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'hello',
          idempotencyKey: 'idem-bad-upload',
          uploadPayload: {
            descriptors: [{ name: 'missing-required-fields.png' }],
            manifest: {
              enabled: true,
              exposeInlineBase64ToAgent: false,
              allowSubagentForwarding: false,
            },
          },
        }),
      },
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'hello',
          idempotencyKey: 'idem-uppercase-inline-mode',
          uploadPayload: {
            descriptors: [{
              id: 'att-uppercase-inline',
              origin: 'upload',
              mode: 'INLINE',
              name: 'image.png',
              mimeType: 'image/png',
              sizeBytes: 100,
              inline: {
                encoding: 'base64',
                base64: 'base64-image',
                base64Bytes: 100,
                previewUrl: 'data:image/png;base64,base64-image',
                compressed: false,
              },
              policy: { forwardToSubagents: false },
            }],
            manifest: {
              enabled: true,
              exposeInlineBase64ToAgent: false,
              allowSubagentForwarding: false,
            },
          },
        }),
      },
    ];

    for (const init of invalidRequests) {
      const res = await app.request('/api/chat-runtime/sessions/session-post/messages', init);
      expect(res.status).toBe(400);
      const json = await res.json() as { ok: boolean; error: string };
      expect(json.ok).toBe(false);
      expect(json.error).toBeTruthy();
    }
  });

  it('rejects image and upload payloads over the chat runtime schema limit', async () => {
    const originalInlineLimit = process.env.NERVE_UPLOAD_INLINE_ATTACHMENT_MAX_MB;
    const originalMetadataLimit = process.env.NERVE_UPLOAD_INLINE_IMAGE_CONTEXT_MAX_BYTES;
    process.env.NERVE_UPLOAD_INLINE_ATTACHMENT_MAX_MB = '0.000001';
    process.env.NERVE_UPLOAD_INLINE_IMAGE_CONTEXT_MAX_BYTES = '128';

    try {
      const { app } = await buildRouteApp();
      const invalidRequests: RequestInit[] = [
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: 'hello',
            idempotencyKey: 'idem-large-image',
            images: [{ mimeType: 'image/png', content: 'abcde' }],
          }),
        },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: 'hello',
            idempotencyKey: 'idem-large-preview',
            images: [{ mimeType: 'image/png', content: 'AA', preview: `data:image/png;base64,${'A'.repeat(200)}` }],
          }),
        },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: 'hello',
            idempotencyKey: 'idem-large-image-name',
            images: [{ mimeType: 'image/png', content: 'AA', name: 'A'.repeat(500) }],
          }),
        },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: 'hello',
            idempotencyKey: 'idem-large-inline',
            uploadPayload: {
              descriptors: [
                {
                  id: 'att-large',
                  origin: 'upload',
                  mode: 'inline',
                  name: 'large.png',
                  mimeType: 'image/png',
                  sizeBytes: 4,
                  inline: {
                    encoding: 'base64',
                    base64: 'abcd',
                    base64Bytes: 4,
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
            },
          }),
        },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: 'hello',
            idempotencyKey: 'idem-large-upload-metadata',
            uploadPayload: {
              descriptors: [
                {
                  id: 'att-large-metadata',
                  origin: 'upload',
                  mode: 'file_reference',
                  name: 'large-metadata.png',
                  mimeType: 'image/png',
                  sizeBytes: 4,
                  reference: {
                    kind: 'local_path',
                    path: `/workspace/${'A'.repeat(200)}.png`,
                    uri: `file:///workspace/${'A'.repeat(200)}.png`,
                  },
                  preparation: { reason: 'A'.repeat(200) },
                  policy: { forwardToSubagents: false },
                },
              ],
              manifest: {
                enabled: true,
                exposeInlineBase64ToAgent: false,
                allowSubagentForwarding: false,
              },
            },
          }),
        },
      ];

      for (const init of invalidRequests) {
        const res = await app.request('/api/chat-runtime/sessions/session-post/messages', init);
        expect(res.status).toBe(400);
        const json = await res.json() as { ok: boolean; error: string };
        expect(json.ok).toBe(false);
        expect(json.error).toBeTruthy();
      }
    } finally {
      if (originalInlineLimit === undefined) {
        delete process.env.NERVE_UPLOAD_INLINE_ATTACHMENT_MAX_MB;
      } else {
        process.env.NERVE_UPLOAD_INLINE_ATTACHMENT_MAX_MB = originalInlineLimit;
      }
      if (originalMetadataLimit === undefined) {
        delete process.env.NERVE_UPLOAD_INLINE_IMAGE_CONTEXT_MAX_BYTES;
      } else {
        process.env.NERVE_UPLOAD_INLINE_IMAGE_CONTEXT_MAX_BYTES = originalMetadataLimit;
      }
    }
  });

  it('accepts padded base64 content at the configured byte limit', async () => {
    const originalInlineLimit = process.env.NERVE_UPLOAD_INLINE_ATTACHMENT_MAX_MB;
    process.env.NERVE_UPLOAD_INLINE_ATTACHMENT_MAX_MB = '0.000001';

    try {
      const runtime = createFakeRuntime();
      const { app } = await buildRouteApp(runtime);
      gatewayRpcCallMock.mockResolvedValue({ runId: 'run-one-byte-image' });

      const res = await app.request('/api/chat-runtime/sessions/agent%3Amain%3Amain/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'one byte image',
          idempotencyKey: 'idem-one-byte-image',
          images: [{ mimeType: 'image/png', content: 'AA==' }],
        }),
      });

      expect(res.status).toBe(200);
      expect(runtime.applyOptimisticUserMessage).toHaveBeenCalledWith(expect.objectContaining({
        images: [
          expect.objectContaining({
            mimeType: 'image/png',
            content: 'AA==',
            preview: 'data:image/png;base64,AA==',
          }),
        ],
      }));
    } finally {
      if (originalInlineLimit === undefined) {
        delete process.env.NERVE_UPLOAD_INLINE_ATTACHMENT_MAX_MB;
      } else {
        process.env.NERVE_UPLOAD_INLINE_ATTACHMENT_MAX_MB = originalInlineLimit;
      }
    }
  });

  it('applies an optimistic user message, sends chat.send, and returns cursor/runId', async () => {
    const optimisticPatch = createPatch('agent:main:main', '17');
    const runBindingPatch = createPatch('agent:main:main', '18');
    const runtime = createFakeRuntime({
      applyOptimisticUserMessage: vi.fn(() => optimisticPatch),
      bindRunIdToOptimisticUserMessage: vi.fn(() => runBindingPatch),
    });
    const { app } = await buildRouteApp(runtime);
    gatewayRpcCallMock.mockResolvedValue({ runId: 'run-123' });

    const res = await app.request('/api/chat-runtime/sessions/agent%3Amain%3Amain/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello runtime', idempotencyKey: 'idem-123' }),
    });

    expect(res.status).toBe(200);
    expect(runtime.applyOptimisticUserMessage).toHaveBeenNthCalledWith(1, {
      sessionKey: 'agent:main:main',
      text: 'hello runtime',
      idempotencyKey: 'idem-123',
    });
    expect(gatewayRpcCallMock).toHaveBeenCalledWith('chat.send', {
      sessionKey: 'agent:main:main',
      message: 'hello runtime',
      deliver: false,
      idempotencyKey: 'idem-123',
    });
    expect(runtime.applyOptimisticUserMessage).toHaveBeenCalledTimes(1);
    expect(runtime.bindRunIdToOptimisticUserMessage).toHaveBeenCalledWith({
      sessionKey: 'agent:main:main',
      idempotencyKey: 'idem-123',
      runId: 'run-123',
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      sessionKey: 'agent:main:main',
      runId: 'run-123',
      cursor: '18',
    });
  });

  it('applies media metadata to optimistic runtime sends and forwards gateway attachments', async () => {
    const optimisticPatch = createPatch('agent:main:main', '17');
    const runBindingPatch = createPatch('agent:main:main', '18');
    const runtime = createFakeRuntime({
      applyOptimisticUserMessage: vi.fn(() => optimisticPatch),
      bindRunIdToOptimisticUserMessage: vi.fn(() => runBindingPatch),
    });
    const { app } = await buildRouteApp(runtime);
    gatewayRpcCallMock.mockResolvedValue({ runId: 'run-media' });

    const res = await app.request('/api/chat-runtime/sessions/agent%3Amain%3Amain/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'look at this',
        idempotencyKey: 'idem-media',
        images: [
          {
            mimeType: 'image/png',
            content: 'base64-image',
            preview: 'data:image/png;base64,base64-image',
            name: 'image.png',
          },
        ],
        uploadPayload: {
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
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(runtime.applyOptimisticUserMessage).toHaveBeenNthCalledWith(1, {
      sessionKey: 'agent:main:main',
      text: 'look at this',
      idempotencyKey: 'idem-media',
      images: [
        {
          mimeType: 'image/png',
          content: 'base64-image',
          preview: 'data:image/png;base64,base64-image',
          name: 'image.png',
        },
      ],
      uploadAttachments: [
        expect.objectContaining({ id: 'att-1', name: 'image.png' }),
      ],
    });
    expect(gatewayRpcCallMock).toHaveBeenCalledWith('chat.send', expect.objectContaining({
      sessionKey: 'agent:main:main',
      message: expect.stringContaining('<nerve-upload-manifest>'),
      deliver: false,
      idempotencyKey: 'idem-media',
      attachments: [{ mimeType: 'image/png', content: 'base64-image' }],
    }));
    const gatewayMessage = gatewayRpcCallMock.mock.calls[0]?.[1]?.message as string;
    expect(gatewayMessage).toContain('"base64":""');
    expect(runtime.applyOptimisticUserMessage).toHaveBeenCalledTimes(1);
    expect(runtime.bindRunIdToOptimisticUserMessage).toHaveBeenCalledWith({
      sessionKey: 'agent:main:main',
      idempotencyKey: 'idem-media',
      runId: 'run-media',
    });
  });

  it('redacts inline upload descriptor data before writing optimistic runtime state', async () => {
    const runtime = createFakeRuntime();
    const { app } = await buildRouteApp(runtime);
    gatewayRpcCallMock.mockResolvedValue({ runId: 'run-redacted-media' });

    const res = await app.request('/api/chat-runtime/sessions/agent%3Amain%3Amain/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'look at this',
        idempotencyKey: 'idem-redacted-media',
        uploadPayload: {
          descriptors: [
            {
              id: 'att-redacted',
              origin: 'upload',
              mode: 'inline',
              name: 'image.png',
              mimeType: 'image/png',
              sizeBytes: 100,
              inline: {
                encoding: 'base64',
                base64: 'base64-image',
                base64Bytes: 100,
                previewUrl: 'data:image/png;base64,base64-image',
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
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(runtime.applyOptimisticUserMessage).toHaveBeenCalledWith(expect.objectContaining({
      uploadAttachments: [
        expect.objectContaining({
          inline: expect.objectContaining({
            base64: '',
            base64Bytes: 100,
            previewUrl: undefined,
          }),
        }),
      ],
    }));
  });

  it('accepts image-only runtime sends', async () => {
    const runtime = createFakeRuntime();
    const { app } = await buildRouteApp(runtime);
    gatewayRpcCallMock.mockResolvedValue({ runId: 'run-image-only' });

    const res = await app.request('/api/chat-runtime/sessions/agent%3Amain%3Amain/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '',
        idempotencyKey: 'idem-image-only',
        images: [
          {
            mimeType: 'image/png',
            content: 'base64-image',
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(runtime.applyOptimisticUserMessage).toHaveBeenNthCalledWith(1, {
      sessionKey: 'agent:main:main',
      text: '',
      idempotencyKey: 'idem-image-only',
      images: [
        {
          mimeType: 'image/png',
          content: 'base64-image',
          preview: 'data:image/png;base64,base64-image',
          name: 'image',
        },
      ],
    });
    expect(gatewayRpcCallMock).toHaveBeenCalledWith('chat.send', expect.objectContaining({
      message: '',
      attachments: [{ mimeType: 'image/png', content: 'base64-image' }],
    }));
  });

  it('marks the server-side optimistic message failed when chat.send fails', async () => {
    const optimisticPatch = createPatch('session-fail', '18');
    const failedPatch = createPatch('session-fail', '19');
    const runtime = createFakeRuntime({
      applyOptimisticUserMessage: vi.fn(() => optimisticPatch),
      failOptimisticUserMessage: vi.fn(() => failedPatch),
    });
    const { app } = await buildRouteApp(runtime);
    gatewayRpcCallMock.mockRejectedValue(new Error('gateway unavailable'));

    const res = await app.request('/api/chat-runtime/sessions/session-fail/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello runtime', idempotencyKey: 'idem-fail' }),
    });

    expect(runtime.applyOptimisticUserMessage).toHaveBeenCalledTimes(1);
    expect(runtime.failOptimisticUserMessage).toHaveBeenCalledWith({
      sessionKey: 'session-fail',
      idempotencyKey: 'idem-fail',
      error: 'chat.send failed: gateway unavailable',
    });
    expect(gatewayRpcCallMock).toHaveBeenCalledWith('chat.send', {
      sessionKey: 'session-fail',
      message: 'hello runtime',
      deliver: false,
      idempotencyKey: 'idem-fail',
    });
    expect(res.status).toBe(502);
    const json = await res.json() as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toContain('chat.send failed');
  });

  it('mounts the route in server app without applying compression to the SSE stream', async () => {
    const runtime = createFakeRuntime();
    await mockRuntimeModules(runtime);
    vi.doMock('hono/compress', () => ({
      compress: () => async (c: { header: (name: string, value: string) => void }, next: () => Promise<void>) => {
        c.header('X-Test-Compression', 'applied');
        await next();
      },
    }));

    const mod = await import('../app.js');

    const healthRes = await mod.default.request('/api/health');
    expect(healthRes.headers.get('X-Test-Compression')).toBe('applied');

    const res = await mod.default.request('/api/chat-runtime/stream?sessionKey=app-session&cursor=0');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Test-Compression')).toBeNull();

    const reader = res.body!.getReader();
    try {
      await readUntilEvent(reader, 'connected');
    } finally {
      await reader.cancel();
    }
  });

  describe('compareCursor (exported)', () => {
    it('returns 0 for equal numeric cursors', async () => {
      const { compareCursor } = await import('./chat-runtime.js');
      expect(compareCursor('5', '5')).toBe(0);
    });

    it('returns sign-correct delta for numeric cursors', async () => {
      const { compareCursor } = await import('./chat-runtime.js');
      expect(compareCursor('3', '5')).toBeLessThan(0);
      expect(compareCursor('7', '5')).toBeGreaterThan(0);
    });

    it('treats malformed cursors as covered (returns 0) rather than advancing', async () => {
      const { compareCursor } = await import('./chat-runtime.js');
      expect(compareCursor('not-a-number', '5')).toBe(0);
      expect(compareCursor('5', 'also-bad')).toBe(0);
      expect(compareCursor('not-a-number', 'also-bad')).toBe(0);
    });

    it('treats out-of-safe-int cursors as covered', async () => {
      const { compareCursor } = await import('./chat-runtime.js');
      const huge = String(Number.MAX_SAFE_INTEGER) + '0';
      expect(compareCursor(huge, '5')).toBe(0);
    });
  });

  it('does not subscribe after the client aborts mid-hydration', async () => {
    // Documents the invariant that subscribe is never called when the client
    // aborted mid-hydration. Note: today this passes even without the
    // belt-and-suspenders guard at line ~97 of chat-runtime.ts — the line-90
    // guard already catches it. The test exists so a future refactor that
    // introduces a real async step between hydration and subscribe (which
    // would defeat the line-90 guard) cannot land silently.
    const { app, runtime } = await buildRouteApp();
    let hydrationResolve: (() => void) | undefined;
    runtime.hydrateSession.mockImplementation(
      () => new Promise<void>((resolve) => { hydrationResolve = resolve; }),
    );

    // Start the SSE request; the response is returned immediately (streaming).
    const res = await app.request('/api/chat-runtime/stream?sessionKey=agent%3Amain%3Amain');
    const reader = res.body!.getReader();

    // Wait a few microtasks so the SSE handler enters and registers onAbort + awaits hydrate.
    await Promise.resolve();
    await Promise.resolve();

    // Cancel the response reader — this triggers stream.abort() => disconnect().
    await reader.cancel();

    // Now resolve hydration so the post-await code runs.
    hydrationResolve?.();

    // Drain any remaining microtasks.
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.subscribe).not.toHaveBeenCalled();
  });
});

async function buildRouteApp(runtime = createFakeRuntime()) {
  await mockRuntimeModules(runtime);

  const mod = await import('./chat-runtime.js');
  const app = new Hono();
  app.route('/', mod.default);
  return { app, runtime };
}

async function mockRuntimeModules(runtime: FakeRuntime) {
  getChatRuntimeMock = vi.fn(() => runtime);
  gatewayRpcCallMock = vi.fn();
  vi.doMock('../lib/chat-runtime/singleton.js', () => ({ getChatRuntime: getChatRuntimeMock }));
  vi.doMock('../lib/gateway-rpc.js', () => ({ gatewayRpcCall: gatewayRpcCallMock }));
}

function createFakeRuntime(overrides: Partial<FakeRuntime> = {}): FakeRuntime {
  const subscribers = new Set<TimelineSubscriber>();

  const runtime: FakeRuntime = {
    hydrateSession: vi.fn(async () => undefined),
    replayAfter: vi.fn((): ReplayResult => ({ kind: 'patches', patches: [] })),
    snapshot: vi.fn((sessionKey: string, reason: TimelineSnapshot['reason']) => createSnapshot(sessionKey, '0', reason)),
    subscribe: vi.fn((_sessionKey: string, subscriber: TimelineSubscriber) => {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    }),
    applyOptimisticUserMessage: vi.fn(({ sessionKey }: { sessionKey: string }) => createPatch(sessionKey, '1')),
    bindRunIdToOptimisticUserMessage: vi.fn(({ sessionKey }: { sessionKey: string }) => createPatch(sessionKey, '3')),
    failOptimisticUserMessage: vi.fn(({ sessionKey }: { sessionKey: string }) => createPatch(sessionKey, '2')),
    emitPatch: (patch: TimelinePatch) => {
      for (const subscriber of [...subscribers]) subscriber(patch);
    },
    ...overrides,
  };

  return runtime;
}

function createPatch(sessionKey: string, cursor: string): TimelinePatch {
  return {
    sessionKey,
    cursor,
    createdAt: 1_775_000_000_000,
    ops: [{ op: 'set_hydration_state', state: 'ready' }],
  };
}

function createSnapshot(
  sessionKey: string,
  cursor: string,
  reason: TimelineSnapshot['reason'],
): TimelineSnapshot {
  return {
    type: 'snapshot',
    sessionKey,
    cursor,
    reason,
    timeline: {
      sessionKey,
      version: 1,
      cursor,
      hydrationState: 'ready',
      turns: [],
      items: {},
      updatedAt: 1_775_000_000_000,
    },
  };
}

async function readUntilEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  eventName: string,
): Promise<Array<{ event: string; data: unknown }>> {
  return readUntilEventCount(reader, eventName, 1);
}

async function readUntilEventCount(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  eventName: string,
  count: number,
): Promise<Array<{ event: string; data: unknown }>> {
  const decoder = new TextDecoder();
  const events: Array<{ event: string; data: unknown }> = [];
  let bufferedText = '';

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { value, done } = await reader.read();
    expect(done).toBe(false);
    bufferedText += decoder.decode(value, { stream: true });
    const [completeText, remainingText] = splitCompleteSseText(bufferedText);
    bufferedText = remainingText;
    events.push(...parseSseEvents(completeText));
    if (events.filter((event) => event.event === eventName).length >= count) return events;
  }

  throw new Error(`SSE event ${eventName} was not received`);
}

function splitCompleteSseText(text: string): [completeText: string, remainingText: string] {
  const lastDelimiterIndex = text.lastIndexOf('\n\n');
  if (lastDelimiterIndex === -1) return ['', text];

  return [
    text.slice(0, lastDelimiterIndex + 2),
    text.slice(lastDelimiterIndex + 2),
  ];
}

function parseSseEvents(text: string): Array<{ event: string; data: unknown }> {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const eventLine = block.split('\n').find((line) => line.startsWith('event: '));
      const dataLines = block
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice('data: '.length));

      return {
        event: eventLine?.slice('event: '.length) ?? '',
        data: JSON.parse(dataLines.join('\n')),
      };
    });
}

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  throw lastError;
}
