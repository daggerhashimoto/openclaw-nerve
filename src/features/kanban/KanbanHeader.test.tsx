import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KanbanHeader } from './KanbanHeader';
import type { KanbanProposal } from './hooks/useProposals';

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

function makeProposal(id: string, title: string): KanbanProposal {
  return {
    id,
    type: 'create',
    payload: { title },
    proposedBy: 'agent:designer',
    proposedAt: Date.now(),
    status: 'pending',
    version: 1,
  };
}

const proposals = [makeProposal('p-1', 'Alpha proposal'), makeProposal('p-2', 'Bravo proposal')];

function headerProps(props: Partial<React.ComponentProps<typeof KanbanHeader>> = {}): React.ComponentProps<typeof KanbanHeader> {
  return {
    filters: { q: '', priority: [], assignee: '', labels: [] },
    onFiltersChange: vi.fn(),
    statusCounts: {},
    onCreateTask: vi.fn(),
    proposals,
    pendingProposalCount: proposals.length,
    ...props,
  };
}

function renderHeader(props: Partial<React.ComponentProps<typeof KanbanHeader>> = {}) {
  return render(<KanbanHeader {...headerProps(props)} />);
}

describe('KanbanHeader', () => {
  it('keeps the proposal inbox closed until asked', () => {
    renderHeader();

    expect(screen.queryByText('Alpha proposal')).not.toBeInTheDocument();
  });

  it('highlightProposalId opens the inbox and marks the proposal', () => {
    renderHeader({ highlightProposalId: 'p-2' });

    const marked = screen.getByText('Bravo proposal').closest('[data-highlighted]');
    expect(marked).toHaveAttribute('data-highlighted', 'true');
    expect(screen.getByText('Alpha proposal').closest('[data-highlighted="true"]')).toBeNull();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(marked);
  });

  it('marks the proposal once it arrives after the inbox opened', () => {
    const view = renderHeader({ highlightProposalId: 'p-2', proposals: [], pendingProposalCount: 0 });
    expect(scrollIntoView).not.toHaveBeenCalled();

    view.rerender(<KanbanHeader {...headerProps({ highlightProposalId: 'p-2' })} />);

    expect(screen.getByText('Bravo proposal').closest('[data-highlighted]')).toHaveAttribute('data-highlighted', 'true');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
