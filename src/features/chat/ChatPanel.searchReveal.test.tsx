/**
 * Search reveals its match (#412).
 *
 * Rows that start folded (system lines, thinking, tool rows, tool groups and
 * their entries, notification strips, referenced memories) used to be counted
 * and scrolled to while their matching text stayed hidden. The current match's
 * row now opens, with whatever inside it holds the match, for as long as it is
 * the current match. Moving on or ending the search folds back what search
 * opened; what the operator opened or folded by hand stays as they left it.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { forwardRef } from 'react';
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

const scrollIntoView = vi.fn();

beforeAll(async () => {
  // Rows and bodies load the markdown renderer lazily; load it once up front.
  await import('@/features/markdown/MarkdownRenderer');
});

beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});

const at = (minute: number) => new Date(Date.UTC(2026, 10, 17, 10, minute));
const CALL = '**tool:** `read`\n```json\n{\n  "path": "notes.md"\n}\n```';

// Each row holds "needle" past what it shows while folded, followed by a word naming the row.
const prompt: ChatMsg = { msgId: 'u-1', role: 'user', html: '', rawText: 'Look into the logs', timestamp: at(0) };
const systemLine: ChatMsg = {
  msgId: 's-1', role: 'system', html: '', rawText: 'Gateway notice\nThe second line holds the needle alpha', timestamp: at(1),
};
const thinking: ChatMsg = {
  msgId: 't-1', role: 'assistant', isThinking: true, html: '', rawText: 'Considering the request. '.repeat(5) + 'needle bravo', timestamp: at(2),
};
const toolRow: ChatMsg = {
  msgId: 'tool-1', role: 'tool', html: 'reading notes.md', rawText: CALL, toolResult: 'line one\nthe needle charlie is here', timestamp: at(3),
};
const reply: ChatMsg = { msgId: 'a-1', role: 'assistant', html: '', rawText: 'Checked the notes.', timestamp: at(4) };
const group: ChatMsg = {
  msgId: 'g-1',
  role: 'tool',
  html: 'Used 3 tools',
  rawText: 'running command\nreading log.md\nreading old.md',
  timestamp: at(5),
  toolGroup: [
    { html: 'running command', rawText: '**tool:** `exec`', preview: 'running command', result: 'nothing to see' },
    { html: 'reading log.md', rawText: CALL, preview: 'reading log.md', result: 'the needle delta in the log' },
    { html: 'reading old.md', rawText: CALL, preview: 'reading old.md', result: 'a second needle golf' },
  ],
};
const strip: ChatMsg = {
  msgId: 'n-1', role: 'user', isSystemNotification: true, systemLabel: 'cleanup: completed', html: '',
  rawText: 'A background task "cleanup" just completed.\nFindings: the needle echo', timestamp: at(6),
};
const withMemories: ChatMsg = {
  msgId: 'u-2', role: 'user', html: '',
  rawText: '<relevant-memories>\nremember the needle foxtrot\n</relevant-memories>\nWhat did we decide?', timestamp: at(7),
};

const transcript = [prompt, systemLine, thinking, toolRow, reply, group, strip, withMemories];
const ROWS = ['needle alpha', 'needle bravo', 'needle charlie', 'needle delta', 'needle echo', 'needle foxtrot'] as const;

function panel(messages: ChatMsg[]) {
  return (
    <ChatPanel
      messages={messages}
      onSend={vi.fn()}
      onAbort={vi.fn()}
      isGenerating={false}
      stream={{ html: '', text: '' } as never}
      historyLoaded
      searchOpen
    />
  );
}

const searchFor = (query: string) =>
  fireEvent.change(screen.getByRole('textbox', { name: 'Search messages' }), { target: { value: query } });
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
const prev = () => fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));

/** Only this row's matching text is on screen; every other row's is still folded away. */
async function expectOnlyShown(container: HTMLElement, shown: (typeof ROWS)[number] | null) {
  if (shown) await waitFor(() => expect(container.textContent).toContain(shown));
  for (const other of ROWS) {
    if (other !== shown) expect(container.textContent).not.toContain(other);
  }
}

