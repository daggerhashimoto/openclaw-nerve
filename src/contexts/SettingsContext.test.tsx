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

// Real normalisation; only the side effect on the audio graph is stubbed.
vi.mock('@/features/voice/audio-feedback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/voice/audio-feedback')>()),
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

  it('defaults to full volume without writing a value when none is stored', async () => {
    const { result } = renderHook(() => useSettings(), { wrapper });

    expect(result.current.uiSoundVolume).toBe(1);
    await waitFor(() => expect(applyUiSoundVolumeMock).toHaveBeenCalledWith(1));
    expect(localStorage.getItem('nerve:uiSoundVolume')).toBeNull();
  });

  it('keeps UI sounds at full volume for a stored sound toggle that is off', async () => {
    localStorage.setItem('oc-sound', 'false');

    const { result } = renderHook(() => useSettings(), { wrapper });

    expect(result.current.soundEnabled).toBe(false);
    expect(result.current.uiSoundVolume).toBe(1);
    await waitFor(() => expect(applyUiSoundVolumeMock).toHaveBeenCalledWith(1));
    expect(localStorage.getItem('nerve:uiSoundVolume')).toBeNull();
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
    expect(localStorage.getItem('oc-sound')).toBeNull();
    await waitFor(() => expect(applyUiSoundVolumeMock).toHaveBeenLastCalledWith(0.25));
  });

  it('keeps the chosen volume across a reload', async () => {
    const first = renderHook(() => useSettings(), { wrapper });
    act(() => first.result.current.setUiSoundVolume(0));
    first.unmount();
    applyUiSoundVolumeMock.mockClear();

    const second = renderHook(() => useSettings(), { wrapper });

    expect(second.result.current.uiSoundVolume).toBe(0);
    await waitFor(() => expect(applyUiSoundVolumeMock).toHaveBeenCalledWith(0));
  });

  it.each([
    ['not a number', 'loud', 1],
    ['blank', '  ', 1],
    ['NaN', 'NaN', 1],
    ['Infinity', 'Infinity', 1],
    ['above full', '1.7', 1],
    ['below silent', '-0.4', 0],
  ])('normalises a stored value that is %s', async (_case, stored, expected) => {
    localStorage.setItem('nerve:uiSoundVolume', stored);

    const { result } = renderHook(() => useSettings(), { wrapper });

    expect(result.current.uiSoundVolume).toBe(expected);
    await waitFor(() => expect(applyUiSoundVolumeMock).toHaveBeenLastCalledWith(expected));
  });

  it('clamps a volume set out of range before storing it', () => {
    const { result } = renderHook(() => useSettings(), { wrapper });

    act(() => result.current.setUiSoundVolume(3));
    expect(result.current.uiSoundVolume).toBe(1);
    expect(localStorage.getItem('nerve:uiSoundVolume')).toBe('1');

    act(() => result.current.setUiSoundVolume(-2));
    expect(result.current.uiSoundVolume).toBe(0);
    expect(localStorage.getItem('nerve:uiSoundVolume')).toBe('0');
  });
});
