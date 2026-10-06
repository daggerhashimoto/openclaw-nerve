import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

describe('SessionList actions', () => {
  it('allows renaming and deleting direct child sessions', () => {
    const sessions: Session[] = [
      { sessionKey: 'agent:reviewer:main', label: 'Reviewer' },
      { sessionKey: 'agent:reviewer:telegram:direct:123', displayName: 'Telegram DM' },
    ];

    renderSessionList({ sessions, compact: true, onRename: vi.fn(), onDelete: vi.fn() });

    fireEvent.click(screen.getAllByLabelText('Session actions')[1]!);

    expect(screen.getByTitle('Rename session')).toBeInTheDocument();
    expect(screen.getByTitle('Delete session')).toBeInTheDocument();
  });

  it('allows renaming and deleting ACP child sessions', () => {
    const sessions: Session[] = [
      { sessionKey: 'agent:codex:main', label: 'Codex' },
      { sessionKey: 'agent:codex:acp:123', displayName: 'ACP Session', parentId: 'agent:codex:main' },
    ];

    renderSessionList({ sessions, compact: true, onRename: vi.fn(), onDelete: vi.fn() });

    fireEvent.click(screen.getAllByLabelText('Session actions')[1]!);

    expect(screen.getByTitle('Rename session')).toBeInTheDocument();
    expect(screen.getByTitle('Delete session')).toBeInTheDocument();
  });

  it('shows an informational dialog when deleting a main agent session', () => {
    const sessions: Session[] = [
      { sessionKey: 'agent:reviewer:main', label: 'Reviewer' },
    ];

    renderSessionList({ sessions, compact: true, onRename: vi.fn(), onDelete: vi.fn() });

    fireEvent.click(screen.getByLabelText('Session actions'));
    fireEvent.click(screen.getByTitle('Delete session'));

    expect(screen.getByText('Cannot Delete Main Agent Session')).toBeInTheDocument();
    expect(screen.getByText(/Main agent sessions are not deletable/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'docs.openclaw.ai/cli/agents' })).toHaveAttribute('href', 'https://docs.openclaw.ai/cli/agents');
  });
});
