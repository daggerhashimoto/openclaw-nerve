import { describe, expect, it } from 'vitest';
import { flattenVisibleFileTree } from './fileTreeRows';
import type { TreeEntry } from './types';

const tree: TreeEntry[] = [
  {
    name: 'src',
    path: 'src',
    type: 'directory',
    children: [
      {
        name: 'components',
        path: 'src/components',
        type: 'directory',
        children: [
          { name: 'Button.tsx', path: 'src/components/Button.tsx', type: 'file' },
        ],
      },
      { name: 'main.ts', path: 'src/main.ts', type: 'file' },
    ],
  },
  { name: 'README.md', path: 'README.md', type: 'file' },
];

describe('flattenVisibleFileTree', () => {
  it('derives a depth-aware visible row list from expanded paths', () => {
    const rows = flattenVisibleFileTree(tree, new Set(['src', 'src/components']));

    expect(rows.map((row) => [row.entry.path, row.depth])).toEqual([
      ['src', 0],
      ['src/components', 1],
      ['src/components/Button.tsx', 2],
      ['src/main.ts', 1],
      ['README.md', 0],
    ]);
  });

  it('does not include collapsed descendants', () => {
    const rows = flattenVisibleFileTree(tree, new Set(['src']));

    expect(rows.map((row) => row.entry.path)).toEqual([
      'src',
      'src/components',
      'src/main.ts',
      'README.md',
    ]);
  });

  it('caps generated rows for very large expanded trees', () => {
    const rows = flattenVisibleFileTree(tree, new Set(['src', 'src/components']), 3);

    expect(rows.map((row) => row.entry.path)).toEqual([
      'src',
      'src/components',
      'src/components/Button.tsx',
    ]);
  });
});
