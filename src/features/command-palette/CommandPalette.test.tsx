import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CommandPalette } from './CommandPalette';
import type { Command } from './types';

function staticCommand(id: string, label: string, action = vi.fn()): Command {
  return { id, label, action, category: 'actions' };
}

function sessionCommand(
  sessionKey: string,
  label: string,
  opts: { isActive?: boolean; keywords?: string[]; action?: ReturnType<typeof vi.fn> } = {},
): Command {
  return {
    id: `session-${sessionKey}`,
    label,
    action: opts.action ?? vi.fn(),
    category: 'sessions',
    keywords: opts.keywords,
    isActive: opts.isActive ?? false,
  };
}

describe('CommandPalette session entries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderPalette(commands: Command[], onClose = vi.fn()) {
    const result = render(<CommandPalette open commands={commands} onClose={onClose} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    return { ...result, onClose };
  }

  function input() {
    return screen.getByPlaceholderText(/search actions/i) as HTMLInputElement;
  }

  it('renders a Sessions section header when session commands are present', () => {
    const commands = [
      staticCommand('search', 'Search messages'),
      sessionCommand('agent:main:main', 'Main'),
    ];
    renderPalette(commands);
    expect(screen.getByText('Sessions')).toBeInTheDocument();
  });

  it('narrows results to matching session commands when typing', () => {
    const commands = [
      staticCommand('search', 'Search messages'),
      staticCommand('reset', 'Reset session'),
      sessionCommand('agent:reviewer:main', 'Reviewer Bot', {
        keywords: ['Reviewer Bot', 'reviewer', 'agent:reviewer:main'],
      }),
      sessionCommand('agent:planner:main', 'Planner Bot', {
        keywords: ['Planner Bot', 'planner', 'agent:planner:main'],
      }),
    ];
    renderPalette(commands);
    fireEvent.change(input(), { target: { value: 'reviewer' } });
    expect(screen.getByText('Reviewer Bot')).toBeInTheDocument();
    expect(screen.queryByText('Planner Bot')).not.toBeInTheDocument();
    expect(screen.queryByText('Search messages')).not.toBeInTheDocument();
  });

  it('fires the highlighted session action exactly once when Enter is pressed', () => {
    const action = vi.fn();
    const commands = [
      sessionCommand('agent:reviewer:main', 'Reviewer Bot', {
        keywords: ['reviewer'],
        action,
      }),
    ];
    const { onClose } = renderPalette(commands);
    fireEvent.change(input(), { target: { value: 'reviewer' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(100); });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('Esc closes the palette without firing any action', () => {
    const action = vi.fn();
    const commands = [
      sessionCommand('agent:reviewer:main', 'Reviewer Bot', { action }),
    ];
    const { onClose } = renderPalette(commands);
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();
  });

  it('ArrowDown moves selection forward one step and Enter fires that item', () => {
    const sessionAction = vi.fn();
    const staticAction = vi.fn();
    const commands = [
      staticCommand('toggle-log', 'Toggle Log Panel', staticAction),
      sessionCommand('agent:reviewer:main', 'Reviewer Bot', {
        keywords: ['Reviewer'],
        action: sessionAction,
      }),
    ];
    renderPalette(commands);
    // Sessions group sorts before actions per CATEGORY_ORDER, so index 0 is
    // Reviewer Bot and ArrowDown advances to index 1, Toggle Log Panel.
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    act(() => { vi.advanceTimersByTime(100); });
    expect(staticAction).toHaveBeenCalledTimes(1);
    expect(sessionAction).not.toHaveBeenCalled();
  });

  it('ArrowDown then ArrowUp returns to the previous selection', () => {
    const sessionAction = vi.fn();
    const staticAction = vi.fn();
    const commands = [
      staticCommand('toggle-log', 'Toggle Log Panel', staticAction),
      sessionCommand('agent:reviewer:main', 'Reviewer Bot', {
        keywords: ['Reviewer'],
        action: sessionAction,
      }),
    ];
    renderPalette(commands);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    act(() => { vi.advanceTimersByTime(100); });
    expect(sessionAction).toHaveBeenCalledTimes(1);
    expect(staticAction).not.toHaveBeenCalled();
  });

  it('marks the active session with aria-current and a "current" badge', () => {
    const commands = [
      sessionCommand('agent:main:main', 'Main', { isActive: true }),
      sessionCommand('agent:reviewer:main', 'Reviewer'),
    ];
    renderPalette(commands);
    const mainButton = screen.getByText('Main').closest('button')!;
    const reviewerButton = screen.getByText('Reviewer').closest('button')!;
    expect(mainButton).toHaveAttribute('aria-current', 'true');
    expect(reviewerButton).not.toHaveAttribute('aria-current');
    const badges = screen.getAllByText('current');
    expect(badges).toHaveLength(1);
    expect(mainButton).toContainElement(badges[0]);
  });

  it('does not render the active affordance for a non-session command with isActive', () => {
    const cmd: Command = {
      id: 'rogue',
      label: 'Rogue Command',
      action: vi.fn(),
      category: 'actions',
      isActive: true,
    };
    renderPalette([cmd]);
    const button = screen.getByText('Rogue Command').closest('button')!;
    expect(button).not.toHaveAttribute('aria-current');
    expect(screen.queryByText('current')).not.toBeInTheDocument();
  });

  it('clamps selectedIndex when typing narrows the filtered list below the cursor', () => {
    const first = vi.fn();
    const second = vi.fn();
    const commands = [
      sessionCommand('agent:alpha:main', 'Alpha', { keywords: ['Alpha'], action: first }),
      sessionCommand('agent:beta:main', 'Beta', { keywords: ['Beta'], action: second }),
      sessionCommand('agent:gamma:main', 'Gamma', { keywords: ['Gamma'], action: vi.fn() }),
    ];
    renderPalette(commands);
    // Move cursor to the third entry.
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    // Type a query that narrows results to one match (the first entry).
    fireEvent.change(input(), { target: { value: 'Alpha' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    act(() => { vi.advanceTimersByTime(100); });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('rapid double-Enter only fires the most-recent action once', () => {
    const first = vi.fn();
    const second = vi.fn();
    const commands = [
      sessionCommand('agent:alpha:main', 'Alpha', { keywords: ['Alpha'], action: first }),
      sessionCommand('agent:beta:main', 'Beta', { keywords: ['Beta'], action: second }),
    ];
    const { onClose } = renderPalette(commands);
    fireEvent.keyDown(input(), { key: 'Enter' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    act(() => { vi.advanceTimersByTime(100); });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('a new command surfaced via parent re-render is searchable without remount', () => {
    const initial = [sessionCommand('agent:main:main', 'Main')];
    const { rerender } = render(
      <CommandPalette open commands={initial} onClose={vi.fn()} />,
    );
    act(() => { vi.advanceTimersByTime(100); });

    const next = [
      sessionCommand('agent:main:main', 'Main'),
      sessionCommand('agent:newcomer:main', 'Newcomer', {
        keywords: ['Newcomer', 'newcomer', 'agent:newcomer:main'],
      }),
    ];
    rerender(<CommandPalette open commands={next} onClose={vi.fn()} />);
    fireEvent.change(input(), { target: { value: 'newcomer' } });
    expect(screen.getByText('Newcomer')).toBeInTheDocument();
  });

  it('shows the empty-state copy when no command matches', () => {
    const commands = [
      staticCommand('search', 'Search messages'),
      sessionCommand('agent:main:main', 'Main'),
    ];
    renderPalette(commands);
    fireEvent.change(input(), { target: { value: 'zzzzzzz-no-match' } });
    expect(screen.getByText(/no matching command/i)).toBeInTheDocument();
  });
});
