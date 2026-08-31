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

  it('uses the independent UI sound channel for a completed text response', () => {
    const ttsEnabled = { current: true };
    const speak = { current: vi.fn() };
    const { result } = renderHook(() => useChatTTS({ ttsEnabled, speak }));

    act(() => result.current.handleFinalTTS(null, true));

    expect(playPingMock).toHaveBeenCalledOnce();
    expect(speak.current).not.toHaveBeenCalled();
  });

  it('plays an explicitly requested completion ping through the UI sound channel', () => {
    const ttsEnabled = { current: true };
    const speak = { current: vi.fn() };
    const { result } = renderHook(() => useChatTTS({ ttsEnabled, speak }));

    act(() => result.current.playCompletionPing());

    expect(playPingMock).toHaveBeenCalledOnce();
  });

  it('falls back to a UI ping when a TTS response arrives with spoken replies disabled', () => {
    const ttsEnabled = { current: false };
    const speak = { current: vi.fn() };
    const { result } = renderHook(() => useChatTTS({ ttsEnabled, speak }));

    act(() => result.current.handleFinalTTS({
      message: { role: 'assistant', content: 'Done' },
      text: 'Done',
      ttsText: 'Task complete',
      charts: [],
    }, true));

    expect(speak.current).not.toHaveBeenCalled();
    expect(playPingMock).toHaveBeenCalledOnce();
  });
});
