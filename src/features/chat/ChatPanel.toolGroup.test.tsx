/**
 * The open/closed state of a tool group while the agent works.
 *
 * During a run, each finished tool call refreshes history, and the group is
 * rebuilt with one more entry. An operator who opened the group should keep
 * watching the calls arrive inside it, not have it fold shut on every call.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { forwardRef } from 'react';
import type { ChatMessage } from '@/types';
import { processChatMessages } from './operations/loadHistory';
import { ChatPanel } from './ChatPanel';

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

const T0 = Date.parse('2026-11-11T14:00:00Z');
const RUN = 'run-tools';

/** One gateway transcript entry, with the stable id the gateway puts on every entry. */
function entry(id: string, seq: number, message: Omit<ChatMessage, '__openclaw'>): ChatMessage {
  return { ...message, timestamp: T0 + seq * 1000, __openclaw: { runId: RUN, id, seq } } as ChatMessage;
}

function toolCall(id: string, seq: number, command: string): ChatMessage {
  return entry(id, seq, {
    role: 'assistant',
    content: [{ type: 'toolCall', name: 'exec', arguments: { command } }],
  } as Omit<ChatMessage, '__openclaw'>);
}

const prompt = entry('u-1', 0, { role: 'user', content: 'Check the repo' } as Omit<ChatMessage, '__openclaw'>);
const calls = [
  toolCall('t-1', 1, 'git status'),
  toolCall('t-2', 2, 'git log -1'),
  toolCall('t-3', 3, 'ls src'),
];

function panel(raw: ChatMessage[]) {
  return (
    <ChatPanel
      messages={processChatMessages(raw)}
      onSend={vi.fn()}
      onAbort={vi.fn()}
      isGenerating
      stream={{ html: '', text: '' } as never}
      historyLoaded
    />
  );
}

const groupButton = (count: number) => screen.getByRole('button', { name: new RegExp(`Used ${count} tools`) });

describe('ChatPanel tool group while the agent works', () => {
  it('opens on the first click', () => {
    render(panel([prompt, calls[0], calls[1]]));
    const group = groupButton(2);
    expect(group).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(group);

    expect(groupButton(2)).toHaveAttribute('aria-expanded', 'true');
  });

  it('stays open and shows each new call as it arrives', () => {
    const { rerender } = render(panel([prompt, calls[0], calls[1]]));
    fireEvent.click(groupButton(2));
    expect(groupButton(2)).toHaveAttribute('aria-expanded', 'true');

    // The next tool call finishes and history is reloaded with it.
    rerender(panel([prompt, ...calls]));

    expect(groupButton(3)).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/ls src/)).toBeVisible();
  });

  it('stays closed when the operator closed it', () => {
    const { rerender } = render(panel([prompt, calls[0], calls[1]]));
    fireEvent.click(groupButton(2));
    fireEvent.click(groupButton(2));
    expect(groupButton(2)).toHaveAttribute('aria-expanded', 'false');

    rerender(panel([prompt, ...calls]));

    expect(groupButton(3)).toHaveAttribute('aria-expanded', 'false');
  });
});
