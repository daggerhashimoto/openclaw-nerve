import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Session } from '@/types';
import { SessionList } from './SessionList';

vi.mock('@/components/skeletons', () => ({
  SessionSkeletonGroup: ({ count = 4 }: { count?: number }) => (
    <div data-testid="session-skeleton-group">Loading {count}</div>
  ),
}));

function renderSessionList(props: Partial<React.ComponentProps<typeof SessionList>> = {}) {
  return render(
    <SessionList
      sessions={[]}
      currentSession=""
      busyState={{}}
      onSelect={() => {}}
      onRefresh={() => {}}
      {...props}
    />,
  );
}

describe('SessionList empty state', () => {
  it('shows the empty state when all sessions are filtered out of the agent sidebar', () => {
    const sessions: Session[] = [
      { sessionKey: 'discord:sean', label: 'Discord Root' },
      { sessionKey: 'whatsapp:sean', label: 'WhatsApp Root' },
    ];

    renderSessionList({ sessions });

    expect(screen.getByText('No active sessions')).toBeInTheDocument();
  });

  it('shows orphaned agent descendants instead of the empty state when cleanup removed the root row', () => {
    const sessions: Session[] = [
      { sessionKey: 'agent:main:telegram:direct:123', displayName: 'Telegram DM' },
      { sessionKey: 'agent:reviewer:subagent:abc123', label: 'Worker' },
      { sessionKey: 'discord:sean', label: 'Discord Root' },
    ];

    renderSessionList({ sessions });

    expect(screen.getByText('Telegram DM')).toBeInTheDocument();
    expect(screen.getByText('Worker')).toBeInTheDocument();
    expect(screen.queryByText('No active sessions')).not.toBeInTheDocument();
  });

  it('shows the loading skeleton when loading and all sessions are filtered out', () => {
    const sessions: Session[] = [
      { sessionKey: 'discord:sean', label: 'Discord Root' },
    ];

    renderSessionList({ sessions, isLoading: true });

    expect(screen.getByTestId('session-skeleton-group')).toBeInTheDocument();
    expect(screen.queryByText('No active sessions')).not.toBeInTheDocument();
  });
});
