import type { FlowSpec } from './flowSpec';

/**
 * Canonical flow sample used by tests and by the format documentation.
 *
 * It exercises every supported shape: a linear entry, a one-to-many branch,
 * a merge into a single verification row, a feedback edge rendered as a return
 * footnote, a group caption, icons and tones.
 */
export const FLOW_SAMPLE_SPEC: FlowSpec = {
  title: 'Decision flow',
  subtitle: 'One request, three lanes, one verification gate',
  nodes: [
    {
      id: 'intake',
      label: 'Incoming task / observation',
      detail: 'user message or scheduled trigger',
      icon: 'inbox',
      tone: 'neutral',
    },
    {
      id: 'router',
      label: 'Decision layer',
      detail: 'classify · score · route · filter',
      icon: 'git-branch',
      tone: 'live',
    },
    {
      id: 'deterministic',
      label: 'Deterministic',
      detail: 'code / rules',
      icon: 'cpu',
      tone: 'green',
    },
    {
      id: 'small',
      label: 'Small model',
      detail: 'simple tasks',
      icon: 'zap',
      tone: 'operator',
    },
    {
      id: 'strong',
      label: 'Strong model',
      detail: 'complex tasks',
      icon: 'brain',
      tone: 'purple',
    },
    {
      id: 'verify',
      label: 'Execution + verification',
      detail: 'tests, policies, optional screening',
      icon: 'shield',
      tone: 'neutral',
    },
  ],
  edges: [
    { from: 'intake', to: 'router', kind: 'flow' },
    { from: 'router', to: 'deterministic', label: 'rules', kind: 'branch' },
    { from: 'router', to: 'small', label: 'simple', kind: 'branch' },
    { from: 'router', to: 'strong', label: 'complex', kind: 'branch' },
    { from: 'deterministic', to: 'verify', kind: 'flow' },
    { from: 'small', to: 'verify', kind: 'flow' },
    { from: 'strong', to: 'verify', kind: 'flow' },
    { from: 'verify', to: 'router', label: 'retry', kind: 'return' },
  ],
  groups: [
    { label: 'Decision', nodes: ['router'] },
    { label: 'Execution', nodes: ['verify'] },
  ],
};

export const FLOW_SAMPLE_JSON = JSON.stringify(FLOW_SAMPLE_SPEC, null, 2);

/** The sample exactly as it appears in a chat message. */
export const FLOW_SAMPLE_MARKDOWN = `\`\`\`flow\n${FLOW_SAMPLE_JSON}\n\`\`\``;
