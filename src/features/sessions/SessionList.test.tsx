import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Session } from '@/types';
import { SessionList } from './SessionList';
import { AGENT_HUES, resetAgentHues } from '@/lib/agentColors';

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

  it('leads each row with a pane and names the state in plain text', () => {
    const sessions: Session[] = [
      { sessionKey: 'agent:main:main', label: 'Main' },
      { sessionKey: 'agent:reviewer:main', label: 'Reviewer' },
      { sessionKey: 'agent:ops:main', label: 'Ops' },
    ];

    const { container } = renderSessionList({
      sessions,
      busyState: { 'agent:main:main': true },
      agentStatus: { 'agent:main:main': { status: 'THINKING', since: 0 } },
      unreadSessions: { 'agent:reviewer:main': true },
    });

    expect(screen.getByRole('img', { name: 'Running' })).toHaveAttribute('data-state', 'live');
    expect(screen.getByText('waiting on you')).toBeInTheDocument();
    expect(screen.getByText('idle')).toBeInTheDocument();
    // One operator pane in the rows, and the facade above them shows the same three sessions in row order (Main, Ops, Reviewer)
    expect(container.querySelectorAll('.pane[data-state="operator"]:not(.pane-lg)')).toHaveLength(1);
    expect(
      Array.from(container.querySelectorAll('.facade .pane')).map((pane) => pane.getAttribute('data-state')),
    ).toEqual(['live', 'off', 'operator']);
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('tints rows and facade windows with the agent family hue, shaded for children, and lets the operator pick one', () => {
    resetAgentHues();
    const sessions: Session[] = [
      { sessionKey: 'agent:main:main', label: 'Main' },
      { sessionKey: 'agent:main:subagent:scan', label: 'Scan' },
      { sessionKey: 'agent:ops:main', label: 'Ops' },
    ];
    const [cantaloupe, mint, lilac] = AGENT_HUES.map((hue) => hue.hex);

    const { container } = renderSessionList({ sessions });

    const facadeHues = () => Array.from(container.querySelectorAll<HTMLElement>('.facade .pane'))
      .map((pane) => pane.style.getPropertyValue('--pane-hue'));
    expect(facadeHues()).toEqual([cantaloupe, `color-mix(in srgb, ${cantaloupe} 62%, white)`, mint]);
    expect(container.querySelectorAll('.pane-hued').length).toBeGreaterThanOrEqual(6);

    // Root rows offer a colour action; children do not
    const colourButtons = screen.getAllByRole('button', { name: 'Agent colour' });
    expect(colourButtons).toHaveLength(2);

    fireEvent.click(colourButtons[1]);
    const swatches = within(screen.getByRole('group', { name: 'Agent colour' })).getAllByRole('button');
    expect(swatches).toHaveLength(AGENT_HUES.length);
    fireEvent.click(within(screen.getByRole('group', { name: 'Agent colour' })).getByRole('button', { name: 'Lilac' }));

    expect(facadeHues()[2]).toBe(lilac);
    expect(JSON.parse(localStorage.getItem('nerve:agent-colors') ?? '{}')).toMatchObject({ main: cantaloupe, ops: lilac });
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
