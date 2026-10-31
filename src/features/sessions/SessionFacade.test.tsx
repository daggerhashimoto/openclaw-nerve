import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SessionFacade, type FacadeWindow } from './SessionFacade';

const windows: FacadeWindow[] = [
  { key: 'agent:main:main', state: 'live', label: 'Jen (main)' },
  { key: 'agent:patch:main', state: 'operator', label: 'Patch' },
  { key: 'agent:review:main', state: 'off', label: 'Reviewer Prime' },
];

describe('SessionFacade', () => {
  it('renders nothing without sessions', () => {
    const { container } = render(<SessionFacade windows={[]} currentSession="" onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('draws one lit window per session, in order, and names the counts', () => {
    render(<SessionFacade windows={windows} currentSession="agent:patch:main" onSelect={vi.fn()} />);

    const facade = screen.getByRole('group', { name: '3 sessions, 1 running, 1 waiting on you' });
    const buttons = within(facade).getAllByRole('button');
    expect(buttons.map((button) => button.querySelector('.pane')?.getAttribute('data-state'))).toEqual([
      'live',
      'operator',
      'off',
    ]);
    expect(buttons[0]).toHaveAccessibleName('Jen (main): Running');
    expect(buttons[1]).toHaveAccessibleName('Patch: Waiting on you');
    expect(buttons[1]).toHaveAttribute('aria-current', 'true');
    expect(buttons[2]).not.toHaveAttribute('aria-current');
    expect(buttons[0].querySelector('.pane')).toHaveClass('pane-lg');
  });

  it('opens a session when its window is clicked', () => {
    const onSelect = vi.fn();
    render(<SessionFacade windows={windows} currentSession="" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reviewer Prime: Idle' }));
    expect(onSelect).toHaveBeenCalledWith('agent:review:main');
  });
});
