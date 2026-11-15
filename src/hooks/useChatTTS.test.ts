import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatTTS } from './useChatTTS';

const { playPingMock } = vi.hoisted(() => ({
  playPingMock: vi.fn(),
}));

vi.mock('@/features/voice/audio-feedback', () => ({
  playPing: playPingMock,
}));

describe('useChatTTS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pings a completed text response while sound is on', () => {
    const soundEnabled = { current: true };
    const speak = { current: vi.fn() };
    const { result } = renderHook(() => useChatTTS({ soundEnabled, speak }));

    act(() => result.current.handleFinalTTS(null, true));

    expect(playPingMock).toHaveBeenCalledOnce();
    expect(speak.current).not.toHaveBeenCalled();
  });

  it('does not ping a completed text response while sound is off', () => {
    const soundEnabled = { current: false };
    const speak = { current: vi.fn() };
    const { result } = renderHook(() => useChatTTS({ soundEnabled, speak }));

    act(() => result.current.handleFinalTTS(null, true));

    expect(playPingMock).not.toHaveBeenCalled();
  });

  it('plays a requested completion ping only while sound is on', () => {
    const soundEnabled = { current: true };
    const speak = { current: vi.fn() };
    const { result } = renderHook(() => useChatTTS({ soundEnabled, speak }));

    act(() => result.current.playCompletionPing());
    expect(playPingMock).toHaveBeenCalledOnce();

    soundEnabled.current = false;
    act(() => result.current.playCompletionPing());
    expect(playPingMock).toHaveBeenCalledOnce();
  });

  it('does not swap a spoken reply for a ping while sound is off', () => {
    const soundEnabled = { current: false };
    const speak = { current: vi.fn() };
    const { result } = renderHook(() => useChatTTS({ soundEnabled, speak }));

    act(() => result.current.handleFinalTTS({
      message: { role: 'assistant', content: 'Done' },
      text: 'Done',
      ttsText: 'Task complete',
      charts: [],
    }, true));

    expect(playPingMock).not.toHaveBeenCalled();
  });
});
