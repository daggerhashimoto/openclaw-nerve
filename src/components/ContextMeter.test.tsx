/** Tests for the ContextMeter component. */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextMeter } from './ContextMeter';

describe('ContextMeter', () => {
  it('renders with normal usage', () => {
    render(<ContextMeter used={5000} limit={100000} />);
    expect(screen.getByText('Context')).toBeInTheDocument();
  });

  it('shows token count', () => {
    const { container } = render(<ContextMeter used={10000} limit={100000} />);
    // AnimatedNumber renders the formatted value (e.g. "10K")
    expect(container.textContent).toMatch(/10/);
  });

  it('does not show warning icon at low usage', () => {
    const { container } = render(<ContextMeter used={1000} limit={100000} />);
    // 1% usage — AlertTriangle SVG should not be present
    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(0);
  });

  it('renders at zero usage', () => {
    const { container } = render(<ContextMeter used={0} limit={100000} />);
    expect(container).toBeTruthy();
    expect(screen.getByText('Context')).toBeInTheDocument();
  });

  it('handles full usage without crashing', () => {
    const { container } = render(<ContextMeter used={100000} limit={100000} />);
    expect(container).toBeTruthy();
  });

  it('handles over-limit usage without crashing', () => {
    const { container } = render(<ContextMeter used={150000} limit={100000} />);
    expect(container).toBeTruthy();
  });

  it('includes tooltip with usage info', () => {
    const { container } = render(<ContextMeter used={50000} limit={100000} />);
    // The outer div has a title attribute
    const tooltipEl = container.querySelector('[title]');
    expect(tooltipEl).toBeTruthy();
    const title = tooltipEl?.getAttribute('title') || '';
    expect(title).toContain('50%');
  });

  it('reads as a percentage of the window', () => {
    render(<ContextMeter used={122000} limit={200000} />);
    expect(screen.getByText('61% of 200k')).toBeInTheDocument();
  });

  it('switches the fill to the operator colour near the limit and destructive when nearly full', () => {
    const { container, rerender } = render(<ContextMeter used={50000} limit={100000} />);
    const fill = () => Array.from(container.querySelectorAll('div')).find(d => d.style.width);
    expect(fill()).toHaveClass('bg-live');

    rerender(<ContextMeter used={85000} limit={100000} />);
    expect(fill()).toHaveClass('bg-operator');

    rerender(<ContextMeter used={97000} limit={100000} />);
    expect(fill()).toHaveClass('bg-destructive');
  });

  it('progress bar width reflects usage', () => {
    const { container } = render(<ContextMeter used={50000} limit={100000} />);
    // The inner div with style.width should be ~50%
    const bars = container.querySelectorAll('div');
    const styledBar = Array.from(bars).find(d => d.style.width);
    expect(styledBar).toBeTruthy();
    expect(styledBar?.style.width).toBe('50%');
  });
});
