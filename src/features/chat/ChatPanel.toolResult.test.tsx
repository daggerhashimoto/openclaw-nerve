/**
 * Tool results in the transcript.
 *
 * OpenClaw 2026.9 records each tool a code-mode `exec` script runs as its own
 * transcript entry: role `custom`, customType `openclaw.nested-tool.v1`, with
 * the call and its result as content blocks. Those used to reach the screen as
 * a System row whose result was wrapped in NUL sentinels, which the markdown
 * parser turned into U+FFFD: `\uFFFDTOOLRESULT_START\uFFFD...`. A call and its
 * result are a tool row, and the result opens beneath it as plain text.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, renderHook, act, waitFor } from '@testing-library/react';
import { forwardRef } from 'react';
import type { ChatMessage, ChatEventPayload, ContentBlock } from '@/types';
import { useChatStreaming } from '@/hooks/useChatStreaming';
import { groupToolMessages, processChatMessages, splitToolCallMessage } from './operations/loadHistory';
import { extractFinalMessages, extractStreamDelta } from './operations/streamEventHandler';
import { StreamingMessage } from './components/StreamingMessage';
import { ChatPanel } from './ChatPanel';
import type { ChatMsg } from './types';

vi.mock('./InputBar', () => ({
  InputBar: forwardRef(function InputBarStub() {
    return <div data-testid="input-bar" />;
  }),
}));
vi.mock('./components/useModelEffort', () => ({
  useModelEffort: () => ({
    modelOptions: [],
    effortOptions: [],
    selectedModel: '',
    selectedEffort: '',
    selectedEffortLabel: '',
    handleModelChange: vi.fn(),
    handleEffortChange: vi.fn(),
    controlsDisabled: true,
    uiError: null,
  }),
}));

beforeAll(async () => {
  // jsdom has no layout; the panel scrolls its list into view.
  Element.prototype.scrollIntoView = vi.fn();
  // MessageBubble lazy-loads the real markdown renderer. Load it once up front so a
  // busy full-suite run does not outlast the default findBy timeout on first render.
  await import('@/features/markdown/MarkdownRenderer');
  // Diff and file previews are lazy too.
  await import('./DiffView');
  await import('./FileContentView');
});

const T0 = Date.parse('2026-11-16T10:00:00Z');
const RUN = 'run-nested';

/** No sentinel name, no NUL and no replacement character anywhere in the rendered text. */
// eslint-disable-next-line no-control-regex -- the old sentinels were NUL characters; this looks for them
const LEAK = /TOOLRESULT|\u0000|\uFFFD/;

function entry(id: string, seq: number, message: Record<string, unknown>): ChatMessage {
  return { ...message, timestamp: T0 + seq * 1000, __openclaw: { runId: RUN, id, seq } } as unknown as ChatMessage;
}

/** A tool that ran inside a code-mode exec script, as an OpenClaw 2026.9 gateway records it. */
function nestedTool(id: string, seq: number, name: string, args: Record<string, unknown>, result: ContentBlock[]): ChatMessage {
  const callId = `tool_call:exec-1:${name}:${seq}`;
  return entry(id, seq, {
    role: 'custom',
    customType: 'openclaw.nested-tool.v1',
    display: true,
    excludeFromContext: true,
    content: [
      { type: 'toolCall', id: callId, name, arguments: args, parentToolCallId: 'exec-1' },
      { type: 'toolResult', role: 'toolResult', toolCallId: callId, toolName: name, isError: false, content: result },
    ],
  });
}

const nestedRead = (id: string, seq: number, path: string, text: string) =>
  nestedTool(id, seq, 'read', { path, optional: true }, [{ type: 'text', text }]);

const prompt = entry('u-1', 0, { role: 'user', content: 'hi' });
const notFound = nestedRead('n-1', 2, 'memory/2026-11-15.md', 'Optional file not found: memory/2026-11-15.md.');

function panel(messages: ChatMsg[], options: { searchOpen?: boolean } = {}) {
  return (
    <ChatPanel
      messages={messages}
      onSend={vi.fn()}
      onAbort={vi.fn()}
      isGenerating={false}
      stream={{ html: '', text: '' } as never}
      historyLoaded
      searchOpen={options.searchOpen}
    />
  );
}

const toolRow = (name: RegExp) => screen.getByRole('button', { name });

