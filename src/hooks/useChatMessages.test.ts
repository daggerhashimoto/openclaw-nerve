/** Tests for chat message reconciliation helpers. */
import { describe, expect, it } from 'vitest';
import { isLikelyDuplicateMessage, mergeFinalMessages, mergeHistoryMessages } from './useChatMessages';
import type { ChatMsg } from '@/features/chat/types';

function msg(role: ChatMsg['role'], rawText: string, sourceId: string, pending = false): ChatMsg {
  return {
    msgId: `ui-${sourceId}`,
    sourceId,
    role,
    html: rawText,
    rawText,
    timestamp: new Date(1700000000000),
    pending,
    tempId: pending ? `temp-${sourceId}` : undefined,
  };
}

function openclawAssistant(rawText: string, sourceId: string, ts = 1700000000000): ChatMsg {
  return {
    ...msg('assistant', rawText, sourceId),
    timestamp: new Date(ts),
  };
}

describe('chat message reconciliation', () => {
  it('dedupes live final messages by stable identity', () => {
    const existing = [msg('assistant', 'Streaming text', 'assistant-1')];
    const incoming = [msg('assistant', 'Final text', 'assistant-1')];

    const result = mergeFinalMessages(existing, incoming);

    expect(result).toHaveLength(1);
    expect(result[0].rawText).toBe('Final text');
    expect(result[0].msgId).toBe('ui-assistant-1');
  });

  it('replaces a pending optimistic user message when history confirms the same idempotency key', () => {
    const existing = [msg('user', 'hello', 'message:idempotency:ik-1', true)];
    const history = [msg('user', 'hello', 'message:idempotency:ik-1')];

    const result = mergeHistoryMessages(existing, history);

    expect(result).toHaveLength(1);
    expect(result[0].pending).toBe(false);
    expect(result[0].tempId).toBe('temp-message:idempotency:ik-1');
  });

  it('matches optimistic user messages against history aliases when OpenClaw wrapper ids are primary', () => {
    const existing = [msg('user', 'hello', 'message:idempotency:ik-1', true)];
    const history = [{
      ...msg('user', 'hello', 'openclaw:id:wrapper-1'),
      alternateSourceIds: ['message:idempotency:ik-1'],
    }];

    const result = mergeHistoryMessages(existing, history);

    expect(result).toHaveLength(1);
    expect(result[0].sourceId).toBe('openclaw:id:wrapper-1');
    expect(result[0].pending).toBe(false);
  });

  it('preserves existing aliases when history confirms a row with new aliases', () => {
    const existing = [{
      ...msg('user', 'hello', 'openclaw:mirror:local-user', true),
      alternateSourceIds: ['message:idempotency:ik-1'],
    }];
    const history = [{
      ...msg('user', 'hello', 'openclaw:id:wrapper-1'),
      alternateSourceIds: ['openclaw:mirror:local-user'],
    }];

    const result = mergeHistoryMessages(existing, history);

    expect(result).toHaveLength(1);
    expect(result[0].alternateSourceIds).toEqual([
      'message:idempotency:ik-1',
      'openclaw:mirror:local-user',
    ]);
  });

  it('preserves pending optimistic messages absent from an authoritative refresh', () => {
    const existing = [
      msg('assistant', 'old', 'assistant-1'),
      msg('user', 'still sending', 'message:idempotency:ik-2', true),
    ];
    const history = [msg('assistant', 'old', 'assistant-1')];

    const result = mergeHistoryMessages(existing, history);

    expect(result.map(m => m.rawText)).toEqual(['old', 'still sending']);
    expect(result[1].pending).toBe(true);
  });

  it('preserves streaming assistant messages when an authoritative refresh is empty', () => {
    const existing = [{
      ...msg('assistant', 'still streaming', 'derived:assistant-stream'),
      streaming: true,
    }];

    const result = mergeHistoryMessages(existing, []);

    expect(result).toHaveLength(1);
    expect(result[0].streaming).toBe(true);
  });

  it('aliases a local streamed assistant final to the later durable OpenClaw history identity', () => {
    const existing = [
      openclawAssistant('Task 10 audit is verified complete.', 'derived:unknown-session:assistant:1786147218006:abc', 1786147218006),
    ];
    const history = [
      openclawAssistant('Task 10 audit is verified complete.', 'openclaw:mirror:019fdeaa-eb0d-7ed1-96dd-08243ee90d95:assistant', 1786147303367),
    ];

    const result = mergeHistoryMessages(existing, history);

    expect(result).toHaveLength(1);
    expect(result[0].sourceId).toBe('openclaw:mirror:019fdeaa-eb0d-7ed1-96dd-08243ee90d95:assistant');
    expect(result[0].msgId).toBe(existing[0].msgId);
  });

  it('preserves legitimate repeated assistant finals that both have durable OpenClaw identities', () => {
    const first = openclawAssistant('Done.', 'openclaw:mirror:run-1:assistant', 1700000000000);
    const second = openclawAssistant('Done.', 'openclaw:mirror:run-2:assistant', 1700000005000);

    const result = mergeFinalMessages([first], [second]);

    expect(result.map(m => m.sourceId)).toEqual([
      'openclaw:mirror:run-1:assistant',
      'openclaw:mirror:run-2:assistant',
    ]);
  });

  it('dedupes live-only assistant messages with identical text inside the legacy window', () => {
    const first = openclawAssistant('Working on it.', 'derived:assistant:1', 1700000000000);
    const second = openclawAssistant('Working on it.', 'derived:assistant:2', 1700000005000);

    expect(isLikelyDuplicateMessage(first, second)).toBe(true);
  });

  it('preserves a repeated current-turn assistant final instead of aliasing an earlier durable turn', () => {
    const priorUser = msg('user', 'First request', 'message:idempotency:ik-1');
    const priorDone = openclawAssistant('Done.', 'openclaw:mirror:run-1:assistant', 1700000000000);
    const currentUser = msg('user', 'Second request', 'message:idempotency:ik-2');
    const currentDone = openclawAssistant('Done.', 'derived:unknown-session:assistant:1700000005000:abc', 1700000005000);

    const result = mergeFinalMessages([priorUser, priorDone, currentUser], [currentDone]);

    expect(result.map(m => m.sourceId)).toEqual([
      'message:idempotency:ik-1',
      'openclaw:mirror:run-1:assistant',
      'message:idempotency:ik-2',
      'derived:unknown-session:assistant:1700000005000:abc',
    ]);
  });

  it('matches a repeated current-turn assistant final only after the latest user during history refresh', () => {
    const existing = [
      msg('user', 'First request', 'message:idempotency:ik-1'),
      openclawAssistant('Done.', 'openclaw:mirror:run-1:assistant', 1700000000000),
      msg('user', 'Second request', 'message:idempotency:ik-2'),
      openclawAssistant('Done.', 'derived:unknown-session:assistant:1700000005000:abc', 1700000005000),
    ];
    const history = [
      msg('user', 'First request', 'message:idempotency:ik-1'),
      openclawAssistant('Done.', 'openclaw:mirror:run-1:assistant', 1700000000000),
      msg('user', 'Second request', 'message:idempotency:ik-2'),
      openclawAssistant('Done.', 'openclaw:mirror:run-2:assistant', 1700000006000),
    ];

    const result = mergeHistoryMessages(existing, history);

    expect(result.map(m => m.sourceId)).toEqual([
      'message:idempotency:ik-1',
      'openclaw:mirror:run-1:assistant',
      'message:idempotency:ik-2',
      'openclaw:mirror:run-2:assistant',
    ]);
    expect(result[3].msgId).toBe(existing[3].msgId);
  });

  it('does not match one existing assistant final to multiple history rows', () => {
    const existing = [
      msg('user', 'Question', 'message:idempotency:ik-1'),
      openclawAssistant('Done.', 'derived:unknown-session:assistant:1700000000000:abc', 1700000000000),
    ];
    const history = [
      msg('user', 'Question', 'message:idempotency:ik-1'),
      openclawAssistant('Done.', 'openclaw:mirror:run-1:assistant', 1700000000000),
      openclawAssistant('Done.', 'openclaw:mirror:run-2:assistant', 1700000005000),
    ];

    const result = mergeHistoryMessages(existing, history);

    expect(result).toHaveLength(3);
    expect(new Set(result.map(m => m.msgId)).size).toBe(3);
    expect(result[1].msgId).toBe(existing[1].msgId);
    expect(result[2].sourceId).toBe('openclaw:mirror:run-2:assistant');
  });

  it('does not alias rich assistant messages with images by matching text alone', () => {
    const local = openclawAssistant('Here is the image.', 'derived:unknown-session:assistant:1700000000000:abc', 1700000000000);
    const durable = {
      ...openclawAssistant('Here is the image.', 'openclaw:mirror:run-1:assistant', 1700000005000),
      extractedImages: [{ url: '/api/files?path=image.png', alt: 'image.png' }],
    };

    const result = mergeHistoryMessages([local], [durable]);

    expect(result).toHaveLength(1);
    expect(result[0].sourceId).toBe('openclaw:mirror:run-1:assistant');
    expect(result[0].msgId).not.toBe(local.msgId);
  });
});
