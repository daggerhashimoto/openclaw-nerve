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
  loadClassicFonts: vi.fn(),
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

describe('SettingsContext theme and style', () => {
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

  it('keeps an explicitly chosen Classic theme', () => {
    localStorage.setItem('oc-theme', 'classic-dracula');

    const { result } = renderHook(() => useSettings(), { wrapper });

    expect(result.current.theme).toBe('classic-dracula');
  });

  it('switches to the Classic default when the style changes, and persists it', () => {
    const { result } = renderHook(() => useSettings(), { wrapper });

    act(() => result.current.setThemeStyle('classic'));

    expect(result.current.theme).toBe('classic-ayu-dark');
    expect(localStorage.getItem('oc-theme')).toBe('classic-ayu-dark');

    act(() => result.current.setThemeStyle('nerve'));

    expect(result.current.theme).toBe('nerve-dark');
    expect(localStorage.getItem('oc-theme')).toBe('nerve-dark');
  });

  it('keeps the current theme when it already belongs to the chosen style', () => {
    localStorage.setItem('oc-theme', 'classic-nord');
    const { result } = renderHook(() => useSettings(), { wrapper });

    act(() => result.current.setThemeStyle('classic'));

    expect(result.current.theme).toBe('classic-nord');
  });
});
