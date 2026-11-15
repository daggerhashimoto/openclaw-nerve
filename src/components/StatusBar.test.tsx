import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { StatusBar } from './StatusBar';

vi.mock('@/contexts/GatewayContext', () => ({
  useGateway: () => ({}),
}));

vi.mock('./UpdateBadge', () => ({
  UpdateBadge: () => <span data-testid="update-badge" />,
}));

function renderStatusBar(props: Partial<ComponentProps<typeof StatusBar>> = {}) {
  return render(
    <StatusBar
      connectionState="connected"
      sessionCount={2}
      {...props}
    />,
  );
}

describe('StatusBar', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', '1.5.3');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the version and draws no decorative activity line', () => {
    renderStatusBar({ performanceMode: true });

    expect(screen.queryByRole('img', { name: 'Gateway activity' })).not.toBeInTheDocument();
    expect(screen.getByText('v1.5.3')).toBeInTheDocument();
  });

  it('reports the connection state in words', () => {
    const { rerender } = renderStatusBar();
    expect(screen.getByRole('status')).toHaveTextContent('Connected');
    expect(screen.getByRole('status').querySelector('.pane')).toBeNull();

    rerender(<StatusBar connectionState="reconnecting" sessionCount={2} />);
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');
    expect(screen.getByRole('status').querySelector('.pane')).toHaveAttribute('data-state', 'operator');

    rerender(<StatusBar connectionState="disconnected" sessionCount={2} />);
    expect(screen.getByRole('status')).toHaveTextContent('Disconnected');
    expect(screen.getByRole('status').querySelector('.pane')).toHaveAttribute('data-state', 'error');
  });

  it('falls back to the bare session count without session details', () => {
    const { container } = renderStatusBar();

    expect(screen.getByTitle('2 sessions')).toBeInTheDocument();
    expect(container.querySelector('.pane-strip')).toBeNull();
  });

  it('names what is running and waiting without drawing a strip of its own', () => {
    const sessions = [
      { sessionKey: 'agent:main:main' },
      { sessionKey: 'agent:main:subagent:scan' },
      { sessionKey: 'agent:patch:main' },
      { sessionKey: 'agent:auto:cron:nightly' },
      { key: 'agent:review:main', status: 'running' },
    ];
    const { container } = renderStatusBar({
      sessionCount: sessions.length,
      sessions,
      busyState: { 'agent:main:main': true },
      unreadSessions: { 'agent:patch:main': true },
    });

    expect(container.querySelector('.pane-strip')).toBeNull();
    expect(screen.getByTitle('5 sessions: 2 running, 1 waiting on you')).toBeInTheDocument();
  });

  it('omits zero clauses from the session summary', () => {
    renderStatusBar({
      sessionCount: 1,
      sessions: [{ sessionKey: 'agent:main:main' }],
      busyState: {},
      unreadSessions: { 'agent:main:main': true },
    });

    expect(screen.getByTitle('1 session: 1 waiting on you')).toBeInTheDocument();
    expect(screen.queryByText(/running/)).not.toBeInTheDocument();
  });

  it('shows the context meter as a percentage of the window', () => {
    renderStatusBar({ contextTokens: 122_000, contextLimit: 200_000 });

    expect(screen.getByText('Context')).toBeInTheDocument();
    expect(screen.getByText('61% of 200k')).toBeInTheDocument();
  });
});
