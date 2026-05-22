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

  it('ArrowDown/ArrowUp moves selection through a mixed list and Enter fires the highlighted item', () => {
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
    // No filter: sessions group sorts before navigation per CATEGORY_ORDER,
    // so index 0 is Reviewer Bot.
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    act(() => { vi.advanceTimersByTime(100); });
    expect(sessionAction).toHaveBeenCalledTimes(1);
    expect(staticAction).not.toHaveBeenCalled();
  });

  it('marks the active session with aria-current and data-active-session', () => {
    const commands = [
      sessionCommand('agent:main:main', 'Main', { isActive: true }),
      sessionCommand('agent:reviewer:main', 'Reviewer'),
    ];
    renderPalette(commands);
    const mainButton = screen.getByText('Main').closest('button')!;
    const reviewerButton = screen.getByText('Reviewer').closest('button')!;
    expect(mainButton).toHaveAttribute('aria-current', 'true');
    expect(mainButton).toHaveAttribute('data-active-session', 'true');
    expect(reviewerButton).not.toHaveAttribute('aria-current');
    expect(reviewerButton).not.toHaveAttribute('data-active-session');
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
