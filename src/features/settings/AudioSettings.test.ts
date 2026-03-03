import { describe, expect, it } from 'vitest';
import { shouldDeferEdgeVoiceAutoSwitch } from './audioSettingsUtils';

describe('shouldDeferEdgeVoiceAutoSwitch', () => {
  it('does not defer for English even when support is not loaded', () => {
    expect(shouldDeferEdgeVoiceAutoSwitch('en', null)).toBe(false);
  });

  it('defers for non-English when support matrix is missing', () => {
    expect(shouldDeferEdgeVoiceAutoSwitch('tr', null)).toBe(true);
  });

  it('does not defer for non-English once support entry exists', () => {
    expect(
      shouldDeferEdgeVoiceAutoSwitch('tr', [
        { code: 'en' },
        { code: 'tr' },
      ]),
    ).toBe(false);
  });

  it('keeps deferring when support entry is still absent', () => {
    expect(
      shouldDeferEdgeVoiceAutoSwitch('tr', [
        { code: 'en' },
        { code: 'de' },
      ]),
    ).toBe(true);
  });
});