describe('search reveals its match inside folded rows', () => {
  it('opens the current match of every kind of folded row, one at a time, and folds it back on moving on', async () => {
    const { container } = render(panel(transcript));
    await expectOnlyShown(container, null);

    searchFor('needle');
    expect(screen.getByText('1 / 6')).toBeInTheDocument();

    await expectOnlyShown(container, 'needle alpha'); // system line
    next();
    await expectOnlyShown(container, 'needle bravo'); // thinking
    next();
    await expectOnlyShown(container, 'needle charlie'); // tool row result
    next();
    await expectOnlyShown(container, 'needle delta'); // tool group entry
    // Every entry whose result holds the query opens; the others stay folded
    expect(container.textContent).toContain('needle golf');
    expect(container.textContent).not.toContain('nothing to see');
    next();
    expect(container.textContent).not.toContain('needle golf');
    await expectOnlyShown(container, 'needle echo'); // notification strip
    next();
    await expectOnlyShown(container, 'needle foxtrot'); // referenced memories
    next();
    await expectOnlyShown(container, 'needle alpha'); // and round again
  });

  it('marks the match in the opened text and scrolls to it', async () => {
    const { container } = render(panel(transcript));

    searchFor('charlie');

    await waitFor(() => {
      const mark = container.querySelector('.tool-result mark.search-highlight');
      expect(mark?.textContent).toBe('charlie');
      expect(scrollIntoView.mock.contexts).toContain(mark);
    });
  });

  it('folds back what it opened when the search is cleared or closed', async () => {
    const { container } = render(panel(transcript));

    searchFor('needle');
    next();
    next();
    await expectOnlyShown(container, 'needle charlie');

    searchFor('');
    await expectOnlyShown(container, null);

    searchFor('delta');
    await expectOnlyShown(container, 'needle delta');
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    await expectOnlyShown(container, null);
  });

  it('never folds what the operator opened by hand', async () => {
    const { container } = render(panel(transcript));
    fireEvent.click(screen.getByRole('button', { name: /reading\s*notes\.md/ }));
    fireEvent.click(screen.getByRole('button', { name: /Used 3 tools/ }));
    fireEvent.click(screen.getByRole('button', { name: /reading\s*log\.md/ }));
    expect(container.textContent).toContain('needle charlie');
    expect(container.textContent).toContain('needle delta');

    searchFor('needle');
    for (let i = 0; i < 6; i++) next();
    searchFor('');

    expect(container.textContent).toContain('needle charlie');
    expect(container.textContent).toContain('needle delta');
  });

  it('lets the operator fold the revealed row, and opens it again on coming back to it', async () => {
    const { container } = render(panel(transcript));
    searchFor('needle');
    await expectOnlyShown(container, 'needle alpha');

    const header = screen.getByText('System').closest('[role="button"]') as HTMLElement;
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    await expectOnlyShown(container, null);

    next();
    await expectOnlyShown(container, 'needle bravo');
    prev();
    await expectOnlyShown(container, 'needle alpha');
  });

  it('folds an operator-opened row with one click while it is the current match', async () => {
    const { container } = render(panel(transcript));
    const row = screen.getByRole('button', { name: /reading\s*notes\.md/ });
    fireEvent.click(row);
    searchFor('charlie');
    expect(container.textContent).toContain('needle charlie');

    fireEvent.click(row);

    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(container.textContent).not.toContain('needle charlie');
  });

  it('opens a row the operator folded while it is the current match, then folds it back', async () => {
    const intermediate: ChatMsg = {
      msgId: 'i-1', role: 'assistant', intermediate: true, html: '', rawText: 'Short first line\nthen the needle hotel', timestamp: at(1),
    };
    const call: ChatMsg = { msgId: 'tool-2', role: 'tool', html: 'reading a.md', rawText: CALL, timestamp: at(2) };
    const later: ChatMsg = { msgId: 'a-2', role: 'assistant', html: '', rawText: 'Another needle india', timestamp: at(3) };
    const { container } = render(panel([prompt, intermediate, call, later]));
    // Intermediate narration starts open; the operator folds it
    await waitFor(() => expect(container.textContent).toContain('needle hotel'));
    const toggle = [...container.querySelectorAll<HTMLElement>('[role="button"][aria-expanded]')]
      .find((el) => el.textContent?.includes('needle hotel'));
    fireEvent.click(toggle as HTMLElement);
    expect(container.textContent).not.toContain('needle hotel');

    searchFor('needle');
    await waitFor(() => expect(container.textContent).toContain('needle hotel'));
    next();

    await waitFor(() => expect(container.textContent).toContain('needle india'));
    expect(container.textContent).not.toContain('needle hotel');
  });
});
