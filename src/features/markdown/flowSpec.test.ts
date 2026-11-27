import { describe, expect, it } from 'vitest';
import { FLOW_SAMPLE_SPEC } from './flowSample';
import { layoutFlow, parseFlowSpec } from './flowSpec';

function parseValue(value: unknown) {
  return parseFlowSpec(JSON.stringify(value));
}

function parseOk(value: unknown) {
  const result = parseValue(value);
  if (!result.ok) throw new Error(`Expected a valid flow spec, got: ${result.error}`);
  return result.spec;
}

describe('parseFlowSpec', () => {
  it('parses the documented sample', () => {
    const spec = parseOk(FLOW_SAMPLE_SPEC);

    expect(spec.title).toBe('Decision flow');
    expect(spec.subtitle).toContain('three lanes');
    expect(spec.nodes).toHaveLength(6);
    expect(spec.nodes[1]).toMatchObject({
      id: 'router',
      label: 'Decision layer',
      icon: 'git-branch',
      tone: 'live',
    });
    expect(spec.edges).toHaveLength(8);
    expect(spec.edges[1]).toMatchObject({ from: 'router', to: 'deterministic', label: 'rules', kind: 'branch' });
    expect(spec.groups).toEqual([
      { label: 'Decision', nodes: ['router'] },
      { label: 'Execution', nodes: ['verify'] },
    ]);
  });

  it('defaults optional edges and groups to empty arrays', () => {
    const spec = parseOk({ nodes: [{ id: 'only', label: 'Only node' }] });
    expect(spec.edges).toEqual([]);
    expect(spec.groups).toEqual([]);
  });

  it('degrades unknown icons and tones instead of failing', () => {
    const spec = parseOk({
      nodes: [
        {
          id: 'a',
          label: 'Node A',
          icon: 'definitely-not-an-icon',
          tone: 'neon',
        },
      ],
    });

    expect(spec.nodes[0].icon).toBeUndefined();
    expect(spec.nodes[0].tone).toBe('neutral');
  });

  it('trims optional strings and drops empty details', () => {
    const spec = parseOk({
      title: '  Flow  ',
      subtitle: '   ',
      nodes: [{ id: 'a', label: '  A  ', detail: '   ' }],
    });

    expect(spec.title).toBe('Flow');
    expect(spec.subtitle).toBeUndefined();
    expect(spec.nodes[0].label).toBe('A');
    expect(spec.nodes[0].detail).toBeUndefined();
  });

  it('rejects invalid JSON', () => {
    const result = parseFlowSpec('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('valid JSON');
  });

  it('rejects a missing or empty node list', () => {
    expect(parseFlowSpec('{}').ok).toBe(false);
    expect(parseValue({ nodes: [] }).ok).toBe(false);
    expect(parseValue({ nodes: 'nope' }).ok).toBe(false);
  });

  it('rejects duplicate node ids', () => {
    const result = parseValue({
      nodes: [
        { id: 'same', label: 'One' },
        { id: 'same', label: 'Two' },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('duplicate node id');
  });

  it('rejects edges that reference unknown nodes, self-loops, and duplicates', () => {
    const nodes = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ];

    expect(parseValue({ nodes, edges: [{ from: 'a', to: 'missing' }] }).ok).toBe(false);
    expect(parseValue({ nodes, edges: [{ from: 'a', to: 'a' }] }).ok).toBe(false);
    expect(
      parseValue({
        nodes,
        edges: [
          { from: 'a', to: 'b' },
          { from: 'a', to: 'b' },
        ],
      }).ok,
    ).toBe(false);
  });

  it('rejects unknown fields instead of silently dropping them', () => {
    const nodes = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ];

    const typo = parseValue({ nodes, egdes: [{ from: 'a', to: 'b' }] });
    expect(typo.ok).toBe(false);
    if (!typo.ok) expect(typo.error).toContain('unknown field "egdes"');

    expect(parseValue({ nodes: [{ id: 'a', label: 'A', colour: 'red' }] }).ok).toBe(false);
    expect(parseValue({ nodes, edges: [{ from: 'a', to: 'b', weight: 2 }] }).ok).toBe(false);
    expect(parseValue({ nodes, groups: [{ label: 'G', nodes: ['a'], colour: 'red' }] }).ok).toBe(
      false,
    );
  });

  it('rejects unknown edge kinds and unknown group members', () => {
    const nodes = [{ id: 'a', label: 'A' }];
    expect(parseValue({ nodes, edges: [{ from: 'a', to: 'a', kind: 'bogus' }] }).ok).toBe(false);
    expect(parseValue({ nodes, groups: [{ label: 'G', nodes: ['missing'] }] }).ok).toBe(false);
  });
});

describe('layoutFlow', () => {
  it('ranks the sample into intake, router, three lanes, verification', () => {
    const layout = layoutFlow(parseOk(FLOW_SAMPLE_SPEC));

    expect(layout.levels.map((level) => level.map((item) => item.id))).toEqual([
      ['intake'],
      ['router'],
      ['deterministic', 'small', 'strong'],
      ['verify'],
    ]);
    expect(layout.segments.map((segments) => segments.length)).toEqual([1, 3, 3]);
    expect(layout.returns.map((edge) => `${edge.from}->${edge.to}`)).toEqual(['verify->router']);
    expect(layout.groups).toEqual([
      { label: 'Decision', level: 1 },
      { label: 'Execution', level: 3 },
    ]);
  });

  it('stacks nodes vertically when the spec has no edges', () => {
    const layout = layoutFlow(
      parseOk({
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ],
      }),
    );

    expect(layout.levels.map((level) => level.map((item) => item.id))).toEqual([['a'], ['b'], ['c']]);
    expect(layout.segments).toHaveLength(2);
  });

  it('breaks cycles deterministically instead of looping', () => {
    const layout = layoutFlow(
      parseOk({
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'c' },
          { from: 'c', to: 'a' },
        ],
      }),
    );

    expect(layout.levels.map((level) => level.map((item) => item.id))).toEqual([['a'], ['b'], ['c']]);
    expect(layout.returns).toHaveLength(1);
    expect(layout.returns[0]).toMatchObject({ from: 'c', to: 'a' });
  });

  it('routes a skipped edge through a virtual lane', () => {
    const layout = layoutFlow(
      parseOk({
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'c' },
          { from: 'a', to: 'c' },
        ],
      }),
    );

    expect(layout.levels.map((level) => level.length)).toEqual([1, 2, 1]);
    expect(layout.levels[1].filter((item) => item.node === null)).toHaveLength(1);
    expect(layout.segments.map((segments) => segments.length)).toEqual([2, 2]);
  });
});
