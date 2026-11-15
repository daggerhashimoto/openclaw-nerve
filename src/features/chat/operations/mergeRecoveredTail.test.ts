/** Tests for mergeRecoveredTail. */
import { describe, it, expect } from 'vitest';
import { keepUnsentMessages, mergeRecoveredTail } from './mergeRecoveredTail';
import { processChatMessages } from './loadHistory';
import type { ChatMsg } from '@/features/chat/types';
import type { ChatMessage } from '@/types';

function makeMsg(role: string, text: string, ts?: number): ChatMsg {
  return {
    role: role as ChatMsg['role'],
    html: `<p>${text}</p>`,
    rawText: text,
    timestamp: new Date(ts ?? Date.now()),
  };
}

/** A row as chat.history yields it: the gateway gave its transcript entry an id. */
function historyRow(role: ChatMessage['role'], text: string, id: string, ts: number, extra: Partial<ChatMessage> = {}): ChatMsg {
  const [row] = processChatMessages([{ role, content: text, timestamp: ts, __openclaw: { id }, ...extra }]);
  return row;
}

/** A row from a live event (a chat final): the gateway sends no transcript id with it. */
function liveRow(role: ChatMessage['role'], text: string, ts: number): ChatMsg {
  const [row] = processChatMessages([{ role, content: text, timestamp: ts }]);
  return row;
}

/** A prompt typed here; its tempId is the idempotency key chat.send carried. */
function localPrompt(text: string, sendKey: string, ts: number, state: 'pending' | 'failed' | 'sent'): ChatMsg {
  return {
    ...makeMsg('user', text, ts),
    msgId: `m-local-${sendKey}`,
    tempId: sendKey,
    pending: state === 'pending',
    ...(state === 'failed' ? { failed: true } : {}),
  };
}

const texts = (msgs: ChatMsg[]) => msgs.map((m) => m.rawText);

// Middle of a 30s bucket, so rows a few seconds apart share a content signature.
const T = 1_700_000_015_000;

