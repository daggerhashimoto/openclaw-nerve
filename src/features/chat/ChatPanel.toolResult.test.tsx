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
import { processChatMessages } from './operations/loadHistory';
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

beforeAll(() => {
  // jsdom has no layout; the panel scrolls its list into view.
  Element.prototype.scrollIntoView = vi.fn();
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

function panel(messages: ChatMsg[]) {
  return (
    <ChatPanel
      messages={messages}
      onSend={vi.fn()}
      onAbort={vi.fn()}
      isGenerating={false}
      stream={{ html: '', text: '' } as never}
      historyLoaded
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

  it('keeps the text of a message that also carries a tool result block, without sentinels', async () => {
    const mixed = entry('u-2', 3, {
      role: 'user',
      content: [
        { type: 'tool_result', content: 'file body' },
        { type: 'text', text: 'Carry on' },
      ],
    });
    const { container } = render(panel(processChatMessages([prompt, mixed])));

    expect(await screen.findByText('Carry on')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(LEAK);
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

  it('streams a message carrying a tool result without sentinels or markup from the result', async () => {
    const delta = extractStreamDelta({
      state: 'delta',
      message: {
        role: 'assistant',
        content: [
          { type: 'toolResult', content: [{ type: 'text', text: 'see <b>raw</b> & <img src=x onerror="alert(1)">' }] },
          { type: 'text', text: 'Reading done' },
        ],
      },
    });
    expect(delta).not.toBeNull();
    expect(delta?.text).not.toMatch(LEAK);

    const { result } = renderHook(() => useChatStreaming());
    act(() => result.current.scheduleStreamingUpdate(RUN, delta?.cleaned ?? ''));
    await waitFor(() => expect(result.current.stream.html).not.toBe(''));

    const { container } = render(<StreamingMessage html={result.current.stream.html} elapsedMs={0} />);
    expect(container.textContent).toContain('see <b>raw</b> & <img src=x onerror="alert(1)">');
    expect(container.textContent).toContain('Reading done');
    expect(container.querySelector('.msg-body b, .msg-body img')).toBeNull();
    expect(container.textContent).not.toMatch(LEAK);
  });
});
