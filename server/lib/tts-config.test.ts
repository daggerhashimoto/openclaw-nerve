/** Tests for language-aware Edge TTS voice resolution. */
import { describe, it, expect, vi } from 'vitest';

type Gender = 'female' | 'male';

interface MockLanguageEntry {
  edgeTtsVoices: { female: string; male: string };
}

const MOCK_LANGUAGES: Record<string, MockLanguageEntry> = {
  en: {
    edgeTtsVoices: { female: 'en-US-AriaNeural', male: 'en-US-GuyNeural' },
  },
  tr: {
    edgeTtsVoices: { female: 'tr-TR-EmelNeural', male: 'tr-TR-AhmetNeural' },
  },
  bn: {
    edgeTtsVoices: { female: 'bn-IN-TanishaaNeural', male: 'bn-BD-PradeepNeural' },
  },
};

async function loadTtsModule(opts: {
  language: string;
  edgeVoiceGender: Gender;
  storedVoice: string;
}) {
  vi.resetModules();

  vi.doMock('./config.js', () => ({
    config: {
      language: opts.language,
      edgeVoiceGender: opts.edgeVoiceGender,
    },
  }));

  vi.doMock('./language.js', () => ({
    getEdgeTtsVoice: (langCode: string, gender: Gender = 'female') => {
      const lang = MOCK_LANGUAGES[langCode] || MOCK_LANGUAGES.en;
      return lang.edgeTtsVoices[gender];
    },
    getQwen3Language: () => null,
    getFallbackInfo: () => ({ supported: true, fallbackLang: 'en' }),
    resolveLanguage: (langCode: string) => MOCK_LANGUAGES[langCode],
  }));

  vi.doMock('node:fs', () => ({
    default: {
      existsSync: () => false,
      readFileSync: () => '',
      writeFileSync: () => {},
    },
  }));

  const mod = await import('./tts-config.js');
  mod.updateTTSConfig({ edge: { voice: opts.storedVoice } });
  return mod;
}

describe('getTTSConfig', () => {
  it('returns Xiaomi defaults when config file is missing', async () => {
    const mod = await loadTtsModule({
      language: 'en',
      edgeVoiceGender: 'female',
      storedVoice: 'en-US-JennyNeural',
    });

    const cfg = mod.getTTSConfig();
    expect(cfg.xiaomi.model).toBe('mimo-v2-tts');
    expect(cfg.xiaomi.voice).toBe('mimo_default');
    expect(cfg.xiaomi.style).toBe('');
  });

  it('deep-merges Xiaomi patches without dropping defaults', async () => {
    const mod = await loadTtsModule({
      language: 'en',
      edgeVoiceGender: 'female',
      storedVoice: 'en-US-JennyNeural',
    });

    const cfg = mod.updateTTSConfig({ xiaomi: { style: 'Happy' } });
    expect(cfg.xiaomi.style).toBe('Happy');
    expect(cfg.xiaomi.model).toBe('mimo-v2-tts');
    expect(cfg.xiaomi.voice).toBe('mimo_default');
  });
});

describe('resolveEdgeTTSVoice', () => {
  it('keeps explicit non-default English override', async () => {
    const mod = await loadTtsModule({
      language: 'en',
      edgeVoiceGender: 'female',
      storedVoice: 'en-US-JennyNeural',
    });

    const resolved = mod.resolveEdgeTTSVoice();
    expect(resolved.voice).toBe('en-US-JennyNeural');
    expect(resolved.language).toBe('en');
  });

  it('falls back to selected non-English language voice when stored voice is English', async () => {
    const mod = await loadTtsModule({
      language: 'tr',
      edgeVoiceGender: 'male',
      storedVoice: 'en-US-JennyNeural',
    });

    const resolved = mod.resolveEdgeTTSVoice();
    expect(resolved.voice).toBe('tr-TR-AhmetNeural');
    expect(resolved.language).toBe('tr');
  });

  it('accepts a valid locale for selected language even if it does not match current gender default', async () => {
    const mod = await loadTtsModule({
      language: 'bn',
      edgeVoiceGender: 'female',
      storedVoice: 'bn-BD-PradeepNeural',
    });

    const resolved = mod.resolveEdgeTTSVoice();
    expect(resolved.voice).toBe('bn-BD-PradeepNeural');
    expect(resolved.language).toBe('bn');
  });

  it('accepts locale-compatible custom non-English voice variants', async () => {
    const mod = await loadTtsModule({
      language: 'tr',
      edgeVoiceGender: 'female',
      storedVoice: 'tr-TR-CustomVoiceNeural',
    });

    const resolved = mod.resolveEdgeTTSVoice();
    expect(resolved.voice).toBe('tr-TR-CustomVoiceNeural');
    expect(resolved.language).toBe('tr');
  });
});
