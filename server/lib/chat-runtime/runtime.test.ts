import { describe, expect, it, vi } from 'vitest';
import { UPLOAD_MANIFEST_CLOSE, UPLOAD_MANIFEST_OPEN } from '../../../shared/chat-upload-manifest.js';
import { ChatRuntime } from './runtime.js';

describe('ChatRuntime', () => {
  it('binds attachment-only active history snapshots to the running turn', async () => {
    const sessionKey = 'agent:main:main';
    const rpc = vi.fn(async (method: string) => {
      expect(method).toBe('chat.history');
      return {
        messages: [
          {
            role: 'user',
            timestamp: 1100,
            content: `\n\n${UPLOAD_MANIFEST_OPEN}{"version":1,"attachments":[{"id":"att-1"}]}${UPLOAD_MANIFEST_CLOSE}`,
          },
          {
            role: 'assistant',
            timestamp: 1200,
            content: 'I can see the image.',
          },
        ],
      };
    });
    const runtime = new ChatRuntime({ rpc, maxPatchesPerSession: 20 });

    runtime.applyOptimisticUserMessage({
      sessionKey,
      text: '',
      idempotencyKey: 'idem-image-only',
      images: [{
        mimeType: 'image/png',
        content: 'aW1hZ2U=',
        preview: 'data:image/png;base64,aW1hZ2U=',
        name: 'image.png',
      }],
      at: 1000,
    });
    runtime.bindRunIdToOptimisticUserMessage({
      sessionKey,
      idempotencyKey: 'idem-image-only',
      runId: 'run-image-only',
      at: 1001,
    });

    await runtime.hydrateSession(sessionKey);

    const snapshot = runtime.snapshot(sessionKey, 'manual');
    const assistant = Object.values(snapshot.timeline.items).find((item) => item.kind === 'assistant_message');
    const user = Object.values(snapshot.timeline.items).find((item) => item.kind === 'user_message');
    const turn = snapshot.timeline.turns.find((candidate) => candidate.runId === 'run-image-only');

    expect(assistant).toMatchObject({
      kind: 'assistant_message',
      runId: 'run-image-only',
      text: 'I can see the image.',
      status: 'complete',
    });
    expect(user).toMatchObject({
      kind: 'user_message',
      runId: 'run-image-only',
      text: '',
      images: [expect.objectContaining({ name: 'image.png' })],
    });
    expect(turn).toMatchObject({ runId: 'run-image-only', status: 'finalized' });
  });

  it('binds attachment-only active history snapshots when the manifest is inside a text block', async () => {
    const sessionKey = 'agent:block-manifest:main';
    const rpc = vi.fn(async (method: string) => {
      expect(method).toBe('chat.history');
      return {
        messages: [
          {
            role: 'user',
            timestamp: 1100,
            content: [
              {
                type: 'text',
                text: `${UPLOAD_MANIFEST_OPEN}{"version":1,"attachments":[{"id":"att-1"}]}${UPLOAD_MANIFEST_CLOSE}`,
              },
            ],
          },
          {
            role: 'assistant',
            timestamp: 1200,
            content: 'I can use the attachment.',
          },
        ],
      };
    });
    const runtime = new ChatRuntime({ rpc, maxPatchesPerSession: 20 });

    runtime.applyOptimisticUserMessage({
      sessionKey,
      text: '',
      idempotencyKey: 'idem-block-manifest',
      uploadAttachments: [{
        id: 'att-1',
        origin: 'upload',
        mode: 'file_reference',
        name: 'notes.txt',
        mimeType: 'text/plain',
        sizeBytes: 64,
        policy: { forwardToSubagents: false },
      }],
      at: 1000,
    });
    runtime.bindRunIdToOptimisticUserMessage({
      sessionKey,
      idempotencyKey: 'idem-block-manifest',
      runId: 'run-block-manifest',
      at: 1001,
    });

    await runtime.hydrateSession(sessionKey);

    const snapshot = runtime.snapshot(sessionKey, 'manual');
    const assistant = Object.values(snapshot.timeline.items).find((item) => item.kind === 'assistant_message');
    const user = Object.values(snapshot.timeline.items).find((item) => item.kind === 'user_message');
    const turn = snapshot.timeline.turns.find((candidate) => candidate.runId === 'run-block-manifest');

    expect(assistant).toMatchObject({
      kind: 'assistant_message',
      runId: 'run-block-manifest',
      text: 'I can use the attachment.',
      status: 'complete',
    });
    expect(user).toMatchObject({
      kind: 'user_message',
      runId: 'run-block-manifest',
      text: '',
      uploadAttachments: [expect.objectContaining({ id: 'att-1' })],
    });
    expect(turn).toMatchObject({ runId: 'run-block-manifest', status: 'finalized' });
  });

  it('binds voice active history snapshots after the gateway appends the TTS system hint', async () => {
    const sessionKey = 'agent:voice:main';
    const rpc = vi.fn(async (method: string) => {
      expect(method).toBe('chat.history');
      return {
        messages: [
          {
            role: 'user',
            timestamp: 1100,
            content: '[voice] summarize this\n\n[system: User sent a voice message. Always include your full text reply AND a [tts:...] marker.]',
          },
          {
            role: 'assistant',
            timestamp: 1200,
            content: 'Summary complete.\n\n[tts: Summary complete.]',
          },
        ],
      };
    });
    const runtime = new ChatRuntime({ rpc, maxPatchesPerSession: 20 });

    runtime.applyOptimisticUserMessage({
      sessionKey,
      text: '[voice] summarize this',
      idempotencyKey: 'idem-voice',
      at: 1000,
    });
    runtime.bindRunIdToOptimisticUserMessage({
      sessionKey,
      idempotencyKey: 'idem-voice',
      runId: 'run-voice',
      at: 1001,
    });

    await runtime.hydrateSession(sessionKey);

    const snapshot = runtime.snapshot(sessionKey, 'manual');
    const assistant = Object.values(snapshot.timeline.items).find((item) => item.kind === 'assistant_message');
    const user = Object.values(snapshot.timeline.items).find((item) => item.kind === 'user_message');
    const turn = snapshot.timeline.turns.find((candidate) => candidate.runId === 'run-voice');

    expect(assistant).toMatchObject({
      kind: 'assistant_message',
      runId: 'run-voice',
      text: 'Summary complete.\n\n[tts: Summary complete.]',
      status: 'complete',
    });
    expect(user).toMatchObject({
      kind: 'user_message',
      runId: 'run-voice',
      text: '[voice] summarize this',
      idempotencyKey: 'idem-voice',
    });
    expect(turn).toMatchObject({ runId: 'run-voice', status: 'finalized' });
  });
});
