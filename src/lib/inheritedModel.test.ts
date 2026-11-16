import { describe, expect, it } from 'vitest';
import { inheritedModelLabels } from './inheritedModel';

describe('inheritedModelLabels', () => {
  it('names the primary model on the button and marks it in the list', () => {
    expect(inheritedModelLabels('gpt-6-luna')).toEqual({ button: 'gpt-6-luna', option: 'gpt-6-luna (primary)' });
  });

  it('reads "Primary" in both places when the primary model is not known', () => {
    const unknown = { button: 'Primary', option: 'Primary' };
    expect(inheritedModelLabels(null)).toEqual(unknown);
    expect(inheritedModelLabels(undefined)).toEqual(unknown);
    expect(inheritedModelLabels('')).toEqual(unknown);
    expect(inheritedModelLabels('   ')).toEqual(unknown);
  });

  it('never returns the bare internal value', () => {
    for (const input of [null, undefined, '', 'gpt-6-luna']) {
      const { button, option } = inheritedModelLabels(input);
      expect(button).not.toBe('primary');
      expect(option).not.toBe('primary');
    }
  });
});
