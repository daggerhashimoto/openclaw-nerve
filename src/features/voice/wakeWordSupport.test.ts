import { describe, expect, it } from 'vitest';
import { getWakeWordSupport, isWakeWordSupportedEnvironment } from './wakeWordSupport';

describe('getWakeWordSupport', () => {
  it('supports wake word on desktop Chrome', () => {
    expect(getWakeWordSupport({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/123 Safari/537.36',
      maxTouchPoints: 0,
    })).toEqual({ supported: true, reason: null });
  });

  it('disables wake word on Android phone browsers', () => {
    expect(getWakeWordSupport({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/123 Mobile Safari/537.36',
      maxTouchPoints: 5,
    })).toEqual({ supported: false, reason: 'mobile-web' });
  });

  it('disables wake word on iPhone browsers', () => {
    expect(getWakeWordSupport({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 Version/17.3 Mobile/15E148 Safari/604.1',
      maxTouchPoints: 5,
    })).toEqual({ supported: false, reason: 'mobile-web' });
  });

  it('disables wake word on iPad-like touch environments', () => {
    expect(getWakeWordSupport({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.3 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    })).toEqual({ supported: false, reason: 'mobile-web' });
  });
});

describe('isWakeWordSupportedEnvironment', () => {
  it('returns true only for supported environments', () => {
    expect(isWakeWordSupportedEnvironment({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/123 Safari/537.36',
      maxTouchPoints: 0,
    })).toBe(true);

    expect(isWakeWordSupportedEnvironment({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/123 Mobile Safari/537.36',
      maxTouchPoints: 5,
    })).toBe(false);
  });
});
