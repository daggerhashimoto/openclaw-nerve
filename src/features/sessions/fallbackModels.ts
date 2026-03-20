import type { InlineSelectOption } from '@/components/ui/InlineSelect';

export const FALLBACK_MODELS: InlineSelectOption[] = [
  { value: 'openai-codex/gpt-5.4', label: 'gpt-5.4' },
  { value: 'anthropic/claude-haiku-4-5', label: 'claude-haiku-4-5' },
  { value: 'anthropic/claude-sonnet-4-5', label: 'claude-sonnet-4-5' },
  { value: 'anthropic/claude-opus-4-6', label: 'claude-opus-4-6' },
];
