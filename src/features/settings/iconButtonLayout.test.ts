import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const indexCss = fs.readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8');

describe('icon button layout regressions', () => {
  // A .shell-icon-button can be squeezed by its padding or a narrow panel; if the SVG is
  // allowed to shrink it collapses to a sliver. The guard rule keeps icons at full size.
  it('never lets an icon shrink inside a shell-icon-button', () => {
    expect(indexCss).toMatch(/\.shell-icon-button\s*>\s*svg\s*\{[^}]*flex-shrink:\s*0;/);
  });
});
