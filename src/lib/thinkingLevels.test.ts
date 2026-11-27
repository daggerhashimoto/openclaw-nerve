import { describe, expect, it } from 'vitest';
import { normalizeThinkingLevel, THINKING_LEVELS, thinkingLevelsForSession } from './thinkingLevels';

describe('normalizeThinkingLevel', () => {
  it('accepts every canonical level, including max and ultra', () => {
    for (const level of THINKING_LEVELS) {
      expect(normalizeThinkingLevel(level)).toBe(level);
    }
  });

  it('normalises case and trims padding', () => {
    expect(normalizeThinkingLevel('  ULTRA ')).toBe('ultra');
  });

  it('rejects placeholders and unknown strings', () => {
    expect(normalizeThinkingLevel('--')).toBeNull();
    expect(normalizeThinkingLevel('turbo')).toBeNull();
    expect(normalizeThinkingLevel(undefined)).toBeNull();
  });
});

describe('thinkingLevelsForSession', () => {
  it('returns the gateway-reported levels in gateway order', () => {
    const levels = thinkingLevelsForSession({
      thinkingLevels: [
        { id: 'off', label: 'off' },
        { id: 'low', label: 'low' },
        { id: 'high', label: 'high' },
        { id: 'max', label: 'max' },
        { id: 'ultra', label: 'ultra' },
      ],
    });

    expect(levels.map((level) => level.id)).toEqual(['off', 'low', 'high', 'max', 'ultra']);
  });

  it('falls back to thinkingOptions for gateways that only send ids', () => {
    const levels = thinkingLevelsForSession({ thinkingOptions: ['high', 'max', 'ultra'] });

    expect(levels).toEqual([
      { id: 'high', label: 'high' },
      { id: 'max', label: 'max' },
      { id: 'ultra', label: 'ultra' },
    ]);
  });

  it('falls back to the canonical vocabulary when the row carries no levels', () => {
    expect(thinkingLevelsForSession(null).map((level) => level.id)).toEqual([...THINKING_LEVELS]);
  });

  it('does not invent levels for a garbled thinkingLevels payload', () => {
    const levels = thinkingLevelsForSession({
      thinkingLevels: [{ id: '--', label: '--' }] as { id: string; label?: string }[],
      thinkingOptions: [],
    });

    expect(levels.map((level) => level.id)).toEqual([...THINKING_LEVELS]);
  });
});
