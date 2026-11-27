import '@testing-library/jest-dom';
import { useState } from 'react';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineSelect } from './InlineSelect';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

const THINKING_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
];

function renderSelect(
  overrides: Partial<React.ComponentProps<typeof InlineSelect>> = {},
) {
  const onChange = overrides.onChange ?? vi.fn();
  render(
    <div>
      <InlineSelect
        value="default"
        onChange={onChange}
        options={THINKING_OPTIONS}
        ariaLabel="Thinking"
        {...overrides}
      />
      <button type="button">Underlying action</button>
    </div>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Thinking' }));
  return { onChange };
}

function touchDown(
  element: Element,
  { x = 40, y = 320, pointerId = 1 }: { x?: number; y?: number; pointerId?: number } = {},
) {
  const event = createEvent.pointerDown(element, {
    pointerId,
    pointerType: 'touch',
    clientX: x,
    clientY: y,
  });
  fireEvent(element, event);
  return event;
}

describe('InlineSelect', () => {
  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('selects immediately on a mouse press', () => {
    const { onChange } = renderSelect();

    fireEvent.pointerDown(screen.getByRole('option', { name: 'medium' }), {
      pointerType: 'mouse',
    });

    expect(onChange).toHaveBeenCalledWith('medium');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does not select or block scrolling on the initial touch press', () => {
    const { onChange } = renderSelect();
    const option = screen.getByRole('option', { name: 'medium' });

    const down = touchDown(option);

    expect(down.defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('treats a vertical drag as a scroll and does not commit', () => {
    const { onChange } = renderSelect();
    const option = screen.getByRole('option', { name: 'medium' });

    touchDown(option, { x: 40, y: 320 });
    fireEvent.pointerMove(option, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 42,
      clientY: 260,
    });
    fireEvent.pointerUp(option, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 42,
      clientY: 260,
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    // Some browsers still synthesize a click at the end of a drag; it must not
    // select the option the finger happened to end on.
    fireEvent.click(screen.getByRole('option', { name: 'high' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores a press cancelled by the browser', () => {
    const { onChange } = renderSelect();
    const option = screen.getByRole('option', { name: 'medium' });

    touchDown(option);
    fireEvent.pointerCancel(option, { pointerId: 1, pointerType: 'touch' });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('commits a tap on pointerup and swallows the compatibility click', () => {
    const { onChange } = renderSelect();
    const option = screen.getByRole('option', { name: 'medium' });

    touchDown(option, { x: 40, y: 320 });
    fireEvent.pointerUp(option, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 41,
      clientY: 321,
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('medium');
    expect(screen.queryByRole('listbox')).toBeNull();

    // The browser fires this click at the tap location after the menu closes.
    const underlying = screen.getByRole('button', { name: 'Underlying action' });
    const onUnderlying = vi.fn();
    underlying.addEventListener('click', onUnderlying);
    fireEvent.click(underlying);

    expect(onUnderlying).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(underlying).toBeInTheDocument();
  });

  it('keeps long lists scrollable inside the viewport', () => {
    const options = Array.from({ length: 40 }, (_, index) => ({
      value: `option-${index}`,
      label: `Option ${index}`,
    }));
    const onChange = vi.fn();
    renderSelect({ options, onChange, value: 'option-0' });

    const listbox = screen.getByRole('listbox');
    expect(listbox).toHaveClass('overflow-auto');
    expect(listbox.style.maxHeight).toBe('320px');
    expect(listbox.style.touchAction).toBe('pan-y');
    expect(listbox.style.overscrollBehavior).toBe('contain');

    // Dragging a long list must scroll it, not select the item under the finger.
    const option = screen.getByRole('option', { name: 'Option 12' });
    touchDown(option, { y: 500 });
    fireEvent.pointerMove(option, { pointerId: 1, pointerType: 'touch', clientX: 40, clientY: 380 });
    fireEvent.pointerUp(option, { pointerId: 1, pointerType: 'touch', clientX: 40, clientY: 380 });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('portals a fixed menu and flips it above a trigger near the bottom edge', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(768);
    const onChange = vi.fn();
    render(
      <InlineSelect
        value="default"
        onChange={onChange}
        options={THINKING_OPTIONS}
        ariaLabel="Thinking"
        inline
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Thinking' });
    trigger.getBoundingClientRect = () => ({
      top: 700,
      bottom: 732,
      left: 40,
      right: 160,
      width: 120,
      height: 32,
      x: 40,
      y: 700,
      toJSON: () => ({}),
    }) as DOMRect;

    fireEvent.click(trigger);

    const listbox = screen.getByRole('listbox');
    // Escapes the trigger's overflow container entirely.
    expect(listbox.parentElement).toBe(document.body);
    expect(listbox).toHaveAttribute('data-placement', 'top');
    expect(listbox.style.position).toBe('fixed');
    expect(listbox.style.bottom).toBe('72px');
    expect(listbox.style.maxHeight).toBe('320px');
  });

  it('captures the option value at press time so a swapped list cannot select a stale index', () => {
    const onChange = vi.fn();
    const first = [
      { value: 'alpha', label: 'Alpha' },
      { value: 'beta', label: 'Beta' },
    ];
    const second = [
      { value: 'gamma', label: 'Gamma' },
      { value: 'delta', label: 'Delta' },
    ];

    const { rerender } = render(
      <InlineSelect value="alpha" onChange={onChange} options={first} ariaLabel="Model" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Model' }));
    const option = screen.getByRole('option', { name: 'Beta' });
    touchDown(option);
    rerender(<InlineSelect value="alpha" onChange={onChange} options={second} ariaLabel="Model" />);
    fireEvent.pointerUp(screen.getByRole('option', { name: 'Delta' }), {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 41,
      clientY: 321,
    });

    expect(onChange).toHaveBeenCalledWith('beta');
  });

  it('wires the trigger to the portaled listbox with aria-controls', () => {
    renderSelect();
    const trigger = screen.getByRole('button', { name: 'Thinking' });
    const listbox = screen.getByRole('listbox');

    expect(trigger).toHaveAttribute('aria-controls', listbox.id);
    expect(listbox.id).toBeTruthy();
  });

  it('never floors the menu height past the space available', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(180);
    render(
      <InlineSelect
        value="default"
        onChange={vi.fn()}
        options={THINKING_OPTIONS}
        ariaLabel="Thinking"
        dropUp
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Thinking' });
    trigger.getBoundingClientRect = () => ({
      top: 10,
      bottom: 42,
      left: 40,
      right: 160,
      width: 120,
      height: 32,
      x: 40,
      y: 10,
      toJSON: () => ({}),
    }) as DOMRect;

    fireEvent.click(trigger);
    const listbox = screen.getByRole('listbox');
    // No room above, so the menu flips below instead of collapsing to 0px.
    expect(listbox).toHaveAttribute('data-placement', 'bottom');
    expect(Number.parseFloat(listbox.style.maxHeight)).toBeGreaterThan(0);
  });

  it('opens below the trigger when there is room', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(768);
    render(
      <div style={{ height: 120, overflow: 'hidden' }}>
        <InlineSelect
          value="default"
          onChange={vi.fn()}
          options={THINKING_OPTIONS}
          ariaLabel="Thinking"
        />
      </div>,
    );

    const trigger = screen.getByRole('button', { name: 'Thinking' });
    trigger.getBoundingClientRect = () => ({
      top: 100,
      bottom: 132,
      left: 40,
      right: 160,
      width: 120,
      height: 32,
      x: 40,
      y: 100,
      toJSON: () => ({}),
    }) as DOMRect;

    fireEvent.click(trigger);

    const listbox = screen.getByRole('listbox');
    expect(listbox.parentElement).toBe(document.body);
    expect(listbox).toHaveAttribute('data-placement', 'bottom');
    expect(listbox.style.top).toBe('136px');
  });

  it('lets its own touch and wheel scrolling bypass the dialog scroll lock', async () => {
    const onChange = vi.fn();
    const onDocumentTouchMove = vi.fn();
    const onDocumentWheel = vi.fn();
    document.addEventListener('touchmove', onDocumentTouchMove);
    document.addEventListener('wheel', onDocumentWheel);

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogTitle>Configure agent</DialogTitle>
            <DialogDescription>Pick a model.</DialogDescription>
            <InlineSelect
              value="default"
              onChange={onChange}
              options={Array.from({ length: 30 }, (_, index) => ({
                value: `model-${index}`,
                label: `model-${index}`,
              }))}
              ariaLabel="Model"
              inline
            />
          </DialogContent>
        </Dialog>
      );
    }

    try {
      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: 'Model' }));
      const option = await screen.findByRole('option', { name: 'model-12' });

      fireEvent.touchMove(option, { touches: [{ clientX: 40, clientY: 200 }] });
      fireEvent.wheel(option, { deltaY: 120 });

      // Radix's RemoveScroll listens on document. The listbox must stop the
      // event first, otherwise the dialog locks the menu's own scrolling.
      expect(onDocumentTouchMove).not.toHaveBeenCalled();
      expect(onDocumentWheel).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('touchmove', onDocumentTouchMove);
      document.removeEventListener('wheel', onDocumentWheel);
    }
  });

  it('does not dismiss a Radix dialog when a portaled option is pressed', async () => {
    const onChange = vi.fn();

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogTitle>Configure agent</DialogTitle>
            <DialogDescription>Pick a model.</DialogDescription>
            <InlineSelect
              value="default"
              onChange={onChange}
              options={THINKING_OPTIONS}
              ariaLabel="Thinking"
              inline
            />
          </DialogContent>
        </Dialog>
      );
    }

    render(<Harness />);
    // Radix attaches its outside-pointer listener on a 0ms timeout.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const trigger = screen.getByRole('button', { name: 'Thinking' });
    fireEvent.click(trigger);

    const option = await screen.findByRole('option', { name: 'high' });
    const listbox = screen.getByRole('listbox');
    expect(listbox.closest('[role="dialog"]')).toBeNull();

    fireEvent.pointerDown(option, { pointerType: 'mouse' });

    expect(onChange).toHaveBeenCalledWith('high');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(trigger).toBeInTheDocument();

    // Touch taps defer Radix's outside-click handling to the compatibility
    // click; that click is suppressed, so the dialog must stay open too.
    fireEvent.click(trigger);
    const touchOption = await screen.findByRole('option', { name: 'medium' });
    touchDown(touchOption);
    fireEvent.pointerUp(touchOption, { pointerId: 1, pointerType: 'touch' });

    expect(onChange).toHaveBeenCalledWith('medium');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
