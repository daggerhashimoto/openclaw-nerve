import { describe, it, expect } from 'vitest';
import { describeToolUse } from './helpers';

describe('describeToolUse for the Codex harness', () => {
  it('names the files an apply_patch call edits with their line counts', () => {
    const text = describeToolUse('apply_patch', {
      changes: [
        { path: '/home/u/nerve/src/a.tsx', kind: { type: 'update' }, stat: { added: 5, removed: 2 }, diff: '' },
        { path: '/home/u/nerve/README.md', kind: { type: 'add' }, diff: '' },
      ],
    });
    expect(text).toBe('editing a.tsx +5 -2, README.md');
  });

  it('falls back to a plain verb when the patch carries no changes', () => {
    expect(describeToolUse('apply_patch', {})).toBe('editing files');
  });

  it('describes bash calls like exec calls', () => {
    expect(describeToolUse('bash', { command: 'grep -rn foo src', cwd: '/home/u/nerve' })).toMatch(/searching files/);
  });
});
