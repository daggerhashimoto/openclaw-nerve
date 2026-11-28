import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CronsTab } from './CronsTab';
import type { CronJob } from '../hooks/useCrons';

const mockUseCrons = vi.fn(() => ({
  jobs: [],
  isLoading: false,
  error: null as string | null,
  fetchJobs: vi.fn(),
  toggleJob: vi.fn(),
  runJob: vi.fn(),
  fetchRuns: vi.fn(),
  addJob: vi.fn(),
  updateJob: vi.fn(),
  deleteJob: vi.fn(),
}));

vi.mock('../hooks/useCrons', () => ({
  useCrons: () => mockUseCrons(),
}));

vi.mock('./CronDialog', () => ({
  CronDialog: () => null,
}));

vi.mock('@/contexts/SessionContext', () => ({
  useSessionContext: () => ({ refreshSessions: vi.fn() }),
}));

const scrollIntoView = vi.fn();

function makeJob(id: string, name: string): CronJob {
  return { id, name, enabled: true, scheduleKind: 'every', everyMs: 3_600_000, payloadKind: 'agentTurn' };
}

describe('CronsTab', () => {
  beforeEach(() => {
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it('shows the error banner and hides the empty state when fetching crons fails', () => {
    mockUseCrons.mockReturnValue({
      jobs: [],
      isLoading: false,
      error: 'Failed to fetch crons',
      fetchJobs: vi.fn(),
      toggleJob: vi.fn(),
      runJob: vi.fn(),
      fetchRuns: vi.fn(),
      addJob: vi.fn(),
      updateJob: vi.fn(),
      deleteJob: vi.fn(),
    });

    render(<CronsTab />);

    expect(screen.getByText('Failed to fetch crons')).toBeInTheDocument();
    expect(screen.queryByText(/no scheduled tasks yet/i)).not.toBeInTheDocument();
  });

  it('focusCronId expands that cron row', async () => {
    const fetchRuns = vi.fn(async () => [{ timestamp: new Date().toISOString(), status: 'ok' }]);
    mockUseCrons.mockReturnValue({
      jobs: [makeJob('cron-1', 'Nightly digest'), makeJob('cron-2', 'Weekly review')],
      isLoading: false,
      error: null,
      fetchJobs: vi.fn(),
      toggleJob: vi.fn(),
      runJob: vi.fn(),
      fetchRuns,
      addJob: vi.fn(),
      updateJob: vi.fn(),
      deleteJob: vi.fn(),
    });

    render(<CronsTab focusCronId="cron-2" />);

    const focused = screen.getByRole('button', { name: 'Weekly review' });
    await waitFor(() => expect(focused).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByRole('button', { name: 'Nightly digest' })).toHaveAttribute('aria-expanded', 'false');
    expect(fetchRuns).toHaveBeenCalledTimes(1);
    expect(fetchRuns).toHaveBeenCalledWith('cron-2');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect((scrollIntoView.mock.contexts[0] as Element).contains(focused)).toBe(true);
  });

  it('a second request with a new nonce for the same cron expands and scrolls to it again', async () => {
    const fetchRuns = vi.fn(async () => [{ timestamp: new Date().toISOString(), status: 'ok' }]);
    mockUseCrons.mockReturnValue({
      jobs: [makeJob('cron-1', 'Nightly digest'), makeJob('cron-2', 'Weekly review')],
      isLoading: false,
      error: null,
      fetchJobs: vi.fn(),
      toggleJob: vi.fn(),
      runJob: vi.fn(),
      fetchRuns,
      addJob: vi.fn(),
      updateJob: vi.fn(),
      deleteJob: vi.fn(),
    });

    const { rerender } = render(<CronsTab focusCronId="cron-2" focusNonce={1} />);
    const row = screen.getByRole('button', { name: 'Weekly review' });
    await waitFor(() => expect(row).toHaveAttribute('aria-expanded', 'true'));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'false');

    // The same request again changes nothing.
    rerender(<CronsTab focusCronId="cron-2" focusNonce={1} />);
    expect(row).toHaveAttribute('aria-expanded', 'false');

    rerender(<CronsTab focusCronId="cron-2" focusNonce={2} />);
    await waitFor(() => expect(row).toHaveAttribute('aria-expanded', 'true'));
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
