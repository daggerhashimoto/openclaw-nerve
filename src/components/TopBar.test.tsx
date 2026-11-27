import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';

vi.mock('./NerveLogo', () => ({
  default: ({ static: still }: { static?: boolean }) => <div data-testid="nerve-logo" data-still={String(Boolean(still))} />,
}));

const baseProps: React.ComponentProps<typeof TopBar> = {
  onSettings: vi.fn(),
  agentLogEntries: [],
  tokenData: null,
  logGlow: false,
  eventEntries: [],
  eventsVisible: false,
  logVisible: false,
  viewMode: 'chat',
  onViewModeChange: vi.fn(),
};

function renderTopBar(props: Partial<React.ComponentProps<typeof TopBar>> = {}) {
  return render(<TopBar {...baseProps} {...props} />);
}

describe('TopBar', () => {
  it('lights the brand pane with the fleet and names the state', () => {
    renderTopBar({ activity: 'live' });
    expect(screen.getByRole('img', { name: /agents working/i })).toHaveAttribute('data-state', 'live');
  });

  it('turns the brand pane cantaloupe when work waits on the operator', () => {
    renderTopBar({ activity: 'operator' });
    expect(screen.getByRole('img', { name: /waiting on you/i })).toHaveAttribute('data-state', 'operator');
  });

  it('keeps the brand pane dark and silent when the house is quiet', () => {
    const { container } = renderTopBar();
    const pane = container.querySelector('.nerve-brand-pane');
    expect(pane).toHaveAttribute('data-state', 'off');
    expect(pane).toHaveAttribute('aria-hidden', 'true');
  });

  it('fires the Nerve mark only while agents work', () => {
    const { unmount } = renderTopBar({ activity: 'live' });
    expect(screen.getByTestId('nerve-logo')).toHaveAttribute('data-still', 'false');
    unmount();

    for (const activity of ['off', 'operator', 'error'] as const) {
      const view = renderTopBar({ activity });
      expect(screen.getByTestId('nerve-logo')).toHaveAttribute('data-still', 'true');
      view.unmount();
    }
  });

  it('shows the tasks view toggle by default', () => {
    renderTopBar();

    expect(screen.getByRole('button', { name: /switch to tasks view/i })).toBeInTheDocument();
  });

  it('hides the tasks view toggle when kanban visibility is disabled', () => {
    renderTopBar({ showKanbanView: false });

    expect(screen.queryByRole('button', { name: /switch to tasks view/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /switch to chat view/i })).toBeInTheDocument();
  });

  it('does not render a top-bar Commands trigger', () => {
    renderTopBar();

    expect(screen.queryByRole('button', { name: /open command palette/i })).not.toBeInTheDocument();
  });

  it('openPanelRequest opens the workspace panel at compact layout', () => {
    const props = { mobilePanelButtonsVisible: true, workspacePanel: <div data-testid="workspace-content" /> };
    const { rerender } = renderTopBar(props);
    const launcher = screen.getByRole('button', { name: /toggle workspace panel/i });
    expect(launcher).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('workspace-content')).not.toBeInTheDocument();

    rerender(
      <TopBar {...baseProps} {...props} openPanelRequest={{ panel: 'workspace', nonce: 1 }} />,
    );

    expect(launcher).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('workspace-content')).toBeInTheDocument();

    // The same nonce again is not a request; the launcher still closes the panel.
    rerender(
      <TopBar {...baseProps} {...props} openPanelRequest={{ panel: 'workspace', nonce: 1 }} />,
    );
    fireEvent.click(launcher);
    expect(launcher).toHaveAttribute('aria-expanded', 'false');

    // A new nonce opens it again, and an open panel stays open.
    rerender(
      <TopBar {...baseProps} {...props} openPanelRequest={{ panel: 'workspace', nonce: 2 }} />,
    );
    expect(launcher).toHaveAttribute('aria-expanded', 'true');
    rerender(
      <TopBar {...baseProps} {...props} openPanelRequest={{ panel: 'workspace', nonce: 3 }} />,
    );
    expect(launcher).toHaveAttribute('aria-expanded', 'true');
  });

  it('does not replay an openPanelRequest it already applied when the bar mounts afresh', () => {
    const props = {
      mobilePanelButtonsVisible: true,
      workspacePanel: <div data-testid="workspace-content" />,
      openPanelRequest: { panel: 'workspace' as const, nonce: 50 },
    };
    const first = renderTopBar(props);
    expect(screen.getByRole('button', { name: /toggle workspace panel/i })).toHaveAttribute('aria-expanded', 'true');
    first.unmount();

    // The compact top bar unmounts while hidden and mounts again with the request still set.
    renderTopBar(props);

    expect(screen.getByRole('button', { name: /toggle workspace panel/i })).toHaveAttribute('aria-expanded', 'false');
  });
});
