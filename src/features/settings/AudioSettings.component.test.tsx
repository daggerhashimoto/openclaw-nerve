import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, Mock } from 'vitest';
import { AudioSettings } from './AudioSettings';
import * as wakeWordSupport from '@/features/voice/wakeWordSupport';

vi.mock('@/features/voice/wakeWordSupport', () => ({
  getWakeWordSupport: vi.fn(() => ({ supported: true, reason: null })),
  isWakeWordSupportedEnvironment: vi.fn(() => true),
}));

vi.mock('@/features/tts/useTTSConfig', () => ({
  useTTSConfig: () => ({
    config: {
      edge: { voice: 'en-US-AriaNeural' },
      openai: { voice: 'alloy' },
      qwen3: { voice: 'Chelsie' },
    },
    saved: true,
    updateField: vi.fn(),
  }),
}));

vi.mock('./VoicePhrasesModal', () => ({
  VoicePhrasesModal: () => null,
}));

vi.mock('@/components/ui/InlineSelect', () => ({
  InlineSelect: () => <div data-testid="inline-select" />,
}));

const baseProps = {
  soundEnabled: true,
  onToggleSound: vi.fn(),
  ttsProvider: 'edge' as const,
  ttsModel: 'tts-1',
  onTtsProviderChange: vi.fn(),
  onTtsModelChange: vi.fn(),
  sttProvider: 'local' as const,
  sttInputMode: 'hybrid' as const,
  sttModel: 'base',
  onSttProviderChange: vi.fn(),
  onSttInputModeChange: vi.fn(),
  onSttModelChange: vi.fn(),
  wakeWordEnabled: true,
  onToggleWakeWord: vi.fn(),
  liveTranscriptionPreview: true,
  onToggleLiveTranscriptionPreview: vi.fn(),
  agentName: 'Kim',
  section: 'input' as const,
};

function mockWakeWordSupport(result: { supported: boolean; reason: 'mobile-web' | null }) {
  (wakeWordSupport.getWakeWordSupport as Mock).mockReturnValue(result);
  (wakeWordSupport.isWakeWordSupportedEnvironment as Mock).mockReturnValue(result.supported);
}

describe('AudioSettings mobile wake-word gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWakeWordSupport({ supported: true, reason: null });

    globalThis.fetch = vi.fn((input: string | URL) => {
      const url = String(input);

      if (url === '/api/transcribe/config') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ openaiKeySet: true, replicateKeySet: true, hasGpu: false }),
        } as Response);
      }

      if (url === '/api/language') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            language: 'en',
            supported: [{ code: 'en', name: 'English', nativeName: 'English' }],
            providers: { edge: true, qwen3: true, openai: true },
          }),
        } as Response);
      }

      if (url === '/api/language/support') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        } as Response);
      }

      if (url === '/api/voice-phrases/status') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        } as Response);
      }

      if (url.startsWith('/api/voice-phrases?lang=')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ wakePhrases: [] }),
        } as Response);
      }

      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    }) as typeof fetch;
  });

  it('renders the wake word toggle as disabled and visually off on mobile web', async () => {
    mockWakeWordSupport({ supported: false, reason: 'mobile-web' });

    render(<AudioSettings {...baseProps} wakeWordEnabled={true} />);

    const toggle = await screen.findByRole('switch', { name: /toggle wake word detection/i });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('shows helper copy pointing users to the manual mic trigger', async () => {
    mockWakeWordSupport({ supported: false, reason: 'mobile-web' });

    render(<AudioSettings {...baseProps} wakeWordEnabled={false} />);

    expect(await screen.findByText(/wake word isn't supported on mobile web/i)).toBeInTheDocument();
    expect(screen.getByText(/use the manual mic trigger instead/i)).toBeInTheDocument();
  });
});