function shownResult(container: HTMLElement): HTMLElement {
  const result = container.querySelector<HTMLElement>('.tool-result');
  expect(result).not.toBeNull();
  return result as HTMLElement;
}

describe('tool results from history', () => {
  it('shows a nested tool call as a tool row, its result opening beneath it, with no sentinel text', () => {
    const { container } = render(panel(processChatMessages([prompt, notFound])));

    expect(container.textContent).not.toMatch(LEAK);
    expect(screen.queryByText('System')).toBeNull();

    fireEvent.click(toolRow(/reading\s*memory\/2026-11-15\.md/));

    expect(shownResult(container).textContent).toBe('Optional file not found: memory/2026-11-15.md.');
    expect(container.textContent).not.toMatch(LEAK);
  });

  it('says so when the result is empty', () => {
    const empty = nestedTool('n-1', 2, 'exec', { command: 'true' }, []);
    const { container } = render(panel(processChatMessages([prompt, empty])));

    fireEvent.click(toolRow(/exec\s*true/));

    expect(shownResult(container).textContent).toBe('(empty result)');
    expect(container.textContent).not.toMatch(LEAK);
  });

  it('shows a result as plain text: markdown and angle brackets are not interpreted', () => {
    const text = '# Not a heading\n**not bold** <b>not bold either</b> <img src=x onerror="alert(1)"> a < b';
    const raw = nestedRead('n-1', 2, 'notes.md', text);
    const { container } = render(panel(processChatMessages([prompt, raw])));

    fireEvent.click(toolRow(/reading\s*notes\.md/));

    const result = shownResult(container);
    expect(result.textContent).toBe(text);
    expect(result.querySelector('h1, strong, b, img')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('lists nested calls in their tool group, each opening to its result', () => {
    const exec = entry('a-1', 1, {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'exec-1', name: 'exec', arguments: { command: 'cat a' } }],
    });
    const execResult = entry('r-1', 4, {
      role: 'toolResult',
      toolCallId: 'exec-1',
      toolName: 'exec',
      content: [{ type: 'text', text: '{"status":"completed"}' }],
    });
    const raw = [
      prompt,
      exec,
      nestedRead('n-1', 2, 'memory/2026-11-16.md', 'Optional file not found: memory/2026-11-16.md.'),
      notFound,
      execResult,
    ];
    const { container } = render(panel(processChatMessages(raw)));

    fireEvent.click(screen.getByRole('button', { name: /Used 3 tools/ }));
    fireEvent.click(toolRow(/reading\s*memory\/2026-11-15\.md/));

    expect(shownResult(container).textContent).toBe('Optional file not found: memory/2026-11-15.md.');
    expect(container.textContent).not.toMatch(LEAK);
  });

  it('keeps both the result and the text of a user entry that carries an unanswered tool result', async () => {
    const mixed = entry('u-2', 3, {
      role: 'user',
      content: [
        { type: 'tool_result', content: 'file body' },
        { type: 'text', text: 'Carry on' },
      ],
    });
    // The split rows, through grouping, as processChatMessages would hand them to the panel
    const { container } = render(panel(groupToolMessages(splitToolCallMessage(mixed))));

    expect(await screen.findByText('Carry on', undefined, { timeout: 5000 })).toBeInTheDocument();
    fireEvent.click(toolRow(/tool result\s*file body/));
    expect(shownResult(container).textContent).toBe('file body');
    expect(container.textContent).not.toMatch(LEAK);
  });

  it('shows a nested entry whose result has no call in it as a result row of that tool', () => {
    const orphan = entry('n-9', 2, {
      role: 'custom',
      customType: 'openclaw.nested-tool.v1',
      content: [{ type: 'toolResult', toolCallId: 'elsewhere', toolName: 'read', content: [{ type: 'text', text: 'late body' }] }],
    });
    const { container } = render(panel(processChatMessages([prompt, orphan])));

    fireEvent.click(toolRow(/read result\s*late body/));

    expect(shownResult(container).textContent).toBe('late body');
  });

  it('still hides tool result entries of their own, as before', () => {
    const call = entry('a-1', 1, {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'exec-1', name: 'exec', arguments: { command: 'ls' } }],
    });
    const plain = entry('r-1', 2, { role: 'toolResult', toolCallId: 'exec-1', toolName: 'exec', content: [{ type: 'text', text: 'top-level output' }] });
    const blocks = entry('r-2', 3, { role: 'toolResult', content: [{ type: 'tool_result', content: 'block output' }] });
    const { container } = render(panel(processChatMessages([prompt, call, plain, blocks])));

    fireEvent.click(toolRow(/exec\s*ls/));

    expect(container.querySelector('.tool-result')).toBeNull();
    expect(container.textContent).not.toContain('top-level output');
    expect(container.textContent).not.toContain('block output');
  });
});

