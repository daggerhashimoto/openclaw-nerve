import '@testing-library/jest-dom';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InlineSelect } from './InlineSelect';

describe('InlineSelect', () => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();

  it('prevents default on option pointerdown to avoid mobile click-through', () => {
    const onChange = vi.fn();

    render(
      <div>
        <InlineSelect
          value="default"
          onChange={onChange}
          options={[
            { value: 'default', label: 'Default' },
            { value: 'medium', label: 'medium' },
            { value: 'high', label: 'high' },
          ]}
          ariaLabel="Thinking"
          inline
        />
        <button type="button">Launch subagent</button>
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Thinking' }));

    const option = screen.getByRole('option', { name: 'medium' });
    const event = createEvent.pointerDown(option);
    fireEvent(option, event);

    expect(event.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledWith('medium');
  });
});
