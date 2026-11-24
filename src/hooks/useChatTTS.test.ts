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

  it('auto-speaks fallback text for a voice message even after resetPlayedSounds runs on turn start', () => {
    const soundEnabled = { current: false };
    const speak = { current: vi.fn() };
    const { result } = renderHook(() => useChatTTS({ soundEnabled, speak }));

    act(() => {
      result.current.trackVoiceMessage('[voice] What is the weather?');
      result.current.resetPlayedSounds();
      result.current.handleFinalTTS({
        message: { role: 'assistant', content: 'It is sunny outside.' },
        text: 'It is sunny outside.',
        ttsText: null,
        charts: [],
      }, true);
    });

    expect(speak.current).toHaveBeenCalledWith('It is sunny outside.');
  });

  it('does not speak a fallback after the voice run clears its tracking on abort or error', () => {
    const soundEnabled = { current: false };
    const speak = { current: vi.fn() };
    const { result } = renderHook(() => useChatTTS({ soundEnabled, speak }));

    act(() => {
      result.current.trackVoiceMessage('[voice] What is the weather?');
      result.current.clearVoiceMessage();
      result.current.handleFinalTTS({
        message: { role: 'assistant', content: 'It is sunny outside.' },
        text: 'It is sunny outside.',
        ttsText: null,
        charts: [],
      }, true);
    });

    expect(speak.current).not.toHaveBeenCalled();
  });

  it('keeps a pending voice fallback for its owner when another run finalizes first', () => {
    const soundEnabled = { current: false };
    const speak = { current: vi.fn() };
    const { result } = renderHook(() => useChatTTS({ soundEnabled, speak }));

    act(() => {
      result.current.trackVoiceMessage('[voice] What is the weather?');
      // Run A finalizes after the send but before its acknowledgement; it must
      // not consume B's pending fallback.
      result.current.handleFinalTTS({
        message: { role: 'assistant', content: 'Unrelated earlier reply.' },
        text: 'Unrelated earlier reply.',
        ttsText: null,
        charts: [],
      }, true, false);
    });
    expect(speak.current).not.toHaveBeenCalled();

    act(() => {
      result.current.handleFinalTTS({
        message: { role: 'assistant', content: 'It is sunny outside.' },
        text: 'It is sunny outside.',
        ttsText: null,
        charts: [],
      }, true, true);
    });
    expect(speak.current).toHaveBeenCalledWith('It is sunny outside.');
  });

  it('speaks explicit ttsText without consuming another run\'s voice fallback', () => {
    const soundEnabled = { current: false };
    const speak = { current: vi.fn() };
    const { result } = renderHook(() => useChatTTS({ soundEnabled, speak }));

    act(() => {
      result.current.trackVoiceMessage('[voice] What is the weather?');
      result.current.handleFinalTTS({
        message: { role: 'assistant', content: 'Earlier run.' },
        text: 'Earlier run.',
        ttsText: 'Earlier spoken reply.',
        charts: [],
      }, true, false);
    });
    expect(speak.current).toHaveBeenCalledWith('Earlier spoken reply.');

    act(() => {
      result.current.handleFinalTTS({
        message: { role: 'assistant', content: 'It is sunny outside.' },
        text: 'It is sunny outside.',
        ttsText: null,
        charts: [],
      }, true, true);
    });
    expect(speak.current).toHaveBeenLastCalledWith('It is sunny outside.');
  });
});
