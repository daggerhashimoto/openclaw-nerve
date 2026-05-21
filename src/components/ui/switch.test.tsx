import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './switch';

describe('Switch', () => {
  it('forwards aria-labelledby to the underlying switch button', () => {
    const onCheckedChange = vi.fn();

    render(
      <div>
        <span id="switch-label">Visible label</span>
        <Switch checked={false} onCheckedChange={onCheckedChange} aria-labelledby="switch-label" />
      </div>,
    );

    expect(screen.getByRole('switch')).toHaveAttribute('aria-labelledby', 'switch-label');
  });

  it('preserves aria-label support and toggles on click', () => {
    const onCheckedChange = vi.fn();

    render(
      <Switch checked={false} onCheckedChange={onCheckedChange} aria-label="Toggle something" />,
    );

    const toggle = screen.getByRole('switch', { name: 'Toggle something' });
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-label', 'Toggle something');
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
