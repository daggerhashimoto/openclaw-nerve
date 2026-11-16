/** extractText: the text of a message for filters, streaming, speech and fallbacks. */
import { describe, it, expect } from 'vitest';
import { extractText, toolResultText } from './helpers';
import type { ContentBlock } from '@/types';

// eslint-disable-next-line no-control-regex -- the old sentinels were NUL characters; this looks for them
const LEAK = /TOOLRESULT|\u0000|\uFFFD/;

describe('extractText', () => {
  it('gives a tool result as a fenced block, with no sentinels', () => {
    const text = extractText({
      role: 'assistant',
      content: [{ type: 'toolResult', content: [{ type: 'text', text: 'Optional file not found: a.md.' }] }],
    });

    expect(text).not.toMatch(LEAK);
    expect(text).toBe('**tool result:**\n```\nOptional file not found: a.md.\n```');
  });

  it('fences a result that contains backticks with a longer fence', () => {
    const text = extractText({
      role: 'user',
      content: [{ type: 'tool_result', content: 'before\n```js\ncode\n```\nafter' }],
    });

    expect(text).toBe('**tool result:**\n````\nbefore\n```js\ncode\n```\nafter\n````');
  });

  it('says when a result is empty', () => {
    const text = extractText({ role: 'assistant', content: [{ type: 'toolResult', content: [] }] });

    expect(text).toBe('**tool result:**\n```\n(empty result)\n```');
  });
});

describe('toolResultText', () => {
  it('reads string, text-block and structured results', () => {
    expect(toolResultText({ type: 'toolResult', content: 'plain' })).toBe('plain');
    expect(toolResultText({
      type: 'toolResult',
      content: [{ type: 'text', text: 'one' }, { type: 'image', data: 'x', mimeType: 'image/png' }, { type: 'text', text: 'two' }],
    })).toBe('one\ntwo');
    expect(toolResultText({ type: 'toolResult', content: { ok: true } } as unknown as ContentBlock)).toBe('{"ok":true}');
    expect(toolResultText({ type: 'toolResult' })).toBe('');
  });
});
