import { act, render, screen, waitFor } from '@testing-library/react';
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
