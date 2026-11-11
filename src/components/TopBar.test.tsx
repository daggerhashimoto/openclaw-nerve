import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';

vi.mock('./NerveLogo', () => ({
  default: () => <div data-testid="nerve-logo" />,
}));

function renderTopBar(props: Partial<React.ComponentProps<typeof TopBar>> = {}) {
  return render(
    <TopBar
      onSettings={vi.fn()}
      agentLogEntries={[]}
      tokenData={null}
      logGlow={false}
      eventEntries={[]}
      eventsVisible={false}
      logVisible={false}
      viewMode="chat"
      onViewModeChange={vi.fn()}
      {...props}
    />,
  );
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
});
