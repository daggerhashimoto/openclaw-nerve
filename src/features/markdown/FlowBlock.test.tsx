/** Tests for the flow fence renderer and its MarkdownRenderer integration. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/highlight', () => ({
  hljs: {
    getLanguage: vi.fn(() => null),
    highlightAuto: vi.fn((code: string) => ({ value: code })),
    highlightElement: vi.fn(),
  },
}));

vi.mock('@/lib/sanitize', () => ({
  sanitizeHtml: vi.fn((html: string) => html),
}));

vi.mock('./CodeBlockActions', () => ({
  CodeBlockActions: () => null,
}));

import { MarkdownRenderer } from './MarkdownRenderer';
import { FlowBlock } from './FlowBlock';
import { FLOW_SAMPLE_MARKDOWN, FLOW_SAMPLE_SPEC } from './flowSample';

describe('FlowBlock', () => {
  it('renders the title, subtitle, nodes, details and groups', () => {
    render(<FlowBlock spec={FLOW_SAMPLE_SPEC} />);

    expect(screen.getByRole('group', { name: 'Decision flow' })).toBeInTheDocument();
    expect(screen.getByText('Decision flow')).toBeInTheDocument();
    expect(screen.getByText('One request, three lanes, one verification gate')).toBeInTheDocument();
    expect(screen.getByText('Incoming task / observation')).toBeInTheDocument();
    expect(screen.getByText('user message or scheduled trigger')).toBeInTheDocument();
    expect(screen.getByText('Small model')).toBeInTheDocument();
    expect(screen.getByText('complex tasks')).toBeInTheDocument();
    expect(screen.getByText('Decision')).toBeInTheDocument();
    expect(screen.getByText('Execution')).toBeInTheDocument();
  });

  it('draws branch labels and folds the return edge into a footnote', () => {
    render(<FlowBlock spec={FLOW_SAMPLE_SPEC} />);

    expect(screen.getByText('rules')).toBeInTheDocument();
    expect(screen.getByText('simple')).toBeInTheDocument();
    expect(screen.getByText('complex')).toBeInTheDocument();

    const footnote = screen.getByText(/returns to/);
    expect(footnote.textContent).toContain('Execution + verification');
    expect(footnote.textContent).toContain('Decision layer');
    expect(footnote.textContent).toContain('retry');
  });

  it('renders one card per node and an arrow for every real connector target', () => {
    const { container } = render(<FlowBlock spec={FLOW_SAMPLE_SPEC} />);
    const figure = container.querySelector('figure.markdown-flow');
    expect(figure).toBeTruthy();

    expect(figure?.querySelectorAll('svg').length).toBeGreaterThanOrEqual(FLOW_SAMPLE_SPEC.nodes.length);
    expect(figure?.querySelectorAll('.grid').length).toBe(4);
  });

  it('draws a centered arrow between rows for a no-edge chain', () => {
    const { container } = render(
      <FlowBlock
        spec={{
          title: 'Chain',
          nodes: [
            { id: 'a', label: 'A', tone: 'neutral' },
            { id: 'b', label: 'B', tone: 'neutral' },
            { id: 'c', label: 'C', tone: 'neutral' },
          ],
          edges: [],
          groups: [],
        }}
      />,
    );

    expect(container.querySelectorAll('svg')).toHaveLength(2);
  });

  it('exposes a screen-reader summary of the edges', () => {
    const { container } = render(<FlowBlock spec={FLOW_SAMPLE_SPEC} />);
    const summary = container.querySelector('.sr-only');
    expect(summary?.textContent).toContain('Incoming task / observation to Decision layer');
    expect(summary?.textContent).toContain('Execution + verification to Decision layer, retry');
  });
});

describe('MarkdownRenderer flow fences', () => {
  it('renders a valid flow fence as a figure without a wrapping pre', () => {
    const { container } = render(<MarkdownRenderer content={FLOW_SAMPLE_MARKDOWN} />);

    expect(container.querySelector('figure.markdown-flow')).toBeTruthy();
    expect(container.querySelector('pre')).toBeNull();
    expect(screen.getByText('Strong model')).toBeInTheDocument();
  });

  it('falls back to a normal code block for unparseable JSON', () => {
    const source = '{\n  "title": "Broken",\n  "nodes": [\n}';
    const { container } = render(<MarkdownRenderer content={'```flow\n' + source + '\n```'} />);

    expect(container.querySelector('figure.markdown-flow')).toBeNull();
    const pre = container.querySelector('pre.hljs');
    expect(pre).toBeTruthy();
    expect(pre?.textContent).toContain('"title": "Broken"');
    expect(pre?.textContent).toContain('flow');
  });

  it('falls back to a code block for structurally invalid specs', () => {
    const source = JSON.stringify({ nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'b' }] });
    const { container } = render(<MarkdownRenderer content={'```flow\n' + source + '\n```'} />);

    expect(container.querySelector('figure.markdown-flow')).toBeNull();
    expect(container.querySelector('pre.hljs')?.textContent).toContain('"from":"a"');
  });

  it('leaves non-flow fences on the existing highlighted code path', () => {
    const { container } = render(<MarkdownRenderer content={'```js\nconst x = 1;\n```'} />);

    expect(container.querySelector('figure.markdown-flow')).toBeNull();
    expect(container.querySelector('pre.hljs')).toBeTruthy();
    expect(screen.getByText('js')).toBeInTheDocument();
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
  });

  it('fits a 375px-wide container without a fixed minimum width or horizontal scroll', () => {
    const { container } = render(
      <div style={{ width: 375 }}>
        <MarkdownRenderer content={FLOW_SAMPLE_MARKDOWN} />
      </div>,
    );
    const figure = container.querySelector<HTMLElement>('figure.markdown-flow');
    expect(figure).not.toHaveClass('overflow-x-auto');
    expect(figure?.querySelectorAll('[style*="min-width"]')).toHaveLength(0);

    const grids = Array.from(figure?.querySelectorAll<HTMLElement>('.flow-level') ?? []);
    expect(grids).toHaveLength(4);
    grids.forEach((grid) => {
      expect(grid.style.gridTemplateColumns).toContain('minmax(0, 1fr)');
    });

    expect(screen.getByText('Deterministic')).toBeInTheDocument();
    expect(screen.getByText('Small model')).toBeInTheDocument();
    expect(screen.getByText('Strong model')).toBeInTheDocument();
  });

  it('ships a container-query stacking layout with labelled branch cards', () => {
    const { container } = render(<FlowBlock spec={FLOW_SAMPLE_SPEC} />);
    const figure = container.querySelector<HTMLElement>('figure.markdown-flow');
    const css = figure?.querySelector('style')?.textContent ?? '';

    expect(css).toContain('container-type: inline-size');
    expect(css).toContain('@container (max-width: 27rem)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) !important');
    expect(css).toContain('position: static');
    expect(css).toContain('translate: none');
    expect(css).toContain('flex-direction: column');
    expect(css).toContain('flow-connectors::after');

    // The stacked layout needs a target name on every branch label; the
    // desktop label stays a single text node so existing queries are valid.
    const simple = container.querySelector('.flow-edge-label[data-label="simple"]');
    expect(simple).toHaveAttribute('data-target', 'Small model');
    expect(simple).toHaveTextContent('simple');

    expect(container.querySelectorAll('.flow-card')).toHaveLength(FLOW_SAMPLE_SPEC.nodes.length);
    expect(container.querySelectorAll('.flow-card-text')).toHaveLength(FLOW_SAMPLE_SPEC.nodes.length);
    const caption = container.querySelector('.flow-group-caption');
    expect(caption).toHaveClass('min-w-0');
    expect(caption).not.toHaveClass('shrink-0');
  });
});
