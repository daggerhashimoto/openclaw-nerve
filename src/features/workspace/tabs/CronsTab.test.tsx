import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CronsTab } from './CronsTab';

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

describe('CronsTab', () => {
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
});
