import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResizablePanels } from './ResizablePanels';

describe('ResizablePanels', () => {
  it('keeps the divider interactive when right pane width is fixed', () => {
    const onResize = vi.fn();
    const onRightWidthChange = vi.fn();

    render(
      <ResizablePanels
        left={<div>left</div>}
        right={<div>right</div>}
        leftPercent={55}
        onResize={onResize}
        rightWidthPx={320}
        onRightWidthChange={onRightWidthChange}
      />,
    );

    const container = screen.getByText('left').parentElement?.parentElement as HTMLDivElement;
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
      toJSON: () => ({}),
    });

    const separator = screen.getByRole('separator', { name: 'Resize panels' });
    fireEvent.mouseDown(separator, { clientX: 680 });
    fireEvent.mouseMove(window, { clientX: 700 });
    fireEvent.mouseUp(window);

    expect(onRightWidthChange).toHaveBeenCalledWith(300);
    expect(onResize).toHaveBeenCalledWith(70);
  });
});
