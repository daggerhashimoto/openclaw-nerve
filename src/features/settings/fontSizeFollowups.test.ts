import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const indexCss = fs.readFileSync(path.join(repoRoot, 'src/index.css'), 'utf8');
const cronsTabSource = fs.readFileSync(path.join(repoRoot, 'src/features/workspace/tabs/CronsTab.tsx'), 'utf8');
const cronDialogSource = fs.readFileSync(path.join(repoRoot, 'src/features/workspace/tabs/CronDialog.tsx'), 'utf8');

describe('font size follow-up regressions', () => {
  it('keeps mobile cockpit form controls at a fixed 16px to avoid iPhone auto-zoom', () => {
    expect(indexCss).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.cockpit-input,\s*\.cockpit-select,\s*\.cockpit-textarea\s*\{\s*font-size:\s*16px;\s*\}/,
    );
  });

  it('removes remaining fixed px typography from the cron list UI', () => {
    expect(cronsTabSource).not.toMatch(/text-\[[0-9.]+px\]/);
  });

  it('removes remaining fixed px typography from the cron dialog UI', () => {
    expect(cronDialogSource).not.toMatch(/text-\[[0-9.]+px\]/);
  });
});
