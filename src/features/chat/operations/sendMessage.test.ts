/** Tests for sendMessage — message building and RPC sending. */
import { describe, it, expect, vi } from 'vitest';
import {
  appendUploadManifest,
  applyVoiceTTSHint,
  buildUserMessage,
  sendChatMessage,
  sendChatRuntimeMessage,
} from './sendMessage';
import type { OutgoingUploadPayload, UploadAttachmentDescriptor } from '../types';

function makeUploadPayload(overrides: Partial<OutgoingUploadPayload> = {}): OutgoingUploadPayload {
  return {
    descriptors: [
      {
        id: 'att-inline',
        origin: 'upload',
        mode: 'inline',
        name: 'small.png',
        mimeType: 'image/png',
        sizeBytes: 120_000,
        inline: {
          encoding: 'base64',
          base64: 'YmFzZTY0LWJ5dGVz',
          base64Bytes: 12,
          previewUrl: 'data:image/png;base64,abc',
          compressed: true,
        },
        preparation: {
          sourceMode: 'inline',
          finalMode: 'inline',
          outcome: 'optimized_inline',
          originalMimeType: 'image/png',
          originalSizeBytes: 120_000,
          inlineBase64Bytes: 12,
          inlineChosenWidth: 1024,
          inlineChosenHeight: 768,
        },
        policy: {
          forwardToSubagents: false,
        },
      },
      {
        id: 'att-ref',
        origin: 'server_path',
        mode: 'file_reference',
        name: 'capture.mov',
        mimeType: 'video/quicktime',
        sizeBytes: 8_000_000,
        reference: {
          kind: 'local_path',
          path: '/workspace/capture.mov',
          uri: 'file:///workspace/capture.mov',
        },
        policy: {
          forwardToSubagents: false,
        },
      },
    ],
    manifest: {
      enabled: true,
      exposeInlineBase64ToAgent: false,
      allowSubagentForwarding: false,
    },
    ...overrides,
  };
}

function extractManifestAttachments(message: string): UploadAttachmentDescriptor[] {
  const manifestMatch = message.match(/<nerve-upload-manifest>(.*?)<\/nerve-upload-manifest>/);
  expect(manifestMatch?.[1]).toBeTruthy();
  const manifest = JSON.parse(manifestMatch![1]) as { attachments: UploadAttachmentDescriptor[] };
  return manifest.attachments;
}

describe('applyVoiceTTSHint', () => {
  it('appends TTS hint to voice messages', () => {
    const result = applyVoiceTTSHint('[voice] Hello there');
    expect(result).toContain('[voice] Hello there');
    expect(result).toContain('[system: User sent a voice message');
    expect(result).toContain('[tts:');
  });

  it('does not modify non-voice messages', () => {
    const text = 'Hello there';
    expect(applyVoiceTTSHint(text)).toBe(text);
  });

  it('only triggers on exact [voice] prefix', () => {
    expect(applyVoiceTTSHint('voice hello')).toBe('voice hello');
    expect(applyVoiceTTSHint('[VOICE] hello')).toBe('[VOICE] hello');
    expect(applyVoiceTTSHint(' [voice] hello')).toBe(' [voice] hello');
  });
});

describe('appendUploadManifest', () => {
  it('injects the manifest wrapper when enabled', () => {
    const message = appendUploadManifest('hello', makeUploadPayload());
    expect(message).toContain('<nerve-upload-manifest>');
    expect(message).toContain('</nerve-upload-manifest>');
    expect(message).toContain('capture.mov');
  });

  it('hides inline base64 and strips preview data URLs by default while preserving metadata', () => {
    const message = appendUploadManifest('hello', makeUploadPayload());
    const attachments = extractManifestAttachments(message);
    const inlineAttachment = attachments[0];

    expect(message).not.toContain('data:image/');
    expect(inlineAttachment.inline?.base64).toBe('');
    expect(inlineAttachment.inline?.previewUrl).toBeUndefined();
    expect(inlineAttachment.inline?.base64Bytes).toBe(12);
    expect(inlineAttachment.inline?.compressed).toBe(true);
    expect(inlineAttachment.origin).toBe('upload');
    expect(inlineAttachment.preparation?.outcome).toBe('optimized_inline');
    expect(inlineAttachment.preparation?.inlineChosenWidth).toBe(1024);
    expect(inlineAttachment.preparation?.inlineChosenHeight).toBe(768);
  });

  it('includes inline base64 in explicit debug mode but still strips preview URLs', () => {
    const message = appendUploadManifest('hello', makeUploadPayload({
      manifest: {
        enabled: true,
        exposeInlineBase64ToAgent: true,
        allowSubagentForwarding: false,
      },
    }));
    const attachments = extractManifestAttachments(message);
    const inlineAttachment = attachments[0];

    expect(inlineAttachment.inline?.base64).toBe('YmFzZTY0LWJ5dGVz');
    expect(inlineAttachment.inline?.previewUrl).toBeUndefined();
    expect(message).not.toContain('data:image/');
  });

  it('keeps message unchanged when manifest is disabled', () => {
    const message = appendUploadManifest('hello', makeUploadPayload({
      manifest: {
        enabled: false,
        exposeInlineBase64ToAgent: false,
        allowSubagentForwarding: false,
      },
    }));

    expect(message).toBe('hello');
  });
});

