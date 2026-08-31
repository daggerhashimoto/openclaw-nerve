import '@testing-library/jest-dom';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsProvider, useSettings } from './SettingsContext';

const { applyUiSoundVolumeMock } = vi.hoisted(() => ({
  applyUiSoundVolumeMock: vi.fn(),
}));

vi.mock('@/features/tts/useTTS', () => ({
  migrateTTSProvider: (provider: string) => provider,
  useTTS: () => ({ speak: vi.fn() }),
}));

vi.mock('@/features/voice/audio-feedback', () => ({
  normalizeUiSoundVolume: (volume: number) => (
    Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1
  ),
  setUiSoundVolume: applyUiSoundVolumeMock,
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
    ['ayu-dark', 'workbench-night'],
    ['midnight', 'workbench-night'],
    ['monochrome', 'workbench-night'],
    ['light', 'nerve-light'],
  ])('moves the stored legacy theme "%s" to "%s"', (saved, expected) => {
    localStorage.setItem('oc-theme', saved);

    const { result } = renderHook(() => useSettings(), { wrapper });

    expect(result.current.theme).toBe(expected);
    expect(localStorage.getItem('oc-theme')).toBe(expected);
  });

  it('defaults fresh installs to Workbench Night', () => {
    const { result } = renderHook(() => useSettings(), { wrapper });

    expect(result.current.theme).toBe('workbench-night');
  });

  it('moves a stored Night to Workbench Night once, and keeps Night when it is picked again', () => {
    localStorage.setItem('oc-theme', 'nerve-dark');
    const first = renderHook(() => useSettings(), { wrapper });
    expect(first.result.current.theme).toBe('workbench-night');

    act(() => first.result.current.setTheme('nerve-dark'));
    first.unmount();

    const second = renderHook(() => useSettings(), { wrapper });
    expect(second.result.current.theme).toBe('nerve-dark');
  });

  it.each([
    ['classic-dracula', 'workbench-night'],
    ['classic-ayu-dark', 'workbench-night'],
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

const originalFetch = globalThis.fetch;

function VolumeProbe() {
  const { uiSoundVolume, setUiSoundVolume } = useSettings();

  return (
    <button type="button" onClick={() => setUiSoundVolume(0.25)}>
      {uiSoundVolume}
    </button>
  );
}

describe('SettingsContext UI sound volume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('restores and applies the saved UI sound volume', async () => {
    localStorage.setItem('nerve:uiSoundVolume', '0.35');

    render(
      <SettingsProvider>
        <VolumeProbe />
      </SettingsProvider>,
    );

    expect(screen.getByRole('button')).toHaveTextContent('0.35');
    await waitFor(() => expect(applyUiSoundVolumeMock).toHaveBeenCalledWith(0.35));
  });

  it('persists UI sound volume changes independently', async () => {
    render(
      <SettingsProvider>
        <VolumeProbe />
      </SettingsProvider>,
    );

    await act(async () => screen.getByRole('button').click());

    expect(screen.getByRole('button')).toHaveTextContent('0.25');
    expect(localStorage.getItem('nerve:uiSoundVolume')).toBe('0.25');
    await waitFor(() => expect(applyUiSoundVolumeMock).toHaveBeenLastCalledWith(0.25));
  });
});
