/** Tests for chat message reconciliation helpers. */
import { describe, expect, it } from 'vitest';
import { mergeFinalMessages, mergeHistoryMessages } from './useChatMessages';
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

  it('preserves aliases and prior primary identity when history confirms a message', () => {
    const existing = [{
      ...msg('user', 'hello', 'message:idempotency:ik-1', true),
      alternateSourceIds: ['message:temp:local-1'],
    }];
    const history = [{
      ...msg('user', 'hello', 'openclaw:id:wrapper-1'),
      alternateSourceIds: ['message:idempotency:ik-1'],
    }];

    const result = mergeHistoryMessages(existing, history);

    expect(result).toHaveLength(1);
    expect(result[0].sourceId).toBe('openclaw:id:wrapper-1');
    expect(result[0].alternateSourceIds).toEqual(expect.arrayContaining([
      'message:temp:local-1',
      'message:idempotency:ik-1',
    ]));
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

  it('preserves streaming messages when history returns empty', () => {
    const existing = [{
      ...msg('assistant', 'still streaming', 'assistant-stream'),
      streaming: true,
    }];

    const result = mergeHistoryMessages(existing, []);

    expect(result).toHaveLength(1);
    expect(result[0].streaming).toBe(true);
  });
});
