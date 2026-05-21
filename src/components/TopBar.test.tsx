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
