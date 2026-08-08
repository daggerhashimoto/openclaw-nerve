/** Tests for mergeRecoveredTail. */
import { describe, it, expect } from 'vitest';
import { mergeRecoveredTail } from './mergeRecoveredTail';
import type { ChatMsg } from '@/features/chat/types';

function makeMsg(role: string, text: string, ts?: number): ChatMsg {
  return {
    role: role as ChatMsg['role'],
    html: `<p>${text}</p>`,
    rawText: text,
    timestamp: new Date(ts ?? Date.now()),
  };
}

function makeIdentifiedMsg(role: string, text: string, sourceId: string, ts?: number): ChatMsg {
  return {
    ...makeMsg(role, text, ts),
    msgId: `ui-${sourceId}`,
    sourceId,
  };
}

describe('mergeRecoveredTail', () => {
  it('returns recovered when existing is empty', () => {
    const recovered = [makeMsg('user', 'Hello')];
    expect(mergeRecoveredTail([], recovered)).toEqual(recovered);
  });

  it('returns existing when recovered is empty', () => {
    const existing = [makeMsg('user', 'Hello')];
    expect(mergeRecoveredTail(existing, [])).toEqual(existing);
  });

  it('appends new messages when recovered starts where existing ends', () => {
    const ts = 1700000000000;
    const existing = [
      makeMsg('user', 'Hello', ts),
      makeMsg('assistant', 'Hi', ts + 1000),
    ];
    const recovered = [
      makeMsg('user', 'Hello', ts),
      makeMsg('assistant', 'Hi', ts + 1000),
      makeMsg('user', 'New question', ts + 2000),
    ];
    const result = mergeRecoveredTail(existing, recovered);
    expect(result).toHaveLength(3);
    expect(result[2].rawText).toBe('New question');
  });

  it('does not duplicate overlapping messages', () => {
    const ts = 1700000000000;
    const existing = [makeMsg('user', 'Hello', ts), makeMsg('assistant', 'Hi', ts + 1000)];
    const recovered = [makeMsg('user', 'Hello', ts), makeMsg('assistant', 'Hi', ts + 1000), makeMsg('user', 'Follow up', ts + 2000)];
    const result = mergeRecoveredTail(existing, recovered);
    // Should have 3 messages, not 4 or 5
    expect(result).toHaveLength(3);
  });

  it('uses anchor path when no suffix-prefix overlap', () => {
    const ts = 1700000000000;
    const existing = [
      makeMsg('user', 'Message A', ts),
      makeMsg('assistant', 'Reply A', ts + 1000),
      makeMsg('user', 'Message B unique content here', ts + 2000),
      makeMsg('assistant', 'Old reply B', ts + 3000),
    ];
    const recovered = [
      makeMsg('user', 'Message B unique content here', ts + 2000),
      makeMsg('assistant', 'New reply B (corrected)', ts + 3000),
      makeMsg('user', 'Message C', ts + 4000),
    ];
    const result = mergeRecoveredTail(existing, recovered);
    // Should preserve A messages, replace from B onwards
    expect(result.some(m => m.rawText === 'Message A')).toBe(true);
    expect(result.some(m => m.rawText === 'Reply A')).toBe(true);
    expect(result.some(m => m.rawText === 'New reply B (corrected)')).toBe(true);
    expect(result.some(m => m.rawText === 'Message C')).toBe(true);
    // Old reply should be replaced, not retained
    expect(result.some(m => m.rawText === 'Old reply B')).toBe(false);
  });

  it('falls back to recovered when no overlap or anchor found', () => {
    const existing = [
      makeMsg('user', 'Old message 1', 1000000),
      makeMsg('assistant', 'Old reply 1', 1000001),
    ];
    const recovered = [
      makeMsg('user', 'Completely different', 2000000),
      makeMsg('assistant', 'New reply', 2000001),
    ];
    const result = mergeRecoveredTail(existing, recovered);
    expect(result).toEqual(recovered);
  });

  it('handles single message overlap', () => {
    const ts = 1700000000000;
    const existing = [makeMsg('user', 'Only msg', ts)];
    const recovered = [makeMsg('user', 'Only msg', ts), makeMsg('assistant', 'Reply', ts + 1000)];
    const result = mergeRecoveredTail(existing, recovered);
    expect(result).toHaveLength(2);
  });

  it('merges recovered messages by stable identity even when content changes', () => {
    const existing = [
      makeIdentifiedMsg('user', 'Question', 'u-1', 1000),
      makeIdentifiedMsg('assistant', 'Streaming partial answer', 'a-1', 2000),
    ];
    const recovered = [
      makeIdentifiedMsg('assistant', 'Final answer', 'a-1', 2000),
      makeIdentifiedMsg('user', 'Next question', 'u-2', 3000),
    ];

    const result = mergeRecoveredTail(existing, recovered);

    expect(result.map(m => m.rawText)).toEqual(['Question', 'Final answer', 'Next question']);
    expect(result[1].msgId).toBe('ui-a-1');
  });

  it('preserves aliases and prior primary identity through recovered-tail merges', () => {
    const existing = [{
      ...makeIdentifiedMsg('assistant', 'Streaming partial answer', 'local-stream', 2000),
      alternateSourceIds: ['message:idempotency:ik-1'],
      collapsed: true,
    }];
    const recovered = [{
      ...makeIdentifiedMsg('assistant', 'Final answer', 'openclaw:id:wrapper-1', 2000),
      alternateSourceIds: ['message:idempotency:ik-1'],
    }];

    const result = mergeRecoveredTail(existing, recovered);

    expect(result).toHaveLength(1);
    expect(result[0].sourceId).toBe('openclaw:id:wrapper-1');
    expect(result[0].msgId).toBe('ui-local-stream');
    expect(result[0].alternateSourceIds).toEqual(expect.arrayContaining([
      'message:idempotency:ik-1',
      'local-stream',
    ]));
    expect(result[0].collapsed).toBe(true);
  });

  it('does not let a stale recovered tail drop newer local state', () => {
    const existing = [
      makeIdentifiedMsg('user', 'Question', 'u-1', 1000),
      makeIdentifiedMsg('assistant', 'Answer', 'a-1', 2000),
      makeIdentifiedMsg('user', 'Optimistic next', 'u-2', 4000),
    ];
    existing[2].pending = true;
    const recovered = [
      makeIdentifiedMsg('assistant', 'Answer from stale tail', 'a-1', 2000),
    ];

    const result = mergeRecoveredTail(existing, recovered);

    expect(result.map(m => m.rawText)).toEqual(['Question', 'Answer from stale tail', 'Optimistic next']);
    expect(result[2].pending).toBe(true);
  });
});
