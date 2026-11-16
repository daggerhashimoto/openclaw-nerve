/** useMessageSearch: which messages a chat search finds. */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMessageSearch } from './useMessageSearch';
import type { ChatMsg } from './types';

const CALL = '**tool:** `read`\n```json\n{\n  "path": "memory/2026-11-15.md"\n}\n```';

function msg(overrides: Partial<ChatMsg>): ChatMsg {
  return { role: 'user', html: '', rawText: '', timestamp: new Date(0), ...overrides };
}

function search(messages: ChatMsg[], query: string) {
  const { result } = renderHook(() => useMessageSearch(messages));
  act(() => result.current.setQuery(query));
  return result.current.matches.map((match) => match.messageIndex);
}

describe('useMessageSearch', () => {
  it('finds a message by its text, ignoring case', () => {
    expect(search([msg({ rawText: 'Hello there' }), msg({ rawText: 'other' })], 'HELLO')).toEqual([0]);
  });

  it('finds a tool row by the text of its result', () => {
    const messages = [
      msg({ rawText: 'hi' }),
      msg({ role: 'tool', rawText: CALL, toolResult: 'Optional file not found: needle.md.' }),
    ];

    expect(search(messages, 'needle')).toEqual([1]);
  });

  it('finds a tool group by the result of one of its entries', () => {
    const group = msg({
      role: 'tool',
      rawText: 'running command\nreading 2026-11-15.md',
      toolGroup: [
        { html: 'running command', rawText: '**tool:** `exec`', preview: 'running command' },
        { html: 'reading 2026-11-15.md', rawText: CALL, preview: 'reading 2026-11-15.md', result: 'line with the needle in it' },
      ],
    });

    expect(search([msg({ rawText: 'hi' }), group], 'needle')).toEqual([1]);
  });

  it('does not find a tool row on text that is in neither its call nor its result', () => {
    expect(search([msg({ role: 'tool', rawText: CALL, toolResult: 'nothing here' })], 'needle')).toEqual([]);
  });
});
