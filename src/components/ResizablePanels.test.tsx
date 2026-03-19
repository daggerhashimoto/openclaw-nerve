/** Tests for the ResizablePanels component. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResizablePanels } from './ResizablePanels';

describe('ResizablePanels', () => {
  it('allows the right sidebar to shrink to 15% by clamping the left pane to 85%', () => {
    const onResize = vi.fn();
    const { container } = render(
      <ResizablePanels
        left={<div>Left</div>}
        right={<div>Right</div>}
        leftPercent={55}
        onResize={onResize}
      />,
    );

    const panelRoot = container.firstElementChild as HTMLDivElement;
    vi.spyOn(panelRoot, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 500,
      width: 1000,
      height: 500,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.mouseDown(screen.getByTitle('Drag to resize. Double click to reset'));
    fireEvent.mouseMove(window, { clientX: 900 });
    fireEvent.mouseUp(window);

    expect(onResize).toHaveBeenCalledWith(85);
  });
});
