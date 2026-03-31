/** Tests for server/lib/constants.ts — URL construction with env overrides. */
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('constants module', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  describe('OPENAI_WHISPER_URL', () => {
    it('omits api-version when OPENAI_API_VERSION is not set', async () => {
      delete process.env.OPENAI_API_VERSION;
      vi.resetModules();
      const { OPENAI_WHISPER_URL } = await import('./constants.js');
      expect(OPENAI_WHISPER_URL).not.toContain('api-version');
      expect(OPENAI_WHISPER_URL).toMatch(/\/audio\/transcriptions$/);
    });

    it('appends api-version when OPENAI_API_VERSION is set', async () => {
      process.env.OPENAI_API_VERSION = '2024-06-01';
      vi.resetModules();
      const { OPENAI_WHISPER_URL } = await import('./constants.js');
      expect(OPENAI_WHISPER_URL).toContain('?api-version=2024-06-01');
    });

    it('uses custom base URL with api-version for Azure endpoints', async () => {
      process.env.OPENAI_BASE_URL = 'https://myresource.cognitiveservices.azure.com/openai/deployments/whisper';
      process.env.OPENAI_API_VERSION = '2024-06-01';
      vi.resetModules();
      const { OPENAI_WHISPER_URL } = await import('./constants.js');
      expect(OPENAI_WHISPER_URL).toBe(
        'https://myresource.cognitiveservices.azure.com/openai/deployments/whisper/audio/transcriptions?api-version=2024-06-01',
      );
    });
  });
});
