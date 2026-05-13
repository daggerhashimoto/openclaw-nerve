import type { TreeEntry } from './types';

export const FILE_TREE_ROW_HEIGHT = 24;
export const FILE_TREE_OVERSCAN_ROWS = 8;
export const MAX_VISIBLE_FILE_TREE_ROWS = 10_000;

export interface FileTreeRow {
  entry: TreeEntry;
  depth: number;
  index: number;
}

export function flattenVisibleFileTree(
  entries: TreeEntry[],
  expandedPaths: Set<string>,
  maxRows = MAX_VISIBLE_FILE_TREE_ROWS,
): FileTreeRow[] {
  const rows: FileTreeRow[] = [];
  const stack = entries
    .slice()
    .reverse()
    .map((entry) => ({ entry, depth: 0 }));

  while (stack.length > 0 && rows.length < maxRows) {
    const { entry, depth } = stack.pop()!;
    rows.push({ entry, depth, index: rows.length });

    if (entry.type !== 'directory' || !expandedPaths.has(entry.path) || !entry.children?.length) {
      continue;
    }

    for (let index = entry.children.length - 1; index >= 0; index -= 1) {
      stack.push({ entry: entry.children[index]!, depth: depth + 1 });
    }
  }

  return rows;
}
