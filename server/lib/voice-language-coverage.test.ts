/** Coverage checks for multilingual server-side voice phrase defaults. */
import { describe, it, expect } from 'vitest';
import { DEFAULT_LANGUAGE, DEFAULT_VOICE_PHRASES, SUPPORTED_LANGUAGES, WHISPER_DEFAULT_MODEL } from './constants.js';

describe('server multilingual voice phrase coverage', () => {
  it('should default to English language preference', () => {
    expect(DEFAULT_LANGUAGE).toBe('en');
  });

  it('should default local whisper model to base', () => {
    expect(WHISPER_DEFAULT_MODEL).toBe('base');
  });

  it('should provide stop and cancel defaults for every supported language', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const defaults = DEFAULT_VOICE_PHRASES[language.code];

      expect(defaults, `missing defaults for ${language.code}`).toBeDefined();
      expect(defaults.stopPhrases.length, `missing stop phrases for ${language.code}`).toBeGreaterThan(0);
      expect(defaults.cancelPhrases.length, `missing cancel phrases for ${language.code}`).toBeGreaterThan(0);

      defaults.stopPhrases.forEach((phrase) => {
        expect(phrase.trim().length).toBeGreaterThan(0);
      });
      defaults.cancelPhrases.forEach((phrase) => {
        expect(phrase.trim().length).toBeGreaterThan(0);
      });
    }
  });
});
