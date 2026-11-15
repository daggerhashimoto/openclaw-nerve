import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const indexCss = fs.readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8');

describe('icon button layout regressions', () => {
  // .shell-icon-button sets `padding: 0 12px` outside any cascade layer, so it beats
  // Tailwind's `px-0`. In a 32-36px button that leaves only a few px of content width and
  // the flex item (the SVG) shrinks to a sliver unless it is told not to.
  it('never lets an icon shrink inside a shell-icon-button', () => {
    expect(indexCss).toMatch(/\.shell-icon-button\s*>\s*svg\s*\{[^}]*flex-shrink:\s*0;/);
  });
});
