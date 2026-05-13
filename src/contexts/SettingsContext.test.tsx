import '@testing-library/jest-dom';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
