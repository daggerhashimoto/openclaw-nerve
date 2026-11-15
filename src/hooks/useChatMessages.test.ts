/** Tests for the pure message helpers in useChatMessages. */
import { describe, it, expect } from 'vitest';
import { isLikelyDuplicateMessage, mergeFinalMessages } from './useChatMessages';
import { processChatMessages } from '@/features/chat/operations/loadHistory';
import type { ChatMsg } from '@/features/chat/types';
import type { ChatMessage } from '@/types';

const T = 1_700_000_015_000;

/** A row as chat.history yields it: the gateway gave its transcript entry an id. */
function historyRow(role: ChatMessage['role'], text: string, id: string, ts: number): ChatMsg {
  const [row] = processChatMessages([{ role, content: text, timestamp: ts, __openclaw: { id } }]);
  return row;
}

/** A row from a live chat final: the gateway sends no transcript id with it. */
function liveRow(text: string, ts: number): ChatMsg {
  const [row] = processChatMessages([{ role: 'assistant', content: text, timestamp: ts }]);
  return row;
}

const texts = (msgs: ChatMsg[]) => msgs.map((m) => m.rawText);

/**
 * A visible row history records after a reply. #376 hit this with a compaction row;
 * those are hidden since #374, so the tests use a row that still shows.
 */
const LATER_ROW = 'Model switched to gpt-5.5';

describe('mergeFinalMessages', () => {
  it('keeps one copy when history already showed the reply and a later row after it', () => {
    // The shape behind #376: a recovery read history after the reply was recorded and
    // a later row followed it, before the live final arrived.
    const existing = [
      historyRow('user', 'Audit task 10', 'e1', T),
      historyRow('assistant', 'Task 10 audit is verified complete.', 'e2', T + 18_000),
      historyRow('system', LATER_ROW, 'e3', T + 40_000),
    ];

    const result = mergeFinalMessages(existing, [liveRow('Task 10 audit is verified complete.', T + 45_000)]);

    expect(result).toEqual(existing);
  });

  it('keeps one copy when a tool result follows the reply in its turn', () => {
    const existing = processChatMessages([
      { role: 'user', content: 'Check it', timestamp: T, __openclaw: { id: 'e1' } },
      { role: 'assistant', content: 'Checked, all good.', timestamp: T + 2000, __openclaw: { id: 'e2' } },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'c1', name: 'exec', input: { command: 'ls' } }],
        timestamp: T + 3000,
        __openclaw: { id: 'e3' },
      },
    ]);

    const result = mergeFinalMessages(existing, [liveRow('Checked, all good.', T + 4000)]);

    expect(texts(result).filter((t) => t === 'Checked, all good.')).toHaveLength(1);
    expect(result).toHaveLength(existing.length);
  });

  it('keeps one copy when a system line follows the reply', () => {
    const existing = [
      historyRow('user', 'Question', 'e1', T),
      historyRow('assistant', 'Answer', 'e2', T + 1000),
      { ...historyRow('system', 'Send error: Timeout', 'e3', T + 2000), msgId: 'm-local-error' },
    ];

    const result = mergeFinalMessages(existing, [liveRow('Answer', T + 3000)]);

    expect(texts(result)).toEqual(['Question', 'Answer', 'Send error: Timeout']);
  });

  it('replaces a live copy earlier in the turn in place', () => {
    const existing = [
      historyRow('user', 'Question', 'e1', T),
      liveRow('Answer', T + 1000),
      historyRow('system', LATER_ROW, 'e2', T + 2000),
    ];
    const incoming = liveRow('Answer', T + 1500);

    const result = mergeFinalMessages(existing, [incoming]);

    expect(texts(result)).toEqual(['Question', 'Answer', LATER_ROW]);
    expect(result[1]).toBe(incoming);
  });

  it('looks past a prompt typed after the reply that is still sending', () => {
    const existing = [
      historyRow('user', 'Question', 'e1', T),
      historyRow('assistant', 'Answer', 'e2', T + 1000),
      { ...historyRow('user', 'Follow-up', 'x', T + 5000), msgId: 'm-local', tempId: 'k1', pending: true },
    ];

    const result = mergeFinalMessages(existing, [liveRow('Answer', T + 2000)]);

    expect(texts(result)).toEqual(['Question', 'Answer', 'Follow-up']);
  });

  it('keeps the same reply in a new turn as a second row', () => {
    const existing = [
      historyRow('user', 'First request', 'e1', T),
      historyRow('assistant', 'Done.', 'e2', T + 1000),
      historyRow('user', 'Second request', 'e3', T + 3000),
    ];

    const result = mergeFinalMessages(existing, [liveRow('Done.', T + 5000)]);

    expect(texts(result)).toEqual(['First request', 'Done.', 'Second request', 'Done.']);
  });

  it('keeps the same reply minutes later as a second row when no prompt separates them', () => {
    // A heartbeat run's prompt is hidden, so its reply lands in the previous turn.
    const existing = [
      historyRow('user', 'Status?', 'e1', T),
      historyRow('assistant', 'All quiet.', 'e2', T + 1000),
    ];

    const result = mergeFinalMessages(existing, [liveRow('All quiet.', T + 5 * 60_000)]);

    expect(texts(result)).toEqual(['Status?', 'All quiet.', 'All quiet.']);
  });

  it('does not let one row stand in for two incoming replies', () => {
    const existing = [historyRow('user', 'Question', 'e1', T), historyRow('assistant', 'Done.', 'e2', T + 1000)];

    const result = mergeFinalMessages(existing, [
      ...processChatMessages([{ role: 'assistant', content: [{ type: 'text', text: 'Done.' }], timestamp: T + 2000 }]),
      historyRow('system', LATER_ROW, 'e3', T + 2500),
      liveRow('Done.', T + 3000),
    ]);

    expect(texts(result)).toEqual(['Question', 'Done.', LATER_ROW, 'Done.']);
  });
});

describe('isLikelyDuplicateMessage', () => {
  it('treats identical live replies within a minute as one', () => {
    expect(isLikelyDuplicateMessage(liveRow('Working on it.', T), liveRow('Working on it.', T + 5000))).toBe(true);
  });

  it('treats identical replies further apart as two', () => {
    expect(isLikelyDuplicateMessage(liveRow('Working on it.', T), liveRow('Working on it.', T + 61_000))).toBe(false);
  });
});