describe('buildUserMessage', () => {
  it('creates a message with the correct role and text', () => {
    const { msg, tempId } = buildUserMessage({ text: 'Hello world' });
    expect(msg.role).toBe('user');
    expect(msg.rawText).toBe('Hello world');
    expect(msg.pending).toBe(true);
    expect(msg.tempId).toBe(tempId);
    expect(tempId).toBeTruthy();
  });

  it('generates unique tempIds', () => {
    const a = buildUserMessage({ text: 'a' });
    const b = buildUserMessage({ text: 'b' });
    expect(a.tempId).not.toBe(b.tempId);
  });

  it('sets a timestamp', () => {
    const { msg } = buildUserMessage({ text: 'test' });
    expect(msg.timestamp).toBeInstanceOf(Date);
    expect(msg.timestamp.getTime()).toBeGreaterThan(0);
  });

  it('renders HTML from markdown text', () => {
    const { msg } = buildUserMessage({ text: '**bold**' });
    expect(msg.html).toContain('bold');
  });

  it('includes images when provided', () => {
    const images = [
      { id: '1', mimeType: 'image/png', content: 'base64data', preview: 'data:image/png;base64,x', name: 'test.png' },
    ];
    const { msg } = buildUserMessage({ text: 'look at this', images });
    expect(msg.images).toHaveLength(1);
    expect(msg.images![0].mimeType).toBe('image/png');
    expect(msg.images![0].name).toBe('test.png');
  });

  it('stores upload descriptors for local rendering', () => {
    const uploadPayload = makeUploadPayload();
    const { msg } = buildUserMessage({ text: 'with upload', uploadPayload });
    expect(msg.uploadAttachments).toHaveLength(2);
    expect(msg.uploadAttachments?.[1].mode).toBe('file_reference');
    expect(msg.uploadAttachments?.[1].origin).toBe('server_path');
  });

  it('omits images field when none provided', () => {
    const { msg } = buildUserMessage({ text: 'no images' });
    expect(msg.images).toBeUndefined();
  });

  it('assigns a msgId', () => {
    const { msg } = buildUserMessage({ text: 'test' });
    expect(msg.msgId).toBeTruthy();
  });
});

