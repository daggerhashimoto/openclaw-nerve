// @vitest-environment node
/**
 * Parse-time regression guard for remarkTexMath. The markdown renderer re-parses
 * a message on every streaming update, so a message full of unclosed math
 * delimiters must stay linear. Each shape parses in well under a second on a
 * developer machine. The budget is wide on purpose: a 3 second budget failed once
 * at 3032 ms while the whole suite ran in parallel, and a return to quadratic
 * scanning took 28 to 38 seconds on these inputs, so 10 seconds still catches it
 * several times over.
 */
import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Nodes, Root } from 'mdast';
import { remarkTexMath } from './remarkTexMath';

const BUDGET_MS = 10_000;

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkTexMath);

function countMath(node: Nodes): number {
  let total = node.type === 'math' || node.type === 'inlineMath' ? 1 : 0;
  if ('children' in node) {
    for (const child of node.children) total += countMath(child);
  }
  return total;
}

const shapes: Array<[name: string, input: string, mathNodes: number]> = [
  ['many \\[ openers', '\\['.repeat(10000), 0],
  ['many \\( openers', '\\('.repeat(10000), 0],
  ['a long run of dollars', '$'.repeat(20000), 0],
  ['many failing single-dollar openers', '$a '.repeat(8000), 0],
  ['many unclosed \\( expressions', '\\(x '.repeat(8000), 0],
  ['many unclosed \\[ expressions', '\\[x '.repeat(8000), 0],
  ['an unclosed $$ block', '$$\n' + 'x = 1\n'.repeat(8000), 0],
  ['an unclosed \\[ block', '\\[\n' + 'x = 1\n'.repeat(8000), 0],
  ['many closed $$ blocks', '$$\nx\n$$\n\n'.repeat(3000), 3000],
  ['many closed \\[ blocks', '\\[\nx\n\\]\n\n'.repeat(3000), 3000],
  ['currency, code and unclosed $$', '$5 and \\(a\\) `c` $$ '.repeat(3000), 3000],
  // Each trailing `\[ ` closes on the next repetition's `\]`; only the last stays open.
  ['currency, code and \\[', '$5 and \\[a^2\\] `c` \\[ '.repeat(3000), 3000],
  ['currency, code and unclosed \\[', '$5 and \\[a^2\\] \\[ `c` '.repeat(3000), 3000],
  ['a long dollar run inside a block', '$$\n' + '$'.repeat(20000) + 'x\n$$', 1],
  ['price-heavy prose', 'Spent $0.42 on input, $1.20 on output. '.repeat(2000), 0],
];

describe('remarkTexMath parse time', () => {
  // Warm the JIT so the first shape is not charged for it.
  processor.parse('warm up $x$ and \\(y\\) and $$z$$\n\n$$\na\n$$');

  it.each(shapes)('parses %s in linear time', (_name, input, mathNodes) => {
    const start = performance.now();
    const tree = processor.parse(input) as Root;
    const elapsed = performance.now() - start;

    expect(countMath(tree)).toBe(mathNodes);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  }, 60_000);
});
