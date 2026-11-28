import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { esc, timeAgo, fmtTokens, fmtCost, fmtK, decodeHtmlEntities } from './formatting';

describe('esc (HTML entity escaping)', () => {
  it('should escape ampersands', () => {
    expect(esc('a & b')).toBe('a &amp; b');
  });

  it('should escape less-than signs', () => {
    expect(esc('<script>')).toBe('&lt;script&gt;');
  });

  it('should escape greater-than signs', () => {
    expect(esc('a > b')).toBe('a &gt; b');
  });

  it('should escape double quotes', () => {
    expect(esc('"hello"')).toBe('&quot;hello&quot;');
  });

  it('should escape multiple characters at once', () => {
    expect(esc('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });

  it('should return empty string for null', () => {
    expect(esc(null)).toBe('');
  });

  it('should return empty string for undefined', () => {
    expect(esc(undefined)).toBe('');
  });

  it('should return empty string for empty string', () => {
    expect(esc('')).toBe('');
  });

  it('should pass through safe text unchanged', () => {
    expect(esc('Hello world')).toBe('Hello world');
  });
});

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return "now" for timestamps less than 60s ago', () => {
    const ts = Date.now() - 30_000; // 30 seconds ago
    expect(timeAgo(ts)).toBe('now');
  });

  it('should return minutes for timestamps less than 1 hour ago', () => {
    const ts = Date.now() - 5 * 60_000; // 5 minutes ago
    expect(timeAgo(ts)).toBe('5m');
  });

  it('should return hours for timestamps less than 1 day ago', () => {
    const ts = Date.now() - 3 * 3_600_000; // 3 hours ago
    expect(timeAgo(ts)).toBe('3h');
  });

  it('should return days for timestamps more than 1 day ago', () => {
    const ts = Date.now() - 2 * 86_400_000; // 2 days ago
    expect(timeAgo(ts)).toBe('2d');
  });

  it('should accept Date objects', () => {
    const ts = new Date(Date.now() - 120_000); // 2 minutes ago
    expect(timeAgo(ts)).toBe('2m');
  });

  it('should accept ISO date strings', () => {
    const ts = new Date(Date.now() - 7200_000).toISOString(); // 2 hours ago
    expect(timeAgo(ts)).toBe('2h');
  });

  it('should measure against a given now instead of the clock', () => {
    const now = Date.parse('2030-06-01T12:00:00Z');
    expect(timeAgo(now - 30_000, now)).toBe('now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5m');
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3h');
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe('2d');
  });
});

describe('fmtTokens', () => {
  it('should format numbers under 1K as-is', () => {
    expect(fmtTokens(0)).toBe('0');
    expect(fmtTokens(999)).toBe('999');
  });

  it('should format thousands with K suffix', () => {
    expect(fmtTokens(1000)).toBe('1.0K');
    expect(fmtTokens(1500)).toBe('1.5K');
    expect(fmtTokens(50_000)).toBe('50.0K');
  });

  it('should format millions with M suffix', () => {
    expect(fmtTokens(1_000_000)).toBe('1.0M');
    expect(fmtTokens(2_500_000)).toBe('2.5M');
  });

  it('should format billions with B suffix', () => {
    expect(fmtTokens(1_000_000_000)).toBe('1.0B');
    expect(fmtTokens(3_700_000_000)).toBe('3.7B');
  });
});

describe('fmtCost', () => {
  it('should format cost with dollar sign and 2 decimals', () => {
    expect(fmtCost(0)).toBe('$0.00');
    expect(fmtCost(1.5)).toBe('$1.50');
    expect(fmtCost(99.999)).toBe('$100.00');
    expect(fmtCost(0.01)).toBe('$0.01');
  });
});

describe('decodeHtmlEntities', () => {
  it('should decode &quot; to double quotes', () => {
    expect(decodeHtmlEntities('&quot;hello&quot;')).toBe('"hello"');
  });

  it('should decode &amp; to ampersand', () => {
    expect(decodeHtmlEntities('a &amp; b')).toBe('a & b');
  });

  it('should decode &lt; and &gt; to angle brackets', () => {
    expect(decodeHtmlEntities('&lt;div&gt;')).toBe('<div>');
  });

  it('should decode &#39; and &apos; to single quotes', () => {
    expect(decodeHtmlEntities("it&#39;s &apos;fine&apos;")).toBe("it's 'fine'");
  });

  it('should decode multiple entities in one string', () => {
    expect(decodeHtmlEntities('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')).toBe('<a href="x">&</a>');
  });

  it('should return text unchanged when no entities present', () => {
    expect(decodeHtmlEntities('Hello world')).toBe('Hello world');
  });

  it('should not double-decode &amp;quot;', () => {
    expect(decodeHtmlEntities('&amp;quot;')).toBe('&quot;');
  });
});

describe('fmtK', () => {
  it('should format numbers under 1000 as-is', () => {
    expect(fmtK(0)).toBe('0');
    expect(fmtK(500)).toBe('500');
    expect(fmtK(999)).toBe('999');
  });

  it('should format numbers 1000+ with k suffix', () => {
    expect(fmtK(1000)).toBe('1k');
    expect(fmtK(1500)).toBe('2k'); // rounds to nearest
    expect(fmtK(50_000)).toBe('50k');
  });
});
