import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LiveHorizon, LIVE_HORIZON_FLAG_KEY } from './LiveHorizon';
import { PERFORMANCE_MODE_STORAGE_KEY } from '@/lib/performanceMode';

describe('LiveHorizon', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('rises while the session works when the flag is on', () => {
    localStorage.setItem(LIVE_HORIZON_FLAG_KEY, 'true');
    render(<LiveHorizon active />);

    const horizon = screen.getByTestId('live-horizon');
    expect(horizon).toHaveAttribute('aria-hidden', 'true');
    expect(horizon.querySelectorAll('.nerve-horizon-bar').length).toBe(96);
  });

  it('is not in the DOM while the session is idle', () => {
    localStorage.setItem(LIVE_HORIZON_FLAG_KEY, 'true');
    render(<LiveHorizon active={false} />);
    expect(screen.queryByTestId('live-horizon')).not.toBeInTheDocument();
  });

  it('stays off without the prototype flag', () => {
    render(<LiveHorizon active />);
    expect(screen.queryByTestId('live-horizon')).not.toBeInTheDocument();
  });

  it('stays off in performance mode', () => {
    localStorage.setItem(LIVE_HORIZON_FLAG_KEY, 'true');
    localStorage.setItem(PERFORMANCE_MODE_STORAGE_KEY, 'true');
    render(<LiveHorizon active />);
    expect(screen.queryByTestId('live-horizon')).not.toBeInTheDocument();
  });
});
