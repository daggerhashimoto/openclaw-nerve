export type SubagentCleanupMode = 'keep' | 'delete';

interface BuildSpawnSubagentMessageOpts {
  task: string;
  label?: string;
  model?: string;
  thinking?: string;
  cleanup?: SubagentCleanupMode;
}

export function buildSpawnSubagentMessage(opts: BuildSpawnSubagentMessageOpts) {
  const lines = ['[spawn-subagent]'];

  lines.push(`task: ${opts.task}`);
  if (opts.label) lines.push(`label: ${opts.label}`);
  if (opts.model) lines.push(`model: ${opts.model}`);
  if (opts.thinking && opts.thinking !== 'off') lines.push(`thinking: ${opts.thinking}`);
  lines.push('mode: run');
  lines.push(`cleanup: ${opts.cleanup ?? 'keep'}`);

  return lines.join('\n');
}
