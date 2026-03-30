import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SessionInfoPanel } from './SessionInfoPanel';
import type { Session } from '@/types';

const baseSession: Session = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  title: 'Test Session',
  model: 'gpt-test',
  totalTokens: 1200,
  contextTokens: 10000,
  updatedAt: Date.now(),
} as Session;

describe('SessionInfoPanel hover delay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not open the popup immediately on hover', () => {
    vi.useFakeTimers();
    render(
      <SessionInfoPanel session={baseSession}>
        <span>Hover target</span>
      </SessionInfoPanel>
    );

    const wrapper = screen.getByText('Hover target').closest('.relative');
    fireEvent.mouseEnter(wrapper!);

    // Should not be visible yet
    expect(screen.queryByText('Model')).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(499); });
    expect(screen.queryByText('Model')).not.toBeInTheDocument();
  });

  it('opens the popup after the delay', () => {
    vi.useFakeTimers();
    render(
      <SessionInfoPanel session={baseSession}>
        <span>Hover target</span>
      </SessionInfoPanel>
    );

    const wrapper = screen.getByText('Hover target').closest('.relative');
    fireEvent.mouseEnter(wrapper!);

    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByText('Model')).toBeInTheDocument();
  });

  it('cancels the popup if the cursor leaves before the delay', () => {
    vi.useFakeTimers();
    render(
      <SessionInfoPanel session={baseSession}>
        <span>Hover target</span>
      </SessionInfoPanel>
    );

    const wrapper = screen.getByText('Hover target').closest('.relative');
    fireEvent.mouseEnter(wrapper!);
    act(() => { vi.advanceTimersByTime(300); });
    fireEvent.mouseLeave(wrapper!);
    act(() => { vi.advanceTimersByTime(500); });

    expect(screen.queryByText('Model')).not.toBeInTheDocument();
  });
});
