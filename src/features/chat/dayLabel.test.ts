import { describe, it, expect } from 'vitest';
import { dayKey, dayLabel } from './utils';

describe('dayLabel', () => {
  const now = new Date(2026, 10, 2, 15, 30); // 2 Nov 2026, local time

  it('names today and yesterday in words', () => {
    expect(dayLabel(new Date(2026, 10, 2, 1, 0), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 10, 1, 23, 59), now)).toBe('Yesterday');
  });

  it('spells older days without the year inside the same year', () => {
    const day = new Date(2026, 4, 20, 9, 0);
    const label = dayLabel(day, now);
    const month = day.toLocaleDateString(undefined, { month: 'short' });
    expect(label).toMatch(/20/);
    expect(label).toContain(month);
    expect(label).not.toMatch(/2026/);
  });

  it('adds the year once the day is in another year', () => {
    expect(dayLabel(new Date(2025, 11, 31, 9, 0), now)).toMatch(/2025/);
  });

  it('keys days by the local calendar date', () => {
    expect(dayKey(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