describe('sendChatMessage', () => {
  it('calls rpc with correct method and params', async () => {
    const rpc = vi.fn().mockResolvedValue({ runId: 'run-1', status: 'started' });

    const result = await sendChatMessage({
      rpc,
      sessionKey: 'session-1',
      text: 'Hello',
      idempotencyKey: 'key-1',
    });

    expect(rpc).toHaveBeenCalledWith('chat.send', expect.objectContaining({
      sessionKey: 'session-1',
      message: 'Hello',
      deliver: false,
      idempotencyKey: 'key-1',
    }));
    expect(result.runId).toBe('run-1');
    expect(result.status).toBe('started');
  });

  it('includes attachments when images are provided', async () => {
    const rpc = vi.fn().mockResolvedValue({});
    const images = [
      { id: '1', mimeType: 'image/jpeg', content: 'b64', preview: '', name: 'pic.jpg' },
    ];

    await sendChatMessage({
      rpc,
      sessionKey: 's1',
      text: 'with image',
      images,
      idempotencyKey: 'k1',
    });

    const callParams = rpc.mock.calls[0][1];
    expect(callParams.attachments).toHaveLength(1);
    expect(callParams.attachments[0].mimeType).toBe('image/jpeg');
    expect(callParams.attachments[0].content).toBe('b64');
  });

  it('injects sanitized upload manifest data into outgoing message body', async () => {
    const rpc = vi.fn().mockResolvedValue({});

    await sendChatMessage({
      rpc,
      sessionKey: 's1',
      text: 'with attachment metadata',
      uploadPayload: makeUploadPayload(),
      idempotencyKey: 'k1',
    });

    const sentMessage = rpc.mock.calls[0][1].message as string;
    const attachments = extractManifestAttachments(sentMessage);
    expect(sentMessage).toContain('<nerve-upload-manifest>');
    expect(sentMessage).toContain('capture.mov');
    expect(attachments[0].inline?.base64).toBe('');
    expect(attachments[0].inline?.previewUrl).toBeUndefined();
    expect(attachments[0].inline?.base64Bytes).toBe(12);
    expect(attachments[1].origin).toBe('server_path');
  });

  it('applies voice TTS hint to voice messages', async () => {
    const rpc = vi.fn().mockResolvedValue({});
    await sendChatMessage({
      rpc,
      sessionKey: 's1',
      text: '[voice] hello',
      idempotencyKey: 'k1',
    });

    const sentMessage = rpc.mock.calls[0][1].message;
    expect(sentMessage).toContain('[system: User sent a voice message');
  });

  it('handles null/empty rpc response gracefully', async () => {
    const rpc = vi.fn().mockResolvedValue(null);
    const result = await sendChatMessage({
      rpc, sessionKey: 's', text: 'hi', idempotencyKey: 'k',
    });
    expect(result.runId).toBeUndefined();
    expect(result.status).toBeUndefined();
  });

  it('validates status field values', async () => {
    const rpc = vi.fn().mockResolvedValue({ status: 'invalid_status' });
    const result = await sendChatMessage({
      rpc, sessionKey: 's', text: 'hi', idempotencyKey: 'k',
    });
    expect(result.status).toBeUndefined();
  });

  it('propagates rpc errors', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('connection failed'));
    await expect(sendChatMessage({
      rpc, sessionKey: 's', text: 'hi', idempotencyKey: 'k',
    })).rejects.toThrow('connection failed');
  });
});

describe('sendChatRuntimeMessage', () => {
  it('posts text messages to the server replay runtime', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ok: true,
        sessionKey: 'agent:main:main',
        cursor: '12',
        runId: 'run-1',
      }),
    });

    const result = await sendChatRuntimeMessage({
      fetchImpl,
      sessionKey: 'agent:main:main',
      text: 'hello runtime',
      idempotencyKey: 'idem-1',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/chat-runtime/sessions/agent%3Amain%3Amain/messages',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hello runtime', idempotencyKey: 'idem-1' }),
      }),
    );
    expect(result).toEqual({
      ok: true,
      sessionKey: 'agent:main:main',
      cursor: '12',
      runId: 'run-1',
    });
  });

  it('sanitizes inline upload descriptors before posting to the server replay runtime', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ok: true,
        sessionKey: 'agent:main:main',
        cursor: '12',
      }),
    });
    const uploadPayload = makeUploadPayload();

    await sendChatRuntimeMessage({
      fetchImpl,
      sessionKey: 'agent:main:main',
      text: 'look at this',
      idempotencyKey: 'idem-image',
      images: [{
        id: 'img-1',
        mimeType: 'image/png',
        content: 'YmFzZTY0LWJ5dGVz',
        preview: 'data:image/png;base64,YmFzZTY0LWJ5dGVz',
        name: 'small.png',
      }],
      uploadPayload,
    });

    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string) as {
      uploadPayload: OutgoingUploadPayload;
    };
    expect(body.uploadPayload.descriptors[0].inline?.base64).toBe('');
    expect(body.uploadPayload.descriptors[0].inline?.previewUrl).toBeUndefined();
    expect(body.uploadPayload.descriptors[0].inline?.base64Bytes).toBe(12);
    expect(body.uploadPayload.descriptors[1].reference).toEqual({
      kind: 'local_path',
      path: '/workspace/capture.mov',
      uri: 'file:///workspace/capture.mov',
    });
  });

  it('throws a useful error when the runtime send fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: vi.fn().mockResolvedValue({ ok: false, error: 'chat.send failed: offline' }),
    });

    await expect(sendChatRuntimeMessage({
      fetchImpl,
      sessionKey: 's1',
      text: 'hello',
      idempotencyKey: 'idem-fail',
    })).rejects.toThrow('chat.send failed: offline');
  });
});
