import '@testing-library/jest-dom';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsProvider, useSettings } from './SettingsContext';

vi.mock('@/features/tts/useTTS', () => ({
  migrateTTSProvider: (provider: string) => provider,
  useTTS: () => ({ speak: vi.fn() }),
}));

vi.mock('@/lib/themes', () => ({
  themeNames: ['ayu-dark'],
  applyTheme: vi.fn(),
}));

vi.mock('@/lib/fonts', () => ({
  fontNames: ['instrument-sans'],
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
