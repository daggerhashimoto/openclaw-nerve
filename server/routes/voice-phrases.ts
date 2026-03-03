/**
 * Voice phrases API — per-language stop/cancel phrase management.
 *
 * GET  /api/voice-phrases?lang=fr  → effective phrases for that language (no English merge)
 * GET  /api/voice-phrases/:lang    → language-only phrases (no English merge)
 * PUT  /api/voice-phrases/:lang    → save custom phrases for a language
 * GET  /api/voice-phrases/status   → which languages have custom phrases configured
 */

import { Hono } from 'hono';
import { config } from '../lib/config.js';
import { DEFAULT_VOICE_PHRASES, SUPPORTED_LANGUAGES } from '../lib/constants.js';
import {
  getVoicePhrases,
  getLanguagePhrases,
  hasCustomPhrases,
  setLanguagePhrases,
} from '../lib/voice-phrases.js';

const app = new Hono();

/**
 * GET /api/voice-phrases — effective phrases for current (or specified) language.
 * Client uses these for voice recognition matching.
 * Query param `lang` overrides the server config language.
 */
app.get('/api/voice-phrases', (c) => {
  const lang = (c.req.query('lang') || config.language || 'en').toLowerCase();
  return c.json(getVoicePhrases(lang));
});

/**
 * GET /api/voice-phrases/status — which languages have custom phrases.
 * Used by the UI to decide whether to show the configuration modal.
 */
app.get('/api/voice-phrases/status', (c) => {
  const status: Record<string, { configured: boolean; hasDefaults: boolean }> = {};
  for (const lang of SUPPORTED_LANGUAGES) {
    status[lang.code] = {
      configured: hasCustomPhrases(lang.code),
      hasDefaults: lang.code in DEFAULT_VOICE_PHRASES,
    };
  }
  return c.json(status);
});

/**
 * GET /api/voice-phrases/:lang — phrases for a specific language (no English merge).
 * Returns custom phrases if set, otherwise defaults, otherwise null.
 */
app.get('/api/voice-phrases/:lang', (c) => {
  const lang = c.req.param('lang').toLowerCase();
  const custom = getLanguagePhrases(lang);
  if (custom) return c.json({ source: 'custom', ...custom });
  const defaults = DEFAULT_VOICE_PHRASES[lang];
  if (defaults) return c.json({ source: 'defaults', ...defaults });
  return c.json({ source: 'none', stopPhrases: [], cancelPhrases: [] });
});

/**
 * PUT /api/voice-phrases/:lang — save custom phrases for a language.
 */
app.put('/api/voice-phrases/:lang', async (c) => {
  const lang = c.req.param('lang').toLowerCase();
  const valid = SUPPORTED_LANGUAGES.some(l => l.code === lang) || lang === 'en';
  if (!valid) return c.text(`Unsupported language: ${lang}`, 400);

  try {
    const body = await c.req.json() as { stopPhrases?: string[]; cancelPhrases?: string[]; wakePhrases?: string[] };
    if (!body.stopPhrases && !body.cancelPhrases && !body.wakePhrases) {
      return c.text('At least one of stopPhrases, cancelPhrases, or wakePhrases required', 400);
    }

    // Merge with existing or defaults
    const existing = getLanguagePhrases(lang) || DEFAULT_VOICE_PHRASES[lang] || { stopPhrases: [], cancelPhrases: [] };
    setLanguagePhrases(lang, {
      stopPhrases: Array.isArray(body.stopPhrases) ? body.stopPhrases : existing.stopPhrases,
      cancelPhrases: Array.isArray(body.cancelPhrases) ? body.cancelPhrases : existing.cancelPhrases,
      wakePhrases: Array.isArray(body.wakePhrases) ? body.wakePhrases : existing.wakePhrases,
    });

    return c.json({ ok: true, lang });
  } catch {
    return c.text('Invalid JSON body', 400);
  }
});

export default app;