describe('tool results next to diffs and file previews', () => {
  const editCall = (id: string, seq: number, result: string) =>
    nestedTool(id, seq, 'edit', { path: 'src/a.ts', oldText: 'const a = 1;', newText: 'const a = 2;' }, [{ type: 'text', text: result }]);
  const writeCall = (id: string, seq: number, result: string) =>
    nestedTool(id, seq, 'write', { path: 'src/b.ts', content: 'export const b = 1;' }, [{ type: 'text', text: result }]);

  it('shows a failed edit as its diff followed by the error', async () => {
    const { container } = render(panel(processChatMessages([prompt, editCall('n-1', 2, 'Error: file not found: src/a.ts')])));

    fireEvent.click(toolRow(/editing\s*src\/a\.ts/));

    await waitFor(() => expect(container.querySelector('.diff-container')).not.toBeNull());
    expect(shownResult(container).textContent).toBe('Error: file not found: src/a.ts');
  });

  it('shows a write as its file preview followed by the result', async () => {
    const { container } = render(panel(processChatMessages([prompt, writeCall('n-1', 2, 'Wrote 19 bytes')])));

    fireEvent.click(toolRow(/writing\s*src\/b\.ts/));

    await waitFor(() => expect(container.querySelector('.file-content-container')).not.toBeNull());
    expect(shownResult(container).textContent).toBe('Wrote 19 bytes');
  });

  it('does the same for edits and writes inside a tool group', async () => {
    const exec = entry('a-1', 1, {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'exec-1', name: 'exec', arguments: { command: 'ls' } }],
    });
    const raw = [prompt, exec, editCall('n-1', 2, 'Error: file not found: src/a.ts'), writeCall('n-2', 3, 'Wrote 19 bytes')];
    const { container } = render(panel(processChatMessages(raw)));

    fireEvent.click(screen.getByRole('button', { name: /Used 3 tools/ }));
    // An edit entry starts open on its diff
    await waitFor(() => expect(container.querySelector('.diff-container')).not.toBeNull());
    fireEvent.click(toolRow(/writing\s*src\/b\.ts/));
    await waitFor(() => expect(container.querySelector('.file-content-container')).not.toBeNull());

    const results = [...container.querySelectorAll('.tool-result')].map((el) => el.textContent);
    expect(results).toEqual(['Error: file not found: src/a.ts', 'Wrote 19 bytes']);
  });
});

