import '@testing-library/jest-dom';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsProvider, useSettings } from './SettingsContext';

vi.mock('@/features/tts/useTTS', () => ({
  migrateTTSProvider: (provider: string) => provider,
  useTTS: () => ({ speak: vi.fn() }),
}));

// Real theme catalogue and resolution; only the DOM side effect is stubbed.
vi.mock('@/lib/themes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/themes')>()),
  applyTheme: vi.fn(),
}));

vi.mock('@/lib/fonts', () => ({
  fontNames: ['atkinson-hyperlegible', 'instrument-sans'],
  DEFAULT_FONT: 'atkinson-hyperlegible',
  applyFont: vi.fn(),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return <SettingsProvider>{children}</SettingsProvider>;
}

describe('SettingsContext performance mode', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults performance mode off', () => {
    const { result } = renderHook(() => useSettings(), { wrapper });

    expect(result.current.performanceMode).toBe(false);
  });

  it('loads and persists performance mode', () => {
    localStorage.setItem('nerve:performanceMode', 'true');

    const { result } = renderHook(() => useSettings(), { wrapper });

    expect(result.current.performanceMode).toBe(true);

    act(() => result.current.togglePerformanceMode());

    expect(result.current.performanceMode).toBe(false);
    expect(localStorage.getItem('nerve:performanceMode')).toBe('false');
  });

  it('keeps performance mode unchanged when persisting it fails', () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    expect(() => act(() => result.current.togglePerformanceMode())).not.toThrow();

    expect(result.current.performanceMode).toBe(false);
    expect(localStorage.getItem('nerve:performanceMode')).toBeNull();
  });

  it('syncs performance mode when another tab changes the stored value', () => {
    const { result } = renderHook(() => useSettings(), { wrapper });

    expect(result.current.performanceMode).toBe(false);

    act(() => {
      localStorage.setItem('nerve:performanceMode', 'true');
      window.dispatchEvent(new StorageEvent('storage', { key: 'nerve:performanceMode', newValue: 'true' }));
    });

    expect(result.current.performanceMode).toBe(true);

    act(() => {
      localStorage.setItem('nerve:performanceMode', 'false');
      window.dispatchEvent(new StorageEvent('storage', { key: 'nerve:performanceMode', newValue: 'false' }));
    });

    expect(result.current.performanceMode).toBe(false);
  });

  it('resets performance mode when another tab clears storage', () => {
    localStorage.setItem('nerve:performanceMode', 'true');
    const { result } = renderHook(() => useSettings(), { wrapper });

    expect(result.current.performanceMode).toBe(true);

    act(() => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });

    expect(result.current.performanceMode).toBe(false);
  });

  it('ignores storage events for unrelated keys', () => {
    localStorage.setItem('nerve:performanceMode', 'true');
    const { result } = renderHook(() => useSettings(), { wrapper });

    act(() => {
      localStorage.setItem('nerve:performanceMode', 'false');
      window.dispatchEvent(new StorageEvent('storage', { key: 'nerve:other', newValue: 'x' }));
    });

    expect(result.current.performanceMode).toBe(true);
  });
});

describe('SettingsContext theme', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each([
    ['ayu-dark', 'nerve-dark'],
    ['midnight', 'nerve-dark'],
    ['monochrome', 'nerve-dark'],
    ['light', 'nerve-light'],
  ])('moves the stored legacy theme "%s" to the Nerve default "%s"', (saved, expected) => {
    localStorage.setItem('oc-theme', saved);

    const { result } = renderHook(() => useSettings(), { wrapper });

    expect(result.current.theme).toBe(expected);
    expect(localStorage.getItem('oc-theme')).toBe(expected);
  });

  it('defaults fresh installs to Night', () => {
    const { result } = renderHook(() => useSettings(), { wrapper });

    expect(result.current.theme).toBe('nerve-dark');
  });

  it.each([
    ['classic-dracula', 'nerve-dark'],
    ['classic-ayu-dark', 'nerve-dark'],
    ['classic-light', 'nerve-light'],
  ])('moves the retired Classic theme "%s" to "%s" and persists it', (saved, expected) => {
    localStorage.setItem('oc-theme', saved);

    const { result } = renderHook(() => useSettings(), { wrapper });

    expect(result.current.theme).toBe(expected);
    expect(localStorage.getItem('oc-theme')).toBe(expected);
  });

  it('switches between Night and Daylight and persists the choice', () => {
    const { result } = renderHook(() => useSettings(), { wrapper });

    act(() => result.current.setTheme('nerve-light'));

    expect(result.current.theme).toBe('nerve-light');
    expect(localStorage.getItem('oc-theme')).toBe('nerve-light');
  });
});