describe('mergeRecoveredTail', () => {
  it('returns recovered when existing is empty', () => {
    const recovered = [makeMsg('user', 'Hello')];
    expect(mergeRecoveredTail([], recovered)).toEqual(recovered);
  });

  it('returns existing when recovered is empty', () => {
    const existing = [makeMsg('user', 'Hello')];
    expect(mergeRecoveredTail(existing, [])).toEqual(existing);
  });

  it('takes the recovered reply when history adds an attachment the live final did not carry', () => {
    const ts = 1700000000000;
    const existing = [
      makeMsg('user', 'Make an image', ts),
      makeMsg('assistant', 'Here it is.', ts + 25_000),
    ];
    const withImage = {
      ...makeMsg('assistant', 'Here it is.', ts + 25_000),
      extractedImages: [{ url: '/api/chat-media?path=x', alt: 'image.png' }],
    };
    const recovered = [makeMsg('user', 'Make an image', ts), withImage];

    const result = mergeRecoveredTail(existing, recovered);

    expect(result).toHaveLength(2);
    expect(result[1].extractedImages).toEqual([{ url: '/api/chat-media?path=x', alt: 'image.png' }]);
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

  it('inserts a recovered message that belongs before an already displayed reply', () => {
    // An interim reply committed mid-turn (e.g. via the message tool) can reach
    // the client after the run's final reply is already on screen.
    const ts = 1700000000000;
    const existing = [
      makeMsg('user', 'Message A', ts),
      makeMsg('assistant', 'Reply A', ts + 1000),
      makeMsg('user', 'Write about clouds', ts + 2000),
      makeMsg('assistant', 'Rain falls.', ts + 8000),
    ];
    const recovered = [
      makeMsg('user', 'Write about clouds', ts + 2000),
      makeMsg('assistant', 'Clouds form.', ts + 5000),
      makeMsg('assistant', 'Rain falls.', ts + 8000),
    ];
    const result = mergeRecoveredTail(existing, recovered);
    expect(result.map(m => m.rawText)).toEqual([
      'Message A',
      'Reply A',
      'Write about clouds',
      'Clouds form.',
      'Rain falls.',
    ]);
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

  describe('rows with transcript ids', () => {
    it('anchors on the transcript id when the recovered copy was edited and its timestamp moved', () => {
      const existing = [
        historyRow('user', 'Question', 'e1', T),
        historyRow('assistant', 'Streaming partial answer', 'e2', T + 1000),
      ];
      const recovered = [
        historyRow('assistant', 'Final answer', 'e2', T + 40_000),
        historyRow('user', 'Next question', 'e3', T + 60_000),
      ];

      const result = mergeRecoveredTail(existing, recovered);

      expect(texts(result)).toEqual(['Question', 'Final answer', 'Next question']);
      expect(result[1].msgId).toBe(existing[1].msgId);
    });

    it('takes the recovered copy of a row it already shows under the same id', () => {
      const existing = [
        historyRow('user', 'Question', 'e1', T),
        historyRow('assistant', 'Draft', 'e2', T + 1000),
      ];
      const recovered = [
        historyRow('user', 'Question', 'e1', T),
        historyRow('assistant', 'Draft, revised', 'e2', T + 1000),
      ];

      expect(texts(mergeRecoveredTail(existing, recovered))).toEqual(['Question', 'Draft, revised']);
    });

    it('does not let a live copy stand in for a reply already shown under its id', () => {
      // A recovery brought in the reply and a later compaction row before the live
      // final arrived, so the live copy sits after both. The next recovery must not
      // anchor that live copy on the reply and repeat the tail.
      const existing = [
        historyRow('user', 'Question', 'e1', T),
        historyRow('assistant', 'Answer', 'e2', T + 1000),
        historyRow('system', 'Compaction', 'e3', T + 2000),
        liveRow('assistant', 'Answer', T + 1500),
      ];
      const recovered = [
        historyRow('user', 'Question', 'e1', T),
        historyRow('assistant', 'Answer', 'e2', T + 1000),
        historyRow('system', 'Compaction', 'e3', T + 2000),
      ];

      const result = mergeRecoveredTail(existing, recovered);

      expect(texts(result)).toEqual(['Question', 'Answer', 'Compaction']);
      expect(result.map((m) => m.msgId)).toEqual(recovered.map((m) => m.msgId));
    });

    it('keeps an identical reply from an earlier turn apart from the current one', () => {
      // The live user bubble carries the browser's clock (here 47s ahead), so only the
      // live final can anchor, and it must anchor on its own turn's reply.
      const existing = [
        historyRow('user', 'First request', 'e1', T),
        historyRow('assistant', 'Done.', 'e2', T + 1000),
        liveRow('user', 'Second request', T + 50_000),
        liveRow('assistant', 'Done.', T + 5000),
      ];
      const recovered = [
        historyRow('user', 'First request', 'e1', T),
        historyRow('assistant', 'Done.', 'e2', T + 1000),
        historyRow('user', 'Second request', 'e3', T + 3000),
        historyRow('assistant', 'Done.', 'e4', T + 5000),
      ];

      const result = mergeRecoveredTail(existing, recovered);

      expect(texts(result)).toEqual(['First request', 'Done.', 'Second request', 'Done.']);
    });

    it('keeps two durable replies with the same text as two rows', () => {
      const existing = [historyRow('assistant', 'Done.', 'e1', T)];
      const recovered = [
        historyRow('assistant', 'Done.', 'e1', T),
        historyRow('assistant', 'Done.', 'e2', T + 5000),
      ];

      const result = mergeRecoveredTail(existing, recovered);

      expect(result.map((m) => m.msgId)).toEqual(recovered.map((m) => m.msgId));
    });

    it('does not give one live reply to two durable replies with the same text', () => {
      const existing = [
        historyRow('user', 'Question', 'e1', T),
        liveRow('assistant', 'Done.', T + 1000),
      ];
      const recovered = [
        historyRow('user', 'Question', 'e1', T),
        historyRow('assistant', 'Done.', 'e2', T + 1000),
        historyRow('assistant', 'Done.', 'e3', T + 6000),
      ];

      const result = mergeRecoveredTail(existing, recovered);

      expect(texts(result)).toEqual(['Question', 'Done.', 'Done.']);
      expect(new Set(result.map((m) => m.msgId)).size).toBe(3);
    });

    it('reconciles a mix of id rows and live rows without an id', () => {
      // The live user bubble carries the browser's clock and the live final the time
      // the gateway sent it, so neither shares a content signature with its history copy.
      const existing = [
        historyRow('user', 'First', 'e1', T),
        historyRow('assistant', 'Reply one', 'e2', T + 1000),
        liveRow('user', 'Second', T + 95_000),
        liveRow('assistant', 'Reply two', T + 160_000),
      ];
      const recovered = [
        historyRow('user', 'First', 'e1', T),
        historyRow('assistant', 'Reply one', 'e2', T + 1000),
        historyRow('user', 'Second', 'e3', T + 50_000),
        historyRow('assistant', 'Reply two', 'e4', T + 100_000),
      ];

      const result = mergeRecoveredTail(existing, recovered);

      expect(texts(result)).toEqual(['First', 'Reply one', 'Second', 'Reply two']);
      expect(result.map((m) => m.msgId)).toEqual(recovered.map((m) => m.msgId));
    });

    it('keeps the full tool group when the recovered window starts inside it', () => {
      // The window cut the first call off, so the recovered group is the rest of the
      // calls under the second call's id. The group already shown covers them.
      const call = (id: string, name: string, ts: number): ChatMessage => ({
        role: 'assistant',
        content: [{ type: 'tool_use', id: `${id}-call`, name, input: { path: `/${name}` } }],
        timestamp: ts,
        __openclaw: { id },
      });
      const reply: ChatMessage = { role: 'assistant', content: 'All read.', timestamp: T + 4000, __openclaw: { id: 'e5' } };
      const prompt: ChatMessage = { role: 'user', content: 'Read three files', timestamp: T, __openclaw: { id: 'e1' } };
      const existing = processChatMessages([prompt, call('e2', 'read', T + 1000), call('e3', 'grep', T + 2000), call('e4', 'glob', T + 3000), reply]);
      const recovered = processChatMessages([call('e3', 'grep', T + 2000), call('e4', 'glob', T + 3000), reply]);

      const result = mergeRecoveredTail(existing, recovered);

      expect(result).toHaveLength(3);
      expect(result[1].toolGroup).toHaveLength(3);
      expect(result[2].rawText).toBe('All read.');
    });
  });

  describe('prompts not sent yet', () => {
    it('keeps a prompt still sending when the recovered tail does not have it yet', () => {
      const existing = [
        historyRow('user', 'Question', 'e1', T),
        historyRow('assistant', 'Answer', 'e2', T + 1000),
        localPrompt('Optimistic next', 'k1', T + 4000, 'pending'),
      ];
      const recovered = [historyRow('assistant', 'Answer from stale tail', 'e2', T + 1000)];

      const result = mergeRecoveredTail(existing, recovered);

      expect(texts(result)).toEqual(['Question', 'Answer from stale tail', 'Optimistic next']);
      expect(result[2].pending).toBe(true);
    });

    it('gives way to the recorded copy that carries its send key', () => {
      // Same text and time bucket: by content alone the local bubble would stay.
      const existing = [
        historyRow('user', 'Question', 'e1', T),
        historyRow('assistant', 'Answer', 'e2', T + 1000),
        localPrompt('Next', 'k1', T + 3000, 'pending'),
      ];
      const recovered = [
        historyRow('user', 'Question', 'e1', T),
        historyRow('assistant', 'Answer', 'e2', T + 1000),
        historyRow('user', 'Next', 'e3', T + 3000, { idempotencyKey: 'k1:user' }),
        historyRow('assistant', 'Reply', 'e4', T + 6000),
      ];

      const result = mergeRecoveredTail(existing, recovered);

      expect(texts(result)).toEqual(['Question', 'Answer', 'Next', 'Reply']);
      expect(result.map((m) => m.msgId)).toEqual(recovered.map((m) => m.msgId));
      expect(result.some((m) => m.pending)).toBe(false);
    });

    it('keeps a prompt that failed to send, still failed', () => {
      const existing = [
        historyRow('user', 'Question', 'e1', T),
        historyRow('assistant', 'Answer', 'e2', T + 1000),
        localPrompt('Retry me', 'k2', T + 4000, 'failed'),
      ];
      const recovered = [
        historyRow('user', 'Question', 'e1', T),
        historyRow('assistant', 'Answer', 'e2', T + 1000),
      ];

      const result = mergeRecoveredTail(existing, recovered);

      expect(texts(result)).toEqual(['Question', 'Answer', 'Retry me']);
      expect(result[2].failed).toBe(true);
    });

    it('drops a failed prompt that history shows the gateway recorded after all', () => {
      const existing = [
        historyRow('user', 'Question', 'e1', T),
        localPrompt('Retry me', 'k3', T + 95_000, 'failed'),
      ];
      const recovered = [
        historyRow('user', 'Question', 'e1', T),
        historyRow('user', 'Retry me', 'e2', T + 3000, { idempotencyKey: 'k3:user' }),
      ];

      const result = mergeRecoveredTail(existing, recovered);

      expect(texts(result)).toEqual(['Question', 'Retry me']);
      expect(result[1].failed).toBeFalsy();
    });

    it('does not take a recorded prompt with the same text but another send key for a failed one', () => {
      const existing = [
        historyRow('user', 'Question', 'e1', T),
        localPrompt('yes', 'k4', T + 9000, 'failed'),
      ];
      const recovered = [
        historyRow('user', 'Question', 'e1', T),
        historyRow('user', 'yes', 'e2', T + 3000, { idempotencyKey: 'other-tab:user' }),
      ];

      const result = mergeRecoveredTail(existing, recovered);

      expect(texts(result)).toEqual(['Question', 'yes', 'yes']);
      expect(result[2].failed).toBe(true);
    });

    it('with no anchor, replaces the transcript but keeps prompts not recorded yet', () => {
      const existing = [
        liveRow('user', 'Old message 1', 1_000_000),
        liveRow('assistant', 'Old reply 1', 1_000_001),
        localPrompt('Lost on the way', 'k5', T + 2000, 'failed'),
        { ...makeMsg('system', 'Send error: Disconnected', T + 2001), msgId: 'm-error' },
        localPrompt('Still sending', 'k6', T + 3000, 'pending'),
      ];
      const recovered = [
        historyRow('user', 'Completely different', 'e1', T),
        historyRow('assistant', 'New reply', 'e2', T + 1000),
      ];

      const result = mergeRecoveredTail(existing, recovered);

      expect(texts(result)).toEqual(['Completely different', 'New reply', 'Lost on the way', 'Still sending']);
      expect(result[2].failed).toBe(true);
      expect(result[3].pending).toBe(true);
    });
  });

  describe('keepUnsentMessages (full history reload)', () => {
    it('keeps a prompt still sending at the end of the reloaded transcript', () => {
      const previous = [historyRow('user', 'Question', 'e1', T), localPrompt('Next', 'k1', T + 2000, 'pending')];
      const history = [historyRow('user', 'Question', 'e1', T), historyRow('assistant', 'Late answer', 'e2', T + 9000)];

      const result = keepUnsentMessages(previous, history);

      expect(texts(result)).toEqual(['Question', 'Late answer', 'Next']);
      expect(result[2].pending).toBe(true);
    });

    it('collapses a prompt into its recorded copy once history has it', () => {
      const previous = [historyRow('user', 'Question', 'e1', T), localPrompt('Next', 'k1', T + 2000, 'pending')];
      const history = [
        historyRow('user', 'Question', 'e1', T),
        historyRow('user', 'Next', 'e2', T + 2500, { idempotencyKey: 'k1:user' }),
      ];

      const result = keepUnsentMessages(previous, history);

      expect(result).toEqual(history);
    });

    it('puts a failed prompt back where it was in time, not after later turns', () => {
      const previous = [
        historyRow('user', 'First', 'e1', T),
        historyRow('assistant', 'Reply one', 'e2', T + 1000),
        localPrompt('Not delivered', 'k2', T + 5000, 'failed'),
      ];
      const history = [
        historyRow('user', 'First', 'e1', T),
        historyRow('assistant', 'Reply one', 'e2', T + 1000),
        historyRow('user', 'Second', 'e3', T + 60_000),
        historyRow('assistant', 'Reply two', 'e4', T + 61_000),
      ];

      const result = keepUnsentMessages(previous, history);

      expect(texts(result)).toEqual(['First', 'Reply one', 'Not delivered', 'Second', 'Reply two']);
      expect(result[2].failed).toBe(true);
    });

    it('does not keep a prompt the gateway already acknowledged', () => {
      const previous = [historyRow('user', 'Question', 'e1', T), localPrompt('Next', 'k1', T + 2000, 'sent')];
      const history = [historyRow('user', 'Question', 'e1', T)];

      expect(keepUnsentMessages(previous, history)).toEqual(history);
    });
  });
});
