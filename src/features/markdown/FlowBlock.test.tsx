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

  it('attributes a multi-row edge chip to its original source, not the row above', () => {
    const { container } = render(
      <FlowBlock
        spec={{
          title: 'Skip edge',
          nodes: [
            { id: 'a', label: 'Alpha', tone: 'neutral' },
            { id: 'b', label: 'Bravo', tone: 'neutral' },
            { id: 'c', label: 'Charlie', tone: 'neutral' },
          ],
          edges: [
            { from: 'a', to: 'b', kind: 'flow' },
            { from: 'b', to: 'c', kind: 'flow' },
            { from: 'a', to: 'c', label: 'skips', kind: 'flow' },
          ],
          groups: [],
        }}
      />,
    );

    const chips = container.querySelectorAll('.flow-edge-label[data-label="skips"]');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveAttribute('data-source', 'Alpha');
    expect(chips[0]).toHaveAttribute('data-target', 'Charlie');
    expect(chips[0]).toHaveTextContent('skips');
  });

  it('renders a source → target chip for unlabeled branch edges in stacked mode', () => {
    const { container } = render(
      <FlowBlock
        spec={{
          title: 'Fan-out',
          nodes: [
            { id: 'hub', label: 'Hub', tone: 'neutral' },
            { id: 'yes', label: 'Yes lane', tone: 'neutral' },
            { id: 'no', label: 'No lane', tone: 'neutral' },
          ],
          edges: [
            { from: 'hub', to: 'yes', label: 'yes', kind: 'branch' },
            { from: 'hub', to: 'no', kind: 'branch' },
          ],
          groups: [],
        }}
      />,
    );

    const chips = container.querySelectorAll('.flow-edge-label');
    expect(chips).toHaveLength(2);
    const branchOnly = container.querySelectorAll('.flow-edge-label--branch-only');
    expect(branchOnly).toHaveLength(1);
    expect(branchOnly[0]).toHaveAttribute('data-source', 'Hub');
    expect(branchOnly[0]).toHaveAttribute('data-target', 'No lane');

    // Hidden on desktop via the scoped sheet; the stacked rules show it.
    const css = container.querySelector('figure.markdown-flow style')?.textContent ?? '';
    expect(css).toContain('.flow-edge-label--branch-only { display: none; }');
    expect(css).toContain('.flow-edge-label--branch-only { display: inline; }');
  });

  it('flags wide fan-outs so they stack below 48rem instead of squeezing cards', () => {
    const leaves = Array.from({ length: 6 }, (_, index) => ({
      id: `leaf-${index}`,
      label: `Leaf ${index}`,
      tone: 'neutral' as const,
    }));
    const { container } = render(
      <FlowBlock
        spec={{
          title: 'Wide fan-out',
          nodes: [{ id: 'hub', label: 'Hub', tone: 'neutral' }, ...leaves],
          edges: leaves.map((leaf) => ({ from: 'hub', to: leaf.id, kind: 'flow' as const })),
          groups: [],
        }}
      />,
    );

    const figure = container.querySelector('figure.markdown-flow');
    expect(figure).toHaveClass('flow-wide-fanout');
    // Default `kind: flow` edges still need a stacked chip: branching is
    // expressed by the graph shape, not by the optional kind label.
    const chips = container.querySelectorAll('.flow-edge-label--branch-only');
    expect(chips).toHaveLength(6);
    expect(chips[0]).toHaveAttribute('data-source', 'Hub');
    expect(chips[0]).toHaveAttribute('data-target', 'Leaf 0');
    const css = figure?.querySelector('style')?.textContent ?? '';
    expect(css).toContain('@container (max-width: 48rem)');
    expect(css).toContain('.flow-wide-fanout .flow-level');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) !important');

    // Three-column sample stays on the desktop grid until the narrow breakpoint.
    const sample = render(<FlowBlock spec={FLOW_SAMPLE_SPEC} />);
    expect(sample.container.querySelector('figure.markdown-flow')).not.toHaveClass(
      'flow-wide-fanout',
    );
  });

  it('shows stacked chips for a default-kind merge', () => {
    const { container } = render(
      <FlowBlock
        spec={{
          title: 'Merge',
          nodes: [
            { id: 'a', label: 'Alpha', tone: 'neutral' },
            { id: 'b', label: 'Bravo', tone: 'neutral' },
            { id: 'c', label: 'Charlie', tone: 'neutral' },
          ],
          edges: [
            { from: 'a', to: 'c', kind: 'flow' },
            { from: 'b', to: 'c', kind: 'flow' },
          ],
          groups: [],
        }}
      />,
    );

    const chips = container.querySelectorAll('.flow-edge-label--branch-only');
    expect(chips).toHaveLength(2);
    expect(Array.from(chips).map((chip) => chip.getAttribute('data-source'))).toEqual(['Alpha', 'Bravo']);
    expect(Array.from(chips).map((chip) => chip.getAttribute('data-target'))).toEqual(['Charlie', 'Charlie']);
  });

  it('flags a pass-through-heavy row as a wide fan-out', () => {
    const sources = ['s1', 's2', 's3'];
    const targets = ['t1', 't2', 't3'];
    const nodes = [
      ...sources.map((id) => ({ id, label: id.toUpperCase(), tone: 'neutral' as const })),
      { id: 'mid', label: 'Intermediate card', tone: 'neutral' as const },
      ...targets.map((id) => ({ id, label: id.toUpperCase(), tone: 'neutral' as const })),
    ];
    const edges = [
      ...sources.flatMap((from) => targets.map((to) => ({ from, to, kind: 'flow' as const }))),
      ...sources.map((from) => ({ from, to: 'mid', kind: 'flow' as const })),
      ...targets.map((to) => ({ from: 'mid', to, kind: 'flow' as const })),
    ];

    const { container } = render(
      <FlowBlock spec={{ title: 'Pass-through', nodes, edges, groups: [] }} />,
    );

    const figure = container.querySelector('figure.markdown-flow');
    expect(figure).toHaveClass('flow-wide-fanout');
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

    // The stacked layout needs both endpoint names on every chip; the desktop
    // label stays a single text node so existing queries are valid.
    const simple = container.querySelector('.flow-edge-label[data-label="simple"]');
    expect(simple).toHaveAttribute('data-source', 'Decision layer');
    expect(simple).toHaveAttribute('data-target', 'Small model');
    expect(simple).toHaveTextContent('simple');
    expect(css).toContain('attr(data-source)');

    expect(container.querySelectorAll('.flow-card')).toHaveLength(FLOW_SAMPLE_SPEC.nodes.length);
    expect(container.querySelectorAll('.flow-card-text')).toHaveLength(FLOW_SAMPLE_SPEC.nodes.length);
    const caption = container.querySelector('.flow-group-caption');
    expect(caption).toHaveClass('min-w-0');
    expect(caption).not.toHaveClass('shrink-0');
  });
});
