import { describe, expect, it } from 'vitest';
import { buildSpawnSubagentMessage } from './buildSpawnSubagentMessage';

describe('buildSpawnSubagentMessage', () => {
  it('builds a keep-after-run payload', () => {
    expect(buildSpawnSubagentMessage({
      task: 'audit auth flow',
      label: 'audit-auth-flow',
      model: 'openai/gpt-5.2-codex',
      thinking: 'medium',
      cleanup: 'keep',
    })).toBe([
      '[spawn-subagent]',
      'task: audit auth flow',
      'label: audit-auth-flow',
      'model: openai/gpt-5.2-codex',
      'thinking: medium',
      'mode: run',
      'cleanup: keep',
    ].join('\n'));
  });

  it('builds a delete-after-run payload', () => {
    expect(buildSpawnSubagentMessage({
      task: 'cleanup test',
      cleanup: 'delete',
    })).toContain('cleanup: delete');
  });
});