describe('tool results in transcript order', () => {
  it('keeps text, results and more text of an entry in the order they were recorded', async () => {
    const mixed = entry('u-2', 3, {
      role: 'user',
      content: [
        { type: 'text', text: 'Before the result' },
        { type: 'tool_result', content: 'file body' },
        { type: 'text', text: 'After the result' },
      ],
    });
    render(panel(processChatMessages([prompt, mixed])));

    const before = await screen.findByText('Before the result', undefined, { timeout: 5000 });
    const after = await screen.findByText('After the result', undefined, { timeout: 5000 });
    const result = toolRow(/tool result\s*file body/);

    expect(before.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(result.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('searching tool results', () => {
  /** The search bar, with a query typed in. */
  function searchFor(query: string) {
    fireEvent.change(screen.getByRole('textbox', { name: 'Search messages' }), { target: { value: query } });
  }

  it('finds a nested tool row by its result, marks the row and opens it on the highlighted match', () => {
    const { container } = render(panel(processChatMessages([prompt, notFound]), { searchOpen: true }));

    searchFor('not found');

    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    const row = container.querySelector('.msg-tool');
    expect(row?.className).toContain('ring-operator/60');
    // The current match opens its row (#412)
    expect(toolRow(/reading\s*memory\/2026-11-15\.md/)).toHaveAttribute('aria-expanded', 'true');
    expect(shownResult(container).querySelector('mark.search-highlight')?.textContent).toBe('not found');
  });

  it('finds a tool group by the result of one of its entries', () => {
    const exec = entry('a-1', 1, {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'exec-1', name: 'exec', arguments: { command: 'cat a' } }],
    });
    const raw = [prompt, exec, nestedRead('n-1', 2, 'notes.md', 'the needle is here'), notFound];
    const { container } = render(panel(processChatMessages(raw), { searchOpen: true }));

    searchFor('needle');

    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    expect(container.querySelector('.msg-tool')?.className).toContain('ring-operator/60');
    // The current match opens the group and the entry whose result holds it (#412)
    expect(screen.getByRole('button', { name: /Used 3 tools/ })).toHaveAttribute('aria-expanded', 'true');
    expect(toolRow(/reading\s*notes\.md/)).toHaveAttribute('aria-expanded', 'true');
    expect(shownResult(container).querySelector('mark.search-highlight')?.textContent).toBe('needle');
  });
});

describe('tool results from live events', () => {
  it('shows a nested tool row that arrives with a chat final', () => {
    const payload: ChatEventPayload = {
      state: 'final',
      runId: RUN,
      messages: [notFound, entry('a-2', 3, { role: 'assistant', content: [{ type: 'text', text: 'Nothing saved yet.' }] })],
    };
    const { container } = render(panel(processChatMessages(extractFinalMessages(payload))));

    fireEvent.click(toolRow(/reading\s*memory\/2026-11-15\.md/));

    expect(shownResult(container).textContent).toBe('Optional file not found: memory/2026-11-15.md.');
    expect(container.textContent).not.toMatch(LEAK);
  });

  it('keeps an unanswered result of a final reply visible once the final is processed', () => {
    const payload: ChatEventPayload = {
      state: 'final',
      runId: RUN,
      message: {
        role: 'assistant',
        content: [
          { type: 'toolResult', content: [{ type: 'text', text: 'streamed body' }] },
          { type: 'text', text: 'Reading done' },
        ],
      },
    };
    const { container } = render(panel(processChatMessages(extractFinalMessages(payload))));

    fireEvent.click(toolRow(/tool result\s*streamed body/));

    expect(shownResult(container).textContent).toBe('streamed body');
  });

  /** Stream one assistant message whose only tool block is a result with this text, and render the preview. */
  async function streamResult(text: string) {
    const delta = extractStreamDelta({
      state: 'delta',
      message: {
        role: 'assistant',
        content: [
          { type: 'toolResult', content: [{ type: 'text', text }] },
          { type: 'text', text: 'Reading **done**' },
        ],
      },
    });
    expect(delta).not.toBeNull();
    expect(delta?.text).not.toMatch(LEAK);

    const { result } = renderHook(() => useChatStreaming());
    act(() => result.current.scheduleStreamingUpdate(RUN, delta?.cleaned ?? ''));
    await waitFor(() => expect(result.current.stream.html).not.toBe(''));

    return render(<StreamingMessage html={result.current.stream.html} elapsedMs={0} />).container;
  }

  it('streams a tool result verbatim: no bold, code, links or HTML from inside it', async () => {
    const text = 'see **bold** and `code` at [label](https://example.com/x) <b>raw</b> & <img src=x onerror="alert(1)">';
    const container = await streamResult(text);

    // The block keeps the line break before its closing fence, as renderMarkdown always has
    const block = container.querySelector('.msg-body pre code');
    expect(block?.textContent).toBe(text + '\n');
    expect(container.querySelector('.msg-body pre :is(strong, em, a, b, img, code code)')).toBeNull();
    // Markdown outside the result still renders
    expect(container.querySelector('.msg-body > strong:last-of-type')?.textContent).toBe('done');
    expect(container.textContent).not.toMatch(LEAK);
  });

  it('streams a result that contains a fence inside its longer fence, with no stray backticks', async () => {
    const text = 'before\n```js\nconst x = **1**;\n```\nafter';
    const container = await streamResult(text);

    const blocks = container.querySelectorAll('.msg-body pre');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].querySelector('code')?.textContent).toBe(text + '\n');
    const outside = (container.querySelector('.msg-body')?.textContent ?? '').replace(blocks[0].textContent ?? '', '');
    expect(outside).not.toContain('`');
    expect(container.querySelector('.msg-body pre strong')).toBeNull();
  });
});
