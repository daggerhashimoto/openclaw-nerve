/**
 * Scrolling to a search match whose text renders lazily.
 *
 * Thinking blocks and system lines render through the lazy markdown renderer.
 * When its chunk has not loaded yet, the opened row first holds only the
 * Suspense fallback, so the highlight the search scrolls to does not exist yet.
 * The panel waits for it, scrolls to it once, and stops watching when the
 * current match changes. The renderer is deliberately not preloaded here: each
 * test imports a fresh ChatPanel, whose lazy renderer starts unloaded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { forwardRef } from 'react';
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

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});

/** A ChatPanel from a fresh module graph, so its lazy markdown renderer has not loaded. */
async function freshChatPanel() {
  vi.resetModules();
  return (await import('./ChatPanel')).ChatPanel;
}

const at = (minute: number) => new Date(Date.UTC(2026, 10, 17, 12, minute));
const prompt: ChatMsg = { msgId: 'u-1', role: 'user', html: '', rawText: 'Think it over', timestamp: at(0) };
const thinking: ChatMsg = {
  msgId: 't-1', role: 'assistant', isThinking: true, html: '', rawText: 'Weighing the options. '.repeat(40) + 'the needle bravo', timestamp: at(1),
};
const systemLine: ChatMsg = {
  msgId: 's-1', role: 'system', html: '', rawText: 'Gateway notice\n' + 'Details follow. '.repeat(40) + 'the needle alpha', timestamp: at(2),
};
const toolRow: ChatMsg = {
  msgId: 'tool-1', role: 'tool', html: 'reading notes.md', rawText: '**tool:** `read`\n```json\n{}\n```', toolResult: 'the needle charlie', timestamp: at(3),
};

const searchFor = (query: string) =>
  fireEvent.change(screen.getByRole('textbox', { name: 'Search messages' }), { target: { value: query } });

/** Elements scrollIntoView was called on, in order. */
const scrolledTo = () => scrollIntoView.mock.contexts as Element[];

describe('scrolling to a search match that renders lazily', () => {
  it.each([
    ['thinking block', thinking, 'bravo'],
    ['system line', systemLine, 'alpha'],
  ])('scrolls to the match in a folded %s once its text has rendered', async (_kind, row, query) => {
    const ChatPanel = await freshChatPanel();
    const { container } = render(
      <ChatPanel messages={[prompt, row]} onSend={vi.fn()} onAbort={vi.fn()} isGenerating={false}
        stream={{ html: '', text: '' } as never} historyLoaded searchOpen />,
    );

    searchFor(query);

    // The row has opened, but its body is still the renderer's fallback
    expect(container.textContent).toContain('Loading');
    expect(container.querySelector('mark.search-highlight')).toBeNull();

    await waitFor(() => {
      const mark = container.querySelector('mark.search-highlight');
      expect(mark?.textContent).toBe(query);
      expect(scrolledTo()).toContain(mark);
    }, { timeout: 5000 });
    // Once, and nothing after it
    const mark = container.querySelector('mark.search-highlight');
    expect(scrolledTo().filter((el) => el === mark)).toHaveLength(1);
  }, 10000);

  it('stops waiting for a match that is no longer the current one', async () => {
    const ChatPanel = await freshChatPanel();
    const { container } = render(
      <ChatPanel messages={[prompt, thinking, toolRow]} onSend={vi.fn()} onAbort={vi.fn()} isGenerating={false}
        stream={{ html: '', text: '' } as never} historyLoaded searchOpen />,
    );
    // Opened by hand, the thinking block stays open, and its text still renders after the match moves on
    fireEvent.click(screen.getByText('Thinking').closest('[role="button"]') as HTMLElement);

    searchFor('needle');
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));

    await waitFor(() => expect(container.querySelector('.tool-result mark.search-highlight')).not.toBeNull());
    const current = container.querySelector('.tool-result mark.search-highlight');
    await waitFor(() => expect(scrolledTo()).toContain(current));

    // The thinking block's text renders later, with its own mark: no scroll goes there
    await waitFor(() => expect(container.textContent).toContain('needle bravo'), { timeout: 5000 });
    const stale = [...container.querySelectorAll('mark.search-highlight')].find((el) => el !== current);
    expect(stale).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scrolledTo()).not.toContain(stale);
  }, 10000);
});
