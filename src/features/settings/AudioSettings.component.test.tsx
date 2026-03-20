import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, Mock } from 'vitest';
import { AudioSettings } from './AudioSettings';
import * as wakeWordSupport from '@/features/voice/wakeWordSupport';

vi.mock('@/features/voice/wakeWordSupport', () => ({
  getWakeWordSupport: vi.fn(() => ({ supported: true, reason: null })),
  isWakeWordSupportedEnvironment: vi.fn(() => true),
}));

const updateField = vi.fn();

vi.mock('@/features/tts/useTTSConfig', () => ({
  useTTSConfig: () => ({
    config: {
      edge: { voice: 'en-US-AriaNeural' },
      openai: { model: 'tts-1', voice: 'alloy', instructions: '' },
      qwen: { mode: 'voice_design', language: 'English', speaker: 'Serena', voiceDescription: '', styleInstruction: '' },
      xiaomi: { model: 'mimo-v2-tts', voice: 'mimo_default', style: '' },
    },
    saved: true,
    updateField,
  }),
}));

vi.mock('./VoicePhrasesModal', () => ({
  VoicePhrasesModal: () => null,
}));

type InlineSelectOption = { value: string; label: string };
type InlineSelectMockProps = {
  ariaLabel: string;
  options: InlineSelectOption[];
  value: string;
  onChange: (value: string) => void;
};

vi.mock('@/components/ui/InlineSelect', () => ({
  InlineSelect: ({ ariaLabel, options, value, onChange }: InlineSelectMockProps) => (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  ),
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

type ApiKeyState = { openaiKeySet: boolean; replicateKeySet: boolean; xiaomiKeySet: boolean; hasGpu: boolean };
let apiKeyState: ApiKeyState = {
  openaiKeySet: true,
  replicateKeySet: true,
  xiaomiKeySet: false,
  hasGpu: false,
};

describe('AudioSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWakeWordSupport({ supported: true, reason: null });
    apiKeyState = {
      openaiKeySet: true,
      replicateKeySet: true,
      xiaomiKeySet: false,
      hasGpu: false,
    };

    globalThis.fetch = vi.fn((input: string | URL) => {
      const url = String(input);

      if (url === '/api/keys') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(apiKeyState),
        } as Response);
      }

      if (url === '/api/transcribe/config') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ hasGpu: apiKeyState.hasGpu }),
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
          json: () => Promise.resolve({ languages: [], isMultilingual: false }),
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

      if (url === '/api/tts/config') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        } as Response);
      }

      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    }) as typeof fetch;
  });

  describe('mobile wake-word gating', () => {
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

  describe('Xiaomi Mimo output settings', () => {
    it('renders a Xiaomi Mimo provider button', async () => {
      render(<AudioSettings {...baseProps} section="output" ttsProvider="xiaomi" ttsModel="" />);
      expect(await screen.findByRole('button', { name: 'Xiaomi Mimo' })).toBeInTheDocument();
    });

    it('shows the Xiaomi API key prompt when Xiaomi is selected and the key is missing', async () => {
      apiKeyState.xiaomiKeySet = false;
      render(<AudioSettings {...baseProps} section="output" ttsProvider="xiaomi" ttsModel="" />);

      expect(await screen.findByText(/MIMO_API_KEY required for Xiaomi Mimo/i)).toBeInTheDocument();
    });

    it('renders Xiaomi model and voice selectors', async () => {
      render(<AudioSettings {...baseProps} section="output" ttsProvider="xiaomi" ttsModel="mimo-v2-tts" />);

      expect(await screen.findByLabelText('TTS Model')).toHaveValue('mimo-v2-tts');
      expect(screen.getByLabelText('Xiaomi Voice')).toHaveValue('mimo_default');
      expect(screen.getByRole('option', { name: 'mimo-v2-tts' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'mimo_default' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'default_zh' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'default_en' })).toBeInTheDocument();
    });

    it('updates Xiaomi voice when the voice selector changes', async () => {
      render(<AudioSettings {...baseProps} section="output" ttsProvider="xiaomi" ttsModel="mimo-v2-tts" />);

      fireEvent.change(await screen.findByLabelText('Xiaomi Voice'), { target: { value: 'default_en' } });
      expect(updateField).toHaveBeenCalledWith('xiaomi', 'voice', 'default_en');
    });

    it('updates Xiaomi style when the Style field changes', async () => {
      render(<AudioSettings {...baseProps} section="output" ttsProvider="xiaomi" ttsModel="mimo-v2-tts" />);

      fireEvent.click(await screen.findByText('Happy, whisper, calm, dramatic...'));
      fireEvent.change(screen.getByPlaceholderText('Happy, whisper, calm, dramatic...'), { target: { value: 'Happy' } });

      expect(updateField).toHaveBeenCalledWith('xiaomi', 'style', 'Happy');
    });
  });
});
